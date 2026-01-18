# Cross-Chat Context System: Technical Deep Dive

This document provides a comprehensive technical analysis of **Memgraph**, ChatNoire's cross-chat memory system. Memgraph enables the AI to remember information about the user across conversations—not through simple RAG, but via a sophisticated graph-based memory architecture with intelligent extraction, deduplication, and tiered retrieval.

---

## Table of Contents

1. [System Overview](#system-overview)
2. [Architecture](#architecture)
3. [Data Model](#data-model)
4. [Memory Ingestion Pipeline](#memory-ingestion-pipeline)
5. [Retrieval Pipeline](#retrieval-pipeline)
6. [LLM Integration Points](#llm-integration-points)
7. [Web Worker Architecture](#web-worker-architecture)
8. [API Endpoints](#api-endpoints)
9. [Performance Optimizations](#performance-optimizations)
10. [Configuration](#configuration)
11. [Sequence Diagrams](#sequence-diagrams)

---

## System Overview

Memgraph is a client-side memory system that runs entirely in the browser. It extracts durable memories from chat conversations, stores them in IndexedDB with graph relationships, and retrieves relevant context when the user sends new messages.

### Key Design Principles

1. **Non-blocking**: All heavy operations (embedding, extraction, graph traversal) run in a Web Worker
2. **Tiered Retrieval**: Uses heuristic-based filtering to minimize LLM calls during retrieval
3. **Graph-Based Relationships**: Memories connect to entities (people, projects, companies) via edges
4. **Automatic Deduplication**: Similar memories are merged rather than duplicated
5. **Local-First**: All data stays in the browser's IndexedDB—no server-side storage

### Data Flow Summary

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              USER MESSAGE                                    │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                    ┌───────────────┴───────────────┐
                    │                               │
                    ▼                               ▼
           ┌────────────────┐              ┌────────────────┐
           │   RETRIEVAL    │              │   INGESTION    │
           │   (blocking)   │              │   (async)      │
           │   ~200-2000ms  │              │   fire-forget  │
           └────────────────┘              └────────────────┘
                    │                               │
         ┌─────────┼─────────┐                      ▼
         │         │         │             ┌────────────────┐
         ▼         ▼         ▼             │ LLM extracts   │
   ┌──────────┬──────────┬──────────┐      │ memories +     │
   │ Embed    │ Entity   │ Graph    │      │ entities       │
   │ query    │ detect   │ expand   │      └────────────────┘
   │ (vector) │ (match)  │ (1-hop)  │              │
   └──────────┴──────────┴──────────┘              ▼
         │         │         │             ┌────────────────┐
         └─────────┼─────────┘             │ Batch embed    │
                   ▼                       │ new memories   │
           ┌────────────────┐              └────────────────┘
           │ Merge & score  │                      │
           │ candidates     │                      ▼
           └────────────────┘              ┌────────────────┐
                    │                      │ Store in       │
                    ▼                      │ IndexedDB      │
           ┌────────────────┐              │ + graph edges  │
           │ Tiered filter: │              └────────────────┘
           │ High→auto      │
           │ Entity→boost   │
           │ Mid→LLM select │
           └────────────────┘
                    │
                    ▼
           ┌────────────────┐
           │ Context pack   │
           │ → Chat API     │
           └────────────────┘
```

---

## Architecture

### Directory Structure

```
memgraph/
├── memgraph.worker.ts    # Web Worker: ingestion & retrieval logic
├── client.ts             # Main thread client wrapper (Comlink)
├── idb.ts                # IndexedDB schema and database operations
├── schemas.ts            # Zod validation schemas
├── types.ts              # Shared TypeScript types
├── retrieve.ts           # Candidate retrieval with MMR diversity
├── rank.ts               # Scoring functions (similarity, recency, confidence)
├── mmr.ts                # Maximal Marginal Relevance selection
└── hash.ts               # SHA-256 hashing for entity IDs

app/api/
├── embed/route.ts        # OpenAI embeddings endpoint
└── memgraph/router/route.ts  # LLM extraction & selection endpoint
```

### Component Responsibilities

| Component | Responsibility |
|-----------|---------------|
| `memgraph.worker.ts` | Core logic: ingestion, retrieval, graph state |
| `client.ts` | Thread-safe client API using Comlink |
| `idb.ts` | IndexedDB operations and schema |
| `router/route.ts` | Server-side LLM calls (extraction, selection) |
| `embed/route.ts` | Server-side embedding generation |

---

## Data Model

### IndexedDB Schema

The system uses a single IndexedDB database (`memgraph_v1`) with four object stores:

#### 1. Memories Store

```typescript
interface MemoryRecord {
  id: string;                    // UUID
  type: MemoryType;              // "fact" | "preference" | "project" | "relationship" | "constraint"
  text: string;                  // Canonical memory text
  embedding?: Float32Array;      // Normalized embedding vector
  confidence: number;            // 0-1, increases with reinforcement
  lastUpdated: number;           // Timestamp
  sourceChatIds: string[];       // Which chats contributed to this memory
  sourceMessageIds: string[];    // Which messages contributed
}
```

**Indexes**: `byType`, `byLastUpdated`

#### 2. Entities Store

```typescript
interface EntityRecord {
  id: string;                    // SHA-256 hash of normalized name
  name: string;                  // Display name
  nameLower: string;             // Lowercase for matching
  embedding?: Float32Array;      // Optional entity embedding
  lastUpdated: number;           // Timestamp
}
```

**Indexes**: `byNameLower`

#### 3. Edges Store

```typescript
interface EdgeRecord {
  fromId: string;                // Memory or Entity ID
  toId: string;                  // Memory or Entity ID
  type: string;                  // "mentions" | "related_to"
  weight: number;                // Edge strength (0-1)
  lastUpdated: number;           // Timestamp
}
```

**Primary Key**: `[fromId, toId, type]` (composite)
**Indexes**: `byFromId`, `byToId`, `byType`

#### 4. Meta Store

Key-value store for system metadata (e.g., embedding queue).

### Memory Types

| Type | Description | Example |
|------|-------------|---------|
| `fact` | Objective information about the user | "William Norden is 22 years old" |
| `preference` | User preferences and working style | "User prefers building systems from scratch" |
| `project` | Projects the user works on | "User works on DeepRune for chip design" |
| `relationship` | People and organizations | "User works with Dr. Dat Tran" |
| `constraint` | Limitations or requirements | "User's resume needs more quantitative metrics" |

### Graph Structure

The graph connects memories to entities bidirectionally:

```
┌──────────────┐     mentions      ┌──────────────┐
│   Memory:    │ ───────────────► │   Entity:    │
│ "William's   │                  │ "DeepRune"   │
│  main project│ ◄─────────────── │              │
│  is DeepRune"│     mentions      └──────────────┘
└──────────────┘
        │
        │ related_to (sim: 0.65-0.70)
        ▼
┌──────────────┐
│   Memory:    │
│ "User uses   │
│  C and Python│
│  for DeepRune│
└──────────────┘
```

---

## Memory Ingestion Pipeline

### Trigger Points

Ingestion is triggered asynchronously (fire-and-forget) when:

1. **User sends a message**: The user message is ingested
2. **Assistant completes a response**: The assistant message is ingested

### Ingestion Flow

```typescript
async function ingestMessage(input: IngestMessageInput) {
  // 1. Ensure worker state is initialized from IndexedDB
  await ensureInitialized();
  
  // 2. Process any pending embeddings (opportunistic)
  await processEmbeddingQueue(2);
  
  // 3. Call LLM to extract memories and entities
  const extraction = await callMemgraphRoute("extract", {
    chatId: input.chatId,
    messageId: input.messageId,
    text: input.text,
    recentWindow: input.recentWindow,
  });
  
  // 4. Store entities with SHA-256 ID generation
  for (const entity of extraction.entities) {
    const entityId = await sha256(entity.name.toLowerCase());
    // Upsert entity...
  }
  
  // 5. Batch embed all memory texts (single API call)
  const embeddings = await fetchEmbeddings(texts);
  
  // 6. For each memory: check for duplicates, merge or create
  for (const memory of validMemories) {
    // Find best matching existing memory
    let bestMatch = findBestMatch(memory.embedding);
    
    if (bestMatch && similarity >= MERGE_THRESHOLD) {
      // Merge: boost confidence, add provenance
      record = mergeMemory(bestMatch, memory);
    } else {
      // Create new memory
      record = createMemory(memory);
    }
    
    // 7. Create edges to mentioned entities
    for (const entity of extraction.entities) {
      createEdge(record.id, entityId, "mentions");
    }
    
    // 8. Create related_to edges for similar but not duplicate memories
    if (bestMatch && similarity >= 0.65 && similarity < MERGE_THRESHOLD) {
      createEdge(record.id, bestMatch.id, "related_to");
    }
  }
}
```

### LLM Extraction Prompt

The extraction endpoint (`/api/memgraph/router`) uses this system prompt:

```
Return JSON matching:
{
  "entities": [{"name": "string"}],
  "memories": [{
    "type": "fact|preference|project|relationship|constraint",
    "text": "string",
    "confidence": number (0-1),
    "evidence": { "chatId": "string", "messageIds": ["string"] }
  }]
}
```

With user prompt:

```
You are extracting stable, reusable memories from chat.
Rules:
- Only extract durable facts/preferences/projects/relationships/constraints.
- Keep memory text canonical, declarative, timeless.
- Keep entity names short and specific.
- Return JSON only.

Input:
chatId: chat_1234...
messageId: msg_5678...
message: "I'm William, I'm 22 and I work on DeepRune with Dr. Tran"
recentWindow: [...]
```

### Deduplication via Merge Threshold

The system prevents duplicate memories using cosine similarity:

| Similarity Range | Action |
|-----------------|--------|
| ≥ 0.70 | **Merge**: Boost confidence by +0.05, add provenance |
| 0.65 - 0.70 | **Related**: Create `related_to` edge, keep both |
| < 0.65 | **New**: Create as separate memory |

```typescript
const MERGE_THRESHOLD = 0.70;

if (bestMatch && bestSim >= MERGE_THRESHOLD) {
  record = {
    ...bestMatch,
    confidence: Math.min(1, bestMatch.confidence + 0.05),
    sourceChatIds: [...new Set([...bestMatch.sourceChatIds, newChatId])],
    sourceMessageIds: [...new Set([...bestMatch.sourceMessageIds, ...newMessageIds])],
  };
}
```

---

## Retrieval Pipeline

### Trigger

Retrieval is called **synchronously** (blocking) before sending a message to the chat API. It has a configurable timeout (default: 2000ms).

### Multi-Source Retrieval Strategy

The retrieval system combines **three sources** to find relevant memories:

| Source | Description | When Used |
|--------|-------------|-----------|
| **Embedding** | Cosine similarity against query embedding | Always |
| **Entity** | Graph traversal from entities mentioned in query | When query contains known entity names |
| **Graph** | 1-hop expansion from high-similarity seeds | When we have confident matches to expand from |

This hybrid approach ensures:
- Fast retrieval for direct semantic matches (embedding)
- Complete coverage when user mentions specific entities by name (entity)
- Contextual expansion to related facts (graph)

### Tiered Filtering Strategy

After collecting candidates from all sources, the system uses tiered filtering:

| Tier | Similarity Range | Action | Latency |
|------|-----------------|--------|---------|
| **High** | ≥ 0.65 | Auto-include (no LLM) | ~200ms |
| **Entity-boosted** | ≥ 0.50 + entity source | Auto-include (no LLM) | ~200ms |
| **Medium** | 0.25 - 0.65 | LLM filter with minimal output | ~1-2s |
| **Low** | < 0.25 | Skip | — |

### Entity Detection (No LLM)

Before embedding the query, the system scans for mentions of known entities:

```typescript
function detectEntityMentions(query: string): EntityRecord[] {
  const queryLower = query.toLowerCase();
  const matches: EntityRecord[] = [];
  
  for (const entity of state.entities.values()) {
    if (entity.nameLower.length <= 2) continue; // Skip short names
    
    // Word-boundary aware matching
    const pattern = new RegExp(`\\b${escaped}\\b`, 'i');
    if (pattern.test(queryLower)) {
      matches.push(entity);
    }
  }
  return matches;
}
```

When entities are detected (e.g., "DeepRune" in "What do I know about DeepRune?"), the system traverses edges to find all connected memories:

```typescript
function getMemoriesForEntity(entityId: string): Set<string> {
  const memoryIds = new Set<string>();
  const edges = [
    ...(state.edgesByFrom.get(entityId) ?? []),
    ...(state.edgesByTo.get(entityId) ?? []),
  ];
  
  for (const edge of edges) {
    const otherId = edge.fromId === entityId ? edge.toId : edge.fromId;
    if (state.memories.has(otherId)) {
      memoryIds.add(otherId);
    }
  }
  return memoryIds;
}
```

### Graph Expansion

For high-confidence embedding matches (similarity ≥ 0.50), the system performs 1-hop graph expansion:

```typescript
function expandViaGraph(seedMemoryIds: Set<string>, maxExpansion: number): Set<string> {
  const expanded = new Set<string>(seedMemoryIds);
  
  for (const currentId of seedMemoryIds) {
    const edges = [
      ...(state.edgesByFrom.get(currentId) ?? []),
      ...(state.edgesByTo.get(currentId) ?? []),
    ];
    
    for (const edge of edges) {
      const neighborId = edge.fromId === currentId ? edge.toId : edge.fromId;
      
      // If neighbor is an entity, get its connected memories
      if (state.entities.has(neighborId)) {
        const entityMemories = getMemoriesForEntity(neighborId);
        entityMemories.forEach(id => expanded.add(id));
      }
      // If neighbor is a related memory
      else if (state.memories.has(neighborId) && edge.type === "related_to") {
        expanded.add(neighborId);
      }
    }
  }
  return expanded;
}
```

**Example**: If the query matches "William uses C for DeepRune" with high similarity:
1. The graph finds the "DeepRune" entity connection
2. Expands to other memories mentioning DeepRune: "DeepRune is a chip design project", "Dr. Tran advises on DeepRune"
3. Also follows `related_to` edges to similar memories

### Full Retrieval Flow

```typescript
async function retrieveContext(input): Promise<ContextPack> {
  // 1. Embed the query
  const [queryEmbedding] = await fetchEmbeddings([input.query]);
  
  // 2. Detect entity mentions (fast, no LLM)
  const mentionedEntities = detectEntityMentions(input.query);
  const entityMemoryIds = new Set<string>();
  for (const entity of mentionedEntities) {
    getMemoriesForEntity(entity.id).forEach(id => entityMemoryIds.add(id));
  }
  
  // 3. Score all memories by embedding similarity
  const scored: ScoredMemory[] = [];
  for (const memory of state.memories.values()) {
    const sim = dot(memory.embedding, queryEmbedding);
    if (sim >= LOW_SIM_THRESHOLD) {
      scored.push({ memory, sim, source: "embedding" });
    }
  }
  
  // 4. Add entity-connected memories with boosted scores
  for (const memId of entityMemoryIds) {
    if (!alreadyScored(memId)) {
      const sim = Math.max(computedSim, LOW_SIM_THRESHOLD + 0.05);
      scored.push({ memory, sim, source: "entity" });
    }
  }
  
  // 5. Graph expansion from high-similarity seeds
  const seeds = scored.filter(s => s.sim >= 0.50).map(s => s.memory.id);
  const expandedIds = expandViaGraph(new Set(seeds), MAX_GRAPH_EXPANSION);
  for (const memId of expandedIds) {
    if (!alreadyScored(memId)) {
      scored.push({ memory, sim, source: "graph" });
    }
  }
  
  // 6. Tiered filtering (high → auto, medium → LLM filter)
  const highSim = scored.filter(s => 
    s.sim >= HIGH_SIM_THRESHOLD || 
    (s.source === "entity" && s.sim >= 0.50)
  );
  const mediumSim = scored.filter(s => /* remaining candidates */);
  
  // 7. LLM filter for medium candidates if needed
  if (mediumSim.length > 0 && highSim.length < 10) {
    selectedFromMedium = await llmFilter(mediumSim);
  }
  
  return buildContextPack([...highSim, ...selectedFromMedium]);
}
```

### Self-Referential Query Detection

For queries like "describe me" or "who am I", embedding similarity often fails because these queries don't semantically match specific facts like "William Norden is 22 years old". The system detects this pattern:

```typescript
const SELF_QUERY_PATTERNS = [
  /\b(describe|tell|about|who\s*(is|am)|what.*know|my|me|myself)\b/i,
  /\b(remember|recall|know.*about)\b.*\b(me|my|i)\b/i,
];

function isSelfReferentialQuery(query: string): boolean {
  return SELF_QUERY_PATTERNS.some(pattern => pattern.test(query));
}

// If self-referential with no matches, include recent user memories
if (scored.length === 0 && isSelfReferentialQuery(input.query)) {
  const allMemories = Array.from(state.memories.values())
    .sort((a, b) => b.lastUpdated - a.lastUpdated)
    .slice(0, MAX_LLM_CANDIDATES);
  // Assign neutral similarity and let LLM filter
}
```

### LLM Selection (Fast Path)

Instead of complex JSON schemas, the selection endpoint uses minimal tokens:

**Prompt**:
```
Query: What programming languages do I know?

Candidates:
1. William Norden's primary languages are C and Python
2. User prefers dark mode
3. User has PyTorch and React experience

Which candidates are relevant to the query? Reply with just the numbers 
separated by spaces (e.g., "1 3 5"), or "none" if none are relevant.
```

**Response**: `"1 3"` (parsed to indices `[0, 2]`)

This takes ~1s instead of 3-5s for structured JSON extraction.

### Context Pack Output

The final output is a `ContextPack` that gets injected into the chat:

```typescript
interface ContextPack {
  summary: string;           // Formatted bullet points for the LLM
  selected: Array<{          // Metadata about selected memories
    memoryId: string;
    type: MemoryType;
    confidence: number;
    lastUpdated: number;
  }>;
  warnings: string[];        // Any retrieval warnings
  provenance: Record<string, {  // Source tracking
    chatIds: string[];
    messageIds: string[];
  }>;
}
```

The `summary` is injected as a system message:

```
MEMORY CONTEXT:
- William Norden is 22 years old
- William's primary programming languages are C and Python
- User works on DeepRune for chip design

WARNINGS:
(none)
```

---

## LLM Integration Points

The system uses LLMs at two points, both via the `/api/memgraph/router` endpoint:

### 1. Extract Mode (Ingestion)

- **Model**: Configurable via `MEMGRAPH_ROUTER_MODEL`
- **Purpose**: Extract memories and entities from messages
- **Latency**: Async, non-blocking (~2-5s)
- **Token usage**: ~500-1000 tokens/message

### 2. Select Mode (Retrieval)

- **Model**: Same as extract mode
- **Purpose**: Filter medium-similarity candidates
- **Latency**: Blocking (~1-2s, only when needed)
- **Token usage**: ~50-100 tokens/query

### Model Selection Trade-offs

| Model | Speed | Quality | Use Case |
|-------|-------|---------|----------|
| `claude-sonnet-4-5` | Slower | Best | Production, important memories |
| `claude-3-haiku-20240307` | Faster | Good | Fast iteration, less critical |

---

## Web Worker Architecture

### Why a Web Worker?

1. **Non-blocking embeddings**: API calls don't freeze the UI
2. **Non-blocking graph operations**: Graph traversal on large memory sets
3. **Isolated state**: Memory maps live in worker, no main-thread overhead
4. **Parallel processing**: Embedding queue runs opportunistically

### Worker State

```typescript
const state = {
  initialized: false,
  memories: new Map<string, MemoryRecord>(),
  entities: new Map<string, EntityRecord>(),
  edgesByFrom: new Map<string, EdgeRecord[]>(),
  edgesByTo: new Map<string, EdgeRecord[]>(),
  embeddingsDisabled: false,  // Set true if API key missing
};
```

### Comlink Communication

The client uses [Comlink](https://github.com/GoogleChromeLabs/comlink) for transparent RPC:

```typescript
// client.ts
import { wrap } from "comlink";

function getWorker() {
  if (!worker) {
    worker = new Worker(new URL("./memgraph.worker.ts", import.meta.url), {
      type: "module",
    });
    workerApi = wrap<MemgraphWorkerApi>(worker);
  }
  return workerApi;
}

// Usage
await ingestMessage({ chatId, messageId, text, ... });
const context = await retrieveContext({ chatId, query, recentWindow });
```

### Embedding Queue

When batch embedding fails or isn't immediately needed, memories are queued:

```typescript
async function processEmbeddingQueue(maxItems = 10) {
  const queue = await getEmbeddingQueue(db);
  const toProcess = queue.splice(0, maxItems);
  
  const texts = toProcess.map(id => memories.get(id).text);
  const vectors = await fetchEmbeddings(texts);
  
  // Update memories with embeddings
  for (let i = 0; i < toProcess.length; i++) {
    memories.get(toProcess[i]).embedding = vectors[i];
    await db.put("memories", updated);
  }
}
```

The queue is processed opportunistically during both ingestion and retrieval.

---

## API Endpoints

### POST /api/embed

Generates embeddings via OpenAI.

**Request**:
```json
{
  "texts": ["memory text 1", "memory text 2"]
}
```

**Response**:
```json
{
  "embeddings": [[0.1, 0.2, ...], [0.3, 0.4, ...]]
}
```

**Model**: Configurable via `MEMGRAPH_EMBED_MODEL` (default: `text-embedding-3-small`)

### POST /api/memgraph/router

Handles both extraction and selection modes.

#### Extract Mode

**Request**:
```json
{
  "mode": "extract",
  "chatId": "chat_123",
  "messageId": "msg_456",
  "text": "I'm William, I work on DeepRune",
  "recentWindow": [...]
}
```

**Response**:
```json
{
  "entities": [{ "name": "William" }, { "name": "DeepRune" }],
  "memories": [{
    "type": "project",
    "text": "User works on DeepRune",
    "confidence": 0.9,
    "evidence": { "chatId": "chat_123", "messageIds": ["msg_456"] }
  }]
}
```

#### Select Mode

**Request**:
```json
{
  "mode": "select",
  "query": "What languages do I know?",
  "candidates": [
    "William knows C and Python",
    "User prefers dark mode",
    "User has React experience"
  ]
}
```

**Response**:
```json
{
  "selected": [0, 2]
}
```

### POST /api/chat

Main chat endpoint that receives the context pack.

**Request**:
```json
{
  "messages": [...],
  "contextPack": {
    "summary": "- William Norden is 22...",
    "selected": [...],
    "warnings": [],
    "provenance": {...}
  }
}
```

The context pack is injected as a system message before the conversation history.

---

## Performance Optimizations

### 1. Tiered Retrieval

Avoids LLM calls for high-confidence matches:

- **High similarity (≥0.65)**: Direct inclusion, no LLM
- **Medium similarity (0.25-0.65)**: LLM filtering only if needed
- **Low similarity (<0.25)**: Skip entirely

### 2. Minimal Token LLM Responses

Selection uses space-separated numbers instead of JSON:
- Output: `"1 3 5"` (~3 tokens)
- vs JSON: `{"selected": [1, 3, 5]}` (~15 tokens)

### 3. Batch Embedding

All memory texts are embedded in a single API call:
```typescript
const texts = validMemories.map(m => m.text);
const embeddings = await fetchEmbeddings(texts);  // Single request
```

### 4. Normalized Embeddings

Vectors are normalized at ingestion time, enabling dot product as cosine similarity:
```typescript
function normalizeEmbedding(vector: number[]) {
  const norm = Math.sqrt(vector.reduce((sum, v) => sum + v * v, 0));
  return new Float32Array(vector.map(v => v / norm));
}

// Fast similarity: dot product = cosine for unit vectors
function dot(a: Float32Array, b: Float32Array) {
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += a[i] * b[i];
  return sum;
}
```

### 5. In-Memory State

The worker keeps all memories, entities, and edges in memory (Maps) after initial load:
- IndexedDB load: Once at startup
- Subsequent queries: In-memory only
- Writes: Async to IndexedDB

### 6. Character Budget

Context summaries are capped at 4000 characters to avoid bloating prompts:
```typescript
const BUDGET_CHARS = 4000;

function buildSummary(candidates, budgetChars) {
  let used = 0;
  for (const candidate of candidates) {
    const line = `- ${candidate.text}`;
    if (used + line.length > budgetChars) break;
    lines.push(line);
    used += line.length;
  }
  return lines.join("\n");
}
```

---

## Configuration

### Environment Variables

```bash
# .env.local

# Main chat model
MEMGRAPH_MAIN_MODEL=claude-sonnet-4-5

# Memory extraction and selection model
MEMGRAPH_ROUTER_MODEL=claude-sonnet-4-5  # or claude-3-haiku-20240307 for speed

# Embedding model
MEMGRAPH_EMBED_MODEL=text-embedding-3-small

# API Keys
ANTHROPIC_API_KEY=sk-ant-api03-...
OPENAI_API_KEY=sk-...
```

### Tunable Constants

| Constant | Location | Default | Description |
|----------|----------|---------|-------------|
| `MERGE_THRESHOLD` | `memgraph.worker.ts` | 0.70 | Similarity threshold for merging memories |
| `HIGH_SIM_THRESHOLD` | `memgraph.worker.ts` | 0.65 | Auto-include threshold |
| `LOW_SIM_THRESHOLD` | `memgraph.worker.ts` | 0.25 | Minimum similarity to consider |
| `GRAPH_EXPANSION_SIM` | `memgraph.worker.ts` | 0.50 | Minimum similarity to trigger graph expansion |
| `MAX_GRAPH_EXPANSION` | `memgraph.worker.ts` | 20 | Max memories to add via graph traversal |
| `MAX_LLM_CANDIDATES` | `memgraph.worker.ts` | 15 | Max candidates for LLM filtering |
| `BUDGET_CHARS` | `memgraph.worker.ts` | 4000 | Max characters in context summary |
| `MEMGRAPH_TIMEOUT_MS` | `ai-chat.tsx` | 2000 | Retrieval timeout in ms |

---

## Sequence Diagrams

### User Sends Message (Full Flow with Graph)

```
┌────────┐    ┌──────────┐    ┌────────────┐    ┌─────────────┐    ┌──────────┐
│  UI    │    │  Client  │    │   Worker   │    │  /api/embed │    │ /api/chat│
└───┬────┘    └────┬─────┘    └─────┬──────┘    └──────┬──────┘    └────┬─────┘
    │              │                │                  │                │
    │ submitMessage│                │                  │                │
    ├─────────────►│                │                  │                │
    │              │ retrieveContext│                  │                │
    │              ├───────────────►│                  │                │
    │              │                │                  │                │
    │              │                │ 1. detectEntityMentions          │
    │              │                │    (fast string match)           │
    │              │                │                  │                │
    │              │                │ 2. fetchEmbeddings               │
    │              │                ├─────────────────►│                │
    │              │                │◄─────────────────┤                │
    │              │                │ (query embedding)│                │
    │              │                │                  │                │
    │              │                │ 3. score memories (embedding)    │
    │              │                │    + entity-connected memories   │
    │              │                │    + graph expansion (1-hop)     │
    │              │                │                  │                │
    │              │                │ [if medium-sim candidates]       │
    │              │                │─────── /api/memgraph/router ─────│
    │              │                │        (select mode)             │
    │              │                │◄─────────────────────────────────│
    │              │                │                  │                │
    │              │◄───────────────┤                  │                │
    │              │ (contextPack)  │                  │                │
    │              │                │                  │                │
    │              │────────────────────────────────────────────────────►
    │              │                │         (messages + contextPack)  │
    │◄─────────────────────────────────────────────────────────────────┤
    │              │ (streaming response)              │                │
    │              │                │                  │                │
    │              │ ingestMessage  │                  │                │
    │              │ (async)        │                  │                │
    │              ├───────────────►│                  │                │
    │              │                │── /api/memgraph/router ──────────►│
    │              │                │   (extract mode)                  │
    │              │                │◄──────────────────────────────────│
    │              │                │                  │                │
    │              │                │ fetchEmbeddings  │                │
    │              │                ├─────────────────►│                │
    │              │                │◄─────────────────┤                │
    │              │                │                  │                │
    │              │                │ store in IndexedDB               │
    │              │                │ (dedup + entity edges)           │
    └──────────────┴────────────────┴──────────────────┴────────────────┘
```

### Graph-Enhanced Retrieval Detail

```
┌──────────────────────────────────────────────────────────────────────────────┐
│                    QUERY: "What do I know about DeepRune?"                   │
└──────────────────────────────────────────────────────────────────────────────┘
                                    │
         ┌──────────────────────────┼──────────────────────────┐
         │                          │                          │
         ▼                          ▼                          ▼
┌─────────────────┐      ┌─────────────────┐      ┌─────────────────┐
│ ENTITY DETECT   │      │ EMBEDDING SCORE │      │ GRAPH EXPAND    │
│                 │      │                 │      │                 │
│ Match "DeepRune"│      │ Embed query     │      │ From high-sim   │
│ against known   │      │ Score all       │      │ seeds, traverse │
│ entities        │      │ memories        │      │ 1-hop via edges │
└────────┬────────┘      └────────┬────────┘      └────────┬────────┘
         │                        │                        │
         ▼                        ▼                        ▼
┌─────────────────┐      ┌─────────────────┐      ┌─────────────────┐
│ Find memories   │      │ High sim:       │      │ Find related    │
│ connected to    │      │ "User works on  │      │ memories via    │
│ DeepRune entity │      │  DeepRune..."   │      │ shared entities │
│                 │      │  sim=0.72       │      │                 │
│ → "DeepRune is  │      │                 │      │ → "Dr. Tran     │
│    a chip       │      │ Medium sim:     │      │    advises on   │
│    design       │      │ "User uses C    │      │    DeepRune"    │
│    project"     │      │  for systems"   │      │                 │
│                 │      │  sim=0.45       │      │                 │
└────────┬────────┘      └────────┬────────┘      └────────┬────────┘
         │                        │                        │
         └────────────────────────┼────────────────────────┘
                                  │
                                  ▼
                    ┌───────────────────────────────┐
                    │     MERGE & DEDUPLICATE       │
                    │     Score by source:          │
                    │     • Entity: boost +0.05     │
                    │     • High-sim: auto-include  │
                    │     • Graph: needs sim≥0.20   │
                    └───────────────────────────────┘
                                  │
                                  ▼
                    ┌───────────────────────────────┐
                    │     TIERED FILTERING          │
                    │     High (≥0.65) → auto       │
                    │     Entity (≥0.50) → auto     │
                    │     Medium → LLM filter       │
                    └───────────────────────────────┘
                                  │
                                  ▼
                    ┌───────────────────────────────┐
                    │     CONTEXT PACK OUTPUT       │
                    │                               │
                    │ - DeepRune is a chip design   │
                    │   project                     │
                    │ - User works on DeepRune      │
                    │ - Dr. Tran advises on         │
                    │   DeepRune                    │
                    │ - User uses C for systems     │
                    └───────────────────────────────┘
```

### Memory Deduplication

```
┌──────────────────────────────────────────────────────────────────────────────┐
│                         INCOMING MEMORY                                       │
│                "User's main project is DeepRune"                             │
│                        embedding: [0.1, 0.2, ...]                            │
└──────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
                    ┌───────────────────────────────┐
                    │   Compare to all existing     │
                    │   memories (cosine similarity)│
                    └───────────────────────────────┘
                                    │
                                    ▼
        ┌───────────────────────────┬───────────────────────────┐
        │                           │                           │
        ▼                           ▼                           ▼
┌───────────────┐         ┌───────────────┐         ┌───────────────┐
│ sim ≥ 0.70    │         │ 0.65 ≤ sim    │         │ sim < 0.65    │
│ MERGE         │         │ < 0.70        │         │ CREATE NEW    │
│               │         │ RELATED EDGE  │         │               │
│ • confidence  │         │               │         │ • New UUID    │
│   += 0.05     │         │ • Keep both   │         │ • Full record │
│ • Add sources │         │ • Create edge │         │ • Create edges│
└───────────────┘         └───────────────┘         └───────────────┘
```

---

## Summary

Memgraph provides ChatNoire with persistent, cross-conversation memory through a carefully designed architecture:

1. **Extraction**: LLM identifies durable memories and entities from messages asynchronously
2. **Storage**: Graph-based IndexedDB schema with memories, entities, and bidirectional edges
3. **Deduplication**: Cosine similarity prevents memory bloat; similar memories create `related_to` edges
4. **Retrieval**: Three-source retrieval (embedding + entity + graph) with tiered LLM filtering
5. **Integration**: Context pack injected as system message to main chat

### When Graph Traversal Helps

| Scenario | Without Graph | With Graph |
|----------|---------------|------------|
| "Tell me about DeepRune" | Only finds memories with high embedding similarity to query | Also finds all memories mentioning "DeepRune" entity |
| "What projects am I on?" | Might miss "User uses C for DeepRune" (low query similarity) | Finds via `related_to` edge from matched project memories |
| "Who do I work with?" | Only direct semantic matches | Traverses from project entities to relationship memories |

The system achieves sub-2-second retrieval latency while maintaining high-quality context selection through intelligent graph expansion, all running entirely client-side for privacy.
