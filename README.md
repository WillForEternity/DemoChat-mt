# ChatNoire

A modern, feature-rich AI chat application built with **Next.js 16**, **Vercel AI SDK v6**, and **Anthropic Claude Sonnet 4.5**.

ChatNoire provides a polished chat experience with a persistent knowledge filesystem, parallel context-saving agents, web search, file attachments, message editing, dark mode, and more.

---

## Features

### Core Chat
- **Streaming Responses** — Real-time response streaming with stop functionality
- **Conversation History** — Automatically saves chats to localStorage with full CRUD support
- **Parallel Chat Sessions** — Start new chats while responses are still streaming
- **Auto Title Generation** — AI-generated titles based on conversation content
- **Message Editing** — Edit previous messages and regenerate responses from that point

### Knowledge Filesystem
- **Persistent Storage** — Client-side IndexedDB storage that Claude can read/write via tools
- **Hybrid Search (RAG)** — Combines lexical (exact terms) + semantic (meaning) search with automatic query detection
- **Sidebar Browser** — Visual file browser in the sidebar to explore your knowledge base
- **KB Summary Preload** — Hybrid context strategy with summary at prompt start for fast retrieval
- **Quote-Grounding** — Claude extracts quotes from files before synthesizing responses

### AI Capabilities
- **Web Search** — Anthropic's first-party web search tool for real-time information
- **Parallel Context Savers** — Spawn up to 6 background agents to save different categories simultaneously
- **Agent Orchestrator UI** — Visual slot-based progress indicator showing agent status
- **Tool Support** — Extensible architecture for adding custom AI tools

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

Create a file called `.env.local` in the project root:

```bash
ANTHROPIC_API_KEY=sk-ant-api03-your-key-here
```

**For RAG/Semantic Search** (optional but recommended):

```bash
OPENAI_API_KEY=sk-your-openai-key-here
```

> The hybrid search system uses OpenAI's `text-embedding-3-small` for semantic embeddings. Without this key, search falls back to lexical-only matching.

Optional environment variables:

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
│   └── embeddings/               # RAG semantic search system
│       ├── index.ts              # Embeddings public API
│       ├── operations.ts         # Embedding & search operations
│       ├── hybrid-search.ts      # Lexical + semantic hybrid search
│       ├── lexical-search.ts     # BM25-style term matching
│       ├── chunker.ts            # Heading-aware Markdown chunker
│       ├── embed-client.ts       # OpenAI embedding API client
│       └── types.ts              # Embedding types
│
├── tools/                         # Tool definitions
│   ├── index.ts                  # Export all tools (createTools factory)
│   ├── knowledge-tools.ts        # Knowledge filesystem tools (kb_list, kb_read, etc.)
│   ├── save-to-context.ts        # Parallel context-saving tool
│   ├── web-search.ts             # Anthropic web search integration
│   └── example-weather.ts.example  # Example tool template
│
├── components/
│   ├── ai-chat.tsx               # Main chat UI component
│   ├── chat-sidebar.tsx          # Sidebar with conversation history & KB browser
│   ├── knowledge-browser.tsx     # Knowledge filesystem browser UI
│   ├── theme-provider.tsx        # Theme context provider
│   ├── tools/                    # Tool-specific UI components
│   │   ├── agent-orchestrator-view.tsx  # Visual agent progress slots
│   │   ├── context-saver-view.tsx       # Context saver streaming display
│   │   ├── knowledge-tool-view.tsx      # KB tool result cards
│   │   ├── web-search-view.tsx          # Web search result display
│   │   └── generic-tool-view.tsx        # Fallback for unknown tools
│   └── ui/                       # shadcn/ui components
│
├── lib/
│   ├── use-chat-history.ts       # Chat history hook (localStorage persistence)
│   ├── chat-types.ts             # Chat-related types
│   ├── storage/                  # Storage utilities
│   │   └── chat-store.ts         # Chat storage operations
│   └── utils.ts                  # Utility functions
│
├── app/
│   ├── api/
│   │   ├── chat/route.ts         # Main chat API endpoint
│   │   ├── context-saver/route.ts  # Context saver agent endpoint
│   │   └── generate-title/route.ts # Auto title generation endpoint
│   ├── page.tsx                  # Main page
│   ├── layout.tsx                # Root layout
│   └── globals.css               # Global styles
│
├── docs/                          # Technical documentation
│   ├── RAG_SEMANTIC_SEARCH.md        # Hybrid search implementation details
│   ├── CROSS_CHAT_CONTEXT_SYSTEM.md  # Memgraph memory system docs
│   └── KNOWLEDGE_FILESYSTEM_REFACTOR.md
│
└── .env.local                    # Your API key (create this!)
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

| Query Type | Example | Behavior |
|------------|---------|----------|
| **Exact** | `useState`, `"JWT token"`, `ECONNREFUSED` | 70% lexical, 30% semantic |
| **Semantic** | "How does authentication work?" | 85% semantic, 15% lexical |
| **Mixed** | "React hooks" | 60% semantic, 40% lexical |

**Why hybrid?** Dense embeddings alone miss exact term matches (like error codes or API names), while keyword search alone misses conceptual relationships. Hybrid search gives you both:

- **Lexical search** — BM25-style term matching with TF-IDF scoring
- **Semantic search** — OpenAI `text-embedding-3-small` embeddings for meaning-based retrieval
- **Automatic query detection** — The system detects query type and adjusts weights automatically

The UI shows the detected query type and matched terms for transparency.

> **Note:** Requires `OPENAI_API_KEY` in `.env.local` for embedding generation.

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
- **Additional Providers**: `@ai-sdk/openai`, `@ai-sdk/groq` (available for extensions)
- **Styling**: Tailwind CSS v4
- **Components**: shadcn/ui + Radix UI
- **Icons**: React Icons (Ionicons, FontAwesome, Material, BoxIcons, Ant Design)
- **Markdown**: react-markdown with remark-gfm
- **Math Rendering**: KaTeX with rehype-katex and remark-math
- **Syntax Highlighting**: react-syntax-highlighter with Prism
- **PDF Parsing**: pdfjs-dist
- **Storage**: IndexedDB (via `idb`) for knowledge base, localStorage for chat history
- **Validation**: Zod
- **Notifications**: Sonner

---

## Deploying to Vercel

1. Push your code to GitHub
2. Import the repository in [Vercel](https://vercel.com)
3. Add `ANTHROPIC_API_KEY` as an environment variable in Project Settings
4. Deploy!

---

## License

MIT
