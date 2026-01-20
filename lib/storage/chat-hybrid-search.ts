/**
 * Chat Hybrid Search
 *
 * Combines lexical (term-based) and semantic (embedding-based) search
 * for chat history with RRF fusion and optional reranking.
 *
 * Mirrors the KB hybrid search implementation but adapted for chat embeddings.
 *
 * 2025 Best Practices:
 * - Uses Reciprocal Rank Fusion (RRF) as the default fusion method
 * - RRF is rank-based (not score-based), requiring no normalization
 * - Optional cross-encoder reranking for 20-40% accuracy boost
 * - Query type detection for optimal lexical/semantic weighting
 */

import { getChatEmbeddingsDb, type ChatEmbeddingRecord } from "./chat-embeddings-idb";
import { embedQuery } from "@/knowledge/embeddings/embed-client";
import {
  chatLexicalSearch,
  detectQueryType,
  type QueryType,
  type ChatLexicalResult,
} from "./chat-lexical-search";
import {
  rerank,
  getRecommendedReranker,
  type RerankDocument,
  type RerankerConfig,
} from "@/knowledge/embeddings/reranker";

/**
 * Fusion method for combining search results.
 */
export type FusionMethod = "rrf" | "weighted";

/**
 * Options for chat hybrid search.
 */
export interface ChatHybridSearchOptions {
  /** Number of results to return (default: 5, max: 25) */
  topK?: number;
  /** Minimum semantic score threshold (default: 0.0 for RRF) */
  threshold?: number;
  /** Override automatic query type detection */
  forceQueryType?: QueryType;
  /** Include score breakdown in results (default: false) */
  includeBreakdown?: boolean;
  /** Fusion method: "rrf" (default, recommended) or "weighted" */
  fusionMethod?: FusionMethod;
  /** RRF smoothing constant k (default: 60) */
  rrfK?: number;
  /** Enable reranking for better accuracy (default: auto-detect) */
  rerank?: boolean;
  /** Reranker backend to use */
  rerankerBackend?: RerankerConfig["backend"];
  /** Number of candidates to retrieve before reranking (default: 50) */
  retrieveK?: number;
}

/**
 * Chat hybrid search result with scoring breakdown.
 */
