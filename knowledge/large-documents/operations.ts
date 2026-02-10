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
 */

import { getLargeDocumentsDb, removeDocumentUmapCache, storeDocumentFile, deleteDocumentFile, getDocumentFile } from "./idb";
import { chunkMarkdown, type ChunkOptions } from "../embeddings/chunker";
import { embedTexts, embedQuery } from "../embeddings/embed-client";
import { rerank, getRecommendedReranker, type RerankDocument, type RerankerConfig } from "../embeddings/reranker";
import { largeDocLexicalSearch, detectQueryType, type LargeDocLexicalResult } from "./lexical-search";
import type {
  LargeDocumentMetadata,
  LargeDocumentChunk,
  LargeDocumentSearchResult,
  IndexingProgress,
  LargeDocumentFile,
} from "./types";

/**
 * Default chunking options for large documents.
 * Optimized for document Q&A use cases.
 */
const DEFAULT_CHUNK_OPTIONS: ChunkOptions = {
  maxTokens: 512,      // Optimal for fact-focused retrieval
  overlapTokens: 75,   // ~15% overlap for context continuity
  minTokens: 50,       // Minimum chunk size
};

/**
 * Search options for large documents.
 */
export interface LargeDocumentSearchOptions {
  /** Number of results to return (default: 10) */
  topK?: number;
  /** Minimum similarity threshold (default: 0.3) */
  threshold?: number;
  /** Enable reranking for better accuracy (default: auto-detect) */
  rerank?: boolean;
  /** Reranker backend to use */
  rerankerBackend?: RerankerConfig["backend"];
  /** Number of candidates to retrieve before reranking (default: 50) */
  retrieveK?: number;
  /** Include matched terms in results */
  includeBreakdown?: boolean;
  /** RRF smoothing constant k (default: 60) */
  rrfK?: number;
}

/**
 * Generate a UUID for document IDs.
 */
function generateId(): string {
  return crypto.randomUUID();
}

/**
 * Compute SHA-256 hash for content change detection.
 */
async function sha256(text: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(text);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Cosine similarity between two vectors.
 */
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
// PDF EXTRACTION
// =============================================================================

/**
 * Check if extracted text appears to be meaningful content vs just artifacts.
 * Scanned PDFs often have partial text like page numbers, headers, or OCR fragments
 * that pass basic length checks but aren't useful content.
 */
function isTextMeaningful(text: string, numPages: number): boolean {
  const trimmed = text.trim();
  
  // Minimum characters per page - academic papers typically have 2000-4000 chars/page
  // We use a low threshold of 500 chars/page to account for image-heavy PDFs
  const minCharsPerPage = 500;
  const expectedMinChars = numPages * minCharsPerPage;
  
  if (trimmed.length < expectedMinChars) {
    console.log(`[PDF] Text too short: ${trimmed.length} chars for ${numPages} pages (expected min ${expectedMinChars})`);
    return false;
  }
  
  // Check for word-like patterns - real text should have mostly alphabetic words
  // Count words (sequences of 3+ letters)
  const words = trimmed.match(/[a-zA-Z]{3,}/g) || [];
  const wordDensity = words.length / (trimmed.length / 100); // words per 100 chars
  
  // Real text typically has 10-20 words per 100 chars
  // Garbage/fragments have much lower density
  if (wordDensity < 5) {
    console.log(`[PDF] Low word density: ${wordDensity.toFixed(2)} words/100 chars`);
    return false;
  }
  
  // Check that we have reasonable sentence-like structure
  // Real text has periods, commas, spaces in expected ratios
  const spaceRatio = (trimmed.match(/ /g) || []).length / trimmed.length;
  if (spaceRatio < 0.1 || spaceRatio > 0.3) {
    console.log(`[PDF] Unusual space ratio: ${(spaceRatio * 100).toFixed(1)}%`);
    return false;
  }
  
  return true;
}

/**
 * Extract text from a PDF using PDF.js (client-side, free).
 * Returns null if the extracted text is too short or appears to be
 * low-quality (likely a scanned PDF that needs OCR).
 */
export async function extractPdfText(
  file: File
): Promise<{ text: string; numPages: number } | null> {
  try {
    const pdfjs = await import("pdfjs-dist/legacy/build/pdf");
    
    // Configure worker if not already set
    // Use unpkg CDN with matching version to avoid version mismatch errors
    // Note: version is accessed via default export or directly - cast to access it
    if (!pdfjs.GlobalWorkerOptions.workerSrc) {
      const version = (pdfjs as unknown as { version: string }).version || "4.9.155";
      pdfjs.GlobalWorkerOptions.workerSrc = `//unpkg.com/pdfjs-dist@${version}/build/pdf.worker.min.mjs`;
    }

    const arrayBuffer = await file.arrayBuffer();
    const pdf = await pdfjs.getDocument({ data: arrayBuffer }).promise;
    const pageTexts: string[] = [];

    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const content = await page.getTextContent();
      const text = content.items
        .map((item: { str?: string }) => item.str || "")
        .join(" ");
      pageTexts.push(text);
    }

    const fullText = pageTexts.join("\n\n");
    
    // Check if we got meaningful text (not just headers/footers/page numbers)
    if (!isTextMeaningful(fullText, pdf.numPages)) {
      console.log("[PDF] Text extraction yielded low-quality content, fallback to AI OCR needed");
      return null; // Signal that fallback is needed
    }

    console.log(`[PDF] Extracted ${fullText.length} chars from ${pdf.numPages} pages (quality check passed)`);
    return { text: fullText, numPages: pdf.numPages };
  } catch (error) {
    console.error("[PDF] PDF.js extraction failed:", error);
    return null; // Signal fallback needed
  }
}

