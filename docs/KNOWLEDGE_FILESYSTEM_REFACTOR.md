# Knowledge Filesystem Refactor Plan

## Overview

Refactor ChatNoire from the complex GraphRAG memory system (Memgraph) to a simple **Knowledge Filesystem** that Claude explicitly controls via tools.

### The Concept

Claude has access to a fast client-side filesystem (IndexedDB). Claude can:
- Create folders and nested folders
- Create files and write content to them
- Append to existing files
- Read files and list folder contents

The user sees the Knowledge Base in the sidebar, and Claude is told the root folder names in every system prompt so it knows what's available.

### Why This Change?

| Current GraphRAG | Knowledge Filesystem |
|------------------|---------------------|
| Automatic extraction (can miss context) | Claude explicitly decides what to save |
| Semantic search (~200ms embed + ~2s LLM) | Direct lookup (~5ms IndexedDB) |
| OpenAI embedding API costs | Zero external API calls |
| Opaque to user | Fully visible in sidebar |

---

## How It Works

### 1. Claude's System Prompt

Every request includes the root folder names:

```
You have access to a persistent Knowledge Filesystem. 

Current root folders: [projects], [about-me], [preferences]

Tools:
- kb_list(path) - List contents of a folder
- kb_read(path) - Read a file's contents  
- kb_write(path, content) - Create/overwrite a file
- kb_append(path, content) - Append to a file
- kb_mkdir(path) - Create a folder

Use these to remember important information across conversations.
```

### 2. Claude's Usage Pattern

When Claude needs context, it navigates the filesystem:

```
User: "What personal projects am I working on?"

Claude thinks: I should check the projects folder.
Claude calls: kb_list("projects")
Result: ["personal-projects.md", "work/"]

Claude calls: kb_read("projects/personal-projects.md")
Result: "- DeepRune: AI dungeon master\n- HomeBot: Smart home automation"

Claude responds: "You're working on DeepRune (an AI dungeon master) and HomeBot (smart home automation)."
```

When Claude learns something new:

```
User: "I just started learning Rust"

Claude calls: kb_append("about-me/skills.md", "\n- Learning Rust (Jan 2026)")
Result: success

Claude responds: "Nice! I've noted that you're learning Rust."
```

### 3. User's View

The sidebar shows a "Knowledge Base" tab with a tree view:

```
📁 about-me/
   📄 background.md
   📄 skills.md
📁 projects/
   📄 personal-projects.md
   📁 work/
📁 preferences/
   📄 coding-style.md
```

Users can click to view file contents (read-only).

---

## Implementation

### Phase 1: Knowledge Filesystem Core

#### `knowledge/types.ts`

```typescript
export interface KnowledgeNode {
  path: string;
  type: "file" | "folder";
  content?: string;
  children?: string[];
  createdAt: number;
  updatedAt: number;
}

export interface KnowledgeTree {
  name: string;
  path: string;
  type: "file" | "folder";
  children?: KnowledgeTree[];
}
```

#### `knowledge/idb.ts`

```typescript
import { openDB, type DBSchema, type IDBPDatabase } from "idb";
import type { KnowledgeNode } from "./types";

interface KnowledgeDbSchema extends DBSchema {
  nodes: {
    key: string;
    value: KnowledgeNode;
  };
}

let dbPromise: Promise<IDBPDatabase<KnowledgeDbSchema>> | null = null;

export function getKnowledgeDb() {
  if (!dbPromise) {
    dbPromise = openDB<KnowledgeDbSchema>("knowledge_v1", 1, {
      upgrade(db) {
        db.createObjectStore("nodes", { keyPath: "path" });
      },
    });
  }
  return dbPromise;
}

export async function initRootIfNeeded() {
  const db = await getKnowledgeDb();
  const root = await db.get("nodes", "/");
  if (!root) {
    await db.put("nodes", {
      path: "/",
      type: "folder",
      children: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
  }
}
```

