/**
 * Large Documents Types
 *
 * TypeScript types for the large document RAG system.
 * Large documents are stored separately from the knowledge base
 * and searched via semantic search rather than full document loading.
 */

/**
 * Document lifecycle status. Reflects ground truth, not UI optimism.
 *
 * - `stored`     File is on disk; indexing has not started yet.
 * - `extracting` Per-page extraction is running (pdf.js + AI fallback).
 * - `embedding`  Chunking + embedding the extracted text.
 * - `ready`      Searchable.
 * - `error`      Indexing failed or was interrupted.
 */
export type LargeDocumentStatus =
  | "stored"
  | "extracting"
  | "embedding"
  | "ready"
  | "error";

/**
 * Metadata about an uploaded large document.
 * Stored in IndexedDB for reference.
 */
export interface LargeDocumentMetadata {
  /** Unique document ID (UUID) */
  id: string;
  /** Original filename */
  filename: string;
  /** MIME type of the document */
  mimeType: string;
  /** File size in bytes */
  fileSize: number;
  /** Number of chunks created from this document */
  chunkCount: number;
  /** When the document was uploaded */
  uploadedAt: number;
  /** When the document was last indexed */
  indexedAt: number;
  /** Optional user-provided description */
  description?: string;
  /** Document lifecycle status */
  status: LargeDocumentStatus;
  /** Error message if status is 'error' */
  errorMessage?: string;
}

/**
 * A chunk of content from a large document, with embedding.
 *
 * `pageStart` / `pageEnd` are required (v2 schema). For non-paged sources
 * (plain text, markdown), they are set to 1.
 */
export interface LargeDocumentChunk {
  /** Unique chunk ID: `${documentId}#${chunkIndex}` */
  id: string;
  /** Reference to parent document */
  documentId: string;
  /** Position in document */
  chunkIndex: number;
  /** The actual text content of this chunk */
  chunkText: string;
  /** SHA-256 hash for change detection */
  contentHash: string;
  /** Breadcrumb path (for structured documents) */
  headingPath: string;
  /** 1536-dimensional embedding vector */
  embedding: number[];
  /** When this chunk was created/updated */
  updatedAt: number;
  /**
   * 1-based page where this chunk's first character lives.
   * Required (v2). Non-paged sources use 1.
   */
  pageStart: number;
  /**
   * 1-based page of last character of this chunk.
   * Differs from pageStart only when ≥30% of chunk chars come from a later page.
   */
  pageEnd: number;
}

/**
 * Search result from large document hybrid search.
 */
export interface LargeDocumentSearchResult {
  /** Document ID */
  documentId: string;
  /** Document filename for display */
  filename: string;
  /** The matching chunk text */
  chunkText: string;
  /** Heading path for context */
  headingPath: string;
  /** Relevance score (0-1), may be from embedding similarity or reranker */
  score: number;
  /** Chunk index for reference */
  chunkIndex: number;
  /** First page (1-based) for citation/jump-to-page */
  pageStart: number;
  /** Last page (1-based) for citation */
  pageEnd: number;
  /** Whether this result was reranked by a cross-encoder */
  reranked?: boolean;
  /** Terms that matched in lexical search (if includeBreakdown enabled) */
  matchedTerms?: string[];
  /** Detected query type (if includeBreakdown enabled) */
  queryType?: "exact" | "semantic" | "mixed";
}

/**
 * Progress callback for document indexing.
 *
 * Optional fields are populated during page-level extraction so the UI
 * can show "Extracting 17 of 40 pages (AI: 3 / 5)" instead of a silent
 * spinner.
 */
export interface IndexingProgress {
  /** Current step (0-based) */
  current: number;
  /** Total steps */
  total: number;
  /** Current status */
  status:
    | "parsing"
    | "pdf-extraction"
    | "ai-extraction"
    | "chunking"
    | "embedding"
    | "complete"
    | "error";
  /** Status message */
  message: string;
  /** Pages processed so far (extraction phase) */
  pagesProcessed?: number;
  /** Total pages in the document */
  pagesTotal?: number;
  /** Source for the most recent page extracted */
  currentSource?: "pdfjs" | "ai";
  /** AI sub-ranges completed / total (if any) */
  aiRangesDone?: number;
  /** AI sub-ranges total */
  aiRangesTotal?: number;
}

/**
 * Stored file data for viewing documents.
 */
export interface LargeDocumentFile {
  /** Document ID (matches LargeDocumentMetadata.id) */
  documentId: string;
  /** Original file data */
  data: ArrayBuffer;
  /** MIME type */
  mimeType: string;
}

/**
 * One row in the per-page extraction cache (v2 schema).
 *
 * Compound key: `[documentId, pageIndex, source]`.
 * Lets Phase 6 "Retry indexing" resume cheaply: pages already extracted
 * (whether by pdf.js or by the AI fallback) are skipped on the next run.
 */
export interface ExtractionCacheEntry {
  /** Reference to parent document */
  documentId: string;
  /** 0-based page index within the document */
  pageIndex: number;
  /** Which extractor produced this text */
  source: "pdfjs" | "ai";
  /** Extracted text for this single page */
  text: string;
  /** SHA-256 hash of the source PDF file (for invalidation on re-upload) */
  fileHash: string;
  /** When this entry was written */
  createdAt: number;
}
