/**
 * Document Search Tool
 *
 * Tool that allows Claude to search across large uploaded documents
 * using semantic search (RAG). This is different from kb_search which
 * searches the knowledge base, and chat_search which searches chat history.
 *
 * Document search is specifically for large files that users upload
 * for Q&A purposes without loading the entire document into context.
 */

import { tool } from "ai";
import { z } from "zod";

/**
 * Tool to search across all uploaded large documents.
 * Executed client-side via onToolCall since it uses IndexedDB.
 */
export const documentSearchTool = tool({
  description: `Semantic search across all LARGE DOCUMENTS (uploaded files for RAG).
Returns relevant chunks from uploaded documents, ranked by similarity score (0-1).

NOTE: This searches uploaded Large Documents. Different from:
- kb_search: searches the Knowledge Base (saved notes/docs)
- chat_search: searches past Chat History

WHEN TO USE:
- User asks questions about an uploaded document
- Finding specific information in large PDFs, text files, etc.
- User references "the document", "that file", "the paper I uploaded"
- Answering questions that require searching through uploaded content

INTERPRETING SCORES:
- 0.7+: High relevance - directly answers the query
- 0.5-0.7: Good relevance - related content
- 0.3-0.5: Moderate relevance - tangentially related
- <0.3: Not returned (filtered out)

Returns: Array of {documentId, filename, chunkText, headingPath, score}`,
  inputSchema: z.object({
    query: z.string().describe("Search query - natural language question or topic to find in documents"),
    topK: z.number().optional().describe("Number of results (default: 10, max: 25)"),
    documentId: z.string().optional().describe("Optional: search only in a specific document by ID"),
  }),
});

/**
 * Tool to list all uploaded large documents.
 * Useful for Claude to know what documents are available.
 */
export const documentListTool = tool({
  description: `List all uploaded LARGE DOCUMENTS available for search.
Returns a list of documents with their filenames, sizes, and chunk counts.

WHEN TO USE:
- User asks "what documents do I have?"
- Before searching, to know what documents are available
- When user references a document by name

Returns: Array of {id, filename, fileSize, chunkCount, uploadedAt, status}`,
  inputSchema: z.object({}),
});

export const documentTools = {
  document_search: documentSearchTool,
  document_list: documentListTool,
};
