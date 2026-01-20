/**
 * Large Documents Types
 *
 * TypeScript types for the large document RAG system.
 * Large documents are stored separately from the knowledge base
 * and searched via semantic search rather than full document loading.
 */

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
  /** Document status */
  status: "uploading" | "indexing" | "ready" | "error";
  /** Error message if status is 'error' */
  errorMessage?: string;
}

/**
 * A chunk of content from a large document, with embedding.
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
}

/**
 * Search result from large document semantic search.
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
  /** Similarity score (0-1) */
  score: number;
  /** Chunk index for reference */
  chunkIndex: number;
}

/**
 * Progress callback for document indexing.
 */
export interface IndexingProgress {
  /** Current step (0-based) */
  current: number;
  /** Total steps */
  total: number;
  /** Current status */
  status: "parsing" | "chunking" | "embedding" | "complete" | "error";
  /** Status message */
  message: string;
}