export interface ChatHybridSearchResult {
  conversationId: string;
  conversationTitle: string;
  chunkText: string;
  messageRole: "user" | "assistant";
  chunkIndex: number;
  /** Combined score (semantic score for display, RRF for ordering) */
  score: number;
  /** Semantic (embedding) similarity score */
  semanticScore: number;
  /** Lexical (term matching) score */
  lexicalScore: number;
  /** Which terms matched for lexical search */
  matchedTerms: string[];
  /** The detected query type */
  queryType: QueryType;
  /** The fusion method used */
  fusionMethod: FusionMethod;
  /** Whether this result was reranked */
  reranked?: boolean;
  /** Semantic rank (position in semantic-only results) */
  semanticRank?: number;
  /** Lexical rank (position in lexical-only results) */
  lexicalRank?: number;
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
 * Perform hybrid search across chat embeddings.
 *
 * Pipeline:
 * 1. Detect query type (exact, semantic, or mixed)
 * 2. Run lexical search → ranked list
 * 3. Run semantic search → ranked list
 * 4. Compute RRF fusion scores
 * 5. (Optional) Rerank top candidates with cross-encoder
 * 6. Return final results
 */
export async function chatHybridSearch(
  query: string,
  options: ChatHybridSearchOptions = {}
): Promise<ChatHybridSearchResult[]> {
  const {
    topK = 5,
    threshold = 0.0,
    forceQueryType,
    includeBreakdown = false,
    fusionMethod = "rrf",
    rrfK = 60,
    rerank: enableRerank,
    rerankerBackend,
    retrieveK = 50,
  } = options;

  const db = await getChatEmbeddingsDb();

  // Load all chat embeddings
  const allEmbeddings = await db.getAll("embeddings");

  if (allEmbeddings.length === 0) {
    return [];
  }

  // Detect query type
  const queryType = forceQueryType ?? detectQueryType(query);

  // Run lexical search
  const lexicalResults = chatLexicalSearch(query, allEmbeddings);
  const lexicalRanks = new Map<string, number>();
  const lexicalScoresMap = new Map<string, ChatLexicalResult>();
  lexicalResults.forEach((result, index) => {
    lexicalRanks.set(result.record.id, index + 1); // 1-indexed rank
    lexicalScoresMap.set(result.record.id, result);
  });

  // Run semantic search
  let queryEmbedding: number[];
  try {
    queryEmbedding = await embedQuery(query);
  } catch (error) {
    console.error("[ChatHybridSearch] Failed to embed query:", error);
    // Fall back to lexical-only if embedding fails
    return lexicalResults
      .slice(0, topK)
      .map((r) => ({
        conversationId: r.record.conversationId,
        conversationTitle: r.record.conversationTitle,
        chunkText: r.record.chunkText,
        messageRole: r.record.messageRole,
        chunkIndex: r.record.chunkIndex,
        score: r.lexicalScore,
        semanticScore: 0,
        lexicalScore: r.lexicalScore,
        matchedTerms: r.matchedTerms,
        queryType,
        fusionMethod: "weighted" as FusionMethod,
        reranked: false,
      }));
  }

  // Compute semantic scores and create ranked list
  const semanticScored: Array<{ embedding: ChatEmbeddingRecord; score: number }> = [];
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

  // Combine using RRF
  const combinedResults: Array<{
    embedding: ChatEmbeddingRecord;
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

  // Sort by RRF score
  combinedResults.sort((a, b) => b.rrfScore - a.rrfScore);

  // Determine if we should rerank
  const shouldRerank = enableRerank ?? (getRecommendedReranker() !== "none");
  const candidateCount = shouldRerank ? retrieveK : topK;

  // Get candidates
  const candidates = combinedResults.slice(0, candidateCount);

  // Filter by semantic threshold
  const filtered = candidates.filter((r) => r.semanticScore >= threshold);

  if (filtered.length === 0) {
    return [];
  }

  // Apply reranking if enabled
  if (shouldRerank && filtered.length > 1) {
    const rerankDocs: RerankDocument[] = filtered.map((r) => ({
      id: r.embedding.id,
      text: r.embedding.chunkText,
      originalScore: r.rrfScore,
      metadata: {
        conversationId: r.embedding.conversationId,
        conversationTitle: r.embedding.conversationTitle,
        messageRole: r.embedding.messageRole,
        chunkIndex: r.embedding.chunkIndex,
        semanticScore: r.semanticScore,
        lexicalScore: r.lexicalScore,
        matchedTerms: r.matchedTerms,
        semanticRank: r.semanticRank,
        lexicalRank: r.lexicalRank,
      },
    }));

    try {
      const reranked = await rerank(query, rerankDocs, {
        backend: rerankerBackend ?? getRecommendedReranker(),
        topK,
      });

      // Build results from reranked list
      return reranked.map((r) => {
        const meta = r.metadata as {
          conversationId: string;
          conversationTitle: string;
          messageRole: "user" | "assistant";
          chunkIndex: number;
          semanticScore: number;
          lexicalScore: number;
          matchedTerms: string[];
          semanticRank: number | null;
          lexicalRank: number | null;
        };
        return {
          conversationId: meta.conversationId,
          conversationTitle: meta.conversationTitle,
          chunkText: r.text,
          messageRole: meta.messageRole,
          chunkIndex: meta.chunkIndex,
          score: Math.round(r.relevanceScore * 100) / 100,
          semanticScore: Math.round(meta.semanticScore * 100) / 100,
          lexicalScore: Math.round(meta.lexicalScore * 100) / 100,
          matchedTerms: includeBreakdown ? meta.matchedTerms : [],
          queryType,
          fusionMethod,
          reranked: true,
          semanticRank: includeBreakdown ? meta.semanticRank ?? undefined : undefined,
          lexicalRank: includeBreakdown ? meta.lexicalRank ?? undefined : undefined,
        };
      });
    } catch (error) {
      console.error("[ChatHybridSearch] Reranking failed, using RRF results:", error);
      // Fall through to non-reranked results
    }
  }

  // Return results without reranking (take topK)
  const finalResults = filtered.slice(0, topK);

  return finalResults.map((r) => ({
    conversationId: r.embedding.conversationId,
    conversationTitle: r.embedding.conversationTitle,
    chunkText: r.embedding.chunkText,
    messageRole: r.embedding.messageRole,
    chunkIndex: r.embedding.chunkIndex,
    score: Math.round(r.semanticScore * 100) / 100,
    semanticScore: Math.round(r.semanticScore * 100) / 100,
    lexicalScore: Math.round(r.lexicalScore * 100) / 100,
    matchedTerms: includeBreakdown ? r.matchedTerms : [],
    queryType,
    fusionMethod,
    reranked: false,
    semanticRank: includeBreakdown ? r.semanticRank ?? undefined : undefined,
    lexicalRank: includeBreakdown ? r.lexicalRank ?? undefined : undefined,
  }));
}
