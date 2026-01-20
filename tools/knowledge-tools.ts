/**
 * Knowledge Filesystem Tools
 *
 * Tools that allow Claude to interact with the persistent Knowledge Filesystem.
 * These tools are executed client-side via the onToolCall callback since
 * IndexedDB runs in the browser.
 *
 * Tools:
 * - kb_list: List contents of a folder
 * - kb_read: Read a file's contents
 * - kb_write: Create or overwrite a file
 * - kb_append: Append to a file
 * - kb_mkdir: Create a folder
 * - kb_delete: Delete a file or folder
 * - kb_search: Semantic search across all files (RAG)
 * - kb_link: Create a relationship between files
 * - kb_unlink: Remove a relationship between files
 * - kb_links: Query all relationships for a file
 * - kb_graph: Traverse the knowledge graph
 */

import { tool } from "ai";
import { z } from "zod";

export const kbListTool = tool({
  description: "List contents of a folder in the knowledge base. Returns an array of file and folder names.",
  inputSchema: z.object({
    path: z.string().describe("Folder path, e.g. 'projects' or 'about-me'. Use '/' for root."),
  }),
});

export const kbReadTool = tool({
  description: "Read the contents of a file in the knowledge base. Returns the file content as a string.",
  inputSchema: z.object({
    path: z.string().describe("File path, e.g. 'projects/ideas.md' or 'about-me/background.md'"),
  }),
});

export const kbWriteTool = tool({
  description: "Create or overwrite a file in the knowledge base. Parent folders are created automatically.",
  inputSchema: z.object({
    path: z.string().describe("File path to write, e.g. 'projects/new-idea.md'"),
    content: z.string().describe("Content to write to the file"),
  }),
});

export const kbAppendTool = tool({
  description: "Append content to a file in the knowledge base. Creates the file if it doesn't exist.",
  inputSchema: z.object({
    path: z.string().describe("File path to append to"),
    content: z.string().describe("Content to append (a newline is added before if needed)"),
  }),
});

export const kbMkdirTool = tool({
  description: "Create a folder in the knowledge base. Parent folders are created automatically.",
  inputSchema: z.object({
    path: z.string().describe("Folder path to create, e.g. 'projects/work' or 'preferences'"),
  }),
});

export const kbDeleteTool = tool({
  description: "Delete a file or folder (and all its contents) from the knowledge base.",
  inputSchema: z.object({
    path: z.string().describe("Path to delete"),
  }),
});

export const kbSearchTool = tool({
  description: `Hybrid search the KNOWLEDGE BASE using both lexical (exact terms) and semantic (meaning) matching.
Returns relevant chunks ranked by combined score (0-1).

NOTE: This searches the Knowledge Base (user's saved notes/docs). For searching past chat history, use chat_search instead.

SEARCH MODES (automatically detected):
- Exact queries ("useState", "ECONNREFUSED", quoted phrases) → lexical-heavy (70% terms, 30% semantic)
- Questions ("How does auth work?") → semantic-heavy (85% meaning, 15% terms)
- Mixed queries → balanced (60% semantic, 40% lexical)

WHEN TO USE:
- Finding information without knowing the exact file path
- Searching for specific terms, code identifiers, or error codes
- Answering questions about stored knowledge
- Discovering related content across files

INTERPRETING SCORES:
- 0.7+: High relevance - chunk directly answers query
- 0.5-0.7: Good relevance - thematically related content
- 0.3-0.5: Moderate relevance - tangentially related
- <0.2: Not returned (filtered out)

QUERY TIPS:
- For exact matches: use quotes ("JWT token") or code identifiers (useState)
- For concepts: ask natural questions ("How does authentication work?")
- For code/errors: use exact terms (ECONNREFUSED, useEffect, async/await)

LIMITATIONS (when to use kb_list + kb_read instead):
- Short bullet lists and structured data may score lower
- Very broad queries ("AI", "projects") get moderate scores everywhere

Returns: Array of {filePath, chunkText, headingPath, score, matchedTerms}`,
  inputSchema: z.object({
    query: z.string().describe("Search query - can be natural language, exact terms, or quoted phrases"),
    topK: z.number().optional().describe("Number of results (default: 5, max: 25)"),
  }),
});