#### `knowledge/operations.ts`

```typescript
import { getKnowledgeDb, initRootIfNeeded } from "./idb";
import type { KnowledgeNode, KnowledgeTree } from "./types";

function parentPath(path: string): string {
  const parts = path.split("/").filter(Boolean);
  return parts.length <= 1 ? "/" : "/" + parts.slice(0, -1).join("/");
}

function nodeName(path: string): string {
  return path.split("/").filter(Boolean).pop() || "";
}

function normalizePath(path: string): string {
  if (!path || path === "/") return "/";
  return "/" + path.split("/").filter(Boolean).join("/");
}

export async function listFolder(path: string): Promise<string[]> {
  await initRootIfNeeded();
  const db = await getKnowledgeDb();
  const node = await db.get("nodes", normalizePath(path));
  if (!node || node.type !== "folder") return [];
  return node.children ?? [];
}

export async function readFile(path: string): Promise<string> {
  const db = await getKnowledgeDb();
  const node = await db.get("nodes", normalizePath(path));
  if (!node) throw new Error(`Not found: ${path}`);
  if (node.type !== "folder") return node.content ?? "";
  throw new Error(`Is a folder: ${path}`);
}

export async function writeFile(path: string, content: string): Promise<void> {
  await initRootIfNeeded();
  const db = await getKnowledgeDb();
  const normalizedPath = normalizePath(path);
  const parent = parentPath(normalizedPath);
  const name = nodeName(normalizedPath);

  // Ensure parent exists
  await mkdir(parent);

  // Add to parent's children if not already there
  const parentNode = await db.get("nodes", parent);
  if (parentNode && !parentNode.children?.includes(name)) {
    parentNode.children = [...(parentNode.children ?? []), name];
    parentNode.updatedAt = Date.now();
    await db.put("nodes", parentNode);
  }

  // Write the file
  const existing = await db.get("nodes", normalizedPath);
  await db.put("nodes", {
    path: normalizedPath,
    type: "file",
    content,
    createdAt: existing?.createdAt ?? Date.now(),
    updatedAt: Date.now(),
  });
}

export async function appendFile(path: string, content: string): Promise<void> {
  const existing = await readFile(path).catch(() => "");
  const separator = existing && !existing.endsWith("\n") ? "\n" : "";
  await writeFile(path, existing + separator + content);
}

export async function mkdir(path: string): Promise<void> {
  await initRootIfNeeded();
  const db = await getKnowledgeDb();
  const normalizedPath = normalizePath(path);

  if (normalizedPath === "/") return;

  // Recursively ensure parent exists
  const parent = parentPath(normalizedPath);
  if (parent !== "/") {
    await mkdir(parent);
  }

  // Check if already exists
  const existing = await db.get("nodes", normalizedPath);
  if (existing) return;

  // Add to parent's children
  const parentNode = await db.get("nodes", parent);
  const name = nodeName(normalizedPath);
  if (parentNode && !parentNode.children?.includes(name)) {
    parentNode.children = [...(parentNode.children ?? []), name];
    parentNode.updatedAt = Date.now();
    await db.put("nodes", parentNode);
  }

  // Create the folder
  await db.put("nodes", {
    path: normalizedPath,
    type: "folder",
    children: [],
    createdAt: Date.now(),
    updatedAt: Date.now(),
  });
}

export async function deleteNode(path: string): Promise<void> {
  const db = await getKnowledgeDb();
  const normalizedPath = normalizePath(path);
  if (normalizedPath === "/") return;

  const node = await db.get("nodes", normalizedPath);
  if (!node) return;

  // Recursively delete children if folder
  if (node.type === "folder" && node.children) {
    for (const child of node.children) {
      await deleteNode(normalizedPath + "/" + child);
    }
  }

  // Remove from parent
  const parent = parentPath(normalizedPath);
  const parentNode = await db.get("nodes", parent);
  const name = nodeName(normalizedPath);
  if (parentNode?.children) {
    parentNode.children = parentNode.children.filter((c) => c !== name);
    parentNode.updatedAt = Date.now();
    await db.put("nodes", parentNode);
  }

  await db.delete("nodes", normalizedPath);
}

export async function getTree(): Promise<KnowledgeTree[]> {
  await initRootIfNeeded();
  const db = await getKnowledgeDb();

  async function buildTree(path: string, name: string): Promise<KnowledgeTree> {
    const node = await db.get("nodes", path);
    if (!node || node.type === "file") {
      return { name, path, type: "file" };
    }
    const children = await Promise.all(
      (node.children ?? []).map((child) =>
        buildTree(path === "/" ? "/" + child : path + "/" + child, child)
      )
    );
    return { name, path, type: "folder", children };
  }

  const root = await db.get("nodes", "/");
  if (!root?.children?.length) return [];

  return Promise.all(
    root.children.map((name) => buildTree("/" + name, name))
  );
}

export async function getRootFolders(): Promise<string[]> {
  await initRootIfNeeded();
  const db = await getKnowledgeDb();
  const root = await db.get("nodes", "/");
  return root?.children ?? [];
}
```

