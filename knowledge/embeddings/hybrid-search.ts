/**
 * Hybrid Search
 *
 * Combines lexical (term-based) and semantic (embedding-based) search
 * for the best of both worlds:
 *
 * - Lexical: Precision for exact terms, code identifiers, error codes
 * - Semantic: Recall for conceptual queries, synonyms, natural language
 *
 * Key insight from e-commerce search research:
 * "Dense embeddings are recall-oriented for meaning, not precision-oriented for exact attributes."
 * Hybrid search fixes this by ensuring exact matches always surface.
 *
 * 2025 Best Practices:
 * - Uses Reciprocal Rank Fusion (RRF) as the default fusion method
 * - RRF is rank-based (not score-based), requiring no normalization
 * - Rewards documents that appear in both lexical and semantic results
 * - Falls back to weighted sum when explicit weights are provided
 */

import { getKnowledgeDb } from "../idb";
import { embedQuery } from "./embed-client";
import {
  lexicalSearch,
  detectQueryType,
  getSearchWeights,
  type QueryType,
  type LexicalSearchResult,
} from "./lexical-search";
import type { EmbeddingRecord, SearchResult } from "./types";

/**
 * Fusion method for combining search results.
 */
export type FusionMethod = "rrf" | "weighted";

/**
 * Extended search result with breakdown of how score was computed.
 */
export interface HybridSearchResult extends SearchResult {
  /** The semantic (embedding) similarity score (0-1) */
  semanticScore: number;
  /** The lexical (term matching) score (normalized) */
  lexicalScore: number;
  /** Which terms matched for lexical search */
  matchedTerms: string[];
  /** The detected query type that influenced weighting */
  queryType: QueryType;
  /** The fusion method used */
  fusionMethod?: FusionMethod;
  /** Semantic rank (position in semantic-only results) */
  semanticRank?: number;
  /** Lexical rank (position in lexical-only results) */
  lexicalRank?: number;
}

/**
 * Options for hybrid search.
 */
