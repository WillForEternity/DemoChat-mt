"use client";

/**
 * Chat Message Component
 *
 * Renders a complete chat message with all its parts:
 * - Text content with markdown/LaTeX/code
 * - Tool invocations
 * - File attachments (images, PDFs)
 * - Reasoning parts
 *
 * Extracted from ai-chat.tsx for reuse in document viewer chat.
 */

import React from "react";
import { IoDocumentText } from "react-icons/io5";
import { cn } from "@/lib/utils";
import { StreamingMarkdownContent } from "./markdown-content";
import {
  ToolInvocationRenderer,
  type ToolInvocationPart,
  type OrchestratorState,
} from "./tool-invocation";

// =============================================================================
// TYPES
// =============================================================================

export interface MessagePart {
  type: string;
  text?: string;
  mediaType?: string;
  url?: string;
  data?: string;
  state?: string;
  toolCallId?: string;
  input?: Record<string, unknown>;
  output?: unknown;
  approval?: { id: string };
}

export interface ChatMessageData {
  id: string;
  role: "user" | "assistant" | "system";
  parts?: MessagePart[];
}

export interface ChatMessageProps {
  /** The message to render */
  message: ChatMessageData;
  /** Index of this message in the messages array */
  messageIndex: number;
  /** Total number of messages */
  totalMessages: number;
  /** Whether the chat is currently loading/streaming */
  isLoading: boolean;
  /** Orchestrator state for save_to_context tools */
  orchestratorState?: OrchestratorState | null;
  /** Handler for tool approval */
  onToolApproval?: (approvalId: string, approved: boolean) => void;
  /** Optional className for the message container */
  className?: string;
  /** Whether to use compact styling (for document viewer) */
  compact?: boolean;
}

// =============================================================================
// CHAT MESSAGE COMPONENT
// =============================================================================

/**
 * Renders a complete chat message with all its parts.
 */
export function ChatMessage({
  message,
  messageIndex,
  totalMessages,
  isLoading,
  orchestratorState,
  onToolApproval,
  className,
  compact = false,
}: ChatMessageProps) {
  const isLastMessage = messageIndex === totalMessages - 1;
  const isStreamingMessage = isLoading && isLastMessage;

  return (
    <div
      className={cn(
        "group flex",
        message.role === "user" ? "justify-end" : "justify-start",
        className
      )}
    >
      <div
        className={cn(
          "relative rounded-2xl",
          message.role === "user"
            ? compact
              ? "max-w-[90%] px-3 py-2 neu-outset text-gray-900 dark:text-neutral-300"
              : "max-w-[80%] px-4 py-2 neu-outset text-gray-900 dark:text-neutral-300"
            : compact
              ? "max-w-[90%] px-3 py-2 bg-transparent text-gray-900 dark:text-neutral-500"
              : "max-w-[80%] px-4 py-2 bg-transparent text-gray-900 dark:text-neutral-500"
        )}
      >
        {message.parts?.map((part, index) => {
          // Handle text parts
          if (part.type === "text") {
            if (message.role === "assistant") {
              return (
                <StreamingMarkdownContent
                  key={index}
                  text={part.text || ""}
                  isStreaming={isStreamingMessage}
                />
              );
            }
            return (
              <span key={index} className="whitespace-pre-wrap">
                {part.text}
              </span>
            );
          }

          // Handle tool invocations
          if (part.type.startsWith("tool-")) {
            return (
              <ToolInvocationRenderer
                key={index}
                part={part as ToolInvocationPart}
                index={index}
                allParts={message.parts as ToolInvocationPart[]}
                orchestratorState={orchestratorState}
                onToolApproval={onToolApproval}
              />
            );
          }

          // Handle reasoning parts
          if (part.type === "reasoning") {
            return (
              <div
                key={index}
                className="my-2 p-3 bg-purple-50 border border-purple-200 rounded-lg text-purple-800 text-sm italic dark:bg-purple-900/20 dark:border-purple-800 dark:text-purple-300"
              >
                <span className="font-medium">Thinking: </span>
                {part.text}
              </div>
            );
          }

          // Handle file parts (images, PDFs, etc.)
          if (part.type === "file") {
            // Handle image files
            if (part.mediaType?.startsWith("image/")) {
              const imageUrl =
                part.url || (part.data ? `data:${part.mediaType};base64,${part.data}` : null);
              if (imageUrl) {
                return (
                  <div key={index} className="my-2">
                    <img
                      src={imageUrl}
                      alt="Attached image"
                      className="max-w-full max-h-96 rounded-lg border border-gray-200 dark:border-neutral-700 object-contain"
                      loading="lazy"
                    />
                  </div>
                );
              }
            }

            // Handle PDFs as embeds
            if (part.mediaType === "application/pdf" && part.url) {
              return (
                <div key={index} className="my-2">
                  <iframe
                    src={part.url}
                    className="w-full h-96 rounded-lg border border-gray-200 dark:border-neutral-700"
                    title="PDF document"
                  />
                </div>
              );
            }

            // Fallback for other file types
            return (
              <div
                key={index}
                className="my-2 p-3 bg-gray-50 dark:bg-neutral-800 border border-gray-200 dark:border-neutral-700 rounded-lg text-sm"
              >
                <IoDocumentText className="inline w-4 h-4 mr-2" />
                File attachment ({part.mediaType || "unknown type"})
              </div>
            );
          }

          return null;
        }) || (
          // Loading indicator when no parts yet
          <div className="flex gap-1">
            <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" />
            <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce [animation-delay:0.1s]" />
            <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce [animation-delay:0.2s]" />
          </div>
        )}
      </div>
    </div>
  );
}