export const chatSearchTool = tool({
  description: `Hybrid search across all CHAT HISTORY using lexical (exact terms) AND semantic (meaning) matching.
Returns relevant chunks from previous chats, ranked by combined score with optional reranking.

NOTE: This searches past chat conversations. For searching the Knowledge Base (saved notes/docs), use kb_search instead.

SEARCH MODES (automatically detected):
- Exact queries ("error code", "useState", quoted phrases) → lexical-heavy
- Questions ("What did we discuss about X?") → semantic-heavy
- Mixed queries → balanced

WHEN TO USE:
- Finding previous discussions on a topic
- Recalling past decisions or recommendations
- Searching for specific terms, code, or error messages mentioned
- Getting context from earlier conversations

INTERPRETING SCORES:
- 0.7+: High relevance - directly discusses the topic
- 0.5-0.7: Good relevance - related discussion
- 0.3-0.5: Moderate relevance - tangentially related
- <0.3: Not returned (filtered out)

QUERY TIPS:
- For exact matches: use quotes ("JWT token") or code identifiers
- For concepts: ask natural questions
- For code/errors: use exact terms (ECONNREFUSED, useEffect)

Returns: Array of {conversationTitle, chunkText, messageRole, score, matchedTerms}`,
  inputSchema: z.object({
    query: z.string().describe("Search query - natural language, exact terms, or quoted phrases"),
    topK: z.number().optional().describe("Number of results (default: 5, max: 25)"),
  }),
});

// =============================================================================
// KNOWLEDGE GRAPH TOOLS
// =============================================================================

const relationshipEnum = z.enum([
  "extends",
  "references",
  "contradicts",
  "requires",
  "blocks",
  "relates-to",
]);

export const kbLinkTool = tool({
  description: `Create a relationship between two files in the knowledge base.
Enables knowledge graph features: automatic context traversal, contradiction detection, prerequisite chains.

RELATIONSHIP TYPES:
- extends: Target builds on source concept (e.g., calculus extends algebra)
- references: Target cites or mentions source
- contradicts: Target conflicts with source (helps track evolution of thinking)
- requires: Target is prerequisite for source
- blocks: Source blocks progress on target
- relates-to: General thematic connection

Use bidirectional=true when relationship is symmetric (e.g., "relates-to" between similar topics).

Both source and target files must exist in the knowledge base.

Returns: { success: true, link: KnowledgeLink } or { success: false, error: string }`,
  inputSchema: z.object({
    source: z.string().describe("Source file path (must exist in KB)"),
    target: z.string().describe("Target file path (must exist in KB)"),
    relationship: relationshipEnum.describe("Type of relationship"),
    bidirectional: z.boolean().optional().default(false).describe("If true, relationship is symmetric (A→B implies B→A)"),
    notes: z.string().optional().describe("Optional context about this relationship"),
  }),
});

export const kbUnlinkTool = tool({
  description: `Remove a relationship between two files in the knowledge base.

Returns: { success: true, deleted: boolean } or { success: false, error: string }`,
  inputSchema: z.object({
    source: z.string().describe("Source file path"),
    target: z.string().describe("Target file path"),
    relationship: relationshipEnum.describe("Type of relationship to remove"),
  }),
});

export const kbLinksTool = tool({
  description: `Query all relationships for a file. Returns both incoming and outgoing links.
Use to understand how a piece of knowledge connects to others in the graph.

Returns: { path, outgoing: KnowledgeLink[], incoming: KnowledgeLink[], total: number }`,
  inputSchema: z.object({
    path: z.string().describe("File path to query links for"),
  }),
});

export const kbGraphTool = tool({
  description: `Traverse the knowledge graph from a starting point.
Returns connected nodes up to specified depth using BFS traversal.

USE CASES:
- Finding prerequisite chains (relationship="requires", direction="outgoing")
- Discovering related content (direction="both")
- Impact analysis - what depends on this file (direction="incoming")
- Finding contradictions (relationship="contradicts")

Returns: { rootPath, depth, nodes: GraphNode[], totalLinks: number }
Each node contains: { path, links: { outgoing, incoming } }`,
  inputSchema: z.object({
    startPath: z.string().describe("Starting file path for traversal"),
    depth: z.number().optional().default(2).describe("Max traversal depth (1-5, default: 2)"),
    relationship: relationshipEnum.optional().describe("Filter to specific relationship type"),
    direction: z.enum(["outgoing", "incoming", "both"]).optional().default("both").describe("Direction to traverse"),
  }),
});

export const knowledgeTools = {
  kb_list: kbListTool,
  kb_read: kbReadTool,
  kb_write: kbWriteTool,
  kb_append: kbAppendTool,
  kb_mkdir: kbMkdirTool,
  kb_delete: kbDeleteTool,
  kb_search: kbSearchTool,
  chat_search: chatSearchTool,
  kb_link: kbLinkTool,
  kb_unlink: kbUnlinkTool,
  kb_links: kbLinksTool,
  kb_graph: kbGraphTool,
};
