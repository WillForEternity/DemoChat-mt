"use client";

/**
 * useClientTools Hook
 *
 * Shared hook for executing client-side tools (IndexedDB-based).
 * Used by both the main chat and document viewer chat.
 *
 * Client-side tools include:
 * - Knowledge Base tools (kb_list, kb_read, kb_write, etc.)
 * - Document tools (document_search, document_list)
 * - Chat search (chat_search)
 */

import { useCallback, useRef, useEffect } from "react";
import * as kb from "@/knowledge";

// =============================================================================
// TYPES
// =============================================================================

export interface ToolCallParams {
  toolCall: {
    toolName: string;
    toolCallId: string;
    input?: Record<string, unknown>;
  };
}

export interface AddToolOutputFn {
  (params: { tool: string; toolCallId: string; output: unknown }): void;
}

export interface UseClientToolsOptions {
  /** Callback when KB folders change (for refreshing sidebar) */
  onKBFoldersChange?: () => void;
  /** Callback to spawn context saver agent */
  onSpawnContextSaver?: (toolCallId: string, input: Record<string, unknown>) => void;
  /** Which tools to enable (defaults to all) */
  enabledTools?: ("kb" | "documents" | "chat_search" | "save_to_context")[];
}

// =============================================================================
// HOOK
// =============================================================================

