/**
 * Large Document Operations
 *
 * Core operations for uploading, indexing, and searching large documents.
 * Uses the same embedding infrastructure as the knowledge base but stores
 * documents in a separate database optimized for large file handling.
 *
 * 2025 Best Practices Applied:
 * - Chunk size: 512 tokens (optimal for fact-focused Q&A retrieval)
 * - Chunk overlap: 75 tokens (~15%, NVIDIA benchmark optimal)
 * - Optional reranking: Cross-encoder reranking for 20-40% accuracy boost
 * - Hybrid search with RRF fusion for better precision/recall balance
 *
 * Phases 3/4/5/6/7 of PDF_TRANSCRIPTION_ACTION_PLAN.md:
 * - Per-page extraction with quality scoring (Phase 3)
 * - Parallel AI extraction over 5-page sub-PDFs (Phase 4)
 * - Page-aware chunking with required pageStart/pageEnd (Phase 5)
 * - New status enum: stored | extracting | embedding | ready | error (Phase 6)
 * - Per-page extraction cache, keyed by file hash, for cheap retries (Phase 7)
 */

import {
  getLargeDocumentsDb,
  removeDocumentUmapCache,
  storeDocumentFile,
  deleteDocumentFile,
  getDocumentFile,
  getCachedPageExtraction,
  setCachedPageExtraction,
  deleteCachedExtractionsForDocument,
} from "./idb";
import { chunkMarkdown, chunkPaged, type ChunkOptions, type PagedChunk } from "../embeddings/chunker";
import { embedTexts, embedQuery } from "../embeddings/embed-client";
import { rerank, getRecommendedReranker, type RerankDocument, type RerankerConfig } from "../embeddings/reranker";
import { largeDocLexicalSearch, detectQueryType, type LargeDocLexicalResult } from "./lexical-search";
import { extractPdfPages, type PageExtraction } from "./page-extraction";
import { groupPagesForAi, extractRangesViaAi } from "./pdf-split";
import type {
  LargeDocumentMetadata,
  LargeDocumentChunk,
  LargeDocumentSearchResult,
  IndexingProgress,
  LargeDocumentFile,
} from "./types";

const DEFAULT_CHUNK_OPTIONS: ChunkOptions = {
  maxTokens: 512,
  overlapTokens: 75,
  minTokens: 50,
};

export interface LargeDocumentSearchOptions {
  topK?: number;
  threshold?: number;
  rerank?: boolean;
  rerankerBackend?: RerankerConfig["backend"];
  retrieveK?: number;
  includeBreakdown?: boolean;
  rrfK?: number;
}

function generateId(): string {
  return crypto.randomUUID();
}

