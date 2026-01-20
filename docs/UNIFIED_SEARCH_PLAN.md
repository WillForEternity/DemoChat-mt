# Unified Semantic Search Plan

> **STATUS: IMPLEMENTED** ✅
> 
> All phases (1-5) have been implemented. Phase 6 (shared core-search.ts) was cancelled as optional.

## Overview

This document outlines the plan to achieve feature parity across all three semantic search tools:
- `kb_search` - Knowledge Base search
- `chat_search` - Chat History search  
- `document_search` - Large Document RAG search

Currently, each search tool has different capabilities. This plan unifies them so all three have the same robust RAG pipeline.

## Current State Analysis

| Feature | Large Docs | KB Search | Chat Search |
|---------|-----------|-----------|-------------|
| Semantic search (embeddings) | ✅ | ✅ | ✅ |
| Lexical/term matching | ❌ | ✅ | ❌ |
| Hybrid fusion (RRF) | ❌ | ✅ | ❌ |
| Cross-encoder reranking | ✅ | ❌ | ❌ |
| Retrieve-then-rerank (50→topK) | ✅ | ❌ | ❌ |
| Query type detection | ❌ | ✅ | ❌ |
| Chunk overlap (15%) | ✅ | ✅ | ❌ |
| Matched terms in results | ❌ | ✅ | ❌ |

### Target State (All Three Tools)

| Feature | All Tools |
|---------|-----------|
| Semantic search (embeddings) | ✅ |
| Lexical/term matching | ✅ |
| Hybrid fusion (RRF) | ✅ |
| Cross-encoder reranking | ✅ (optional, auto-detect) |
| Retrieve-then-rerank | ✅ (retrieve 50, rerank to topK) |
| Query type detection | ✅ |
| Chunk overlap | ✅ |
| Matched terms in results | ✅ |

---

## Implementation Plan

### Phase 1: Add Reranking to KB Search (hybrid-search.ts)

**File:** `knowledge/embeddings/hybrid-search.ts`

**Changes:**

1. Add reranking options to `HybridSearchOptions`:

```typescript
export interface HybridSearchOptions {
  topK?: number;
  threshold?: number;
  forceQueryType?: QueryType;
  semanticWeight?: number;
  includeBreakdown?: boolean;
  fusionMethod?: FusionMethod;
  rrfK?: number;
  // NEW: Reranking options
  rerank?: boolean;
  rerankerBackend?: RerankerConfig["backend"];
  retrieveK?: number; // Candidates to retrieve before reranking (default: 50)
}
```

2. Import reranker:

```typescript
import { rerank, getRecommendedReranker, type RerankDocument, type RerankerConfig } from "./reranker";
```

3. Modify `hybridSearch()` to apply reranking after RRF fusion:

```typescript
// After getting RRF-sorted results...
const shouldRerank = options.rerank ?? (getRecommendedReranker() !== "none");
const candidateCount = shouldRerank ? (options.retrieveK ?? 50) : topK;

// Get more candidates if reranking
const candidates = sortedResults.slice(0, candidateCount);

if (shouldRerank && candidates.length > 1) {
  const rerankDocs: RerankDocument[] = candidates.map((c) => ({
    id: c.embedding.id,
    text: c.embedding.chunkText,
    originalScore: c.rrfScore,
    metadata: {
      filePath: c.embedding.filePath,
      headingPath: c.embedding.headingPath,
      chunkIndex: c.embedding.chunkIndex,
    },
  }));

  try {
    const reranked = await rerank(query, rerankDocs, {
      backend: options.rerankerBackend ?? getRecommendedReranker(),
      topK,
    });
    // Map back to HybridSearchResult format...
  } catch (error) {
    console.error("[HybridSearch] Reranking failed, using RRF results:", error);
    // Fall through to non-reranked results
  }
}
```

**Estimated effort:** Small - infrastructure exists, just need to wire it up.

---

### Phase 2: Add Hybrid Search + Reranking to Chat Search

**Files:**
- `lib/storage/chat-embeddings-ops.ts` - Add hybrid search
- `lib/storage/chat-lexical-search.ts` - NEW: Lexical search for chat

#### Step 2a: Create Chat Lexical Search

**New file:** `lib/storage/chat-lexical-search.ts`

Port the lexical search logic from `knowledge/embeddings/lexical-search.ts` but adapted for chat:

```typescript
/**
 * Chat Lexical Search
 * 
 * Term-based search for chat embeddings, mirroring KB lexical search.
 */

import type { ChatEmbeddingRecord } from "./chat-embeddings-idb";

export interface ChatLexicalResult {
  record: ChatEmbeddingRecord;
  lexicalScore: number;
  matchedTerms: string[];
}

/**
 * Perform lexical search on chat embeddings.
 */
export function chatLexicalSearch(
  query: string,
  embeddings: ChatEmbeddingRecord[]
): ChatLexicalResult[] {
  // Same BM25-inspired scoring as KB lexical search
  // Tokenize query, compute TF-IDF-like scores, etc.
}

// Reuse query type detection from KB
export { detectQueryType, getSearchWeights } from "@/knowledge/embeddings/lexical-search";
```

#### Step 2b: Create Chat Hybrid Search

**New file:** `lib/storage/chat-hybrid-search.ts`

```typescript
/**
 * Chat Hybrid Search
 * 
 * Combines lexical + semantic search for chat history with RRF fusion.
 * Mirrors the KB hybrid search implementation.
 */

import { getChatEmbeddingsDb } from "./chat-embeddings-idb";
import { embedQuery } from "@/knowledge/embeddings/embed-client";
import { chatLexicalSearch, detectQueryType, getSearchWeights } from "./chat-lexical-search";
import { rerank, getRecommendedReranker } from "@/knowledge/embeddings/reranker";

export interface ChatHybridSearchOptions {
  topK?: number;
  threshold?: number;
  forceQueryType?: QueryType;
  includeBreakdown?: boolean;
  fusionMethod?: FusionMethod;
  rrfK?: number;
  rerank?: boolean;
  rerankerBackend?: RerankerConfig["backend"];
  retrieveK?: number;
}

export interface ChatHybridSearchResult {
  conversationId: string;
  conversationTitle: string;
  chunkText: string;
  messageRole: "user" | "assistant";
  score: number;
  chunkIndex: number;
  semanticScore: number;
  lexicalScore: number;
  matchedTerms: string[];
  queryType: QueryType;
  reranked?: boolean;
}

export async function chatHybridSearch(
  query: string,
  options: ChatHybridSearchOptions = {}
): Promise<ChatHybridSearchResult[]> {
  // 1. Load all chat embeddings
  // 2. Run lexical search → ranked list
  // 3. Run semantic search → ranked list  
  // 4. Compute RRF scores
  // 5. (Optional) Rerank top candidates
  // 6. Return results
}
```

#### Step 2c: Update searchChatEmbeddings

**File:** `lib/storage/chat-embeddings-ops.ts`

Replace `searchChatEmbeddings` to use hybrid search:

```typescript
export async function searchChatEmbeddings(
  query: string,
  topK: number = 5,
  threshold: number = 0.3
): Promise<ChatSearchResult[]> {
  // Use new hybrid search with reranking
  const results = await chatHybridSearch(query, {
    topK,
    threshold,
    rerank: true, // Auto-detect backend availability
  });
  
  // Map to existing ChatSearchResult format for backward compat
  return results.map((r) => ({
    conversationId: r.conversationId,
    conversationTitle: r.conversationTitle,
    chunkText: r.chunkText,
    messageRole: r.messageRole,
    score: r.score,
    chunkIndex: r.chunkIndex,
  }));
}
```

**Estimated effort:** Medium - need to port lexical search logic for chat format.

---

### Phase 3: Add Hybrid Search to Large Document Search

**File:** `knowledge/large-documents/operations.ts`

#### Step 3a: Create Large Document Lexical Search

**New file:** `knowledge/large-documents/lexical-search.ts`

```typescript
/**
 * Large Document Lexical Search
 * 
 * Term-based search for large document chunks.
 */

import type { LargeDocumentChunk } from "./types";

export interface LargeDocLexicalResult {
  chunk: LargeDocumentChunk;
  lexicalScore: number;
  matchedTerms: string[];
}

export function largeDocLexicalSearch(
  query: string,
  chunks: LargeDocumentChunk[]
): LargeDocLexicalResult[] {
  // Same BM25-inspired scoring
}
```

#### Step 3b: Update searchLargeDocuments

Modify to use hybrid search (RRF fusion of lexical + semantic):

