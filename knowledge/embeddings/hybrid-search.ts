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
}

/**
 * Options for hybrid search.
 */
export interface HybridSearchOptions {
  /** Number of results to return (default: 5, max: 20) */
  topK?: number;
  /** Minimum combined score to include (default: 0.2) */
  threshold?: number;
  /** Override automatic query type detection */
  forceQueryType?: QueryType;
  /** Custom semantic weight (0-1), lexical weight is 1 - this */
  semanticWeight?: number;
  /** Include score breakdown in results (default: false for backward compat) */
  includeBreakdown?: boolean;
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
 * Normalize a score to 0-1 range using min-max normalization.
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
 * Algorithm:
 * 1. Detect query type (exact, semantic, or mixed)
 * 2. Run lexical search for term matching
 * 3. Run semantic search for embedding similarity
 * 4. Combine scores with type-based weighting
 * 5. Return ranked results
 */
export async function hybridSearch(
  query: string,
  options: HybridSearchOptions = {}
): Promise<HybridSearchResult[]> {
  const {
    topK = 5,
    threshold = 0.2,
    forceQueryType,
    semanticWeight: customSemanticWeight,
    includeBreakdown = false,
  } = options;

  const db = await getKnowledgeDb();

  // Load all embeddings
  const allEmbeddings = await db.getAll("embeddings");

  if (allEmbeddings.length === 0) {
    return [];
  }

  // Detect query type for dynamic weighting
  const queryType = forceQueryType ?? detectQueryType(query);
  const weights = customSemanticWeight !== undefined
    ? { semanticWeight: customSemanticWeight, lexicalWeight: 1 - customSemanticWeight }
    : getSearchWeights(queryType);

  // Run lexical search
  const lexicalResults = lexicalSearch(query, allEmbeddings);
  const lexicalScores = new Map<string, LexicalSearchResult>();
  for (const result of lexicalResults) {
    lexicalScores.set(result.record.id, result);
  }

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
      }));
  }

  // Compute semantic scores
  const rawSemanticScores = new Map<string, number>();
  for (const embedding of allEmbeddings) {
    const similarity = cosineSimilarity(queryEmbedding, embedding.embedding);
    rawSemanticScores.set(embedding.id, similarity);
  }

  // Normalize lexical scores for fair comparison
  const rawLexicalScores = new Map<string, number>();
  const lexicalEntries = Array.from(lexicalScores.entries());
  for (const [id, result] of lexicalEntries) {
    rawLexicalScores.set(id, result.lexicalScore);
  }
  const normalizedLexicalScores = normalizeScores(rawLexicalScores);

  // Combine all documents with their scores
  const allDocIds = new Set<string>();
  for (const embedding of allEmbeddings) {
    allDocIds.add(embedding.id);
  }

  const combinedResults: Array<{
    embedding: EmbeddingRecord;
    semanticScore: number;
    lexicalScore: number;
    normalizedLexical: number;
    combinedScore: number;
    matchedTerms: string[];
  }> = [];

  const docIdArray = Array.from(allDocIds);
  for (const id of docIdArray) {
    const embedding = allEmbeddings.find((e) => e.id === id)!;
    const semanticScore = rawSemanticScores.get(id) ?? 0;
    const lexicalResult = lexicalScores.get(id);
    const rawLexical = lexicalResult?.lexicalScore ?? 0;
    const normalizedLexical = rawLexical > 0 ? (normalizedLexicalScores.get(id) ?? 0) : 0;
    const matchedTerms = lexicalResult?.matchedTerms ?? [];

    // Combine scores with weights
    // For semantic: use raw score (already 0-1 from cosine similarity)
    // For lexical: use normalized score for fair weighting
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
    score: Math.round(r.combinedScore * 100) / 100, // Round to 2 decimals
    chunkIndex: r.embedding.chunkIndex,
    semanticScore: Math.round(r.semanticScore * 100) / 100,
    lexicalScore: Math.round(r.lexicalScore * 100) / 100,
    matchedTerms: includeBreakdown ? r.matchedTerms : [],
    queryType: includeBreakdown ? queryType : queryType, // Always include for debugging
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
