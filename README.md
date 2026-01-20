# ChatNoire

A modern, feature-rich AI chat application built with **Next.js 16**, **Vercel AI SDK v6**, and **Anthropic Claude Sonnet 4.5**.

ChatNoire provides a polished chat experience with a persistent knowledge filesystem, large document RAG, parallel context-saving agents, web search, file attachments, authentication, and more.

---

## Features

### Core Chat
- **Streaming Responses** — Real-time response streaming with stop functionality
- **Conversation History** — Automatically saves chats to IndexedDB with full CRUD support
- **Chat History Search** — Hybrid search (lexical + semantic + reranking) across past conversations
- **Parallel Chat Sessions** — Start new chats while responses are still streaming
- **Auto Title Generation** — AI-generated titles based on conversation content
- **Message Editing** — Edit previous messages and regenerate responses from that point

### Knowledge Filesystem
- **Persistent Storage** — Client-side IndexedDB storage that Claude can read/write via tools
- **Hybrid Search (RAG)** — Combines lexical + semantic search with RRF (Reciprocal Rank Fusion)
- **Sidebar Browser** — Visual file browser in the sidebar to explore your knowledge base
- **KB Summary Preload** — Hybrid context strategy with summary at prompt start for fast retrieval
- **Quote-Grounding** — Claude extracts quotes from files before synthesizing responses

### Large Document RAG
- **Upload Large Documents** — Upload PDFs, text files, and markdown for Q&A without loading into context
- **Automatic Chunking** — Heading-aware chunking with 15% overlap to preserve context at boundaries
- **Hybrid Search** — Combines lexical (exact terms) + semantic (meaning) with RRF fusion
- **Cross-Encoder Reranking** — Optional reranking stage improves retrieval accuracy by 20-40%
- **Document Browser** — Visual browser to manage uploaded documents

### AI Capabilities
- **Web Search** — Anthropic's first-party web search tool for real-time information
- **Parallel Context Savers** — Spawn up to 6 background agents to save different categories simultaneously
- **Agent Orchestrator UI** — Visual slot-based progress indicator showing agent status
- **Tool Support** — Extensible architecture for adding custom AI tools

### Authentication & BYOK
- **Better Auth** — OAuth authentication with GitHub and Google providers
- **Owner Mode** — Owner emails get free access using server-side API keys
- **BYOK (Bring Your Own Key)** — Non-owners can provide their own API keys via Settings
- **Per-User Key Storage** — API keys stored securely in localStorage, scoped per user

### UI/UX
- **Rich Markdown Rendering** — Headers, bold, italic, lists, tables, code blocks with syntax highlighting
- **LaTeX/KaTeX Support** — Mathematical equations rendered beautifully
- **Inline Icons** — Use `:IconName:` syntax for react-icons (Ionicons, FontAwesome, Material, etc.)
- **Dark/Light/System Theme** — Full theme support with system preference detection
- **Neumorphic Tool Cards** — Beautiful neumorphic design for tool execution visualizations
- **Collapsible Sidebar** — Clean UI with persistent sidebar state
- **Expandable Input** — Expand the text input for composing longer messages
- **Copy Code Blocks** — One-click copy for code snippets in responses

### File Handling
- **File Attachments** — Attach text files and PDFs (with automatic text extraction via pdfjs-dist)
- **Large Document Upload** — Upload documents for RAG-based Q&A

---

## Quick Start

### Step 1: Install Dependencies

```bash
pnpm install
# or
npm install
```

### Step 2: Get Your Anthropic API Key

