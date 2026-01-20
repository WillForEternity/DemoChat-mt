/**
 * Large Document Lexical Search
 *
 * Term-based search for large document chunks, complementing semantic search.
 * Handles exact terms, quoted phrases, and technical identifiers.
 *
 * Uses BM25-inspired scoring adapted for document content.
 */

import type { LargeDocumentChunk } from "./types";

// Re-export query type detection from KB lexical search
export {
  detectQueryType,
  getSearchWeights,
  type QueryType,
} from "@/knowledge/embeddings/lexical-search";

/**
 * Result of lexical search with term match details.
 */
export interface LargeDocLexicalResult {
  chunk: LargeDocumentChunk;
  lexicalScore: number;
  matchedTerms: string[];
  termFrequencies: Map<string, number>;
}

/**
 * Tokenize text into searchable terms.
 * Handles code identifiers, camelCase, snake_case, etc.
 */
function tokenize(text: string): string[] {
  // Convert to lowercase
  const lower = text.toLowerCase();

  // Split on whitespace and punctuation, but keep underscores for snake_case
  const tokens = lower
    .split(/[\s\-.,;:!?()[\]{}"'`<>\/\\|@#$%^&*+=~]+/)
    .filter((t) => t.length > 0);

  // Also split camelCase and PascalCase
  const expanded: string[] = [];
  for (const token of tokens) {
    // Split camelCase: "useState" -> ["use", "state", "usestate"]
    const camelParts = token
      .replace(/([a-z])([A-Z])/g, "$1 $2")
      .toLowerCase()
      .split(/\s+/);

    if (camelParts.length > 1) {
      expanded.push(...camelParts);
      expanded.push(token); // Keep original as well
    } else {
      expanded.push(token);
    }

    // Also split snake_case: "use_state" -> ["use", "state", "use_state"]
    if (token.includes("_")) {
      const snakeParts = token.split("_").filter((p) => p.length > 0);
      expanded.push(...snakeParts);
    }
  }

  // Remove very short tokens (but keep 2-char ones for things like "AI", "Go")
  return Array.from(new Set(expanded)).filter((t) => t.length >= 2);
}

/**
 * Extract quoted phrases from a query.
 */
function extractQuotedPhrases(query: string): {
  phrases: string[];
  remainingQuery: string;
} {
  const phrases: string[] = [];
  let remaining = query;

  // Match both single and double quotes
  const quoteRegex = /["']([^"']+)["']/g;
  let match;

  while ((match = quoteRegex.exec(query)) !== null) {
    phrases.push(match[1].toLowerCase());
    remaining = remaining.replace(match[0], " ");
  }

  // Also match backticks for code
  const backtickRegex = /`([^`]+)`/g;
  while ((match = backtickRegex.exec(query)) !== null) {
    phrases.push(match[1].toLowerCase());
    remaining = remaining.replace(match[0], " ");
  }

  return {
    phrases,
    remainingQuery: remaining.trim(),
  };
}

/**
 * Compute term frequency (TF) for a term in a document.
 * Uses log normalization: 1 + log(count) if count > 0, else 0
 */
function computeTF(term: string, docTokens: string[]): number {
  const count = docTokens.filter((t) => t === term).length;
  return count > 0 ? 1 + Math.log(count) : 0;
}

/**
 * Compute inverse document frequency (IDF) for a term.
 * IDF = log(N / (1 + df)) where N is total docs and df is docs containing term
 */
function computeIDF(
  term: string,
  allDocTokens: Map<string, string[]>,
  totalDocs: number
): number {
  let docsWithTerm = 0;
  const tokenArrays = Array.from(allDocTokens.values());
  for (const tokens of tokenArrays) {
    if (tokens.includes(term)) {
      docsWithTerm++;
    }
  }
  return Math.log(totalDocs / (1 + docsWithTerm));
}

/**
 * Perform lexical search across large document chunks.
 *
 * Scoring approach (BM25-inspired):
 * - Exact phrase matches get highest boost
 * - Term frequency (TF) normalized by log
 * - Inverse document frequency (IDF) for rare terms
 * - Position boost for matches in headings
 */
export function largeDocLexicalSearch(
  query: string,
  chunks: LargeDocumentChunk[],
  options: {
    /** Boost for matches in heading path (default: 1.5) */
    headingBoost?: number;
    /** Boost for exact phrase matches (default: 2.0) */
    phraseBoost?: number;
    /** Minimum score to include in results (default: 0.01) */
    minScore?: number;
  } = {}
): LargeDocLexicalResult[] {
  const { headingBoost = 1.5, phraseBoost = 2.0, minScore = 0.01 } = options;

  if (chunks.length === 0) {
    return [];
  }

  // Extract quoted phrases and remaining terms
  const { phrases, remainingQuery } = extractQuotedPhrases(query);
  const queryTerms = tokenize(remainingQuery);

  // If no search terms, return empty
  if (queryTerms.length === 0 && phrases.length === 0) {
    return [];
  }

  // Pre-tokenize all documents
  const docTokensMap = new Map<string, string[]>();
  const docTextMap = new Map<string, string>(); // For phrase matching

  for (const chunk of chunks) {
    const fullText = `${chunk.headingPath} ${chunk.chunkText}`;
    docTokensMap.set(chunk.id, tokenize(fullText));
    docTextMap.set(chunk.id, fullText.toLowerCase());
  }

  // Compute IDF for all query terms
  const totalDocs = chunks.length;
  const idfMap = new Map<string, number>();
  for (const term of queryTerms) {
    idfMap.set(term, computeIDF(term, docTokensMap, totalDocs));
  }

  // Score each document
  const results: LargeDocLexicalResult[] = [];

  for (const chunk of chunks) {
    const docTokens = docTokensMap.get(chunk.id)!;
    const docText = docTextMap.get(chunk.id)!;
    const headingText = chunk.headingPath.toLowerCase();

    let score = 0;
    const matchedTerms: string[] = [];
    const termFrequencies = new Map<string, number>();

    // Score individual terms using TF-IDF
    for (const term of queryTerms) {
      const tf = computeTF(term, docTokens);
      if (tf > 0) {
        const idf = idfMap.get(term) || 0;
        let termScore = tf * idf;

        // Boost if term appears in heading
        if (headingText.includes(term)) {
          termScore *= headingBoost;
        }

        score += termScore;
        matchedTerms.push(term);
        termFrequencies.set(term, tf);
      }
    }

    // Score exact phrase matches
    for (const phrase of phrases) {
      if (docText.includes(phrase)) {
        // Phrase match gets significant boost
        score += phraseBoost * phrase.split(/\s+/).length;
        matchedTerms.push(`"${phrase}"`);

        // Extra boost if in heading
        if (headingText.includes(phrase)) {
          score += phraseBoost * 0.5;
        }
      }
    }

    // Normalize score by query length to keep it in reasonable range
    const normalizer = queryTerms.length + phrases.length * 2;
    const normalizedScore = normalizer > 0 ? score / normalizer : 0;

    if (normalizedScore >= minScore) {
      results.push({
        chunk,
        lexicalScore: normalizedScore,
        matchedTerms: Array.from(new Set(matchedTerms)),
        termFrequencies,
      });
    }
  }

  // Sort by score descending
  return results.sort((a, b) => b.lexicalScore - a.lexicalScore);
}