```typescript
export async function searchLargeDocuments(
  query: string,
  topKOrOptions: number | LargeDocumentSearchOptions = 10,
  threshold: number = 0.3
): Promise<LargeDocumentSearchResult[]> {
  // ... existing setup ...

  // NEW: Run lexical search
  const lexicalResults = largeDocLexicalSearch(query, allChunks);
  const lexicalRanks = new Map<string, number>();
  lexicalResults.forEach((result, index) => {
    lexicalRanks.set(result.chunk.id, index + 1);
  });

  // Existing: Run semantic search
  const semanticScored = allChunks.map((chunk) => ({
    chunk,
    score: cosineSimilarity(queryEmbedding, chunk.embedding),
  }));
  
  // NEW: Compute RRF scores
  const rrfScored = allChunks.map((chunk) => {
    const semanticRank = semanticRanks.get(chunk.id) ?? null;
    const lexicalRank = lexicalRanks.get(chunk.id) ?? null;
    return {
      chunk,
      rrfScore: computeRRFScore(semanticRank, lexicalRank, rrfK),
      semanticScore: rawSemanticScores.get(chunk.id) ?? 0,
      lexicalScore: lexicalResults.find(r => r.chunk.id === chunk.id)?.lexicalScore ?? 0,
      matchedTerms: lexicalResults.find(r => r.chunk.id === chunk.id)?.matchedTerms ?? [],
    };
  });

  // Sort by RRF, then rerank...
}
```

**Estimated effort:** Medium - same pattern as Phase 2.

---

### Phase 4: Add Chunk Overlap to Chat Chunker

**File:** `lib/storage/chat-chunker.ts`

Currently, chat chunks have no overlap. Add overlap similar to the markdown chunker:

```typescript
export interface ChatChunkOptions {
  maxTokens?: number;      // Default: 500
  overlapTokens?: number;  // Default: 75 (~15%)
  minTokens?: number;      // Default: 50
}

export function chunkChatMessages(
  messages: UIMessage[],
  options: ChatChunkOptions = {}
): ChatChunk[] {
  const { maxTokens = 500, overlapTokens = 75, minTokens = 50 } = options;
  
  // When splitting long messages, include overlap from previous chunk
  // This ensures context isn't lost at chunk boundaries
}
```

**Estimated effort:** Small - modify existing chunking logic.

---

### Phase 5: Update Tool Definitions & UI

#### Step 5a: Update Tool Descriptions

**File:** `tools/knowledge-tools.ts`

Update `chatSearchTool` description to reflect new hybrid capabilities:

```typescript
export const chatSearchTool = tool({
  description: `Hybrid search across all CHAT HISTORY using lexical (exact terms) AND semantic (meaning) matching.
Returns relevant chunks ranked by combined score with optional reranking.

SEARCH MODES (automatically detected):
- Exact queries ("error code", "useState") → lexical-heavy
- Questions ("What did we discuss about X?") → semantic-heavy
- Mixed queries → balanced

...rest of description...`,
});
```

**File:** `tools/document-search.ts`

Update `documentSearchTool` description similarly.

#### Step 5b: Update ai-chat.tsx Tool Execution

**File:** `components/ai-chat.tsx`

Update tool execution to pass new options and return matched terms:

```typescript
case "chat_search": {
  const { chatHybridSearch } = await import("@/lib/storage/chat-hybrid-search");
  const query = args.query as string;
  const topK = Math.min((args.topK as number) || 5, 25);
  const results = await chatHybridSearch(query, { 
    topK, 
    includeBreakdown: true,
    rerank: true,
  });
  
  // Include matched terms in XML output
  const xmlOutput = `<search_results source="chat_history" query="${query}" mode="${results[0]?.queryType || 'mixed'}">
${results.map((r) => {
  const matchedTermsAttr = r.matchedTerms?.length > 0 
    ? ` matched_terms="${r.matchedTerms.join(', ')}"` 
    : '';
  return `<result score="${r.score}" conversation="${r.conversationTitle}" role="${r.messageRole}"${matchedTermsAttr}>
<chunk_text>
${r.chunkText}
</chunk_text>
</result>`;
}).join("\n")}
</search_results>`;
  // ...
}
```

#### Step 5c: Update Search Result UI Components

**Files:**
- `components/tools/chat-search-view.tsx` - Add matched terms display
- `components/tools/document-search-view.tsx` - Add matched terms display

Add visual indicators for:
- Query type detected (exact/semantic/mixed)
- Matched terms highlighted
- Whether result was reranked

**Estimated effort:** Small - mostly updating descriptions and XML output.

---