/**
 * Parse a scanned PDF using Claude Haiku via the /api/parse-pdf endpoint.
 * This is the fallback when PDF.js can't extract text.
 */
export async function parsePdfWithClaude(file: File): Promise<string> {
  const formData = new FormData();
  formData.append("file", file);
  // Use free trial for PDF OCR - this is a background indexing operation
  formData.append("useFreeTrial", "true");

  const response = await fetch("/api/parse-pdf", {
    method: "POST",
    body: formData,
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || "PDF parsing with AI failed");
  }

  const { text } = await response.json();
  console.log(`[PDF] Claude extracted ${text.length} chars`);
  return text;
}

/**
 * Parse document content based on MIME type.
 * Currently supports plain text, markdown, and PDF.
 */
async function parseDocument(
  content: ArrayBuffer | string,
  mimeType: string
): Promise<string> {
  // Handle text-based formats
  if (
    mimeType.startsWith("text/") ||
    mimeType === "application/json" ||
    mimeType === "application/xml"
  ) {
    if (typeof content === "string") {
      return content;
    }
    const decoder = new TextDecoder("utf-8");
    return decoder.decode(content);
  }

  // PDF is now handled in uploadLargeDocument directly
  if (mimeType === "application/pdf") {
    throw new Error("PDF files should be processed via extractPdfText or parsePdfWithClaude");
  }

  throw new Error(`Unsupported file type: ${mimeType}`);
}

/**
 * Result of storing a document (fast operation).
 */
export interface StoredDocumentResult {
  metadata: LargeDocumentMetadata;
  fileData: ArrayBuffer;
}

/**
 * Store a large document for immediate viewing.
 * This is the fast path - stores file and metadata, returns immediately.
 * Call indexLargeDocumentInBackground() separately to index for search.
 *
 * @returns metadata and file data for immediate viewing
 */
export async function storeLargeDocument(
  file: File,
  description?: string
): Promise<StoredDocumentResult> {
  const db = await getLargeDocumentsDb();
  const documentId = generateId();
  const mimeType = file.type || "text/plain";

  // Create initial metadata with pending_index status
  const metadata: LargeDocumentMetadata = {
    id: documentId,
    filename: file.name,
    mimeType,
    fileSize: file.size,
    chunkCount: 0,
    uploadedAt: Date.now(),
    indexedAt: 0,
    description,
    status: "uploading", // Will be updated to "indexing" when background index starts
  };

  // Save initial metadata
  await db.put("documents", metadata);

  // Store original file for viewing
  const fileData = await file.arrayBuffer();
  await storeDocumentFile(documentId, fileData, mimeType);

  console.log(`[LargeDocs] Stored document ${documentId} for immediate viewing`);

  return { metadata, fileData };
}

