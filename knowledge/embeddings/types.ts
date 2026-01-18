/**
 * Embedding Types
 *
 * TypeScript types for the RAG semantic search system.
 */

/**
 * A chunk of content from a document, ready for embedding.
 */
export interface Chunk {
  text: string;
  index: number;
  headingPath: string; // breadcrumb of headings: "Section > Subsection"
  startOffset: number;
  endOffset: number;
}

/**
 * An embedding record stored in IndexedDB.
 * Includes content hash for change detection (Cursor-inspired).
 */
export interface EmbeddingRecord {
  id: string; // unique chunk id: `${filePath}#${chunkIndex}`
  filePath: string; // source file path
  chunkIndex: number; // position in file
  chunkText: string; // the actual text chunk (for display)
  contentHash: string; // SHA-256 hash of chunk text (for change detection)
  headingPath: string; // e.g., "Projects > API Design > Authentication"
  embedding: number[]; // 1536-dim vector (text-embedding-3-small)
  updatedAt: number;
}

/**
 * A search result returned from semantic search.
 */
export interface SearchResult {
  filePath: string;
  chunkText: string;
  headingPath: string;
  score: number; // cosine similarity (0-1)
  chunkIndex: number;
}