export function useClientTools(options: UseClientToolsOptions = {}) {
  const {
    onKBFoldersChange,
    onSpawnContextSaver,
    enabledTools = ["kb", "documents", "chat_search"],
  } = options;

  // Ref to store addToolOutput function
  const addToolOutputRef = useRef<AddToolOutputFn | null>(null);

  /**
   * Set the addToolOutput function (called from useChat's return value)
   */
  const setAddToolOutput = useCallback((fn: AddToolOutputFn) => {
    addToolOutputRef.current = fn;
  }, []);

  /**
   * Execute a tool asynchronously and send output back via addToolOutput.
   */
  const executeToolAsync = useCallback(
    async (toolName: string, toolCallId: string, args: Record<string, unknown>) => {
      let output: unknown;

      try {
        switch (toolName) {
          // =====================================================================
          // KNOWLEDGE BASE TOOLS
          // =====================================================================
          case "kb_list": {
            if (!enabledTools.includes("kb")) {
              output = { error: "Knowledge base tools not enabled" };
              break;
            }
            const path = (args.path as string) || "/";
            const result = await kb.listFolder(path);
            // XML-formatted output for context engineering
            const xmlOutput = `<folder path="${path}">
${result.folders.map((f) => `<subfolder name="${f}" />`).join("\n")}
${result.files.map((f) => `<file name="${f.name}" size="${f.size}" modified="${f.updatedAt}" />`).join("\n")}
</folder>`;
            output = { folder_xml: xmlOutput, ...result };
            break;
          }
          case "kb_read": {
            if (!enabledTools.includes("kb")) {
              output = { error: "Knowledge base tools not enabled" };
              break;
            }
            const path = args.path as string;
            const content = await kb.readFile(path);
            output = content !== null
              ? { content }
              : { error: `File not found: ${path}` };
            break;
          }
          case "kb_write": {
            if (!enabledTools.includes("kb")) {
              output = { error: "Knowledge base tools not enabled" };
              break;
            }
            const path = args.path as string;
            const content = args.content as string;
            await kb.writeFile(path, content, { source: "agent" });
            output = { success: true, path };
            onKBFoldersChange?.();
            break;
          }
          case "kb_append": {
            if (!enabledTools.includes("kb")) {
              output = { error: "Knowledge base tools not enabled" };
              break;
            }
            const path = args.path as string;
            const content = args.content as string;
            await kb.appendFile(path, content, { source: "agent" });
            output = { success: true, path };
            break;
          }
          case "kb_mkdir": {
            if (!enabledTools.includes("kb")) {
              output = { error: "Knowledge base tools not enabled" };
              break;
            }
            const path = args.path as string;
            await kb.mkdir(path, { source: "agent" });
            output = { success: true, path };
            onKBFoldersChange?.();
            break;
          }
          case "kb_delete": {
            if (!enabledTools.includes("kb")) {
              output = { error: "Knowledge base tools not enabled" };
              break;
            }
            const path = args.path as string;
            await kb.deleteNode(path, { source: "agent" });
            output = { success: true, path };
            onKBFoldersChange?.();
            break;
          }
          case "kb_rename": {
            if (!enabledTools.includes("kb")) {
              output = { error: "Knowledge base tools not enabled" };
              break;
            }
            const path = args.path as string;
            const newName = args.newName as string;
            const newPath = await kb.renameNode(path, newName, { source: "agent" });
            output = { success: true, newPath };
            onKBFoldersChange?.();
            break;
          }
          case "kb_search": {
            if (!enabledTools.includes("kb")) {
              output = { error: "Knowledge base tools not enabled" };
              break;
            }
            const query = args.query as string;
            const topK = (args.topK as number) || 10;
            const results = await kb.hybridSearch(query, { topK });
            if (results.length === 0) {
              output = { results: [], message: "No matching files found in Knowledge Base." };
            } else {
              const xmlOutput = `<search_results source="knowledge_base" query="${query}">
${results.map((r) => `<result score="${r.score}" path="${r.path}">
<chunk_text>
${r.chunkText}
</chunk_text>
</result>`).join("\n")}
</search_results>`;
              output = { search_results: xmlOutput, results };
            }
            break;
          }

          // =====================================================================
          // KNOWLEDGE GRAPH TOOLS
          // =====================================================================
          case "kb_link": {
            if (!enabledTools.includes("kb")) {
              output = { error: "Knowledge base tools not enabled" };
              break;
            }
            const result = await kb.createLink(
              args.sourcePath as string,
              args.targetPath as string,
              args.relationship as kb.RelationshipType | undefined
            );
            output = result;
            break;
          }
          case "kb_unlink": {
            if (!enabledTools.includes("kb")) {
              output = { error: "Knowledge base tools not enabled" };
              break;
            }
            const result = await kb.deleteLink(
              args.sourcePath as string,
              args.targetPath as string,
              args.relationship as kb.RelationshipType | undefined
            );
            output = result;
            break;
          }
          case "kb_links": {
            if (!enabledTools.includes("kb")) {
              output = { error: "Knowledge base tools not enabled" };
              break;
            }
            const result = await kb.getLinksForFile(args.path as string);
            const xmlOutput = `<file_links path="${args.path}">
<outgoing>
${result.outgoing.map((l) => `<link target="${l.target}" relationship="${l.relationship}" />`).join("\n")}
</outgoing>
<incoming>
${result.incoming.map((l) => `<link source="${l.source}" relationship="${l.relationship}" />`).join("\n")}
</incoming>
</file_links>`;
            output = { links_xml: xmlOutput, ...result };
            break;
          }
          case "kb_graph": {
            if (!enabledTools.includes("kb")) {
              output = { error: "Knowledge base tools not enabled" };
              break;
            }
            const result = await kb.traverseGraph(
              args.startPath as string,
              {
                depth: args.depth as number | undefined,
                relationship: args.relationship as kb.RelationshipType | undefined,
                direction: args.direction as "outgoing" | "incoming" | "both" | undefined,
              }
            );
            const xmlOutput = `<graph_traversal root="${result.rootPath}" depth="${result.depth}" total_links="${result.totalLinks}">
${result.nodes.map((n) => `<node path="${n.path}">
${n.links.outgoing.length > 0 ? `<outgoing>${n.links.outgoing.map((l) => `<link target="${l.target}" relationship="${l.relationship}" />`).join("")}</outgoing>` : ''}
${n.links.incoming.length > 0 ? `<incoming>${n.links.incoming.map((l) => `<link source="${l.source}" relationship="${l.relationship}" />`).join("")}</incoming>` : ''}
</node>`).join("\n")}
</graph_traversal>`;
            output = { graph_xml: xmlOutput, ...result };
            break;
          }

          // =====================================================================
          // DOCUMENT TOOLS
          // =====================================================================
          case "document_search": {
            if (!enabledTools.includes("documents")) {
              output = { error: "Document tools not enabled" };
              break;
            }
            const { searchLargeDocuments, searchLargeDocument } = await import("@/knowledge/large-documents");
            const query = args.query as string;
            const topK = Math.min((args.topK as number) || 10, 25);
            const documentId = args.documentId as string | undefined;

            const searchOptions = {
              topK,
              includeBreakdown: true,
              rerank: true,
            };

            const results = documentId
              ? await searchLargeDocument(documentId, query, searchOptions)
              : await searchLargeDocuments(query, searchOptions);

            if (results.length === 0) {
              output = {
                results: [],
                message: "No matching content found in uploaded documents.",
              };
            } else {
              const queryType = results[0]?.queryType || "mixed";
              const xmlOutput = `<search_results source="large_documents" query="${query}" mode="${queryType}">
${results.map((r) => {
  const matchedTermsAttr = r.matchedTerms && r.matchedTerms.length > 0
    ? ` matched_terms="${r.matchedTerms.join(', ')}"`
    : '';
  const rerankedAttr = r.reranked ? ' reranked="true"' : '';
  return `<result score="${r.score}" document="${r.filename}" heading="${r.headingPath}"${matchedTermsAttr}${rerankedAttr}>
<chunk_text>
${r.chunkText}
</chunk_text>
</result>`;
}).join("\n")}
</search_results>`;
              output = { search_results: xmlOutput, results };
            }
            break;
          }
          case "document_list": {
            if (!enabledTools.includes("documents")) {
              output = { error: "Document tools not enabled" };
              break;
            }
            const { getAllLargeDocuments } = await import("@/knowledge/large-documents");
            const documents = await getAllLargeDocuments();

            if (documents.length === 0) {
              output = {
                documents: [],
                message: "No documents have been uploaded yet.",
              };
            } else {
              const xmlOutput = `<documents count="${documents.length}">
${documents.map((d) => {
  return `<document id="${d.id}" filename="${d.filename}" status="${d.status}" chunks="${d.chunkCount}" size="${d.fileSize}" />`;
}).join("\n")}
</documents>`;
              output = { documents_xml: xmlOutput, documents };
            }
            break;
          }

          // =====================================================================
          // CHAT SEARCH
          // =====================================================================
          case "chat_search": {
            if (!enabledTools.includes("chat_search")) {
              output = { error: "Chat search not enabled" };
              break;
            }
            const { searchChatHistory } = await import("@/lib/storage");
            const query = args.query as string;
            const topK = Math.min((args.topK as number) || 10, 25);

            const results = await searchChatHistory(query, {
              topK,
              includeBreakdown: true,
              rerank: true,
            });

            if (results.length === 0) {
              output = {
                results: [],
                message: "No matching messages found in chat history.",
              };
            } else {
              const queryType = results[0]?.queryType || "mixed";
              const xmlOutput = `<search_results source="chat_history" query="${query}" mode="${queryType}">
${results.map((r) => {
  const matchedTermsAttr = r.matchedTerms && r.matchedTerms.length > 0
    ? ` matched_terms="${r.matchedTerms.join(', ')}"`
    : '';
  const rerankedAttr = r.reranked ? ' reranked="true"' : '';
  return `<result score="${r.score}" conversation="${r.conversationTitle}" role="${r.messageRole}"${matchedTermsAttr}${rerankedAttr}>
<chunk_text>
${r.chunkText}
</chunk_text>
</result>`;
}).join("\n")}
</search_results>`;
              output = { search_results: xmlOutput, results };
            }
            break;
          }

          // =====================================================================
          // SAVE TO CONTEXT (special handling)
          // =====================================================================
          case "save_to_context": {
            if (!enabledTools.includes("save_to_context")) {
              output = { error: "Save to context not enabled" };
              break;
            }
            // Spawn context saver agent - handled by parent component
            onSpawnContextSaver?.(toolCallId, args);
            // Return immediately - the orchestrator will handle the output
            return;
          }

          default:
            // Unknown tool - might be server-side
            console.warn("[useClientTools] Unknown tool:", toolName);
            output = { error: `Unknown client-side tool: ${toolName}` };
        }
      } catch (error) {
        console.error("[useClientTools] Tool execution error:", error);
        output = { error: error instanceof Error ? error.message : String(error) };
      }

      // Send tool output back to the chat
      if (addToolOutputRef.current) {
        addToolOutputRef.current({ tool: toolName, toolCallId, output });
      }
    },
    [enabledTools, onKBFoldersChange, onSpawnContextSaver]
  );

  /**
   * Handle tool calls from the AI model.
   * Fire-and-forget pattern for parallel tool execution.
   */
  const handleToolCall = useCallback(
    ({ toolCall }: ToolCallParams) => {
      const toolName = toolCall.toolName;
      const toolCallId = toolCall.toolCallId;
      const args = (toolCall.input ?? {}) as Record<string, unknown>;

      console.log("[useClientTools] Tool call:", toolName, args);

      // Fire-and-forget: start execution but don't await
      executeToolAsync(toolName, toolCallId, args);
    },
    [executeToolAsync]
  );

  return {
    handleToolCall,
    setAddToolOutput,
  };
}