### Phase 6: Create Shared Search Infrastructure (Optional Refactor)

To reduce code duplication, create a shared core search module:

**New file:** `lib/search/core-search.ts`

```typescript
/**
 * Core Search Infrastructure
 * 
 * Shared hybrid search + reranking pipeline used by all search tools.
 */

export interface SearchableDocument {
  id: string;
  text: string;
  embedding: number[];
  metadata: Record<string, unknown>;
}

export interface CoreSearchOptions {
  topK?: number;
  threshold?: number;
  forceQueryType?: QueryType;
  fusionMethod?: FusionMethod;
  rrfK?: number;
  rerank?: boolean;
  rerankerBackend?: RerankerConfig["backend"];
  retrieveK?: number;
}

export interface CoreSearchResult {
  id: string;
  text: string;
  score: number;
  semanticScore: number;
  lexicalScore: number;
  matchedTerms: string[];
  queryType: QueryType;
  reranked: boolean;
  metadata: Record<string, unknown>;
}

/**
 * Unified search pipeline:
 * 1. Lexical search → ranked list
 * 2. Semantic search → ranked list
 * 3. RRF fusion
 * 4. Optional reranking
 */
export async function coreSearch(
  query: string,
  documents: SearchableDocument[],
  options: CoreSearchOptions = {}
): Promise<CoreSearchResult[]> {
  // Shared implementation
}
```

Then each search tool wraps this core:

```typescript
// KB Search
const results = await coreSearch(query, 
  allEmbeddings.map(e => ({
    id: e.id,
    text: e.chunkText,
    embedding: e.embedding,
    metadata: { filePath: e.filePath, headingPath: e.headingPath },
  })),
  options
);

// Chat Search
const results = await coreSearch(query,
  chatEmbeddings.map(e => ({
    id: e.id,
    text: e.chunkText,
    embedding: e.embedding,
    metadata: { conversationId: e.conversationId, conversationTitle: e.conversationTitle },
  })),
  options
);

// Large Doc Search
const results = await coreSearch(query,
  chunks.map(c => ({
    id: c.id,
    text: c.chunkText,
    embedding: c.embedding,
    metadata: { documentId: c.documentId, filename: doc?.filename },
  })),
  options
);
```

**Estimated effort:** Medium - refactoring, but reduces long-term maintenance.

---

## File Changes Summary

### New Files
- `lib/storage/chat-lexical-search.ts`
- `lib/storage/chat-hybrid-search.ts`
- `knowledge/large-documents/lexical-search.ts`
- `lib/search/core-search.ts` (optional Phase 6)

### Modified Files
- `knowledge/embeddings/hybrid-search.ts` - Add reranking
- `knowledge/large-documents/operations.ts` - Add hybrid search
- `lib/storage/chat-embeddings-ops.ts` - Use hybrid search
- `lib/storage/chat-chunker.ts` - Add overlap
- `tools/knowledge-tools.ts` - Update descriptions
- `tools/document-search.ts` - Update descriptions
- `components/ai-chat.tsx` - Update tool execution
- `components/tools/chat-search-view.tsx` - Add matched terms UI
- `components/tools/document-search-view.tsx` - Add matched terms UI

---

## Implementation Order

1. **Phase 1** - Add reranking to KB search (quick win, infrastructure exists)
2. **Phase 4** - Add chunk overlap to chat chunker (quick win)
3. **Phase 2** - Chat hybrid search + reranking (medium effort)
4. **Phase 3** - Large doc hybrid search (medium effort)
5. **Phase 5** - Update tools & UI (small effort)
6. **Phase 6** - Optional shared infrastructure refactor

---

## Testing Checklist

- [ ] KB search returns matched terms and supports reranking
- [ ] Chat search finds exact terms (error codes, variable names)
- [ ] Chat search applies reranking when API keys available
- [ ] Large doc search includes matched terms in results
- [ ] Query type detection works for all three tools
- [ ] Reranking gracefully falls back on error
- [ ] UI shows matched terms and rerank indicator
- [ ] Performance is acceptable (< 2s for typical queries)

---

## Benefits

1. **Better exact-match recall** - All tools can find specific terms, code identifiers, error messages
2. **20-40% accuracy improvement** - Cross-encoder reranking across all tools
3. **Consistent UX** - Same capabilities regardless of which search tool is used
4. **Better debugging** - Matched terms show why results were returned
5. **Reduced hallucination** - Reranking reduces false positives by ~35%
