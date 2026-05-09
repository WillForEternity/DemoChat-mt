"use client";

/**
 * Tool Invocation Renderer
 *
 * Renders tool calls and their results in the chat.
 * Extracted from ai-chat.tsx for reuse in document viewer chat.
 */

import React from "react";
import { IoAlertCircle, IoCheckmark, IoClose } from "react-icons/io5";
import { Button } from "@/components/ui/button";

// Import tool view components
import { KnowledgeToolView } from "@/components/tools/knowledge-tool-view";
import { KnowledgeLinkToolView } from "@/components/tools/knowledge-link-tool-view";
import { WebSearchView } from "@/components/tools/web-search-view";
import { ChatSearchView } from "@/components/tools/chat-search-view";
import { DocumentSearchView, DocumentListView } from "@/components/tools/document-search-view";
import { GenericToolView } from "@/components/tools/generic-tool-view";
import {
  AgentOrchestratorView,
  type OrchestratorState,
} from "@/components/tools/agent-orchestrator-view";

export type { OrchestratorState };

// =============================================================================
// TYPES
// =============================================================================

export type ToolInvocationState =
  | "partial-call"
  | "call"
  | "approval-requested"
  | "output-available"
  | "error";

export interface ToolInvocationPart {
  type: string;
  state: ToolInvocationState;
  toolCallId: string;
  input: Record<string, unknown>;
  output?: unknown;
  approval?: { id: string };
}

export interface ToolInvocationRendererProps {
  /** The tool invocation part to render */
  part: ToolInvocationPart;
  /** Index of the part in the message */
  index: number;
  /** All parts in the message (used for orchestrator grouping) */
  allParts?: ToolInvocationPart[];
  /** Orchestrator state for save_to_context tools */
  orchestratorState?: OrchestratorState | null;
  /** Handler for tool approval (human-in-the-loop) */
  onToolApproval?: (approvalId: string, approved: boolean) => void;
}

// =============================================================================
// TOOL INVOCATION RENDERER
// =============================================================================

/**
 * Renders a tool invocation with appropriate UI based on tool type and state.
 */
export function ToolInvocationRenderer({
  part,
  index,
  allParts,
  orchestratorState,
  onToolApproval,
}: ToolInvocationRendererProps) {
  // Only handle tool-* part types
  if (!part.type.startsWith("tool-")) return null;

  const toolName = part.type.replace("tool-", "");
  const invocation = part;

  // Handle approval-requested state (human-in-the-loop)
  if (invocation.state === "approval-requested" && invocation.approval && onToolApproval) {
    return (
      <div
        key={index}
        className="my-3 p-4 bg-gray-50 border border-gray-200 rounded-xl dark:bg-neutral-800 dark:border-neutral-700"
      >
        <div className="flex items-start gap-3">
          <IoAlertCircle className="w-5 h-5 text-gray-500 dark:text-neutral-400 mt-0.5" />
          <div className="flex-1">
            <p className="font-medium text-gray-800 dark:text-neutral-200">
              Tool requires approval: {toolName}
            </p>
            <pre className="mt-2 text-sm text-gray-700 dark:text-neutral-300 bg-gray-100 dark:bg-neutral-700 p-2 rounded overflow-x-auto">
              {JSON.stringify(invocation.input, null, 2)}
            </pre>
            <div className="mt-3 flex gap-2">
              <Button
                size="sm"
                variant="neumorphic-success"
                onClick={() => onToolApproval(invocation.approval!.id, true)}
              >
                <IoCheckmark className="w-4 h-4 mr-1" />
                Approve
              </Button>
              <Button
                size="sm"
                variant="neumorphic-destructive"
                onClick={() => onToolApproval(invocation.approval!.id, false)}
              >
                <IoClose className="w-4 h-4 mr-1" />
                Deny
              </Button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // save_to_context tool - progress is shown in the unified AgentOrchestratorView
  // Only render the orchestrator on the FIRST save_to_context call in this message
  if (toolName === "save_to_context") {
    if (allParts) {
      const saveContextParts = allParts.filter((p) => p.type === "tool-save_to_context");
      const firstSaveContextIndex = allParts.findIndex((p) => p.type === "tool-save_to_context");

      // Only render orchestrator at the position of the first save_to_context call
      if (firstSaveContextIndex === index && orchestratorState) {
        return (
          <AgentOrchestratorView
            key={index}
            state={orchestratorState}
            expectedAgentCount={saveContextParts.length}
          />
        );
      }
    }
    // Return null for subsequent save_to_context calls
    return null;
  }

  // Knowledge filesystem tools
  const knowledgeTools = [
    "kb_list",
    "kb_read",
    "kb_write",
    "kb_append",
    "kb_mkdir",
    "kb_delete",
    "kb_search",
  ];

  if (knowledgeTools.includes(toolName)) {
    return <KnowledgeToolView key={index} toolName={toolName} invocation={invocation} />;
  }

  // Knowledge graph tools
  const knowledgeLinkTools = ["kb_link", "kb_unlink", "kb_links", "kb_graph"];
  if (knowledgeLinkTools.includes(toolName)) {
    return <KnowledgeLinkToolView key={index} toolName={toolName} invocation={invocation} />;
  }

  // Web search tool
  if (
    toolName === "web_search" ||
    toolName.startsWith("webSearch") ||
    toolName.toLowerCase().includes("websearch") ||
    toolName.toLowerCase().includes("web_search")
  ) {
    return <WebSearchView key={index} invocation={invocation} />;
  }

  // Chat history search tool
  if (toolName === "chat_search") {
    return <ChatSearchView key={index} invocation={invocation} />;
  }

  // Document search tool
  if (toolName === "document_search") {
    return <DocumentSearchView key={index} invocation={invocation} />;
  }

  // Document list tool
  if (toolName === "document_list") {
    return <DocumentListView key={index} invocation={invocation} />;
  }

  // All other tools - use generic UI
  return <GenericToolView key={index} toolName={toolName} invocation={invocation} />;
}