#### `knowledge/index.ts`

```typescript
export * from "./types";
export * from "./operations";
export { getKnowledgeDb, initRootIfNeeded } from "./idb";
```

---

### Phase 2: Claude's Tools

#### `tools/knowledge-tools.ts`

```typescript
import { tool } from "ai";
import { z } from "zod";

export const kbListTool = tool({
  description: "List contents of a folder in the knowledge base",
  parameters: z.object({
    path: z.string().describe("Folder path, e.g. 'projects' or 'about-me'"),
  }),
});

export const kbReadTool = tool({
  description: "Read the contents of a file in the knowledge base",
  parameters: z.object({
    path: z.string().describe("File path, e.g. 'projects/ideas.md'"),
  }),
});

export const kbWriteTool = tool({
  description: "Create or overwrite a file in the knowledge base",
  parameters: z.object({
    path: z.string().describe("File path to write"),
    content: z.string().describe("Content to write"),
  }),
});

export const kbAppendTool = tool({
  description: "Append content to a file (creates if doesn't exist)",
  parameters: z.object({
    path: z.string().describe("File path to append to"),
    content: z.string().describe("Content to append"),
  }),
});

export const kbMkdirTool = tool({
  description: "Create a folder in the knowledge base",
  parameters: z.object({
    path: z.string().describe("Folder path to create"),
  }),
});

export const knowledgeTools = {
  kb_list: kbListTool,
  kb_read: kbReadTool,
  kb_write: kbWriteTool,
  kb_append: kbAppendTool,
  kb_mkdir: kbMkdirTool,
};
```

#### Update `tools/index.ts`

```typescript
export { knowledgeTools } from "./knowledge-tools";

import { knowledgeTools } from "./knowledge-tools";

export const tools = {
  ...knowledgeTools,
};
```

---

### Phase 3: Client-Side Tool Execution

Since IndexedDB runs in the browser, tools must execute client-side. Use the `useChat` hook's `onToolCall` callback.

#### Update `components/ai-chat.tsx`

Add tool execution handler:

```typescript
import * as kb from "@/knowledge";

// Inside the component:
const [rootFolders, setRootFolders] = useState<string[]>([]);

// Load root folders on mount
useEffect(() => {
  kb.getRootFolders().then(setRootFolders);
}, []);

// Refresh after KB changes
const refreshRootFolders = () => kb.getRootFolders().then(setRootFolders);

// Tool execution
const handleToolCall = async (toolCall: { toolName: string; args: any }) => {
  const { toolName, args } = toolCall;

  switch (toolName) {
    case "kb_list":
      const items = await kb.listFolder(args.path);
      return { contents: items };

    case "kb_read":
      const content = await kb.readFile(args.path);
      return { content };

    case "kb_write":
      await kb.writeFile(args.path, args.content);
      refreshRootFolders();
      return { success: true };

    case "kb_append":
      await kb.appendFile(args.path, args.content);
      return { success: true };

    case "kb_mkdir":
      await kb.mkdir(args.path);
      refreshRootFolders();
      return { success: true };

    default:
      return { error: `Unknown tool: ${toolName}` };
  }
};

// Pass to useChat
const { messages, ... } = useChat({
  // ... other options
  onToolCall: handleToolCall,
});
```

