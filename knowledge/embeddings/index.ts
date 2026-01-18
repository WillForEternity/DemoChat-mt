/**
 * Embeddings - Public API
 *
 * Exports all embedding-related functionality for the RAG semantic search system.
 *
 * Search hierarchy:
 * - hybridSearch: Recommended. Combines lexical + semantic for best results.
 * - searchEmbeddings: Semantic-only search (legacy, still available).
 * - lexicalSearch: Term-only search (low-level, for special cases).
 */

export * from "./types";
export * from "./chunker";
export * from "./embed-client";
export * from "./operations";
export * from "./lexical-search";
export * from "./hybrid-search";
