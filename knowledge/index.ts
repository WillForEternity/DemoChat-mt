/**
 * Knowledge Filesystem - Public API
 *
 * A simple client-side filesystem that Claude controls via tools.
 * Data is persisted in IndexedDB for fast, local access.
 *
 * Usage:
 *   import * as kb from "@/knowledge";
 *
 *   await kb.mkdir("projects");
 *   await kb.writeFile("projects/ideas.md", "# Ideas\n\n- Build an AI");
 *   const content = await kb.readFile("projects/ideas.md");
 *   const items = await kb.listFolder("projects");
 *   const tree = await kb.getTree();
 *
 * Hybrid Search (Recommended):
 *   import { hybridSearch } from "@/knowledge";
 *   const results = await hybridSearch("authentication methods");
 *   // Combines lexical (exact terms) + semantic (meaning) for best results
 *
 * Legacy Semantic-Only Search:
 *   import { searchEmbeddings } from "@/knowledge";
 *   const results = await searchEmbeddings("authentication methods");
 */

export * from "./types";
export * from "./operations";
export * from "./kb-summary";
export { getKnowledgeDb, initRootIfNeeded, migrateFromV2NameIfNeeded } from "./idb";

// Embedding/search exports
export {
  searchEmbeddings,
  embedFile,
  deleteFileEmbeddings,
  getEmbeddingStats,
  getAllEmbeddings,
  reindexAllFiles,
  clearAllEmbeddings,
  getUmapCache,
  computeAndCacheUmapProjection,
} from "./embeddings/operations";

// Hybrid search exports (recommended over searchEmbeddings)
export {
  hybridSearch,
  search,
  analyzeQuery,
  type HybridSearchResult,
  type HybridSearchOptions,
} from "./embeddings/hybrid-search";

// Lexical search exports (low-level, for special cases)
export {
  lexicalSearch,
  detectQueryType,
  getSearchWeights,
  tokenize,
  type LexicalSearchResult,
  type QueryType,
} from "./embeddings/lexical-search";

export type { SearchResult, EmbeddingRecord, Chunk } from "./embeddings/types";
export type { ReindexProgressCallback } from "./embeddings/operations";
export type { UmapCache } from "./idb";