Update the transport to include root folders:

```typescript
const transport = useMemo(
  () =>
    new DefaultChatTransport({
      api: "/api/chat",
      body: { rootFolders },
    }),
  [rootFolders]
);
```

---

### Phase 4: Update System Prompt

#### Update `agents/chat-agent.ts`

```typescript
export function createChatAgent(apiKey: string, rootFolders: string[] = []) {
  const anthropic = createAnthropic({ apiKey });

  const folderList = rootFolders.length > 0
    ? rootFolders.map((f) => `[${f}]`).join(", ")
    : "(empty)";

  const instructions = `You are Claude, a helpful AI assistant.

## Knowledge Filesystem

You have access to a persistent filesystem that saves information across conversations.

**Current root folders:** ${folderList}

**Tools:**
- \`kb_list(path)\` - List folder contents. Returns array of file/folder names.
- \`kb_read(path)\` - Read a file. Returns the file content.
- \`kb_write(path, content)\` - Create or overwrite a file.
- \`kb_append(path, content)\` - Append to a file.
- \`kb_mkdir(path)\` - Create a folder.

**Usage:**
- When you learn something important about the user, save it.
- When answering questions, check relevant files first.
- Organize with folders: about-me/, projects/, preferences/, etc.
- Use .md extension for files.

Be helpful and concise.`;

  return new ToolLoopAgent({
    model: anthropic(process.env.MAIN_MODEL || "claude-sonnet-4-5"),
    instructions,
    tools,
    stopWhen: stepCountIs(10),
  });
}
```

#### Update `app/api/chat/route.ts`

```typescript
export async function POST(req: Request) {
  const { messages, rootFolders } = await req.json();

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return Response.json({ error: "API key not set" }, { status: 400 });
  }

  const agent = createChatAgent(apiKey, rootFolders ?? []);

  return createAgentUIStreamResponse({
    agent,
    uiMessages: messages,
  });
}
```

---

### Phase 5: Knowledge Browser UI

#### `components/knowledge-browser.tsx`

```typescript
"use client";

import { useState, useEffect } from "react";
import { ChevronRight, ChevronDown, FileText, Folder } from "lucide-react";
import { getTree, readFile, type KnowledgeTree } from "@/knowledge";

