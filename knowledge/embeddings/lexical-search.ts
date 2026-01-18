/**
 * Lexical Search
 *
 * Simple term-based search for exact keyword matching.
 * Complements semantic search by handling:
 * - Exact terms (library names, error codes, API methods)
 * - Quoted phrases
 * - Technical identifiers (ECONNREFUSED, useState, etc.)
 *
 * Uses a simplified BM25-inspired scoring approach.
 */

import type { EmbeddingRecord } from "./types";

/**
 * Result of lexical search with term match details.
 */
export interface LexicalSearchResult {
  record: EmbeddingRecord;
  lexicalScore: number;
  matchedTerms: string[];
  termFrequencies: Map<string, number>;
}

/**
 * Tokenize text into searchable terms.
 * Handles code identifiers, camelCase, snake_case, etc.
 */
export function tokenize(text: string): string[] {
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
 * Returns { phrases: string[], remainingQuery: string }
 */
export function extractQuotedPhrases(query: string): {
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
 * Perform lexical search across embedding records.
 *
 * Scoring approach (BM25-inspired):
 * - Exact phrase matches get highest boost
 * - Term frequency (TF) normalized by log
 * - Inverse document frequency (IDF) for rare terms
 * - Position boost for matches in headings/file paths
 */
export function lexicalSearch(
  query: string,
  documents: EmbeddingRecord[],
  options: {
    /** Boost for matches in heading/file path (default: 1.5) */
    headingBoost?: number;
    /** Boost for exact phrase matches (default: 2.0) */
    phraseBoost?: number;
    /** Minimum score to include in results (default: 0.01) */
    minScore?: number;
  } = {}
): LexicalSearchResult[] {
  const { headingBoost = 1.5, phraseBoost = 2.0, minScore = 0.01 } = options;

  if (documents.length === 0) {
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

  for (const doc of documents) {
    const fullText = `${doc.headingPath} ${doc.filePath} ${doc.chunkText}`;
    docTokensMap.set(doc.id, tokenize(fullText));
    docTextMap.set(doc.id, fullText.toLowerCase());
  }

  // Compute IDF for all query terms
  const totalDocs = documents.length;
  const idfMap = new Map<string, number>();
  for (const term of queryTerms) {
    idfMap.set(term, computeIDF(term, docTokensMap, totalDocs));
  }

  // Score each document
  const results: LexicalSearchResult[] = [];

  for (const doc of documents) {
    const docTokens = docTokensMap.get(doc.id)!;
    const docText = docTextMap.get(doc.id)!;
    const headingText = `${doc.headingPath} ${doc.filePath}`.toLowerCase();

    let score = 0;
    const matchedTerms: string[] = [];
    const termFrequencies = new Map<string, number>();

    // Score individual terms using TF-IDF
    for (const term of queryTerms) {
      const tf = computeTF(term, docTokens);
      if (tf > 0) {
        const idf = idfMap.get(term) || 0;
        let termScore = tf * idf;

        // Boost if term appears in heading/path
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
        record: doc,
        lexicalScore: normalizedScore,
        matchedTerms: Array.from(new Set(matchedTerms)),
        termFrequencies,
      });
    }
  }

  // Sort by score descending
  return results.sort((a, b) => b.lexicalScore - a.lexicalScore);
}

/**
 * Detect if a query looks like it needs exact matching.
 * Used for dynamic weighting between lexical and semantic search.
 */
export type QueryType = "exact" | "semantic" | "mixed";

export function detectQueryType(query: string): QueryType {
  // Exact: has quoted strings
  if (/["'`]/.test(query)) {
    return "exact";
  }

  // Exact: looks like a constant (ALL_CAPS)
  if (/^[A-Z][A-Z0-9_]+$/.test(query.trim())) {
    return "exact";
  }

  // Exact: looks like code identifier (camelCase, snake_case with specific patterns)
  if (/^[a-z]+[A-Z][a-zA-Z0-9]*$/.test(query.trim())) {
    // camelCase like "useState"
    return "exact";
  }

  // Exact: file extension query
  if (/\.(js|ts|tsx|jsx|md|py|go|rs|json|yaml|yml|toml|css|html)$/i.test(query)) {
    return "exact";
  }

  // Exact: error code patterns
  if (/^E[A-Z]+$/.test(query.trim()) || /^[A-Z]{2,}_[A-Z_]+$/.test(query.trim())) {
    return "exact";
  }

  // Exact: short single technical term (likely a library/API name)
  const words = query.trim().split(/\s+/);
  if (words.length === 1 && /^[a-z0-9_-]+$/i.test(words[0]) && words[0].length <= 15) {
    return "mixed"; // Single word could be either
  }

  // Semantic: question words
  if (/^(what|how|why|when|where|who|which|can|does|is|are|should|would|could)/i.test(query)) {
    return "semantic";
  }

  // Semantic: longer natural language queries
  if (words.length >= 4) {
    return "semantic";
  }

  // Default: mixed for medium-length queries
  return "mixed";
}

/**
 * Get recommended weights based on query type.
 */
export function getSearchWeights(queryType: QueryType): {
  semanticWeight: number;
  lexicalWeight: number;
} {
  switch (queryType) {
    case "exact":
      return { semanticWeight: 0.3, lexicalWeight: 0.7 };
    case "semantic":
      return { semanticWeight: 0.85, lexicalWeight: 0.15 };
    case "mixed":
    default:
      return { semanticWeight: 0.6, lexicalWeight: 0.4 };
  }
}
