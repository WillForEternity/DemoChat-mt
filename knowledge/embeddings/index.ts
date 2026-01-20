/**
 * Embeddings - Public API
 *
 * Exports all embedding-related functionality for the RAG semantic search system.
 *
 * Search hierarchy:
 * - hybridSearch: Recommended. Combines lexical + semantic with RRF fusion.
 * - searchEmbeddings: Semantic-only search (legacy, still available).
 * - lexicalSearch: Term-only search (low-level, for special cases).
 *
 * 2025 Best Practices:
 * - RRF (Reciprocal Rank Fusion) for combining lexical + semantic results
 * - Optional cross-encoder reranking for 20-40% accuracy improvement
 * - Chunk overlap (15%) to prevent context loss at boundaries
 */

export * from "./types";
export * from "./chunker";
export * from "./embed-client";
export * from "./operations";
export * from "./lexical-search";
export * from "./hybrid-search";
export * from "./reranker";