async function sha256(text: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(text);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function sha256Bytes(bytes: ArrayBuffer): Promise<string> {
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0,
    normA = 0,
    normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denominator = Math.sqrt(normA) * Math.sqrt(normB);
  return denominator === 0 ? 0 : dot / denominator;
}

// =============================================================================
// PDF EXTRACTION (Phase 3+4+7 pipeline)
// =============================================================================

/**
 * Re-export of the modern per-page extractor. The legacy `extractPdfText`
 * wrapper still lives in `page-extraction.ts` for one release so the
 * legacy `uploadLargeDocumentFromText` path keeps working.
 */
export { extractPdfPages } from "./page-extraction";
export { extractPdfText } from "./page-extraction";

/**
 * Send a PDF (or sub-PDF) to `/api/parse-pdf` and return the extracted text.
 *
 * The route returns a text stream (Phase 4); we collect it into a single
 * string here for callers that don't care about deltas. Provider is
 * Gemini 2.5 Flash.
 */
export async function parsePdfWithAi(file: File): Promise<string> {
  const formData = new FormData();
  formData.append("file", file);
  formData.append("useFreeTrial", "true");

  const response = await fetch("/api/parse-pdf", { method: "POST", body: formData });
  if (!response.ok) {
    let message = "PDF parsing with AI failed";
    try {
      const err = await response.json();
      message = err.error ?? message;
    } catch {
      // ignore
    }
    throw new Error(message);
  }

  if (!response.body) {
    return await response.text();
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let out = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    out += decoder.decode(value, { stream: true });
  }
  out += decoder.decode();
  console.log(`[PDF] Gemini extracted ${out.length} chars`);
  return out;
}

export interface StoredDocumentResult {
  metadata: LargeDocumentMetadata;
  fileData: ArrayBuffer;
}

/**
 * Store a large document for immediate viewing.
 * Fast path: writes file + metadata, status = `stored`.
 * Call `indexLargeDocumentInBackground()` separately to index for search.
 */
export async function storeLargeDocument(
  file: File,
  description?: string,
): Promise<StoredDocumentResult> {
  const db = await getLargeDocumentsDb();
  const documentId = generateId();
  const mimeType = file.type || "text/plain";

  const metadata: LargeDocumentMetadata = {
    id: documentId,
    filename: file.name,
    mimeType,
    fileSize: file.size,
    chunkCount: 0,
    uploadedAt: Date.now(),
    indexedAt: 0,
    description,
    status: "stored",
  };

  await db.put("documents", metadata);

  const fileData = await file.arrayBuffer();
  await storeDocumentFile(documentId, fileData, mimeType);

  console.log(`[LargeDocs] Stored document ${documentId}`);
  return { metadata, fileData };
}

interface IndexedPage {
  pageIndex: number; // 0-based
  text: string;
  source: "pdfjs" | "ai";
}

/**
 * Interleaved PDF extraction.
 *
 * Same per-page extraction pipeline as `runPdfExtraction`, but the pdfjs
 * "good" pages and each AI range are handed to the `onPagesReady`
 * callback as soon as they're available. The caller (typically
 * `indexLargeDocumentInBackground`) chunks + embeds + persists each wave
 * immediately, so a large document becomes searchable mid-extraction.
 */
async function runPdfExtractionInterleaved(
  documentId: string,
  file: File,
  fileBytes: ArrayBuffer,
  fileHash: string,
  onProgress: ((p: IndexingProgress) => void) | undefined,
  onPagesReady: (
    pages: Array<{ pageIndex: number; text: string }>,
    label: string,
  ) => Promise<void>,
): Promise<void> {
  onProgress?.({
    current: 0,
    total: 5,
    status: "pdf-extraction",
    message: "Reading PDF pages…",
  });

  const { pages, numPages } = await extractPdfPages(file);

  // Cache pdfjs results for "good" pages and persist them immediately.
  const goodPages: Array<{ pageIndex: number; text: string }> = [];
  for (const p of pages) {
    if (p.quality === "good") {
      await setCachedPageExtraction({
        documentId,
        pageIndex: p.pageIndex,
        source: "pdfjs",
        text: p.text,
        fileHash,
        createdAt: Date.now(),
      });
      goodPages.push({ pageIndex: p.pageIndex, text: p.text });
    }
  }

  // Identify pages still needing AI; honor the per-page extraction cache so
  // retries don't re-OCR previously-completed pages.
  const pendingPages: PageExtraction[] = [];
  const cachedAiPages: Array<{ pageIndex: number; text: string }> = [];
  for (const p of pages) {
    if (p.quality === "good") continue;
    const cached = await getCachedPageExtraction(documentId, p.pageIndex, "ai", fileHash);
    if (cached) {
      cachedAiPages.push({ pageIndex: p.pageIndex, text: cached.text });
    } else {
      pendingPages.push(p);
    }
  }

  // First wave: persist everything we already have (pdfjs good + cached AI).
  // This makes the document searchable before any AI calls run.
  const firstWave = [...goodPages, ...cachedAiPages].sort(
    (a, b) => a.pageIndex - b.pageIndex,
  );
  if (firstWave.length > 0) {
    await onPagesReady(firstWave, `pdfjs+cache (${firstWave.length} pages)`);
  }

  let pagesProcessed = firstWave.length;
  onProgress?.({
    current: 1,
    total: 5,
    status: "pdf-extraction",
    message: pendingPages.length === 0
      ? `Extracted ${numPages} pages from PDF.js`
      : `pdf.js handled ${pagesProcessed}/${numPages} pages`,
    pagesProcessed,
    pagesTotal: numPages,
    currentSource: "pdfjs",
  });

  if (pendingPages.length === 0) return;

  const ranges = groupPagesForAi(pendingPages);
  let rangesDone = 0;

  onProgress?.({
    current: 1.2,
    total: 5,
    status: "ai-extraction",
    message: `AI extracting ${pendingPages.length} pages in ${ranges.length} chunk${ranges.length === 1 ? "" : "s"}…`,
    pagesProcessed,
    pagesTotal: numPages,
    currentSource: "ai",
    aiRangesDone: 0,
    aiRangesTotal: ranges.length,
  });

  await extractRangesViaAi(fileBytes, ranges, {
    concurrency: 4,
    onRangeDone: async (result) => {
      rangesDone++;
      const rangeLen = result.range.endIndex - result.range.startIndex + 1;
      pagesProcessed += rangeLen;

      if (!result.error) {
        const pagesForRange: Array<{ pageIndex: number; text: string }> = [];
        for (const pp of result.pages) {
          if (pp.text) {
            await setCachedPageExtraction({
              documentId,
              pageIndex: pp.pageIndex,
              source: "ai",
              text: pp.text,
              fileHash,
              createdAt: Date.now(),
            });
            pagesForRange.push({ pageIndex: pp.pageIndex, text: pp.text });
          }
        }
        if (pagesForRange.length > 0) {
          await onPagesReady(
            pagesForRange,
            `ai range ${result.range.startIndex + 1}–${result.range.endIndex + 1}`,
          );
        }
      }

      onProgress?.({
        current: 1.2 + (rangesDone / ranges.length) * 1.3,
        total: 5,
        status: "ai-extraction",
        message: result.error
          ? `Pages ${result.range.startIndex + 1}–${result.range.endIndex + 1} failed`
          : `Extracted pages ${result.range.startIndex + 1}–${result.range.endIndex + 1}`,
        pagesProcessed,
        pagesTotal: numPages,
        currentSource: "ai",
        aiRangesDone: rangesDone,
        aiRangesTotal: ranges.length,
      });
    },
  });
}

/**
 * Run the per-page PDF extraction pipeline:
 *   1. pdf.js extracts every page locally; each page is quality-scored.
 *   2. Pages flagged `low` or `failed` are grouped into ≤5-page ranges.
 *   3. Sub-PDFs for those ranges are sent to /api/parse-pdf in parallel
 *      (concurrency=4) — each call streams text back via Gemini 2.5 Flash.
 *   4. Per-page results are written to the extractionCache (keyed by
 *      [documentId, pageIndex, source] + invalidated on file-hash change).
 *
 * Per-range failures DO NOT fail the document: those pages return empty
 * text and the caller can surface a "Pages X–Y failed" affordance.
 *
 * NOTE: This non-interleaved variant is preserved for legacy callers but
 * the main indexing pipeline uses `runPdfExtractionInterleaved` so chunks
 * become searchable mid-extraction.
 */
async function runPdfExtraction(
  documentId: string,
  file: File,
  fileBytes: ArrayBuffer,
  fileHash: string,
  onProgress: ((p: IndexingProgress) => void) | undefined,
): Promise<IndexedPage[]> {
  // Step 1: per-page extraction with pdf.js
  onProgress?.({
    current: 0,
    total: 5,
    status: "pdf-extraction",
    message: "Reading PDF pages…",
  });

  const { pages, numPages } = await extractPdfPages(file);

  // Cache pdfjs results for "good" pages (cheap to recompute, but keeping
  // them lets retries skip pdf.js entirely on huge PDFs).
  for (const p of pages) {
    if (p.quality === "good") {
      await setCachedPageExtraction({
        documentId,
        pageIndex: p.pageIndex,
        source: "pdfjs",
        text: p.text,
        fileHash,
        createdAt: Date.now(),
      });
    }
  }

  const final: IndexedPage[] = pages.map((p) =>
    p.quality === "good"
      ? { pageIndex: p.pageIndex, text: p.text, source: "pdfjs" as const }
      : { pageIndex: p.pageIndex, text: "", source: "ai" as const },
  );

  // Step 2: identify pages still needing AI (skip those already cached).
  const pendingPages: PageExtraction[] = [];
  for (const p of pages) {
    if (p.quality === "good") continue;
    const cached = await getCachedPageExtraction(documentId, p.pageIndex, "ai", fileHash);
    if (cached) {
      final[p.pageIndex] = {
        pageIndex: p.pageIndex,
        text: cached.text,
        source: "ai",
      };
    } else {
      pendingPages.push(p);
    }
  }

  let pagesProcessed = pages.filter((p) => p.quality === "good").length +
    (pages.length - pages.filter((p) => p.quality === "good").length - pendingPages.length);

  onProgress?.({
    current: 1,
    total: 5,
    status: "pdf-extraction",
    message: pendingPages.length === 0
      ? `Extracted ${numPages} pages from PDF.js`
      : `pdf.js handled ${pagesProcessed}/${numPages} pages`,
    pagesProcessed,
    pagesTotal: numPages,
    currentSource: "pdfjs",
  });

  if (pendingPages.length === 0) return final;

  // Step 3: group + parallel AI extraction.
  const ranges = groupPagesForAi(pendingPages);
  let rangesDone = 0;

  onProgress?.({
    current: 1.2,
    total: 5,
    status: "ai-extraction",
    message: `AI extracting ${pendingPages.length} pages in ${ranges.length} chunk${ranges.length === 1 ? "" : "s"}…`,
    pagesProcessed,
    pagesTotal: numPages,
    currentSource: "ai",
    aiRangesDone: 0,
    aiRangesTotal: ranges.length,
  });

  const results = await extractRangesViaAi(fileBytes, ranges, {
    concurrency: 4,
    onRangeDone: async (result) => {
      rangesDone++;
      const rangeLen = result.range.endIndex - result.range.startIndex + 1;
      pagesProcessed += rangeLen;

      // Write per-page cache entries — for now Gemini returns the joined
      // text on the first page of the range; we cache it as the entire
      // range's text on that first page slot.
      if (!result.error) {
        for (const pp of result.pages) {
          if (pp.text) {
            await setCachedPageExtraction({
              documentId,
              pageIndex: pp.pageIndex,
              source: "ai",
              text: pp.text,
              fileHash,
              createdAt: Date.now(),
            });
          }
          final[pp.pageIndex] = {
            pageIndex: pp.pageIndex,
            text: pp.text,
            source: "ai",
          };
        }
      }

      onProgress?.({
        current: 1.2 + (rangesDone / ranges.length) * 1.3,
        total: 5,
        status: "ai-extraction",
        message: result.error
          ? `Pages ${result.range.startIndex + 1}–${result.range.endIndex + 1} failed`
          : `Extracted pages ${result.range.startIndex + 1}–${result.range.endIndex + 1}`,
        pagesProcessed,
        pagesTotal: numPages,
        currentSource: "ai",
        aiRangesDone: rangesDone,
        aiRangesTotal: ranges.length,
      });
    },
  });

  const failedRanges = results.filter((r) => r.error);
  if (failedRanges.length > 0) {
    console.warn(
      `[LargeDocs] ${failedRanges.length}/${results.length} AI ranges failed for ${documentId}`,
    );
  }

  return final;
}

/**
 * Chunk + embed + persist a group of pages.
 *
 * Pulled out of `indexLargeDocumentInBackground` so it can be called
 * incrementally — once for the pdfjs "good" pages right after extraction,
 * and again for each AI range as it completes. This is what makes a document
 * searchable mid-extraction.
 *
 * - `nextChunkIndex` is a mutable counter so chunkIndex stays globally unique
 *   across calls within one document.
 * - `existingHashMap` is shared across calls so embedding reuse keeps working
 *   even when chunks land in multiple waves.
 * - Writes are committed per embedding batch (≤20) so partial RAG kicks in
 *   ASAP.
 */
async function chunkEmbedAndPersistPages(
  db: Awaited<ReturnType<typeof getLargeDocumentsDb>>,
  documentId: string,
  pages: Array<{ pageIndex: number; text: string }>,
  existingHashMap: Map<string, LargeDocumentChunk>,
  nextChunkIndex: { value: number },
  reusedCount: { value: number },
  groupLabel: string,
): Promise<LargeDocumentChunk[]> {
  const eligible = pages.filter((p) => p.text && p.text.trim().length > 0);
  if (eligible.length === 0) return [];

  const chunks: PagedChunk[] = chunkPaged(eligible, DEFAULT_CHUNK_OPTIONS);
  if (chunks.length === 0) return [];

  const BATCH_SIZE = 20;
  const written: LargeDocumentChunk[] = [];

  for (let i = 0; i < chunks.length; i += BATCH_SIZE) {
    const batch = chunks.slice(i, i + BATCH_SIZE);

    const batchHashes: string[] = [];
    const needsEmbedding: { batchIdx: number; text: string }[] = [];
    for (let j = 0; j < batch.length; j++) {
      const hash = await sha256(batch[j].text);
      batchHashes.push(hash);
      if (!existingHashMap.has(hash)) {
        needsEmbedding.push({ batchIdx: j, text: batch[j].text });
      }
    }

    let newEmbeddings: number[][] = [];
    if (needsEmbedding.length > 0) {
      newEmbeddings = await embedTexts(needsEmbedding.map((n) => n.text));
    }

    const batchRecords: LargeDocumentChunk[] = [];
    let newEmbIdx = 0;
    for (let j = 0; j < batch.length; j++) {
      const chunk = batch[j];
      const contentHash = batchHashes[j];
      const existing = existingHashMap.get(contentHash);

      let embedding: number[];
      if (existing) {
        embedding = existing.embedding;
        reusedCount.value++;
      } else {
        embedding = newEmbeddings[newEmbIdx++];
      }

      const chunkIndex = nextChunkIndex.value++;
      const record: LargeDocumentChunk = {
        id: `${documentId}#${chunkIndex}`,
        documentId,
        chunkIndex,
        chunkText: chunk.text,
        contentHash,
        headingPath: chunk.headingPath,
        embedding,
        updatedAt: Date.now(),
        pageStart: chunk.pageStart,
        pageEnd: chunk.pageEnd,
      };
      batchRecords.push(record);
      // Track this hash so a later wave with identical text reuses the new
      // embedding instead of paying for another API call.
      existingHashMap.set(contentHash, record);
    }

    const batchTx = db.transaction("chunks", "readwrite");
    for (const record of batchRecords) {
      await batchTx.store.put(record);
    }
    await batchTx.done;

    written.push(...batchRecords);
  }

  console.log(
    `[LargeDocs] ${groupLabel}: chunked+embedded+wrote ${written.length} chunks`,
  );
  return written;
}

/**
 * Index a stored document in the background.
 *
 * Status flow: `stored` -> `extracting` -> `embedding` -> `ready`.
 * On failure: status -> `error` with `errorMessage` set.
 *
 * For PDFs, chunking + embedding is interleaved with extraction so chunks
 * become searchable as soon as their pages are extracted, rather than
 * waiting for the entire document. The status flips from `extracting` to
 * `embedding` as soon as the first chunk is written.
 */
export async function indexLargeDocumentInBackground(
  documentId: string,
  file: File,
  onProgress?: (progress: IndexingProgress) => void,
): Promise<LargeDocumentMetadata> {
  const db = await getLargeDocumentsDb();
  const mimeType = file.type || "text/plain";

  const metadata = await db.get("documents", documentId);
  if (!metadata) {
    throw new Error(`Document ${documentId} not found for indexing`);
  }

  try {
    metadata.status = "extracting";
    // Clear any prior error from a previous failed run so the UI doesn't
    // keep showing a stale "API key required"/etc. message during retry.
    metadata.errorMessage = undefined;
    await db.put("documents", metadata);

    onProgress?.({
      current: 0,
      total: 5,
      status: "parsing",
      message: "Parsing document…",
    });

    // Snapshot existing chunks once so embedding reuse works across all
    // interleaved waves below.
    const existingChunks = await db.getAllFromIndex("chunks", "by-document", documentId);
    const existingHashMap = new Map<string, LargeDocumentChunk>();
    for (const c of existingChunks) {
      existingHashMap.set(c.contentHash, c);
    }
    const reusedCount = { value: 0 };
    const nextChunkIndex = { value: 0 };
    const allWrittenIds = new Set<string>();
    let firstWaveDone = false;

    const persist = async (
      pages: Array<{ pageIndex: number; text: string }>,
      label: string,
    ) => {
      const written = await chunkEmbedAndPersistPages(
        db,
        documentId,
        pages,
        existingHashMap,
        nextChunkIndex,
        reusedCount,
        label,
      );
      for (const r of written) allWrittenIds.add(r.id);

      // First time we successfully write any chunks, flip to "embedding"
      // so search picks the document up immediately.
      if (!firstWaveDone && written.length > 0) {
        firstWaveDone = true;
        metadata.status = "embedding";
        metadata.chunkCount = allWrittenIds.size;
        await db.put("documents", metadata);
      } else if (firstWaveDone && written.length > 0) {
        // Keep chunkCount fresh as more waves land so the UI reflects progress.
        metadata.chunkCount = allWrittenIds.size;
        await db.put("documents", metadata);
      }
    };

    if (mimeType === "application/pdf") {
      const fileBytes = await file.arrayBuffer();
      const fileHash = await sha256Bytes(fileBytes);

      // Run extraction with an interleaved persist callback. The pdfjs
      // "good" pages are persisted in one wave right after pdf.js finishes;
      // each AI range becomes its own wave when it completes.
      await runPdfExtractionInterleaved(
        documentId,
        file,
        fileBytes,
        fileHash,
        onProgress,
        persist,
      );
    } else {
      const content = await file.text();
      // Non-PDF sources are treated as a single page so the v2 schema
      // invariant (`pageStart`/`pageEnd` required) is trivially satisfied.
      // Use the markdown chunker to preserve heading-aware behavior, then
      // tag pageStart/pageEnd = 1.
      const flatChunks = chunkMarkdown(content, DEFAULT_CHUNK_OPTIONS).map((c) => ({
        ...c,
        pageStart: 1,
        pageEnd: 1,
      }));
      // Reuse the per-batch persistence machinery by feeding it as a single
      // page. chunkPaged on a single page would re-chunk, but we already have
      // chunks — simulate by writing directly.
      const BATCH_SIZE = 20;
      for (let i = 0; i < flatChunks.length; i += BATCH_SIZE) {
        const batch = flatChunks.slice(i, i + BATCH_SIZE);
        const batchHashes: string[] = [];
        const needsEmbedding: { batchIdx: number; text: string }[] = [];
        for (let j = 0; j < batch.length; j++) {
          const hash = await sha256(batch[j].text);
          batchHashes.push(hash);
          if (!existingHashMap.has(hash)) {
            needsEmbedding.push({ batchIdx: j, text: batch[j].text });
          }
        }
        let newEmbeddings: number[][] = [];
        if (needsEmbedding.length > 0) {
          newEmbeddings = await embedTexts(needsEmbedding.map((n) => n.text));
        }
        const batchRecords: LargeDocumentChunk[] = [];
        let newEmbIdx = 0;
        for (let j = 0; j < batch.length; j++) {
          const chunk = batch[j];
          const contentHash = batchHashes[j];
          const existing = existingHashMap.get(contentHash);
          let embedding: number[];
          if (existing) {
            embedding = existing.embedding;
            reusedCount.value++;
          } else {
            embedding = newEmbeddings[newEmbIdx++];
          }
          const chunkIndex = nextChunkIndex.value++;
          const record: LargeDocumentChunk = {
            id: `${documentId}#${chunkIndex}`,
            documentId,
            chunkIndex,
            chunkText: chunk.text,
            contentHash,
            headingPath: chunk.headingPath,
            embedding,
            updatedAt: Date.now(),
            pageStart: chunk.pageStart,
            pageEnd: chunk.pageEnd,
          };
          batchRecords.push(record);
          existingHashMap.set(contentHash, record);
        }
        const tx = db.transaction("chunks", "readwrite");
        for (const r of batchRecords) await tx.store.put(r);
        await tx.done;
        for (const r of batchRecords) allWrittenIds.add(r.id);

        if (!firstWaveDone && batchRecords.length > 0) {
          firstWaveDone = true;
          metadata.status = "embedding";
        }
        metadata.chunkCount = allWrittenIds.size;
        await db.put("documents", metadata);
      }
    }

    if (allWrittenIds.size === 0) {
      throw new Error("Document produced no chunks. It may be empty.");
    }

    if (reusedCount.value > 0) {
      console.log(
        `[LargeDocs] Reused ${reusedCount.value}/${allWrittenIds.size} embeddings via content hash match`,
      );
    }

    // Stale-chunk cleanup: anything from a prior indexing pass that wasn't
    // re-written this run.
    const oldChunkIds = new Set(existingChunks.map((c) => c.id));
    const staleChunkIds = [...oldChunkIds].filter((id) => !allWrittenIds.has(id));
    if (staleChunkIds.length > 0) {
      const cleanupTx = db.transaction("chunks", "readwrite");
      for (const staleId of staleChunkIds) {
        await cleanupTx.store.delete(staleId);
      }
      await cleanupTx.done;
    }

    metadata.chunkCount = allWrittenIds.size;
    metadata.indexedAt = Date.now();
    metadata.status = "ready";
    metadata.errorMessage = undefined;
    await db.put("documents", metadata);

    onProgress?.({
      current: 5,
      total: 5,
      status: "complete",
      message: `Indexed ${allWrittenIds.size} chunks successfully`,
    });

    console.log(
      `[LargeDocs] Finished indexing document ${documentId}: ${allWrittenIds.size} chunks`,
    );

    return metadata;
  } catch (error) {
    metadata.status = "error";
    metadata.errorMessage = error instanceof Error ? error.message : String(error);
    await db.put("documents", metadata);

    onProgress?.({
      current: 0,
      total: 5,
      status: "error",
      message: metadata.errorMessage,
    });

    console.error(`[LargeDocs] Indexing failed for document ${documentId}:`, error);
    throw error;
  }
}

/**
 * Upload + index synchronously. Legacy combined function; use
 * `storeLargeDocument` + `indexLargeDocumentInBackground` for the fast
 * "store-then-index" UX.
 */
export async function uploadLargeDocument(
  file: File,
  description?: string,
  onProgress?: (progress: IndexingProgress) => void,
): Promise<LargeDocumentMetadata> {
  const { metadata } = await storeLargeDocument(file, description);
  return indexLargeDocumentInBackground(metadata.id, file, onProgress);
}

export async function uploadLargeDocumentFromText(
  filename: string,
  content: string,
  mimeType: string = "text/plain",
  description?: string,
  onProgress?: (progress: IndexingProgress) => void,
): Promise<LargeDocumentMetadata> {
  const blob = new Blob([content], { type: mimeType });
  const file = new File([blob], filename, { type: mimeType });
  return uploadLargeDocument(file, description, onProgress);
}

/**
 * Detect documents whose indexing was interrupted (tab closed, crash)
 * and flip them to `error` so they can be retried. Returns the count of
 * documents recovered. Called once on app boot from the
 * large-document-browser mount effect — single source of truth.
 */
export async function recoverInterruptedDocuments(
  staleAfterMs: number = 5 * 60_000,
): Promise<number> {
  const db = await getLargeDocumentsDb();
  const docs = await db.getAll("documents");
  const now = Date.now();
  let recovered = 0;
  for (const doc of docs) {
    if (
      (doc.status === "extracting" || doc.status === "embedding") &&
      now - doc.uploadedAt > staleAfterMs
    ) {
      doc.status = "error";
      doc.errorMessage = "Indexing was interrupted";
      await db.put("documents", doc);
      recovered++;
    }
  }
  if (recovered > 0) {
    console.log(`[LargeDocs] Recovered ${recovered} interrupted documents`);
  }
  return recovered;
}

export async function deleteLargeDocument(documentId: string): Promise<void> {
  const db = await getLargeDocumentsDb();

  const chunks = await db.getAllFromIndex("chunks", "by-document", documentId);
  const chunkTx = db.transaction("chunks", "readwrite");
  for (const chunk of chunks) {
    await chunkTx.store.delete(chunk.id);
  }
  await chunkTx.done;

  await db.delete("documents", documentId);
  await deleteDocumentFile(documentId);
  await removeDocumentUmapCache(documentId);
  await deleteCachedExtractionsForDocument(documentId);
}

export async function getLargeDocumentFile(
  documentId: string,
): Promise<LargeDocumentFile | undefined> {
  return getDocumentFile(documentId);
}

export async function loadDocumentContent(documentId: string): Promise<string> {
  const db = await getLargeDocumentsDb();
  const chunks = await db.getAllFromIndex("chunks", "by-document", documentId);
  // Sort by page first (chunkIndex is now write-order due to interleaved
  // indexing, so it no longer reflects document position). Use chunkIndex
  // as a secondary key to keep chunks within the same page in a stable order.
  chunks.sort((a, b) => a.pageStart - b.pageStart || a.chunkIndex - b.chunkIndex);
  return chunks.map((c) => c.chunkText).join("\n\n");
}

export async function renameLargeDocument(
  documentId: string,
  newFilename: string,
): Promise<LargeDocumentMetadata | undefined> {
  const db = await getLargeDocumentsDb();
  const doc = await db.get("documents", documentId);
  if (!doc) return undefined;
  doc.filename = newFilename.trim();
  await db.put("documents", doc);
  return doc;
}

export async function getAllLargeDocuments(): Promise<LargeDocumentMetadata[]> {
  const db = await getLargeDocumentsDb();
  return db.getAll("documents");
}

export async function getLargeDocument(
  documentId: string,
): Promise<LargeDocumentMetadata | undefined> {
  const db = await getLargeDocumentsDb();
  return db.get("documents", documentId);
}

function computeRRFScore(
  semanticRank: number | null,
  lexicalRank: number | null,
  k: number = 60,
): number {
  let score = 0;
  if (semanticRank !== null) score += 1 / (k + semanticRank);
  if (lexicalRank !== null) score += 1 / (k + lexicalRank);
  return score;
}

export async function searchLargeDocuments(
  query: string,
  topKOrOptions: number | LargeDocumentSearchOptions = 10,
  threshold: number = 0.3,
): Promise<LargeDocumentSearchResult[]> {
  const options: LargeDocumentSearchOptions =
    typeof topKOrOptions === "number"
      ? { topK: topKOrOptions, threshold }
      : topKOrOptions;

  const {
    topK = 10,
    threshold: minThreshold = 0.3,
    rerank: enableRerank,
    rerankerBackend,
    retrieveK = 50,
    includeBreakdown = false,
    rrfK = 60,
  } = options;

  const db = await getLargeDocumentsDb();
  const allDocs = await db.getAll("documents");
  // Include "embedding" as well so a large document becomes incrementally
  // searchable as soon as its first batch of chunks is committed — users
  // shouldn't have to wait for full transcription/indexing before RAG works.
  const readyDocs = allDocs.filter(
    (d) => d.status === "ready" || d.status === "embedding",
  );
  if (readyDocs.length === 0) return [];

  const docMap = new Map<string, LargeDocumentMetadata>();
  for (const doc of readyDocs) docMap.set(doc.id, doc);

  const queryType = detectQueryType(query);

  let queryEmbedding: number[] | null = null;
  try {
    queryEmbedding = await embedQuery(query);
  } catch (error) {
    console.error("[LargeDocs] Failed to embed query, using lexical-only:", error);
  }

  type ScoredCandidate = {
    chunk: LargeDocumentChunk;
    semanticScore: number;
    lexicalScore: number;
    matchedTerms: string[];
  };
  const allCandidates: ScoredCandidate[] = [];

  for (const doc of readyDocs) {
    const chunks = await db.getAllFromIndex("chunks", "by-document", doc.id);
    if (chunks.length === 0) continue;

    const lexicalResults = largeDocLexicalSearch(query, chunks);
    const lexicalScoresMap = new Map<string, LargeDocLexicalResult>();
    for (const r of lexicalResults) lexicalScoresMap.set(r.chunk.id, r);

    for (const chunk of chunks) {
      const semanticScore = queryEmbedding
        ? cosineSimilarity(queryEmbedding, chunk.embedding)
        : 0;
      const lexicalResult = lexicalScoresMap.get(chunk.id);
      if (semanticScore < minThreshold && !lexicalResult) continue;

      allCandidates.push({
        chunk,
        semanticScore,
        lexicalScore: lexicalResult?.lexicalScore ?? 0,
        matchedTerms: lexicalResult?.matchedTerms ?? [],
      });
    }
  }

  if (allCandidates.length === 0) return [];

  if (!queryEmbedding) {
    allCandidates.sort((a, b) => b.lexicalScore - a.lexicalScore);
    return allCandidates.slice(0, topK).map((r) => {
      const doc = docMap.get(r.chunk.documentId);
      return {
        documentId: r.chunk.documentId,
        filename: doc?.filename || "Unknown Document",
        chunkText: r.chunk.chunkText,
        headingPath: r.chunk.headingPath,
        score: r.lexicalScore,
        chunkIndex: r.chunk.chunkIndex,
        pageStart: r.chunk.pageStart,
        pageEnd: r.chunk.pageEnd,
        matchedTerms: includeBreakdown ? r.matchedTerms : undefined,
        queryType: includeBreakdown ? queryType : undefined,
      };
    });
  }

  allCandidates.sort((a, b) => b.semanticScore - a.semanticScore);
  const semanticRanks = new Map<string, number>();
  allCandidates.forEach((item, index) => {
    semanticRanks.set(item.chunk.id, index + 1);
  });

  const lexicalCandidates = allCandidates
    .filter((c) => c.lexicalScore > 0)
    .sort((a, b) => b.lexicalScore - a.lexicalScore);
  const lexicalRanks = new Map<string, number>();
  lexicalCandidates.forEach((item, index) => {
    lexicalRanks.set(item.chunk.id, index + 1);
  });

  const rrfScored = allCandidates.map((c) => ({
    ...c,
    rrfScore: computeRRFScore(
      semanticRanks.get(c.chunk.id) ?? null,
      lexicalRanks.get(c.chunk.id) ?? null,
      rrfK,
    ),
  }));

  rrfScored.sort((a, b) => b.rrfScore - a.rrfScore);

  const shouldRerank = enableRerank ?? (getRecommendedReranker() !== "none");
  const candidateCount = shouldRerank ? retrieveK : topK;
  const filtered = rrfScored
    .slice(0, candidateCount)
    .filter((r) => r.semanticScore >= minThreshold);

  if (filtered.length === 0) return [];

  if (shouldRerank && filtered.length > 1) {
    const rerankDocs: RerankDocument[] = filtered.map((r) => ({
      id: r.chunk.id,
      text: r.chunk.chunkText,
      originalScore: r.rrfScore,
      metadata: {
        documentId: r.chunk.documentId,
        chunkIndex: r.chunk.chunkIndex,
        headingPath: r.chunk.headingPath,
        semanticScore: r.semanticScore,
        lexicalScore: r.lexicalScore,
        matchedTerms: r.matchedTerms,
        pageStart: r.chunk.pageStart,
        pageEnd: r.chunk.pageEnd,
      },
    }));

    try {
      const reranked = await rerank(query, rerankDocs, {
        backend: rerankerBackend ?? getRecommendedReranker(),
        topK,
      });

      return reranked.map((r) => {
        const meta = r.metadata as {
          documentId: string;
          chunkIndex: number;
          headingPath: string;
          semanticScore: number;
          lexicalScore: number;
          matchedTerms: string[];
          pageStart: number;
          pageEnd: number;
        };
        const doc = docMap.get(meta.documentId);
        return {
          documentId: meta.documentId,
          filename: doc?.filename || "Unknown Document",
          chunkText: r.text,
          headingPath: meta.headingPath,
          score: Math.round(r.relevanceScore * 100) / 100,
          chunkIndex: meta.chunkIndex,
          pageStart: meta.pageStart,
          pageEnd: meta.pageEnd,
          reranked: true,
          matchedTerms: includeBreakdown ? meta.matchedTerms : undefined,
          queryType: includeBreakdown ? queryType : undefined,
        };
      });
    } catch (error) {
      console.error("[LargeDocs] Reranking failed, falling back to RRF scores:", error);
    }
  }

  return filtered.slice(0, topK).map((r) => {
    const doc = docMap.get(r.chunk.documentId);
    return {
      documentId: r.chunk.documentId,
      filename: doc?.filename || "Unknown Document",
      chunkText: r.chunk.chunkText,
      headingPath: r.chunk.headingPath,
      score: Math.round(r.semanticScore * 100) / 100,
      chunkIndex: r.chunk.chunkIndex,
      pageStart: r.chunk.pageStart,
      pageEnd: r.chunk.pageEnd,
      reranked: false,
      matchedTerms: includeBreakdown ? r.matchedTerms : undefined,
      queryType: includeBreakdown ? queryType : undefined,
    };
  });
}

export async function searchLargeDocument(
  documentId: string,
  query: string,
  topKOrOptions: number | LargeDocumentSearchOptions = 10,
  threshold: number = 0.3,
): Promise<LargeDocumentSearchResult[]> {
  const options: LargeDocumentSearchOptions =
    typeof topKOrOptions === "number"
      ? { topK: topKOrOptions, threshold }
      : topKOrOptions;

  const {
    topK = 10,
    threshold: minThreshold = 0.3,
    rerank: enableRerank,
    rerankerBackend,
    retrieveK = 50,
    includeBreakdown = false,
    rrfK = 60,
  } = options;

  const db = await getLargeDocumentsDb();
  const chunks = await db.getAllFromIndex("chunks", "by-document", documentId);
  if (chunks.length === 0) return [];

  const doc = await db.get("documents", documentId);
  const queryType = detectQueryType(query);

  const lexicalResults = largeDocLexicalSearch(query, chunks);
  const lexicalRanks = new Map<string, number>();
  const lexicalScoresMap = new Map<string, LargeDocLexicalResult>();
  lexicalResults.forEach((result, index) => {
    lexicalRanks.set(result.chunk.id, index + 1);
    lexicalScoresMap.set(result.chunk.id, result);
  });

  let queryEmbedding: number[];
  try {
    queryEmbedding = await embedQuery(query);
  } catch (error) {
    console.error("[LargeDocs] Failed to embed query:", error);
    return lexicalResults.slice(0, topK).map((r) => ({
      documentId,
      filename: doc?.filename || "Unknown Document",
      chunkText: r.chunk.chunkText,
      headingPath: r.chunk.headingPath,
      score: r.lexicalScore,
      chunkIndex: r.chunk.chunkIndex,
      pageStart: r.chunk.pageStart,
      pageEnd: r.chunk.pageEnd,
      matchedTerms: includeBreakdown ? r.matchedTerms : undefined,
      queryType: includeBreakdown ? queryType : undefined,
    }));
  }

  const semanticScored: Array<{ chunk: LargeDocumentChunk; score: number }> = [];
  for (const chunk of chunks) {
    const similarity = cosineSimilarity(queryEmbedding, chunk.embedding);
    semanticScored.push({ chunk, score: similarity });
  }
  semanticScored.sort((a, b) => b.score - a.score);

  const semanticRanks = new Map<string, number>();
  const rawSemanticScores = new Map<string, number>();
  semanticScored.forEach((item, index) => {
    semanticRanks.set(item.chunk.id, index + 1);
    rawSemanticScores.set(item.chunk.id, item.score);
  });

  const combinedResults: Array<{
    chunk: LargeDocumentChunk;
    rrfScore: number;
    semanticScore: number;
    lexicalScore: number;
    matchedTerms: string[];
  }> = [];

  for (const chunk of chunks) {
    const id = chunk.id;
    const semanticRank = semanticRanks.get(id) ?? null;
    const lexicalRank = lexicalRanks.get(id) ?? null;
    const semanticScore = rawSemanticScores.get(id) ?? 0;
    const lexicalResult = lexicalScoresMap.get(id);
    const lexicalScore = lexicalResult?.lexicalScore ?? 0;
    const matchedTerms = lexicalResult?.matchedTerms ?? [];

    const rrfScore = computeRRFScore(semanticRank, lexicalRank, rrfK);

    combinedResults.push({
      chunk,
      rrfScore,
      semanticScore,
      lexicalScore,
      matchedTerms,
    });
  }

  combinedResults.sort((a, b) => b.rrfScore - a.rrfScore);

  const shouldRerank = enableRerank ?? (getRecommendedReranker() !== "none");
  const candidateCount = shouldRerank ? retrieveK : topK;
  const candidates = combinedResults.slice(0, candidateCount);
  const filtered = candidates.filter((r) => r.semanticScore >= minThreshold);
  if (filtered.length === 0) return [];

  if (shouldRerank && filtered.length > 1) {
    const rerankDocs: RerankDocument[] = filtered.map((r) => ({
      id: r.chunk.id,
      text: r.chunk.chunkText,
      originalScore: r.rrfScore,
      metadata: {
        chunkIndex: r.chunk.chunkIndex,
        headingPath: r.chunk.headingPath,
        semanticScore: r.semanticScore,
        lexicalScore: r.lexicalScore,
        matchedTerms: r.matchedTerms,
        pageStart: r.chunk.pageStart,
        pageEnd: r.chunk.pageEnd,
      },
    }));

    try {
      const reranked = await rerank(query, rerankDocs, {
        backend: rerankerBackend ?? getRecommendedReranker(),
        topK,
      });

      return reranked.map((r) => {
        const meta = r.metadata as {
          chunkIndex: number;
          headingPath: string;
          matchedTerms: string[];
          pageStart: number;
          pageEnd: number;
        };
        return {
          documentId,
          filename: doc?.filename || "Unknown Document",
          chunkText: r.text,
          headingPath: meta.headingPath,
          score: Math.round(r.relevanceScore * 100) / 100,
          chunkIndex: meta.chunkIndex,
          pageStart: meta.pageStart,
          pageEnd: meta.pageEnd,
          reranked: true,
          matchedTerms: includeBreakdown ? meta.matchedTerms : undefined,
          queryType: includeBreakdown ? queryType : undefined,
        };
      });
    } catch (error) {
      console.error("[LargeDocs] Reranking failed:", error);
    }
  }

  return filtered.slice(0, topK).map((r) => ({
    documentId,
    filename: doc?.filename || "Unknown Document",
    chunkText: r.chunk.chunkText,
    headingPath: r.chunk.headingPath,
    score: Math.round(r.semanticScore * 100) / 100,
    chunkIndex: r.chunk.chunkIndex,
    pageStart: r.chunk.pageStart,
    pageEnd: r.chunk.pageEnd,
    reranked: false,
    matchedTerms: includeBreakdown ? r.matchedTerms : undefined,
    queryType: includeBreakdown ? queryType : undefined,
  }));
}

export async function getLargeDocumentStats(): Promise<{
  totalDocuments: number;
  totalChunks: number;
  totalSize: number;
  documents: Array<{ id: string; filename: string; chunkCount: number; fileSize: number }>;
}> {
  const db = await getLargeDocumentsDb();
  const docs = await db.getAll("documents");

  return {
    totalDocuments: docs.length,
    totalChunks: docs.reduce((sum, doc) => sum + doc.chunkCount, 0),
    totalSize: docs.reduce((sum, doc) => sum + doc.fileSize, 0),
    documents: docs.map((doc) => ({
      id: doc.id,
      filename: doc.filename,
      chunkCount: doc.chunkCount,
      fileSize: doc.fileSize,
    })),
  };
}