export interface HybridSearchOptions {
  /** Number of results to return (default: 5, max: 20) */
  topK?: number;
  /** Minimum combined score to include (default: 0.2 for weighted, 0.0 for RRF) */
  threshold?: number;
  /** Override automatic query type detection */
  forceQueryType?: QueryType;
  /** Custom semantic weight (0-1), lexical weight is 1 - this. Setting this forces weighted fusion. */
  semanticWeight?: number;
  /** Include score breakdown in results (default: false for backward compat) */
  includeBreakdown?: boolean;
  /** Fusion method: "rrf" (default, recommended) or "weighted" */
  fusionMethod?: FusionMethod;
  /** RRF smoothing constant k (default: 60, standard value) */
  rrfK?: number;
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
 * Reciprocal Rank Fusion (RRF) score calculation.
 * 
 * RRF(d) = Σ 1/(k + rank(d))
 * 
 * Benefits:
 * - No normalization needed (uses ranks, not scores)
 * - Rewards documents appearing in multiple lists
 * - Robust across different scoring scales
 * - k=60 is the standard value (prevents single top result from dominating)
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
 * Normalize a score to 0-1 range using min-max normalization.
 * Used only for weighted fusion (legacy support).
 */
function normalizeScores(
  scores: Map<string, number>
): Map<string, number> {
  const values = Array.from(scores.values());
  if (values.length === 0) return scores;

  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min;

  if (range === 0) {
    // All scores are the same, normalize to 0.5
    const normalized = new Map<string, number>();
    const entries = Array.from(scores.entries());
    for (const [id] of entries) {
      normalized.set(id, 0.5);
    }
    return normalized;
  }

  const normalized = new Map<string, number>();
  const entries = Array.from(scores.entries());
  for (const [id, score] of entries) {
    normalized.set(id, (score - min) / range);
  }
  return normalized;
}

/**
 * Perform hybrid search combining lexical and semantic approaches.
 *
 * Algorithm (RRF - default):
 * 1. Detect query type (exact, semantic, or mixed)
 * 2. Run lexical search for term matching → get ranked list
 * 3. Run semantic search for embedding similarity → get ranked list
 * 4. Compute RRF score: RRF(d) = 1/(k + semantic_rank) + 1/(k + lexical_rank)
 * 5. Return results sorted by RRF score
 *
 * Algorithm (Weighted - legacy):
 * 1-3. Same as above
 * 4. Combine scores with type-based weighting
 * 5. Return ranked results
 */
export async function hybridSearch(
  query: string,
  options: HybridSearchOptions = {}
): Promise<HybridSearchResult[]> {
  const {
    topK = 5,
    forceQueryType,
    semanticWeight: customSemanticWeight,
    includeBreakdown = false,
    rrfK = 60,
  } = options;

  // Determine fusion method: use weighted if explicit weight provided, otherwise RRF
  const fusionMethod: FusionMethod = 
    options.fusionMethod ?? (customSemanticWeight !== undefined ? "weighted" : "rrf");
  
  // Threshold defaults differ by fusion method
  const threshold = options.threshold ?? (fusionMethod === "rrf" ? 0.0 : 0.2);

  const db = await getKnowledgeDb();

  // Load all embeddings
  const allEmbeddings = await db.getAll("embeddings");

  if (allEmbeddings.length === 0) {
    return [];
  }

  // Detect query type for dynamic weighting (used for weighted fusion)
  const queryType = forceQueryType ?? detectQueryType(query);
  const weights = customSemanticWeight !== undefined
    ? { semanticWeight: customSemanticWeight, lexicalWeight: 1 - customSemanticWeight }
    : getSearchWeights(queryType);

  // Run lexical search and create ranked list
  const lexicalResults = lexicalSearch(query, allEmbeddings);
  const lexicalRanks = new Map<string, number>();
  const lexicalScoresMap = new Map<string, LexicalSearchResult>();
  lexicalResults.forEach((result, index) => {
    lexicalRanks.set(result.record.id, index + 1); // 1-indexed rank
    lexicalScoresMap.set(result.record.id, result);
  });

  // Run semantic search
  let queryEmbedding: number[];
  try {
    queryEmbedding = await embedQuery(query);
  } catch (error) {
    console.error("[HybridSearch] Failed to embed query:", error);
    // Fall back to lexical-only if embedding fails
    return lexicalResults
      .slice(0, topK)
      .filter((r) => r.lexicalScore >= threshold)
      .map((r) => ({
        filePath: r.record.filePath,
        chunkText: r.record.chunkText,
        headingPath: r.record.headingPath,
        score: r.lexicalScore,
        chunkIndex: r.record.chunkIndex,
        semanticScore: 0,
        lexicalScore: r.lexicalScore,
        matchedTerms: r.matchedTerms,
        queryType,
        fusionMethod: "weighted" as FusionMethod,
      }));
  }

  // Compute semantic scores and create ranked list
  const semanticScored: Array<{ embedding: EmbeddingRecord; score: number }> = [];
  for (const embedding of allEmbeddings) {
    const similarity = cosineSimilarity(queryEmbedding, embedding.embedding);
    semanticScored.push({ embedding, score: similarity });
  }
  
  // Sort by semantic score to get ranks
  semanticScored.sort((a, b) => b.score - a.score);
  
  const semanticRanks = new Map<string, number>();
  const rawSemanticScores = new Map<string, number>();
  semanticScored.forEach((item, index) => {
    semanticRanks.set(item.embedding.id, index + 1); // 1-indexed rank
    rawSemanticScores.set(item.embedding.id, item.score);
  });

  // Combine results based on fusion method
  if (fusionMethod === "rrf") {
    return hybridSearchRRF(
      allEmbeddings,
      semanticRanks,
      lexicalRanks,
      rawSemanticScores,
      lexicalScoresMap,
      queryType,
      topK,
      threshold,
      rrfK,
      includeBreakdown
    );
  } else {
    return hybridSearchWeighted(
      allEmbeddings,
      rawSemanticScores,
      lexicalScoresMap,
      weights,
      queryType,
      topK,
      threshold,
      includeBreakdown,
      semanticRanks,
      lexicalRanks
    );
  }
}

/**
 * RRF-based hybrid search fusion.
 */
function hybridSearchRRF(
  allEmbeddings: EmbeddingRecord[],
  semanticRanks: Map<string, number>,
  lexicalRanks: Map<string, number>,
  rawSemanticScores: Map<string, number>,
  lexicalScoresMap: Map<string, LexicalSearchResult>,
  queryType: QueryType,
  topK: number,
  threshold: number,
  rrfK: number,
  includeBreakdown: boolean
): HybridSearchResult[] {
  const combinedResults: Array<{
    embedding: EmbeddingRecord;
    rrfScore: number;
    semanticScore: number;
    lexicalScore: number;
    semanticRank: number | null;
    lexicalRank: number | null;
    matchedTerms: string[];
  }> = [];

  for (const embedding of allEmbeddings) {
    const id = embedding.id;
    const semanticRank = semanticRanks.get(id) ?? null;
    const lexicalRank = lexicalRanks.get(id) ?? null;
    const semanticScore = rawSemanticScores.get(id) ?? 0;
    const lexicalResult = lexicalScoresMap.get(id);
    const lexicalScore = lexicalResult?.lexicalScore ?? 0;
    const matchedTerms = lexicalResult?.matchedTerms ?? [];

    // Compute RRF score
    const rrfScore = computeRRFScore(semanticRank, lexicalRank, rrfK);

    combinedResults.push({
      embedding,
      rrfScore,
      semanticScore,
      lexicalScore,
      semanticRank,
      lexicalRank,
      matchedTerms,
    });
  }

  // Sort by RRF score and filter by threshold
  const sortedResults = combinedResults
    .filter((r) => r.rrfScore >= threshold)
    .sort((a, b) => b.rrfScore - a.rrfScore)
    .slice(0, topK);

  // Format results
  return sortedResults.map((r) => ({
    filePath: r.embedding.filePath,
    chunkText: r.embedding.chunkText,
    headingPath: r.embedding.headingPath,
    score: Math.round(r.rrfScore * 10000) / 10000, // RRF scores are small, keep more precision
    chunkIndex: r.embedding.chunkIndex,
    semanticScore: Math.round(r.semanticScore * 100) / 100,
    lexicalScore: Math.round(r.lexicalScore * 100) / 100,
    matchedTerms: includeBreakdown ? r.matchedTerms : [],
    queryType,
    fusionMethod: "rrf" as FusionMethod,
    semanticRank: includeBreakdown ? r.semanticRank ?? undefined : undefined,
    lexicalRank: includeBreakdown ? r.lexicalRank ?? undefined : undefined,
  }));
}

/**
 * Weighted sum hybrid search fusion (legacy support).
 */
function hybridSearchWeighted(
  allEmbeddings: EmbeddingRecord[],
  rawSemanticScores: Map<string, number>,
  lexicalScoresMap: Map<string, LexicalSearchResult>,
  weights: { semanticWeight: number; lexicalWeight: number },
  queryType: QueryType,
  topK: number,
  threshold: number,
  includeBreakdown: boolean,
  semanticRanks: Map<string, number>,
  lexicalRanks: Map<string, number>
): HybridSearchResult[] {
  // Normalize lexical scores for fair comparison
  const rawLexicalScores = new Map<string, number>();
  const lexicalEntries = Array.from(lexicalScoresMap.entries());
  for (const [id, result] of lexicalEntries) {
    rawLexicalScores.set(id, result.lexicalScore);
  }
  const normalizedLexicalScores = normalizeScores(rawLexicalScores);

  const combinedResults: Array<{
    embedding: EmbeddingRecord;
    semanticScore: number;
    lexicalScore: number;
    normalizedLexical: number;
    combinedScore: number;
    matchedTerms: string[];
    semanticRank: number | null;
    lexicalRank: number | null;
  }> = [];

  for (const embedding of allEmbeddings) {
    const id = embedding.id;
    const semanticScore = rawSemanticScores.get(id) ?? 0;
    const lexicalResult = lexicalScoresMap.get(id);
    const rawLexical = lexicalResult?.lexicalScore ?? 0;
    const normalizedLexical = rawLexical > 0 ? (normalizedLexicalScores.get(id) ?? 0) : 0;
    const matchedTerms = lexicalResult?.matchedTerms ?? [];

    // Combine scores with weights
    const combinedScore =
      semanticScore * weights.semanticWeight +
      normalizedLexical * weights.lexicalWeight;

    combinedResults.push({
      embedding,
      semanticScore,
      lexicalScore: rawLexical,
      normalizedLexical,
      combinedScore,
      matchedTerms,
      semanticRank: semanticRanks.get(id) ?? null,
      lexicalRank: lexicalRanks.get(id) ?? null,
    });
  }

  // Sort by combined score and filter by threshold
  const sortedResults = combinedResults
    .filter((r) => r.combinedScore >= threshold)
    .sort((a, b) => b.combinedScore - a.combinedScore)
    .slice(0, topK);

  // Format results
  return sortedResults.map((r) => ({
    filePath: r.embedding.filePath,
    chunkText: r.embedding.chunkText,
    headingPath: r.embedding.headingPath,
    score: Math.round(r.combinedScore * 100) / 100,
    chunkIndex: r.embedding.chunkIndex,
    semanticScore: Math.round(r.semanticScore * 100) / 100,
    lexicalScore: Math.round(r.lexicalScore * 100) / 100,
    matchedTerms: includeBreakdown ? r.matchedTerms : [],
    queryType,
    fusionMethod: "weighted" as FusionMethod,
    semanticRank: includeBreakdown ? r.semanticRank ?? undefined : undefined,
    lexicalRank: includeBreakdown ? r.lexicalRank ?? undefined : undefined,
  }));
}

/**
 * Simpler interface that matches the original searchEmbeddings signature.
 * Use this for backward compatibility.
 */
export async function search(
  query: string,
  topK: number = 5,
  threshold: number = 0.2
): Promise<SearchResult[]> {
  const results = await hybridSearch(query, { topK, threshold });

  // Convert to basic SearchResult format
  return results.map((r) => ({
    filePath: r.filePath,
    chunkText: r.chunkText,
    headingPath: r.headingPath,
    score: r.score,
    chunkIndex: r.chunkIndex,
  }));
}

/**
 * Get details about how a query would be processed.
 * Useful for debugging and understanding search behavior.
 */
export function analyzeQuery(query: string): {
  queryType: QueryType;
  weights: { semanticWeight: number; lexicalWeight: number };
  explanation: string;
} {
  const queryType = detectQueryType(query);
  const weights = getSearchWeights(queryType);

  let explanation: string;
  switch (queryType) {
    case "exact":
      explanation =
        "Query contains quoted phrases, code identifiers, or technical terms. " +
        "Lexical search is prioritized to find exact matches.";
      break;
    case "semantic":
      explanation =
        "Query is a natural language question or long-form query. " +
        "Semantic search is prioritized to find conceptually related content.";
      break;
    case "mixed":
    default:
      explanation =
        "Query is a mix of specific terms and general concepts. " +
        "Both lexical and semantic search are weighted equally.";
      break;
  }

  return { queryType, weights, explanation };
}