/**
 * Index a document in the background after it's been stored.
 * This is the slow path - parses, chunks, and embeds the content.
 * The document must have already been stored via storeLargeDocument().
 *
 * @param documentId - ID of the already-stored document
 * @param file - Original file for text extraction
 * @param onProgress - Optional progress callback
 */
export async function indexLargeDocumentInBackground(
  documentId: string,
  file: File,
  onProgress?: (progress: IndexingProgress) => void
): Promise<LargeDocumentMetadata> {
  const db = await getLargeDocumentsDb();
  const mimeType = file.type || "text/plain";

  // Get existing metadata
  let metadata = await db.get("documents", documentId);
  if (!metadata) {
    throw new Error(`Document ${documentId} not found for indexing`);
  }

  try {
    // Update status to indexing
    metadata.status = "indexing";
    await db.put("documents", metadata);

    // Report parsing status
    onProgress?.({
      current: 0,
      total: 5,
      status: "parsing",
      message: "Parsing document...",
    });

    let content: string;

    // Handle PDF files specially
    if (mimeType === "application/pdf") {
      // Try PDF.js extraction first (free, fast)
      onProgress?.({
        current: 0,
        total: 5,
        status: "pdf-extraction",
        message: "Extracting text from PDF...",
      });

      const pdfResult = await extractPdfText(file);
      
      if (pdfResult) {
        // PDF.js extraction succeeded
        content = pdfResult.text;
      } else {
        // Fallback to Claude Haiku for scanned PDFs
        onProgress?.({
          current: 0.5,
          total: 5,
          status: "ai-extraction",
          message: "Using AI to extract text from scanned PDF...",
        });
        
        content = await parsePdfWithClaude(file);
      }
    } else {
      // Read text-based file content directly
      content = await file.text();
    }

    // Report chunking status
    onProgress?.({
      current: 1,
      total: 5,
      status: "chunking",
      message: "Splitting into chunks...",
    });

    // Chunk the content with optimized settings for document Q&A
    const chunks = chunkMarkdown(content, DEFAULT_CHUNK_OPTIONS);

    if (chunks.length === 0) {
      throw new Error("Document produced no chunks. It may be empty.");
    }

    // Report embedding status
    onProgress?.({
      current: 2,
      total: 5,
      status: "embedding",
      message: `Embedding ${chunks.length} chunks...`,
    });

    // Load existing chunks for this document (for content hash change detection).
    // If a chunk's text hasn't changed (same SHA-256 hash), we reuse the existing
    // embedding instead of re-computing it — saving API calls and time.
    const existingChunks = await db.getAllFromIndex("chunks", "by-document", documentId);
    const existingHashMap = new Map<string, LargeDocumentChunk>();
    for (const c of existingChunks) {
      existingHashMap.set(c.contentHash, c);
    }
    const reusedCount = { value: 0 };

    // Embed chunks in batches (20 at a time to avoid API limits)
    const BATCH_SIZE = 20;
    const allChunkRecords: LargeDocumentChunk[] = [];

    for (let i = 0; i < chunks.length; i += BATCH_SIZE) {
      const batch = chunks.slice(i, i + BATCH_SIZE);

      // Compute hashes first to detect unchanged chunks
      const batchHashes: string[] = [];
      const needsEmbedding: { batchIdx: number; text: string }[] = [];
      for (let j = 0; j < batch.length; j++) {
        const hash = await sha256(batch[j].text);
        batchHashes.push(hash);
        const existing = existingHashMap.get(hash);
        if (!existing) {
          needsEmbedding.push({ batchIdx: j, text: batch[j].text });
        }
      }

      // Only call the embedding API for chunks that actually changed
      let newEmbeddings: number[][] = [];
      if (needsEmbedding.length > 0) {
        newEmbeddings = await embedTexts(needsEmbedding.map((n) => n.text));
      }

      // Build chunk records, reusing existing embeddings where possible
      let newEmbIdx = 0;
      for (let j = 0; j < batch.length; j++) {
        const chunk = batch[j];
        const chunkIndex = i + j;
        const contentHash = batchHashes[j];
        const existing = existingHashMap.get(contentHash);

        let embedding: number[];
        if (existing) {
          // Reuse existing embedding — content unchanged
          embedding = existing.embedding;
          reusedCount.value++;
        } else {
          embedding = newEmbeddings[newEmbIdx++];
        }

        const chunkRecord: LargeDocumentChunk = {
          id: `${documentId}#${chunkIndex}`,
          documentId,
          chunkIndex,
          chunkText: chunk.text,
          contentHash,
          headingPath: chunk.headingPath,
          embedding,
          updatedAt: Date.now(),
        };

        allChunkRecords.push(chunkRecord);
      }

      // Update progress
      const progress = Math.min(
        2 + ((i + BATCH_SIZE) / chunks.length) * 2,
        4
      );
      onProgress?.({
        current: progress,
        total: 5,
        status: "embedding",
        message: `Embedded ${Math.min(i + BATCH_SIZE, chunks.length)} of ${chunks.length} chunks...`,
      });
    }

    if (reusedCount.value > 0) {
      console.log(`[LargeDocs] Reused ${reusedCount.value}/${allChunkRecords.length} embeddings via content hash match`);
    }

    // Delete any old chunks that no longer exist (document may have shrunk)
    const oldChunkIds = new Set(existingChunks.map((c) => c.id));
    const newChunkIds = new Set(allChunkRecords.map((c) => c.id));
    const staleChunkIds = [...oldChunkIds].filter((id) => !newChunkIds.has(id));

    // Store all chunks (and remove stale ones)
    const tx = db.transaction("chunks", "readwrite");
    for (const record of allChunkRecords) {
      await tx.store.put(record);
    }
    for (const staleId of staleChunkIds) {
      await tx.store.delete(staleId);
    }
    await tx.done;

    // Update metadata with final stats
    metadata.chunkCount = allChunkRecords.length;
    metadata.indexedAt = Date.now();
    metadata.status = "ready";
    await db.put("documents", metadata);

    // Report complete
    onProgress?.({
      current: 5,
      total: 5,
      status: "complete",
      message: `Indexed ${allChunkRecords.length} chunks successfully`,
    });

    console.log(`[LargeDocs] Finished indexing document ${documentId}: ${allChunkRecords.length} chunks`);

    return metadata;
  } catch (error) {
    // Update metadata with error (but keep file viewable)
    metadata.status = "error";
    metadata.errorMessage =
      error instanceof Error ? error.message : String(error);
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
 * Upload and index a large document.
 * This is the legacy combined function that stores and indexes synchronously.
 * For immediate viewing with background indexing, use storeLargeDocument() 
 * followed by indexLargeDocumentInBackground().
 *
 * Process:
 * 1. Store file for viewing (fast)
 * 2. Parse document content to text (with PDF extraction if needed)
 * 3. Chunk the text using the markdown chunker
 * 4. Embed all chunks in batches
 * 5. Store chunks with embeddings
 */
export async function uploadLargeDocument(
  file: File,
  description?: string,
  onProgress?: (progress: IndexingProgress) => void
): Promise<LargeDocumentMetadata> {
  // Store the document first (fast)
  const { metadata } = await storeLargeDocument(file, description);
  
  // Then index it (slow) - this blocks until complete for legacy compatibility
  return indexLargeDocumentInBackground(metadata.id, file, onProgress);
}

/**
 * Upload a large document from text content (for pre-parsed PDFs).
 */
export async function uploadLargeDocumentFromText(
  filename: string,
  content: string,
  mimeType: string = "text/plain",
  description?: string,
  onProgress?: (progress: IndexingProgress) => void
): Promise<LargeDocumentMetadata> {
  // Create a File-like object for the upload function
  const blob = new Blob([content], { type: mimeType });
  const file = new File([blob], filename, { type: mimeType });
  return uploadLargeDocument(file, description, onProgress);
}

/**
 * Delete a large document and all its chunks.
 */
export async function deleteLargeDocument(documentId: string): Promise<void> {
  const db = await getLargeDocumentsDb();

  // Delete all chunks for this document
  const chunks = await db.getAllFromIndex("chunks", "by-document", documentId);
  const chunkTx = db.transaction("chunks", "readwrite");
  for (const chunk of chunks) {
    await chunkTx.store.delete(chunk.id);
  }
  await chunkTx.done;

  // Delete the document metadata
  await db.delete("documents", documentId);

  // Delete the original file data
  await deleteDocumentFile(documentId);

  // Remove cached UMAP projection for this document
  await removeDocumentUmapCache(documentId);
}

/**
 * Get the original file data for viewing a document.
 */
export async function getLargeDocumentFile(
  documentId: string
): Promise<LargeDocumentFile | undefined> {
  return getDocumentFile(documentId);
}

/**
 * Load document content by reconstructing from stored chunks.
 * Used for text viewer when original file isn't needed.
 */
export async function loadDocumentContent(documentId: string): Promise<string> {
  const db = await getLargeDocumentsDb();
  const chunks = await db.getAllFromIndex("chunks", "by-document", documentId);
  
  // Sort by chunk index
  chunks.sort((a, b) => a.chunkIndex - b.chunkIndex);
  
  // Reconstruct content (note: this won't perfectly restore original due to chunking overlap)
  return chunks.map(c => c.chunkText).join("\n\n");
}

/**
 * Rename a large document.
 */
export async function renameLargeDocument(
  documentId: string,
  newFilename: string
): Promise<LargeDocumentMetadata | undefined> {
  const db = await getLargeDocumentsDb();

  const doc = await db.get("documents", documentId);
  if (!doc) {
    return undefined;
  }

  // Update the filename
  doc.filename = newFilename.trim();
  await db.put("documents", doc);

  return doc;
}

/**
 * Get all uploaded documents.
 */
export async function getAllLargeDocuments(): Promise<LargeDocumentMetadata[]> {
  const db = await getLargeDocumentsDb();
  return db.getAll("documents");
}

/**
 * Get a single document by ID.
 */
export async function getLargeDocument(
  documentId: string
): Promise<LargeDocumentMetadata | undefined> {
  const db = await getLargeDocumentsDb();
  return db.get("documents", documentId);
}

/**
 * Compute RRF score from ranks.
 * RRF(d) = Σ 1/(k + rank(d))
 */
function computeRRFScore(
  semanticRank: number | null,
  lexicalRank: number | null,
  k: number = 60
): number {
  let score = 0;
  if (semanticRank !== null) {
    score += 1 / (k + semanticRank);
  }
  if (lexicalRank !== null) {
    score += 1 / (k + lexicalRank);
  }
  return score;
}

/**
 * Search across all large documents using hybrid search (lexical + semantic + RRF).
 *
 * This is the core RAG search function that Claude will use.
 *
 * Optimized pipeline (loads chunks per-document to bound memory):
 * 1. Get list of ready documents
 * 2. For each document, load its chunks via the by-document index
 * 3. Run lexical + semantic search per document, collect all scored candidates
 * 4. Compute global RRF fusion scores across all candidates
 * 5. (Optional) Rerank top candidates with cross-encoder for better accuracy
 * 6. Return final results with matched terms
 */
export async function searchLargeDocuments(
  query: string,
  topKOrOptions: number | LargeDocumentSearchOptions = 10,
  threshold: number = 0.3
): Promise<LargeDocumentSearchResult[]> {
  // Support both legacy (topK, threshold) and new (options) signatures
  const options: LargeDocumentSearchOptions =
    typeof topKOrOptions === "number"
      ? { topK: topKOrOptions, threshold }
      : topKOrOptions;

  const {
    topK = 10,
    threshold: minThreshold = 0.3,
    rerank: enableRerank,
    rerankerBackend,
    retrieveK = 50, // Retrieve more candidates when reranking
    includeBreakdown = false,
    rrfK = 60,
  } = options;

  const db = await getLargeDocumentsDb();

  // Get all ready documents
  const allDocs = await db.getAll("documents");
  const readyDocs = allDocs.filter((d) => d.status === "ready");
  if (readyDocs.length === 0) return [];

  const docMap = new Map<string, LargeDocumentMetadata>();
  for (const doc of readyDocs) {
    docMap.set(doc.id, doc);
  }

  // Detect query type
  const queryType = detectQueryType(query);

  // Embed the query upfront (needed for all documents)
  let queryEmbedding: number[] | null = null;
  try {
    queryEmbedding = await embedQuery(query);
  } catch (error) {
    console.error("[LargeDocs] Failed to embed query, using lexical-only:", error);
  }

  // Collect scored candidates across all documents.
  // We load chunks per-document via the by-document index to avoid loading
  // the entire chunks store into memory at once.
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

    // Lexical search for this document's chunks
    const lexicalResults = largeDocLexicalSearch(query, chunks);
    const lexicalScoresMap = new Map<string, LargeDocLexicalResult>();
    for (const r of lexicalResults) {
      lexicalScoresMap.set(r.chunk.id, r);
    }

    // Semantic scoring for this document's chunks
    for (const chunk of chunks) {
      const semanticScore = queryEmbedding
        ? cosineSimilarity(queryEmbedding, chunk.embedding)
        : 0;
      const lexicalResult = lexicalScoresMap.get(chunk.id);

      // Early filter: skip chunks below threshold that also have no lexical match.
      // This avoids accumulating thousands of irrelevant candidates.
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

  // If we only have lexical results (embedding failed), sort by lexical score
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
        matchedTerms: includeBreakdown ? r.matchedTerms : undefined,
        queryType: includeBreakdown ? queryType : undefined,
      };
    });
  }

  // Sort candidates by semantic score to assign semantic ranks
  allCandidates.sort((a, b) => b.semanticScore - a.semanticScore);
  const semanticRanks = new Map<string, number>();
  allCandidates.forEach((item, index) => {
    semanticRanks.set(item.chunk.id, index + 1);
  });

  // Sort candidates by lexical score to assign lexical ranks (only those with a score)
  const lexicalCandidates = allCandidates
    .filter((c) => c.lexicalScore > 0)
    .sort((a, b) => b.lexicalScore - a.lexicalScore);
  const lexicalRanks = new Map<string, number>();
  lexicalCandidates.forEach((item, index) => {
    lexicalRanks.set(item.chunk.id, index + 1);
  });

  // Compute RRF scores
  const rrfScored = allCandidates.map((c) => ({
    ...c,
    rrfScore: computeRRFScore(
      semanticRanks.get(c.chunk.id) ?? null,
      lexicalRanks.get(c.chunk.id) ?? null,
      rrfK
    ),
  }));

  // Sort by RRF score
  rrfScored.sort((a, b) => b.rrfScore - a.rrfScore);

  // Determine if we should rerank
  const shouldRerank = enableRerank ?? (getRecommendedReranker() !== "none");
  const candidateCount = shouldRerank ? retrieveK : topK;

  // Get candidates and filter by semantic threshold
  const filtered = rrfScored
    .slice(0, candidateCount)
    .filter((r) => r.semanticScore >= minThreshold);

  if (filtered.length === 0) return [];

  // Apply reranking if enabled
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
        };
        const doc = docMap.get(meta.documentId);
        return {
          documentId: meta.documentId,
          filename: doc?.filename || "Unknown Document",
          chunkText: r.text,
          headingPath: meta.headingPath,
          score: Math.round(r.relevanceScore * 100) / 100,
          chunkIndex: meta.chunkIndex,
          reranked: true,
          matchedTerms: includeBreakdown ? meta.matchedTerms : undefined,
          queryType: includeBreakdown ? queryType : undefined,
        };
      });
    } catch (error) {
      console.error("[LargeDocs] Reranking failed, falling back to RRF scores:", error);
    }
  }

  // Return results without reranking (take topK)
  return filtered.slice(0, topK).map((r) => {
    const doc = docMap.get(r.chunk.documentId);
    return {
      documentId: r.chunk.documentId,
      filename: doc?.filename || "Unknown Document",
      chunkText: r.chunk.chunkText,
      headingPath: r.chunk.headingPath,
      score: Math.round(r.semanticScore * 100) / 100,
      chunkIndex: r.chunk.chunkIndex,
      reranked: false,
      matchedTerms: includeBreakdown ? r.matchedTerms : undefined,
      queryType: includeBreakdown ? queryType : undefined,
    };
  });
}

