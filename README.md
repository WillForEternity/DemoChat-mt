# ChatNoir

A modern, feature-rich AI chat application built with **Next.js 16**, **Vercel AI SDK v6**, and **Anthropic Claude**.

ChatNoir provides a polished chat experience with a persistent knowledge filesystem, large document RAG, parallel context-saving agents, web search, a full-featured document viewer, file attachments, authentication, and more.

---

# Part I — Overview

## What Is ChatNoir?

ChatNoir is a local-first AI chat app that goes far beyond a simple Claude wrapper. It gives Claude a **persistent memory** (a knowledge filesystem stored in your browser), the ability to **search and discuss uploaded documents** (PDFs, text, markdown), **web search**, and a **full-featured document viewer** with screenshot-based chat. Everything runs client-side except the AI inference itself.

### Key Capabilities

- **Chat with Claude** — Streaming responses with full markdown, LaTeX, code highlighting, and tool use
- **Knowledge Filesystem** — Claude can read, write, search, and link files in a persistent client-side storage system, giving it memory across conversations
- **Large Document RAG** — Upload PDFs and text files for question-answering without loading entire documents into context
- **Document Viewer** — A Cursor-style 3-panel reader with PDF rendering, screenshot selection, and margin chats
- **Web Search** — Anthropic's first-party web search for real-time information
- **Parallel Context Savers** — Claude spawns up to 6 background agents to organize and save information simultaneously
- **Chat History Search** — Hybrid search across past conversations
- **Authentication & BYOK** — OAuth login, owner mode, and bring-your-own-key support

---

## Quick Start

### Step 1: Install Dependencies

```bash
pnpm install
# or
npm install
```

### Step 2: Get Your API Keys