1. Go to [console.anthropic.com](https://console.anthropic.com/)
2. Sign in or create a free account
3. Navigate to **Settings** → **API Keys** (or go directly to [console.anthropic.com/settings/keys](https://console.anthropic.com/settings/keys))
4. Click **"Create Key"**
5. Copy the key — it will look like `sk-ant-api03-...`

> **Important:** You will only see the full key once. Save it somewhere safe!

### Step 3: Create Your Environment File

Copy the example file and fill in your values:

```bash
cp .env.local.example .env.local
```

**Required API Keys:**

```bash
# Anthropic API Key - for Claude chat
# Get yours at: https://console.anthropic.com/settings/keys
ANTHROPIC_API_KEY=sk-ant-api03-your-key-here

# OpenAI API Key - for embeddings/semantic search
# Get yours at: https://platform.openai.com/api-keys
OPENAI_API_KEY=sk-proj-your-key-here
```

**Authentication (Required for multi-user):**

```bash
# Secret key for signing sessions (generate with: openssl rand -base64 32)
BETTER_AUTH_SECRET=your-random-32-character-secret-here

# Base URL for auth callbacks
BETTER_AUTH_URL=http://localhost:3000

# GitHub OAuth (create at: https://github.com/settings/developers)
GITHUB_CLIENT_ID=your-github-client-id
GITHUB_CLIENT_SECRET=your-github-client-secret

# Google OAuth (create at: https://console.cloud.google.com/apis/credentials)
GOOGLE_CLIENT_ID=your-google-client-id
GOOGLE_CLIENT_SECRET=your-google-client-secret

# Owner emails - these users get free access to server API keys
OWNER_EMAILS=your@email.com
```

**Optional - Enhanced Reranking:**

```bash
# Cohere API Key - for cross-encoder reranking (improves RAG accuracy by 20-40%)
# Get yours at: https://dashboard.cohere.com/api-keys
# If not set, falls back to GPT-4o-mini reranking using your OpenAI key
COHERE_API_KEY=your-cohere-api-key-here
```

**Optional - Model Configuration:**

```bash
# Main chat model (default: claude-sonnet-4-5)
MAIN_MODEL=claude-sonnet-4-5

# Context Saver agent model (default: claude-sonnet-4-5)
CONTEXT_SAVER_MODEL=claude-sonnet-4-5
```

### Step 4: Start the Development Server

```bash
pnpm dev
# or
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

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
│   ├── embeddings/               # RAG semantic search system
│   │   ├── index.ts              # Embeddings public API
│   │   ├── operations.ts         # Embedding & search operations
│   │   ├── hybrid-search.ts      # Lexical + semantic hybrid search with RRF
│   │   ├── lexical-search.ts     # BM25-style term matching
│   │   ├── chunker.ts            # Heading-aware chunker with overlap
│   │   ├── embed-client.ts       # OpenAI embedding API client
│   │   ├── reranker.ts           # Cross-encoder reranking (Cohere/OpenAI)
│   │   └── types.ts              # Embedding types
│   └── large-documents/          # Large document RAG system
│       ├── index.ts              # Large docs public API
│       ├── idb.ts                # IndexedDB schema for documents
│       ├── operations.ts         # Upload, index, hybrid search operations
│       ├── lexical-search.ts     # BM25-style term matching for documents
│       └── types.ts              # Large document types
│
├── tools/                         # Tool definitions
│   ├── index.ts                  # Export all tools (createTools factory)
│   ├── knowledge-tools.ts        # Knowledge filesystem tools (kb_list, kb_read, etc.)
│   ├── document-search.ts        # Large document search tools
│   ├── save-to-context.ts        # Parallel context-saving tool
│   ├── web-search.ts             # Anthropic web search integration
│   └── example-weather.ts.example  # Example tool template
│
├── components/
│   ├── ai-chat.tsx               # Main chat UI component
│   ├── chat-sidebar.tsx          # Sidebar with conversation history & KB browser
│   ├── knowledge-browser.tsx     # Knowledge filesystem browser UI
│   ├── large-document-browser.tsx # Large document upload/manage UI
│   ├── embeddings-viewer.tsx     # KB embeddings debug viewer
│   ├── chat-embeddings-viewer.tsx # Chat embeddings debug viewer
│   ├── theme-provider.tsx        # Theme context provider
│   ├── tools/                    # Tool-specific UI components
│   │   ├── agent-orchestrator-view.tsx  # Visual agent progress slots
│   │   ├── context-saver-view.tsx       # Context saver streaming display
│   │   ├── knowledge-tool-view.tsx      # KB tool result cards
│   │   ├── document-search-view.tsx     # Large doc search results
│   │   ├── chat-search-view.tsx         # Chat history search results
│   │   ├── web-search-view.tsx          # Web search result display
│   │   └── generic-tool-view.tsx        # Fallback for unknown tools
│   └── ui/                       # shadcn/ui components
│
├── lib/
│   ├── auth.ts                   # Better Auth server configuration
│   ├── auth-client.ts            # Better Auth client
│   ├── auth-helper.ts            # Auth utilities for API routes
│   ├── api-keys.ts               # BYOK API key management
│   ├── use-chat-history.ts       # Chat history hook
│   ├── chat-types.ts             # Chat-related types
│   ├── storage/                  # Storage utilities
│   │   ├── chat-store.ts         # Chat storage operations
│   │   ├── chat-chunker.ts       # Chat message chunking with overlap
│   │   ├── chat-embeddings-idb.ts # Chat embeddings IndexedDB
│   │   ├── chat-embeddings-ops.ts # Chat embeddings operations
│   │   ├── chat-lexical-search.ts # BM25-style term matching for chat
│   │   └── chat-hybrid-search.ts  # Hybrid search for chat (lexical + semantic + RRF)
│   └── utils.ts                  # Utility functions
│
├── app/
│   ├── api/
│   │   ├── auth/[...all]/route.ts  # Better Auth catch-all route
│   │   ├── chat/route.ts           # Main chat API endpoint
│   │   ├── embed/route.ts          # Embedding API endpoint
│   │   ├── context-saver/route.ts  # Context saver agent endpoint
│   │   └── generate-title/route.ts # Auto title generation endpoint
│   ├── page.tsx                  # Main page
│   ├── layout.tsx                # Root layout
│   └── globals.css               # Global styles
│
├── docs/                          # Technical documentation
│   ├── RAG_SEMANTIC_SEARCH.md        # Hybrid search implementation details
│   ├── UNIFIED_SEARCH_PLAN.md        # Unified hybrid search across all tools
│   ├── CROSS_CHAT_CONTEXT_SYSTEM.md  # Cross-chat context system docs
│   └── KNOWLEDGE_FILESYSTEM_REFACTOR.md
│
└── .env.local                    # Your environment variables (create this!)
```

---

## Knowledge Filesystem

ChatNoire includes a **Knowledge Filesystem** — a persistent client-side storage system that Claude can read and write via tools. This allows the AI to remember information about you across conversations.

### How It Works

The Knowledge Filesystem is stored in **IndexedDB** in your browser, providing fast, local access without any API calls. Claude has access to tools for managing your knowledge base:

| Tool | Description |
|------|-------------|
| `kb_list(path)` | List folder contents |
| `kb_read(path)` | Read a file's contents |
| `kb_write(path, content)` | Create or overwrite a file |
| `kb_append(path, content)` | Append to a file |
| `kb_mkdir(path)` | Create a folder |
| `kb_delete(path)` | Delete a file or folder |
| `kb_search(query, topK?)` | Hybrid search across all files (lexical + semantic) |

### Parallel Context Saving

When you share information, Claude can spawn **parallel context saver agents** (up to 6) to organize and save different categories simultaneously:

| Tool | Description |
|------|-------------|
| `save_to_context(information, context?)` | Spawn a background agent to save one category |

For example, if you say "I'm John, a software engineer at Google, and I prefer dark mode", Claude will spawn 3 parallel agents:
1. Personal info agent → saves name
2. Work info agent → saves job details
3. Preferences agent → saves UI preferences

The UI shows a beautiful slot-based progress indicator that fills as agents complete.

### Hybrid Search (RAG)

ChatNoire uses a **hybrid search** system that combines lexical and semantic approaches for optimal retrieval:

**Why hybrid?** Dense embeddings alone miss exact term matches (like error codes or API names), while keyword search alone misses conceptual relationships. Hybrid search gives you both.

#### Search Pipeline

1. **Lexical Search** — BM25-style term matching with TF-IDF scoring
2. **Semantic Search** — OpenAI embeddings for meaning-based retrieval
3. **RRF Fusion** — Reciprocal Rank Fusion combines both result lists
4. **Reranking** (optional) — Cross-encoder reranks top candidates for 20-40% accuracy boost

#### Reciprocal Rank Fusion (RRF)

RRF is the 2025 industry standard for combining search results. Unlike weighted scores, RRF uses **ranks** not scores, making it robust across different scoring systems:

```
RRF(d) = 1/(k + semantic_rank) + 1/(k + lexical_rank)
```

Documents that appear in both lexical AND semantic results get boosted.

#### Cross-Encoder Reranking

After initial retrieval, a cross-encoder model reranks the top candidates by examining query-document pairs together. This captures word-level interactions that bi-encoders miss.

| Backend | Quality | Cost | Notes |
|---------|---------|------|-------|
| **Cohere** | Best | $2/1000 searches | Purpose-built, fastest |
| **GPT-4o-mini** | Good | ~$0.15/1M tokens | Default if no Cohere key |
| **None** | Baseline | Free | Skip reranking |

> **Note:** Requires `OPENAI_API_KEY` for embeddings. Reranking uses GPT-4o-mini by default, or Cohere if `COHERE_API_KEY` is set.

### Unified Search Across All Tools

All three search tools now share the same hybrid search pipeline:

| Feature | KB Search | Chat Search | Document Search |
|---------|-----------|-------------|-----------------|
| Semantic search (embeddings) | ✅ | ✅ | ✅ |
| Lexical/term matching | ✅ | ✅ | ✅ |
| Hybrid fusion (RRF) | ✅ | ✅ | ✅ |
| Cross-encoder reranking | ✅ | ✅ | ✅ |
| Retrieve-then-rerank (50→topK) | ✅ | ✅ | ✅ |
| Query type detection | ✅ | ✅ | ✅ |
| Chunk overlap (~15%) | ✅ | ✅ | ✅ |
| Matched terms in results | ✅ | ✅ | ✅ |

This ensures consistent behavior and accuracy regardless of which search tool Claude uses.

### Hybrid Preload Strategy

ChatNoire uses a hybrid context strategy for optimal performance:
- **Summary at start**: A compact index of your KB is included in Claude's system prompt
- **Semantic search**: Claude uses `kb_search` to find relevant content by meaning or exact terms
- **On-demand retrieval**: Claude uses `kb_read` to fetch full file contents when needed
- **Quote-grounding**: Claude extracts quotes from files before synthesizing responses for accuracy

### Suggested Organization

```
knowledge/
├── about-me/
│   ├── background.md
│   └── resume.md
├── preferences/
│   └── coding-style.md
├── projects/
│   ├── current-project.md
│   └── ideas.md
└── work/
    └── team.md
```

---

## Large Document RAG

For documents too large to fit in Claude's context window, ChatNoire provides a **Large Document RAG** system. Upload PDFs, text files, or markdown and ask questions without loading the entire document.

### How It Works

1. **Upload** — Drop a file in the Large Documents browser
2. **Chunking** — Document is split into ~512-token chunks with 15% overlap
3. **Embedding** — Each chunk is embedded using OpenAI's embedding model
4. **Storage** — Chunks and embeddings stored in IndexedDB (client-side)
5. **Search** — Claude uses `document_search` to find relevant chunks by meaning
6. **Rerank** — Top candidates are reranked for higher accuracy
7. **Answer** — Claude synthesizes an answer from the retrieved chunks

### Document Tools

| Tool | Description |
|------|-------------|
| `document_search(query, topK?, documentId?)` | Semantic search across uploaded documents |
| `document_list()` | List all uploaded documents |

### Chunking Strategy (2025 Best Practices)

| Parameter | Value | Rationale |
|-----------|-------|-----------|
| **Chunk Size** | 512 tokens | Optimal for fact-focused Q&A retrieval |
| **Overlap** | 75 tokens (15%) | Prevents context loss at boundaries |
| **Splitter** | Heading-aware | Respects document structure (Markdown headings, paragraphs, sentences) |

### Supported File Types

- **Text** — `.txt`, `.md`, `.json`, `.xml`
- **PDF** — Automatic text extraction via pdfjs-dist

---

## Chat History Search

ChatNoire can search across your **past conversations** to find relevant context. This uses the same unified hybrid search as the Knowledge Base and Large Documents.

| Tool | Description |
|------|-------------|
| `chat_search(query, topK?)` | Hybrid search across chat history (lexical + semantic + reranking) |

### Features

- **Hybrid Search** — Combines lexical (exact terms) and semantic (meaning) with RRF fusion
- **Auto Query Detection** — Automatically detects query type (exact, semantic, or mixed)
- **Cross-Encoder Reranking** — Optional reranking for 20-40% accuracy improvement
- **Chunk Overlap** — 15% overlap between chunks to preserve context at boundaries
- **Matched Terms** — Shows which terms matched for transparency

Chat messages are automatically chunked (with overlap) and embedded when conversations are saved.

---

## Web Search

ChatNoire integrates Anthropic's first-party **web search** capability, giving Claude real-time access to the internet.

### Features

- Up to **5 searches per conversation** (configurable)
- Automatic source citations
- Optional domain allow/block lists
- Optional user location for relevant results

### When Claude Uses Web Search

- Current events, news, or recent information
- Up-to-date documentation or API references
- User explicitly asks to search the web
- Topics where training data might be outdated

---

## Adding Custom Tools

### Step 1: Create the Tool

Create a new file in `/tools/` (e.g., `calculator.ts`):

```typescript
import { tool } from "ai";
import { z } from "zod";

export const calculatorTool = tool({
  description: "Perform mathematical calculations",
  inputSchema: z.object({
    expression: z.string().describe("Math expression to evaluate"),
  }),
  execute: async ({ expression }) => {
    const result = eval(expression); // Use a safe math parser in production!
    return { expression, result };
  },
});
```

### Step 2: Register the Tool

Add your tool to `/tools/index.ts`:

```typescript
import { calculatorTool } from "./calculator";

export function createTools(apiKey: string): ToolSet {
  return {
    ...knowledgeTools,
    save_to_context: saveToContextTool,
    web_search: createWebSearchTool(apiKey),
    calculator: calculatorTool,  // Add your tool here
  };
}
```

### Step 3: (Optional) Create a UI Component

Create a component in `/components/tools/` to render your tool's results beautifully. See `knowledge-tool-view.tsx` or `web-search-view.tsx` for examples.

---

## Customizing the Agent

Edit `/agents/chat-agent.ts` to customize the agent's behavior. The `createChatAgent` function builds the agent with:

- **Model**: Claude Sonnet 4.5 (configurable via `MAIN_MODEL` env var)
- **Instructions**: System prompt with XML-structured context engineering
- **Tools**: All tools from `/tools/index.ts`
- **KB Summary**: Pre-generated summary of your knowledge base for hybrid preload

### Context Engineering

The system prompt follows research-backed context engineering principles:
- XML-structured data at TOP (improves retrieval by up to 30%)
- Quote-grounding instruction (improves accuracy by 20+ percentage points)
- Hybrid preload strategy (summary + just-in-time retrieval)

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
4. Confirm the key hasn't been revoked in the Anthropic console

---

## Tech Stack

- **Framework**: Next.js 16 with App Router
- **AI SDK**: Vercel AI SDK v6 (`ai`, `@ai-sdk/react`, `@ai-sdk/anthropic`)
- **Model**: Claude Sonnet 4.5 (Anthropic)
- **Embeddings**: OpenAI `text-embedding-3-small` (or `text-embedding-3-large` with dimension reduction)
- **Reranking**: Cohere Rerank API or GPT-4o-mini fallback
- **Additional Providers**: `@ai-sdk/openai`, `@ai-sdk/groq` (available for extensions)
- **Authentication**: Better Auth with GitHub and Google OAuth
- **Styling**: Tailwind CSS v4
- **Components**: shadcn/ui + Radix UI
- **Icons**: React Icons (Ionicons, FontAwesome, Material, BoxIcons, Ant Design)
- **Markdown**: react-markdown with remark-gfm
- **Math Rendering**: KaTeX with rehype-katex and remark-math
- **Syntax Highlighting**: react-syntax-highlighter with Prism
- **PDF Parsing**: pdfjs-dist
- **Storage**: IndexedDB (via `idb`) for knowledge base, chat history, and large documents
- **Validation**: Zod
- **Notifications**: Sonner

---

## Authentication

ChatNoire uses **Better Auth** for authentication with OAuth providers.

### Owner vs BYOK Users

| User Type | API Keys Used | Configuration |
|-----------|---------------|---------------|
| **Owner** | Server-side env keys | Email in `OWNER_EMAILS` |
| **BYOK User** | Their own keys | Entered via Settings modal |

Owner emails get free access using the API keys in your `.env.local`. Other users must provide their own keys through the Settings modal (stored in their browser's localStorage).

### Setting Up OAuth

1. **GitHub**: Create OAuth app at [github.com/settings/developers](https://github.com/settings/developers)
   - Callback URL: `http://localhost:3000/api/auth/callback/github`

2. **Google**: Create credentials at [console.cloud.google.com](https://console.cloud.google.com/apis/credentials)
   - Callback URL: `http://localhost:3000/api/auth/callback/google`

---

## Deploying to Vercel

1. Push your code to GitHub
2. Import the repository in [Vercel](https://vercel.com)
3. Add environment variables in Project Settings:
   - `ANTHROPIC_API_KEY`
   - `OPENAI_API_KEY`
   - `BETTER_AUTH_SECRET`
   - `BETTER_AUTH_URL` (your production URL)
   - `GITHUB_CLIENT_ID` and `GITHUB_CLIENT_SECRET`
   - `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`
   - `OWNER_EMAILS`
   - `COHERE_API_KEY` (optional)
4. Update OAuth callback URLs to use your production domain
5. Deploy!

---

## License

MIT
