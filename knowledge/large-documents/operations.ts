/**
 * Large Document Operations
 *
 * Core operations for uploading, indexing, and searching large documents.
 * Uses the same embedding infrastructure as the knowledge base but stores
 * documents in a separate database optimized for large file handling.
 */

import { getLargeDocumentsDb } from "./idb";
import { chunkMarkdown } from "../embeddings/chunker";
import { embedTexts, embedQuery } from "../embeddings/embed-client";
import type {
  LargeDocumentMetadata,
  LargeDocumentChunk,
  LargeDocumentSearchResult,
  IndexingProgress,
} from "./types";

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

/**
 * Parse document content based on MIME type.
 * Currently supports plain text and markdown.
 * PDF support can be added later with pdf-parse or similar.
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

  // For PDF, we'll need to parse it - for now return error message
  if (mimeType === "application/pdf") {
    // PDF parsing would require a library like pdf-parse
    // For now, we'll handle this client-side before calling upload
    throw new Error("PDF files should be converted to text before upload");
  }

  throw new Error(`Unsupported file type: ${mimeType}`);
}

/**
 * Upload and index a large document.
 *
 * Process:
 * 1. Create document metadata record
 * 2. Parse document content to text
 * 3. Chunk the text using the markdown chunker
 * 4. Embed all chunks in batches
 * 5. Store chunks with embeddings
 */