1. **Anthropic API Key** (required) — [console.anthropic.com/settings/keys](https://console.anthropic.com/settings/keys)
2. **OpenAI API Key** (required for embeddings/search) — [platform.openai.com/api-keys](https://platform.openai.com/api-keys)
3. **Cohere API Key** (optional, improves RAG accuracy 20-40%) — [dashboard.cohere.com/api-keys](https://dashboard.cohere.com/api-keys)

### Step 3: Create Your Environment File

```bash
cp .env.local.example .env.local
```

Fill in the required values:

```bash
# Required
ANTHROPIC_API_KEY=sk-ant-api03-your-key-here
OPENAI_API_KEY=sk-proj-your-key-here

# Authentication (required for multi-user)
BETTER_AUTH_SECRET=your-random-32-character-secret-here  # generate: openssl rand -base64 32
BETTER_AUTH_URL=http://localhost:3000
GITHUB_CLIENT_ID=your-github-client-id
GITHUB_CLIENT_SECRET=your-github-client-secret
GOOGLE_CLIENT_ID=your-google-client-id
GOOGLE_CLIENT_SECRET=your-google-client-secret
OWNER_EMAILS=your@email.com

# Optional
COHERE_API_KEY=your-cohere-api-key-here          # cross-encoder reranking
MAIN_MODEL=claude-sonnet-4-5                      # default chat model
CONTEXT_SAVER_MODEL=claude-sonnet-4-5             # context saver model
```

### Step 4: Start the Development Server

```bash
pnpm dev
# or
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

---

## How to Use It

1. **Chat** — Type a message and chat with Claude. Responses stream in real-time. You can switch models between Haiku (fast), Sonnet (balanced), and Opus (powerful).

2. **Knowledge Base** — Share information and Claude will save it automatically using parallel context savers. Browse your knowledge in the sidebar. Claude searches it before every response.

3. **Upload Documents** — Click "Upload Document" in the Large Documents section. Documents index in the background. Once indexed, Claude can search them to answer questions.

4. **View Documents** — Click the eye icon on any document to open the full-screen viewer. Drag to select regions of a PDF, press Enter, and chat about the selection.

5. **Web Search** — Claude automatically searches the web when questions require real-time information.

6. **Search Chat History** — Claude can search your past conversations to find relevant context.

---

## Authentication & Access

| User Type | API Keys Used | How to Set Up |
|-----------|---------------|---------------|
| **Owner** | Server-side env keys | Add email to `OWNER_EMAILS` |
| **BYOK User** | Their own keys | Enter via Settings modal |
| **Free Trial** | Owner's keys (5 chats) | Automatic for new visitors |

**OAuth Setup:**
- **GitHub**: Create OAuth app at [github.com/settings/developers](https://github.com/settings/developers) — Callback: `http://localhost:3000/api/auth/callback/github`
- **Google**: Create credentials at [console.cloud.google.com](https://console.cloud.google.com/apis/credentials) — Callback: `http://localhost:3000/api/auth/callback/google`

---

## NPM Scripts

| Script | Command | Description |
|--------|---------|-------------|
| `dev` | `next dev --turbopack` | Start dev server with Turbopack |
| `dev:webpack` | `next dev --webpack` | Start dev server with Webpack |
| `dev:clean` | `rm -rf .next && next dev --turbopack` | Clean cache and start fresh |
| `build` | `next build` | Build for production |
| `start` | `next start` | Start production server |
| `lint` | `eslint .` | Run ESLint |

---

## Deploying to Vercel

1. Push your code to GitHub
2. Import the repository in [Vercel](https://vercel.com)
3. Add environment variables in Project Settings:
   - `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`
   - `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL` (production URL)
   - `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`
   - `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`
   - `OWNER_EMAILS`
   - `COHERE_API_KEY` (optional)
4. Update OAuth callback URLs to use your production domain
5. Deploy!

---

## Troubleshooting

### "ANTHROPIC_API_KEY is not set" Error
1. Ensure the file is named exactly `.env.local` (with the leading dot)
2. Verify it's in the project root (same level as `package.json`)
3. Check there are no spaces around the `=` sign
4. Restart the dev server after creating the file

### "invalid x-api-key" Error
1. Verify you copied the full key (it's quite long)
2. Ensure the key starts with `sk-ant-api03-`
3. Check for extra spaces or quotes around the key

### PDF Upload Requires API Key
Scanned/image-based PDFs require AI-powered OCR via Claude Haiku. Ensure `ANTHROPIC_API_KEY` is configured.

### Document Has Very Few Chunks
If a PDF has surprisingly few chunks, PDF.js may have extracted low-quality text. Delete and re-upload — the improved quality detection should trigger AI OCR fallback.

---

# Part II — Technical Deep-Dive

## Architecture at a Glance

ChatNoir is a Next.js 16 App Router application with a **local-first architecture**. All persistent storage (knowledge base, chat history, document chunks, embeddings) lives in the browser via IndexedDB. The server handles AI inference, embeddings, and reranking. This design means zero database setup, instant reads, and full offline access to stored data.

```
┌─────────────────────────────────────────────────────────────┐
│  Browser (Client)                                           │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────┐  │
│  │ Knowledge    │  │ Chat History │  │ Large Documents  │  │
│  │ Filesystem   │  │ (IndexedDB)  │  │ (IndexedDB v4)   │  │
│  │ (IndexedDB)  │  │              │  │ docs, chunks,    │  │
│  │              │  │              │  │ files, embeddings│  │
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────────┘  │
│         │                 │                  │              │
│  ┌──────┴─────────────────┴──────────────────┴───────────┐  │
│  │           useClientTools (shared hook)                 │  │
│  │  Fire-and-forget execution · XML-formatted outputs    │  │
│  └───────────────────────────┬───────────────────────────┘  │
│                              │                              │
├──────────────────────────────┼──────────────────────────────┤
│  Server (Next.js API Routes) │                              │
│  ┌───────────────────────────┴───────────────────────────┐  │
│  │  /api/chat        → ToolLoopAgent (AI SDK v6)         │  │
│  │  /api/embed       → OpenAI text-embedding-3-small     │  │
│  │  /api/rerank      → Cohere or GPT-4o-mini fallback    │  │
│  │  /api/context-saver → Parallel background agents      │  │
│  │  /api/parse-pdf   → Claude Haiku OCR fallback         │  │
│  └───────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
```

---

## The Agent System

### ToolLoopAgent Pattern

The chat agent (`agents/chat-agent.ts`) uses AI SDK v6's `ToolLoopAgent` — the model can call tools and receive results in a loop, up to 10 steps, enabling multi-hop reasoning without manual orchestration:

```typescript
stopWhen: stepCountIs(10)  // Prevents infinite tool loops
```

Tools are registered via a factory (`createTools`) that accepts API keys, making the tool set configurable per-request. Client-side tools (KB operations, document search, chat search) execute in the browser via the shared `useClientTools` hook, while server-side tools (web search, context savers) execute on the server.

### Context Engineering

The system prompt follows research-backed context engineering principles:

1. **XML-structured data at the top** — KB summary, document list, and metadata are wrapped in semantic XML tags (`<knowledge_base>`, `<uploaded_documents>`, `<assistant_identity>`). Studies show XML-structured context at the beginning of prompts improves retrieval by up to 30%.

2. **Hybrid preload strategy** — A compact KB summary is injected into the system prompt for fast access; Claude uses `kb_search` and `kb_read` for on-demand deep retrieval. This balances latency (no tool call needed for overview) with depth (full content available).

3. **Quote-grounding** — The prompt instructs Claude to extract verbatim `<quote>` tags from knowledge files before synthesizing responses. This technique improves factual accuracy by 20+ percentage points by forcing the model to anchor claims to source material.

4. **Multi-source investigation** — The agent is prompted to proactively check multiple sources (KB search, chat history search, web search) before answering, reducing hallucination through triangulation.

### Parallel Context Savers

When Claude decides to save information, it spawns up to 6 independent background agents via the `save_to_context` tool. Each agent handles one category (personal info, preferences, work details, etc.) in parallel:

- The orchestrator UI shows a slot-based progress indicator that fills as agents complete
- Each agent runs as an independent API call to `/api/context-saver`
- The main chat continues streaming while agents work in the background
- Agents use the same KB tools (write, append, link) to organize saved information

---

## Hybrid Search System (RAG)

All three search domains — Knowledge Base, Chat History, and Large Documents — share an identical hybrid search pipeline. This unified architecture ensures consistent retrieval quality regardless of which tool Claude uses.

### The Pipeline

```
Query → [Query Type Detection] → [Lexical Search] + [Semantic Search]
                                        ↓                   ↓
                                  BM25 rankings        Embedding rankings
                                        ↓                   ↓
                                   [Reciprocal Rank Fusion (RRF)]
                                              ↓
                                     [Cross-Encoder Reranking]
                                              ↓
                                        Top-K results
```

### Reciprocal Rank Fusion (RRF)

Instead of combining raw scores (which requires fragile normalization across different scoring systems), RRF uses **ranks**:

```
RRF(d) = 1/(k + semantic_rank) + 1/(k + lexical_rank)
```

With k=60 (the industry standard), this formula:
- Rewards documents appearing in both lexical AND semantic results
- Is robust across different scoring scales (no normalization needed)
- Prevents a single top-ranked result from dominating the final list

**Why hybrid?** Dense embeddings alone miss exact term matches (error codes, API names, proper nouns), while keyword search alone misses conceptual relationships. Hybrid search captures both.

### Query Type Detection

The system automatically classifies queries as:
- **Exact** — Quoted phrases, code snippets, error codes → lexical-heavy
- **Semantic** — Natural language questions → embedding-heavy
- **Mixed** — Both → balanced fusion

While RRF is rank-based and doesn't strictly need weighting, query type detection helps with debugging and metrics.

### Cross-Encoder Reranking

After initial retrieval (top 50 candidates), a cross-encoder reranks results by examining query-document pairs jointly. Unlike bi-encoders (which embed query and document separately), cross-encoders capture fine-grained word-level interactions:

| Backend | Quality | Cost | Notes |
|---------|---------|------|-------|
| **Cohere** | Best | $2/1000 searches | Purpose-built reranker, fastest |
| **GPT-4o-mini** | Good | ~$0.15/1M tokens | Default if no Cohere key |
| **None** | Baseline | Free | Skip reranking entirely |

This retrieve-then-rerank pattern (50 → topK) improves accuracy by 20-40% over retrieval alone.

### Unified Search Table

| Feature | KB Search | Chat Search | Document Search |
|---------|-----------|-------------|-----------------|
| Semantic search (embeddings) | ✓ | ✓ | ✓ |
| Lexical/term matching (BM25) | ✓ | ✓ | ✓ |
| Hybrid fusion (RRF) | ✓ | ✓ | ✓ |
| Cross-encoder reranking | ✓ | ✓ | ✓ |
| Retrieve-then-rerank (50→topK) | ✓ | ✓ | ✓ |
| Chunk overlap (~15%) | ✓ | ✓ | ✓ |
| Matched terms in results | ✓ | ✓ | ✓ |

---

## Knowledge Filesystem

The knowledge filesystem is a virtual file system stored entirely in IndexedDB. Claude interacts with it through tools that mirror a real filesystem:

| Tool | Description |
|------|-------------|
| `kb_list(path)` | List folder contents |
| `kb_read(path)` | Read a file's contents |
| `kb_write(path, content)` | Create or overwrite a file |
| `kb_append(path, content)` | Append to a file |
| `kb_mkdir(path)` | Create a folder |
| `kb_delete(path)` | Delete a file or folder |
| `kb_search(query, topK?)` | Hybrid search across all files |
| `kb_link(source, target, relationship)` | Create a relationship between files |
| `kb_unlink(source, target, relationship)` | Remove a relationship |
| `kb_links(path)` | Query all links for a file |
| `kb_graph(startPath, depth?, relationship?, direction?)` | Traverse the knowledge graph |

### Knowledge Graph

Beyond flat file storage, the knowledge graph adds **semantic relationships** between files, transforming isolated documents into an interconnected web:

| Relationship | Meaning | Example |
|-------------|---------|---------|
| `extends` | Builds upon | "calculus.md" extends "algebra.md" |
| `references` | Cites | "project-plan.md" references "requirements.md" |
| `contradicts` | Conflicts with | "diet-2025.md" contradicts "diet-2024.md" |
| `requires` | Prerequisite | "ml-advanced.md" requires "linear-algebra.md" |
| `blocks` | Blocks progress | "tech-debt.md" blocks "feature-x.md" |
| `relates-to` | Thematic connection | "react-hooks.md" relates-to "state-management.md" |

Graph traversal via `kb_graph` enables:
- **Prerequisite chains**: Find what you need to learn first
- **Impact analysis**: Discover what depends on a given file
- **Contradiction detection**: Surface conflicting information
- **Related content discovery**: Navigate thematic connections

---

## Large Document RAG

### The Ingestion Pipeline

```
Upload → Store File (IndexedDB) → Background Indexing:
  1. Extract text (PDF.js or Claude Haiku OCR)
  2. Heading-aware chunking (512 tokens, 15% overlap)
  3. SHA-256 hash each chunk
  4. Compare hashes against existing chunks
  5. Embed only new/changed chunks (OpenAI)
  6. Store chunks + embeddings in IndexedDB
  7. Clean up stale chunks from previous runs
```

### Intelligent PDF Extraction

ChatNoir uses a two-tier PDF extraction strategy:

| Method | Cost | Speed | Best For |
|--------|------|-------|----------|
| **PDF.js** | Free | Fast | Text-based PDFs with selectable text |
| **Claude Haiku** | ~$0.01/page | Slower | Scanned documents, image-heavy PDFs |

**Quality detection** automatically triggers the fallback by checking:
- **Character density** — Real documents have 500+ chars/page
- **Word density** — Real text has 5+ words per 100 characters
- **Text structure** — Proper spacing ratios indicate readable content

When these heuristics detect garbage extraction (common with scanned PDFs), the system seamlessly falls back to Claude Haiku for AI-powered OCR.

### Content Hash Change Detection

Re-indexing a document doesn't re-embed everything. Each chunk is SHA-256 hashed, and hashes are compared against existing chunks:

```typescript
const existingHashMap = new Map<string, LargeDocumentChunk>();
for (const chunk of existingChunks) {
  existingHashMap.set(chunk.contentHash, chunk);
}
// Only embed chunks whose hash changed — saves API calls
```

This means editing a few paragraphs in a 200-page document only re-embeds the affected chunks.

### Per-Document Search

Cross-document search loads chunks per-document via IndexedDB index queries (`by-document`), processes each document's chunks independently, then merges results globally. This bounds memory usage — a collection of 50 large documents doesn't load all chunks into memory at once.

### Chunking Strategy

| Parameter | Value | Rationale |
|-----------|-------|-----------|
| Chunk Size | 512 tokens | Optimal for fact-focused Q&A (per NVIDIA benchmarks) |
| Overlap | 75 tokens (15%) | Prevents context loss at chunk boundaries |
| Splitter | Heading-aware | Respects document structure (headings, paragraphs, sentences) |

---

## Document Viewer

### Cursor-Style 3-Panel Layout

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  Document.pdf                                 [Indexing...]           [✕]   │
├─────────────────────────────────────────────────────────────────────────────┤
│ [Document Sidebar]       │  [PDF/Text Viewer]          │  [Chat Panel]      │
│ (collapsible, resizable) │  (main content area)        │  (collapsible)     │
│                          │                             │                    │
│ > Documents              │  ┌─────────────────────┐    │  [Chat 1] [Chat 2] │
│   • Calculus.pdf         │  │                     │    │  ─────────────────  │
│   ○ Physics.pdf          │  │   PDF Page Render   │    │  Selection: [img]  │
│   ○ Notes.md             │  │                     │    │                    │
│                          │  │   [Drag to select]  │    │  User: Explain...  │
│                          │  │   [┌───────────┐]   │    │  Claude: This...   │
│                          │  │   [│ selection │]   │    │                    │
│                          │  │   [└───────────┘]   │    │  ┌──────────────┐  │
│                          │  └─────────────────────┘    │  │ [input...]   │  │
│                          │  [◀ Page [_1_]/50 ▶][Zoom][☾]│             [💬 2] │
│ [📄▸]                    │  [Capture (Enter)] [Cancel] │                    │
└─────────────────────────────────────────────────────────────────────────────┘
```

Built with `react-resizable-panels`, the layout provides imperative panel handles for programmatic expand/collapse with intuitive icons and chat count badges on collapsed panels.

### Progressive Page Loading (Sliding Window)

Rendering all pages of a 1000-page PDF would be catastrophic for memory. Instead, the PDF viewer uses a **sliding window** approach:

```typescript
const PAGE_BUFFER = 3;
// Only 7 pages rendered at any time: visible page ± 3 buffer pages
function getWindowPages(centerPage: number, numPages: number): Set<number>
```

An **IntersectionObserver** detects which page is most visible, with 150ms debouncing to prevent re-render storms during fast scrolling. A ref-based tracking pattern avoids recreating the observer on every state change:

```typescript
visiblePageRef.current = mostVisiblePage;
setTimeout(() => setVisiblePage(visiblePageRef.current), SCROLL_DEBOUNCE_MS);
```

As the user scrolls, the window slides — distant pages are evicted and new pages are rendered, keeping memory bounded regardless of document length.

### Zoom Position Preservation

When zooming, the viewer records the fractional scroll position within the current page, then restores the exact relative position after React re-renders at the new scale. The IntersectionObserver is suppressed during the zoom transition to prevent page-jump artifacts.

### Internal Link Navigation

Clicking table-of-contents links, footnotes, or cross-references navigates to the target page — even if that page hasn't been rendered yet. The viewer expands the sliding window to include the target, scrolls to it, and then re-centers the window.

### Screenshot Selection (Native Canvas Capture)

The screenshot system extracts directly from react-pdf's native canvas, avoiding the overhead and CSS-parsing issues of libraries like html2canvas:

```typescript
const pdfCanvas = pageElement.querySelector("canvas");
ctx.drawImage(pdfCanvas, left * scaleX, top * scaleY, width, height);
```

Smart scaling handles edge cases:
- Small selections are upscaled (1.5x) for readability
- Large selections are capped at 1500px to avoid excessive token usage
- Format selection: JPEG for large images (>500K pixels), PNG for smaller ones

### Session-Level PDF Cache

A module-level `Map` caches PDF files as `Uint8Array` (preventing ArrayBuffer detachment issues). Up to 10 documents are cached with LRU-style eviction, making re-opening recently viewed documents instant.

### Upload Reconciliation

When a document is uploaded and viewed before indexing completes, the viewer creates a temporary `pending-` ID and displays the raw file immediately. A polling mechanism checks every 2 seconds for the real indexed document:

```typescript
if (currentDocument.id.startsWith("pending-")) {
  const match = docs.find(d => d.filename === currentDocument.filename);
  if (match) setCurrentDocument(match);  // Seamless transition
}
```

The user sees no interruption — the view seamlessly transitions from direct file to indexed document.

### Margin Chat (Full Infrastructure Reuse)

Each margin chat tab is a **full-featured chat instance** that reuses the same infrastructure as the main chat:

- Same `/api/chat` endpoint and `useChat` hook
- Shared `ChatMessage` component for markdown, LaTeX, code, and tool rendering
- Shared `ToolInvocationRenderer` for tool call displays
- Same `useClientTools` hook for KB search, document search
- Independent conversation history per tab

This guarantees feature parity — syntax-highlighted code blocks, KaTeX math, GFM tables, and tool visualizations all work identically in margin chats.

### Text Viewer Fidelity

Text and markdown documents render from the **original uploaded file** stored in IndexedDB, not from reconstructed chunks. This preserves exact formatting, whitespace, and structure. Legacy documents without stored files fall back to chunk reconstruction.

---

## Client-Side Tool Execution

The `useClientTools` hook is the bridge between the AI SDK's streaming protocol and IndexedDB operations:

### Fire-and-Forget Pattern

Tool calls execute asynchronously without blocking the stream, enabling parallel execution:

```typescript
const handleToolCall = useCallback(({ toolCall }) => {
  executeToolAsync(toolName, toolCallId, args);  // Don't await
}, [executeToolAsync]);
```

This means Claude can fire multiple `kb_search` or `document_search` calls simultaneously, with results arriving as they complete.

### XML-Formatted Outputs

All tool outputs include XML-formatted versions alongside structured data. For example, `kb_search` returns both a JSON result and a `<search_results>` XML block. This context engineering technique improves the model's ability to parse and use tool results accurately.

### Configurable Tool Enablement

Different chat contexts enable different tool sets:
- **Main chat**: All tools (KB, documents, chat search, web search, context savers)
- **Document viewer margin chat**: Only KB and document tools (no chat search or context savers)

---

## Streaming & UI

### Smooth Streaming

The chat API uses AI SDK's `smoothStream` with line-based chunking to prevent mid-word cuts during streaming, improving perceived performance and readability.

### Neumorphic Tool Cards

Tool execution results are rendered as neumorphic cards — soft shadows and subtle gradients create a tactile, physical feel. Each tool type has a specialized view component (KB results, web search, document search, etc.) with a generic fallback for unknown tools.

### Rich Rendering Pipeline

Messages pass through a rendering pipeline:
1. **react-markdown** with remark-gfm for GitHub-flavored markdown
2. **remark-math** + **rehype-katex** for LaTeX equation rendering
3. **react-syntax-highlighter** with Prism for code block syntax highlighting
4. Custom `:IconName:` syntax for inline react-icons
5. One-click copy for code blocks

---

## Project Structure

```
├── agents/                        # Agent definitions
│   ├── index.ts                  # Export all agents
│   ├── chat-agent.ts             # Main chat agent with ToolLoopAgent
│   └── context-saver-agent.ts    # Parallel context-saving agent
│
├── knowledge/                     # Knowledge Filesystem (client-side storage)
│   ├── index.ts                  # Public API exports
│   ├── idb.ts                    # IndexedDB schema and initialization
│   ├── operations.ts             # Filesystem operations (read, write, list, etc.)
│   ├── kb-summary.ts             # KB summary generator for hybrid preload
│   ├── types.ts                  # TypeScript types
│   ├── backup.ts                 # Backup/restore functionality
│   ├── embeddings/               # RAG semantic search system
│   │   ├── index.ts              # Embeddings public API
│   │   ├── operations.ts         # Embedding & search operations
│   │   ├── hybrid-search.ts      # Lexical + semantic hybrid search with RRF
│   │   ├── lexical-search.ts     # BM25-style term matching
│   │   ├── chunker.ts            # Heading-aware chunker with overlap
│   │   ├── embed-client.ts       # OpenAI embedding API client
│   │   ├── reranker.ts           # Cross-encoder reranking (Cohere/OpenAI)
│   │   └── types.ts              # Embedding types
│   ├── links/                    # Knowledge Graph system
│   │   ├── index.ts              # Links public API
│   │   ├── operations.ts         # Link CRUD operations
│   │   ├── graph-traversal.ts    # BFS graph traversal
│   │   └── types.ts              # Link/graph types
│   └── large-documents/          # Large document RAG system
│       ├── index.ts              # Large docs public API
│       ├── idb.ts                # IndexedDB schema v4 (documents, chunks, files, umap_projections)
│       ├── operations.ts         # Upload, index, hybrid search, PDF extraction, content hash detection
│       ├── lexical-search.ts     # BM25-style term matching for documents
│       └── types.ts              # Large document types
│
├── tools/                         # Tool definitions
│   ├── index.ts                  # Export all tools (createTools factory)
│   ├── knowledge-tools.ts        # KB filesystem + graph tools
│   ├── document-search.ts        # Large document search tools
│   ├── save-to-context.ts        # Parallel context-saving tool
│   ├── web-search.ts             # Anthropic web search integration
│   └── example-weather.ts.example # Example tool template
│
├── components/
│   ├── ai-chat.tsx               # Main chat UI component
│   ├── chat-sidebar.tsx          # Sidebar with conversation history & KB browser
│   ├── knowledge-browser.tsx     # Knowledge filesystem browser UI
│   ├── knowledge-graph-viewer.tsx # Interactive knowledge graph visualization
│   ├── large-document-browser.tsx # Large document upload/manage UI
│   ├── chat/                     # Shared chat components
│   │   ├── markdown-content.tsx  # Markdown/LaTeX/code rendering
│   │   ├── tool-invocation.tsx   # Tool call UI rendering
│   │   └── chat-message.tsx      # Complete message rendering
│   ├── document-viewer/          # Full-screen document viewer
│   │   ├── index.tsx             # 3-panel layout with react-resizable-panels
│   │   ├── pdf-viewer.tsx        # PDF rendering with progressive loading
│   │   ├── text-viewer.tsx       # Markdown/text rendering
│   │   ├── chat-panel.tsx        # Tabbed chat container
│   │   ├── chat-instance.tsx     # Individual margin chat
│   │   └── document-sidebar.tsx  # Document list sidebar
│   ├── tools/                    # Tool-specific UI components
│   │   ├── agent-orchestrator-view.tsx  # Visual agent progress slots
│   │   ├── context-saver-view.tsx       # Context saver streaming display
│   │   ├── knowledge-tool-view.tsx      # KB tool result cards
│   │   ├── knowledge-link-tool-view.tsx # Knowledge graph link cards
│   │   ├── document-search-view.tsx     # Document search results
│   │   ├── chat-search-view.tsx         # Chat history search results
│   │   ├── web-search-view.tsx          # Web search result display
│   │   ├── chunk-viewer-modal.tsx       # Chunk detail modal
│   │   └── generic-tool-view.tsx        # Fallback for unknown tools
│   └── ui/                       # shadcn/ui components
│
├── lib/
│   ├── auth.ts                   # Better Auth server configuration
│   ├── auth-client.ts            # Better Auth client
│   ├── auth-helper.ts            # Auth utilities for API routes
│   ├── api-keys.ts               # BYOK API key management
│   ├── free-trial.ts             # Free trial tracking (5 free chats)
│   ├── use-chat-history.ts       # Chat history hook
│   ├── use-client-tools.ts       # Shared hook for client-side tool execution
│   ├── chat-types.ts             # Chat-related types
│   ├── storage/                  # Storage utilities
│   │   ├── chat-store.ts         # Chat storage operations
│   │   ├── chat-chunker.ts       # Chat message chunking with overlap
│   │   ├── chat-embeddings-idb.ts # Chat embeddings IndexedDB
│   │   ├── chat-embeddings-ops.ts # Chat embeddings operations
│   │   ├── chat-lexical-search.ts # BM25-style term matching for chat
│   │   └── chat-hybrid-search.ts  # Hybrid search for chat
│   └── utils.ts                  # Utility functions
│
├── app/
│   ├── api/
│   │   ├── auth/[...all]/route.ts    # Better Auth catch-all route
│   │   ├── auth/check-owner/route.ts # Owner status check endpoint
│   │   ├── chat/route.ts             # Main chat API endpoint
│   │   ├── embed/route.ts            # Embedding API endpoint
│   │   ├── rerank/route.ts           # Reranking API endpoint
│   │   ├── context-saver/route.ts    # Context saver agent endpoint
│   │   ├── generate-title/route.ts   # Auto title generation endpoint
│   │   └── parse-pdf/route.ts        # Claude Haiku PDF extraction fallback
│   ├── page.tsx                  # Main page
│   ├── layout.tsx                # Root layout
│   └── globals.css               # Global styles
│
├── docs/                          # Technical documentation
│   ├── RAG_SEMANTIC_SEARCH.md
│   ├── UNIFIED_SEARCH_PLAN.md
│   ├── CROSS_CHAT_CONTEXT_SYSTEM.md
│   └── KNOWLEDGE_FILESYSTEM_REFACTOR.md
│
└── .env.local                    # Your environment variables (create this!)
```

---

## Adding Custom Tools

### Step 1: Create the Tool

```typescript
// tools/calculator.ts
import { tool } from "ai";
import { z } from "zod";

export const calculatorTool = tool({
  description: "Perform mathematical calculations",
  inputSchema: z.object({
    expression: z.string().describe("Math expression to evaluate"),
  }),
  execute: async ({ expression }) => {
    const result = eval(expression);
    return { expression, result };
  },
});
```

### Step 2: Register It

```typescript
// tools/index.ts
import { calculatorTool } from "./calculator";

export function createTools(apiKey: string): ToolSet {
  return {
    ...knowledgeTools,
    save_to_context: saveToContextTool,
    web_search: createWebSearchTool(apiKey),
    calculator: calculatorTool,  // Add here
  };
}
```

### Step 3: (Optional) Create a UI Component

Create a component in `components/tools/` to render results. See `knowledge-tool-view.tsx` or `web-search-view.tsx` for examples.

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| **Framework** | Next.js 16.0.10 (App Router, Turbopack) |
| **Runtime** | React 19.2.1 |
| **AI SDK** | Vercel AI SDK v6 (`ai` 6.0.34, `@ai-sdk/react` 3.0.35, `@ai-sdk/anthropic` 3.0.13) |
| **Models** | Claude Haiku 4.5, Sonnet 4.5, Opus 4.6 (Anthropic) |
| **Embeddings** | OpenAI `text-embedding-3-small` |
| **Reranking** | Cohere Rerank API or GPT-4o-mini fallback |
| **Auth** | Better Auth 1.4.15 (GitHub + Google OAuth) |
| **Styling** | Tailwind CSS v4.1.9 + shadcn/ui + Radix UI |
| **Icons** | Lucide React + React Icons |
| **Markdown** | react-markdown 10.1.0 + remark-gfm |
| **Math** | KaTeX 0.16.27 (rehype-katex + remark-math) |
| **Code** | react-syntax-highlighter (Prism) |
| **PDF Parsing** | pdfjs-dist 4.9.155 + Claude Haiku OCR fallback |
| **PDF Viewing** | react-pdf 9.2.1 |
| **Layout** | react-resizable-panels |
| **Storage** | IndexedDB (via `idb` 8.0.3) |
| **Validation** | Zod 3.25.76 |
| **Notifications** | Sonner |
| **Analytics** | Vercel Analytics |

---

## License

MIT