/**
 * Search a specific document only using hybrid search.
 */
export async function searchLargeDocument(
  documentId: string,
  query: string,
  topKOrOptions: number | LargeDocumentSearchOptions = 10,
  threshold: number = 0.3
): Promise<LargeDocumentSearchResult[]> {
  // Support both legacy and new signatures
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

  // Get chunks for this document only
  const chunks = await db.getAllFromIndex("chunks", "by-document", documentId);

  if (chunks.length === 0) {
    return [];
  }

  // Get document metadata
  const doc = await db.get("documents", documentId);

  // Detect query type
  const queryType = detectQueryType(query);

  // Run lexical search on this document's chunks
  const lexicalResults = largeDocLexicalSearch(query, chunks);
  const lexicalRanks = new Map<string, number>();
  const lexicalScoresMap = new Map<string, LargeDocLexicalResult>();
  lexicalResults.forEach((result, index) => {
    lexicalRanks.set(result.chunk.id, index + 1);
    lexicalScoresMap.set(result.chunk.id, result);
  });

  // Embed the query
  let queryEmbedding: number[];
  try {
    queryEmbedding = await embedQuery(query);
  } catch (error) {
    console.error("[LargeDocs] Failed to embed query:", error);
    // Fall back to lexical-only
    return lexicalResults.slice(0, topK).map((r) => ({
      documentId,
      filename: doc?.filename || "Unknown Document",
      chunkText: r.chunk.chunkText,
      headingPath: r.chunk.headingPath,
      score: r.lexicalScore,
      chunkIndex: r.chunk.chunkIndex,
      matchedTerms: includeBreakdown ? r.matchedTerms : undefined,
      queryType: includeBreakdown ? queryType : undefined,
    }));
  }

  // Compute semantic scores and ranks
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

  // Combine using RRF
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

  // Sort by RRF score
  combinedResults.sort((a, b) => b.rrfScore - a.rrfScore);

  // Determine if we should rerank
  const shouldRerank = enableRerank ?? (getRecommendedReranker() !== "none");
  const candidateCount = shouldRerank ? retrieveK : topK;
  const candidates = combinedResults.slice(0, candidateCount);

  // Filter by semantic threshold
  const filtered = candidates.filter((r) => r.semanticScore >= minThreshold);

  if (filtered.length === 0) {
    return [];
  }

  // Apply reranking if enabled
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
        };
        return {
          documentId,
          filename: doc?.filename || "Unknown Document",
          chunkText: r.text,
          headingPath: meta.headingPath,
          score: Math.round(r.relevanceScore * 100) / 100,
          chunkIndex: meta.chunkIndex,
          reranked: true,
          matchedTerms: includeBreakdown ? meta.matchedTerms : undefined,
          queryType: includeBreakdown ? queryType : undefined,
        };
      });
    } catch (error) {
      console.error("[LargeDocs] Reranking failed:", error);
      // Fall through to non-reranked results
    }
  }

  // Return results without reranking
  return filtered.slice(0, topK).map((r) => ({
    documentId,
    filename: doc?.filename || "Unknown Document",
    chunkText: r.chunk.chunkText,
    headingPath: r.chunk.headingPath,
    score: Math.round(r.semanticScore * 100) / 100,
    chunkIndex: r.chunk.chunkIndex,
    reranked: false,
    matchedTerms: includeBreakdown ? r.matchedTerms : undefined,
    queryType: includeBreakdown ? queryType : undefined,
  }));
}

/**
 * Get statistics about large documents.
 */
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