export async function uploadLargeDocument(
  file: File,
  description?: string,
  onProgress?: (progress: IndexingProgress) => void
): Promise<LargeDocumentMetadata> {
  const db = await getLargeDocumentsDb();
  const documentId = generateId();

  // Create initial metadata
  const metadata: LargeDocumentMetadata = {
    id: documentId,
    filename: file.name,
    mimeType: file.type || "text/plain",
    fileSize: file.size,
    chunkCount: 0,
    uploadedAt: Date.now(),
    indexedAt: 0,
    description,
    status: "uploading",
  };

  // Save initial metadata
  await db.put("documents", metadata);

  try {
    // Report parsing status
    onProgress?.({
      current: 0,
      total: 4,
      status: "parsing",
      message: "Parsing document...",
    });

    // Read file content
    const content = await file.text();

    // Update status to indexing
    metadata.status = "indexing";
    await db.put("documents", metadata);

    // Report chunking status
    onProgress?.({
      current: 1,
      total: 4,
      status: "chunking",
      message: "Splitting into chunks...",
    });

    // Chunk the content (use larger chunks for large docs - 800 tokens)
    const chunks = chunkMarkdown(content, 800);

    if (chunks.length === 0) {
      throw new Error("Document produced no chunks. It may be empty.");
    }

    // Report embedding status
    onProgress?.({
      current: 2,
      total: 4,
      status: "embedding",
      message: `Embedding ${chunks.length} chunks...`,
    });

    // Embed chunks in batches (20 at a time to avoid API limits)
    const BATCH_SIZE = 20;
    const allChunkRecords: LargeDocumentChunk[] = [];

    for (let i = 0; i < chunks.length; i += BATCH_SIZE) {
      const batch = chunks.slice(i, i + BATCH_SIZE);
      const batchTexts = batch.map((c) => c.text);

      // Embed the batch
      const embeddings = await embedTexts(batchTexts);

      // Create chunk records
      for (let j = 0; j < batch.length; j++) {
        const chunk = batch[j];
        const chunkIndex = i + j;
        const contentHash = await sha256(chunk.text);

        const chunkRecord: LargeDocumentChunk = {
          id: `${documentId}#${chunkIndex}`,
          documentId,
          chunkIndex,
          chunkText: chunk.text,
          contentHash,
          headingPath: chunk.headingPath,
          embedding: embeddings[j],
          updatedAt: Date.now(),
        };

        allChunkRecords.push(chunkRecord);
      }

      // Update progress
      const progress = Math.min(
        2 + ((i + BATCH_SIZE) / chunks.length),
        3
      );
      onProgress?.({
        current: progress,
        total: 4,
        status: "embedding",
        message: `Embedded ${Math.min(i + BATCH_SIZE, chunks.length)} of ${chunks.length} chunks...`,
      });
    }

    // Store all chunks
    const tx = db.transaction("chunks", "readwrite");
    for (const record of allChunkRecords) {
      await tx.store.put(record);
    }
    await tx.done;

    // Update metadata with final stats
    metadata.chunkCount = allChunkRecords.length;
    metadata.indexedAt = Date.now();
    metadata.status = "ready";
    await db.put("documents", metadata);

    // Report complete
    onProgress?.({
      current: 4,
      total: 4,
      status: "complete",
      message: `Indexed ${allChunkRecords.length} chunks successfully`,
    });

    return metadata;
  } catch (error) {
    // Update metadata with error
    metadata.status = "error";
    metadata.errorMessage =
      error instanceof Error ? error.message : String(error);
    await db.put("documents", metadata);

    onProgress?.({
      current: 0,
      total: 4,
      status: "error",
      message: metadata.errorMessage,
    });

    throw error;
  }
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
 * Search across all large documents using semantic search.
 *
 * This is the core RAG search function that Claude will use.
 */
export async function searchLargeDocuments(
  query: string,
  topK: number = 10,
  threshold: number = 0.3
): Promise<LargeDocumentSearchResult[]> {
  const db = await getLargeDocumentsDb();

  // Get all chunks
  const allChunks = await db.getAll("chunks");

  if (allChunks.length === 0) {
    return [];
  }

  // Get all document metadata for filename lookup
  const allDocs = await db.getAll("documents");
  const docMap = new Map<string, LargeDocumentMetadata>();
  for (const doc of allDocs) {
    docMap.set(doc.id, doc);
  }

  // Embed the query
  let queryEmbedding: number[];
  try {
    queryEmbedding = await embedQuery(query);
  } catch (error) {
    console.error("[LargeDocs] Failed to embed query:", error);
    throw new Error("Failed to embed search query. Check API key configuration.");
  }

  // Compute cosine similarity for each chunk
  const scored = allChunks.map((chunk) => ({
    chunk,
    score: cosineSimilarity(queryEmbedding, chunk.embedding),
  }));

  // Filter by threshold, sort by score, and take top K
  const results = scored
    .filter((s) => s.score >= threshold)
    .sort((a, b) => b.score - a.score)
    .slice(0, topK)
    .map((s) => {
      const doc = docMap.get(s.chunk.documentId);
      return {
        documentId: s.chunk.documentId,
        filename: doc?.filename || "Unknown Document",
        chunkText: s.chunk.chunkText,
        headingPath: s.chunk.headingPath,
        score: Math.round(s.score * 100) / 100, // Round to 2 decimals
        chunkIndex: s.chunk.chunkIndex,
      };
    });

  return results;
}

/**
 * Search a specific document only.
 */
export async function searchLargeDocument(
  documentId: string,
  query: string,
  topK: number = 10,
  threshold: number = 0.3
): Promise<LargeDocumentSearchResult[]> {
  const db = await getLargeDocumentsDb();

  // Get chunks for this document only
  const chunks = await db.getAllFromIndex("chunks", "by-document", documentId);

  if (chunks.length === 0) {
    return [];
  }

  // Get document metadata
  const doc = await db.get("documents", documentId);

  // Embed the query
  let queryEmbedding: number[];
  try {
    queryEmbedding = await embedQuery(query);
  } catch (error) {
    console.error("[LargeDocs] Failed to embed query:", error);
    throw new Error("Failed to embed search query. Check API key configuration.");
  }

  // Compute cosine similarity for each chunk
  const scored = chunks.map((chunk) => ({
    chunk,
    score: cosineSimilarity(queryEmbedding, chunk.embedding),
  }));

  // Filter by threshold, sort by score, and take top K
  return scored
    .filter((s) => s.score >= threshold)
    .sort((a, b) => b.score - a.score)
    .slice(0, topK)
    .map((s) => ({
      documentId: s.chunk.documentId,
      filename: doc?.filename || "Unknown Document",
      chunkText: s.chunk.chunkText,
      headingPath: s.chunk.headingPath,
      score: Math.round(s.score * 100) / 100,
      chunkIndex: s.chunk.chunkIndex,
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