export function KnowledgeBrowser({ onRefresh }: { onRefresh?: () => void }) {
  const [tree, setTree] = useState<KnowledgeTree[]>([]);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [fileContent, setFileContent] = useState("");

  const loadTree = async () => {
    const t = await getTree();
    setTree(t);
  };

  useEffect(() => {
    loadTree();
  }, []);

  // Expose refresh method
  useEffect(() => {
    if (onRefresh) {
      // Parent can call this to trigger refresh
    }
  }, [onRefresh]);

  const toggle = (path: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      next.has(path) ? next.delete(path) : next.add(path);
      return next;
    });
  };

  const selectFile = async (path: string) => {
    setSelectedFile(path);
    const content = await readFile(path);
    setFileContent(content);
  };

  const renderNode = (node: KnowledgeTree, depth = 0) => {
    const isExpanded = expanded.has(node.path);
    const isFolder = node.type === "folder";

    return (
      <div key={node.path}>
        <button
          onClick={() => (isFolder ? toggle(node.path) : selectFile(node.path))}
          className="w-full flex items-center gap-1 px-2 py-1 text-sm hover:bg-gray-100 dark:hover:bg-gray-800 rounded"
          style={{ paddingLeft: depth * 12 + 8 }}
        >
          {isFolder ? (
            <>
              {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
              <Folder size={14} className="text-amber-500" />
            </>
          ) : (
            <>
              <span className="w-3.5" />
              <FileText size={14} className="text-blue-500" />
            </>
          )}
          <span className="truncate">{node.name}</span>
        </button>
        {isFolder && isExpanded && node.children?.map((c) => renderNode(c, depth + 1))}
      </div>
    );
  };

  return (
    <div className="flex flex-col h-full">
      <div className="p-3 border-b font-semibold text-sm">Knowledge Base</div>
      <div className="flex-1 overflow-y-auto p-2">
        {tree.length === 0 ? (
          <p className="text-gray-500 text-sm text-center py-4">
            No knowledge yet. Claude will create files as you chat.
          </p>
        ) : (
          tree.map((node) => renderNode(node))
        )}
      </div>
      {selectedFile && (
        <div className="border-t max-h-48 overflow-auto">
          <div className="px-3 py-2 bg-gray-50 dark:bg-gray-800 text-xs font-medium flex justify-between">
            <span>{selectedFile}</span>
            <button onClick={() => setSelectedFile(null)}>×</button>
          </div>
          <pre className="p-3 text-xs whitespace-pre-wrap">{fileContent}</pre>
        </div>
      )}
    </div>
  );
}
```

#### Update `components/chat-sidebar.tsx`

Add a tab to switch between Chats and Knowledge:

```typescript
import { KnowledgeBrowser } from "./knowledge-browser";

// Add state
const [activeTab, setActiveTab] = useState<"chats" | "knowledge">("chats");

// In render, add tabs
<div className="flex border-b">
  <button
    onClick={() => setActiveTab("chats")}
    className={cn("flex-1 py-2 text-sm", activeTab === "chats" && "border-b-2 border-blue-500")}
  >
    Chats
  </button>
  <button
    onClick={() => setActiveTab("knowledge")}
    className={cn("flex-1 py-2 text-sm", activeTab === "knowledge" && "border-b-2 border-blue-500")}
  >
    Knowledge
  </button>
</div>

{activeTab === "chats" ? (
  // existing chat list
) : (
  <KnowledgeBrowser />
)}
```

---

### Phase 6: Remove Memgraph

Delete:
```
memgraph/          (entire folder)
app/api/embed/     (entire folder)
app/api/memgraph/  (entire folder)
```

Remove from `components/ai-chat.tsx`:
- All memgraph imports
- `ingestMessage`, `retrieveContext` calls
- Context injection logic

Remove from `.env.local`:
- `OPENAI_API_KEY` (if only used for embeddings)
- `MEMGRAPH_*` variables

---

## File Structure After Refactor

```
DemoChat-mt/
├── knowledge/
│   ├── index.ts
│   ├── types.ts
│   ├── idb.ts
│   └── operations.ts
├── tools/
│   ├── index.ts
│   └── knowledge-tools.ts
├── components/
│   ├── ai-chat.tsx          (updated)
│   ├── chat-sidebar.tsx     (updated)
│   └── knowledge-browser.tsx (new)
├── agents/
│   └── chat-agent.ts        (updated)
└── app/api/
    └── chat/route.ts        (updated)
```

---

## Testing Checklist

- [ ] `kb_mkdir("projects")` creates a folder
- [ ] `kb_write("projects/ideas.md", "...")` creates a file
- [ ] `kb_read("projects/ideas.md")` returns content
- [ ] `kb_list("projects")` returns `["ideas.md"]`
- [ ] `kb_append("projects/ideas.md", "more")` appends content
- [ ] Knowledge Browser shows the tree
- [ ] Clicking a file shows its content
- [ ] Root folders appear in Claude's system prompt
- [ ] Data persists across page refreshes
