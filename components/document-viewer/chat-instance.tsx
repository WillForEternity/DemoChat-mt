"use client";

/**
 * Chat Instance Component
 *
 * Individual chat tab that reuses the existing chat infrastructure.
 * Uses the same /api/chat endpoint and useChat hook as the main chat.
 * Now uses shared ChatMessage component for full markdown/LaTeX/tool rendering.
 * Supports both text selections (legacy) and screenshot selections.
 * 
 * Users can now:
 * - Start chats without any selection
 * - Edit the prompt before sending a screenshot
 * - Attach screenshots to any message
 */

import { useState, useRef, useEffect, useMemo, useCallback } from "react";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, lastAssistantMessageIsCompleteWithToolCalls } from "ai";
import { Loader2, Send, X, Image as ImageIcon } from "lucide-react";
import { useClientTools } from "@/lib/use-client-tools";
import { ChatMessage, type ChatMessageData } from "@/components/chat";
import { cn } from "@/lib/utils";
import type { MarginChat } from "./index";

interface ChatInstanceProps {
  chat: MarginChat;
  /** Callback when messages change (for persisting chat state) */
  onMessagesChange: (messages: import("ai").UIMessage[]) => void;
  /** Callback when AI generates a title for this chat */
  onTitleChange: (title: string) => void;
}

export function ChatInstance({ chat, onMessagesChange, onTitleChange }: ChatInstanceProps) {
  const [input, setInput] = useState("");
  const messagesEndRef = useRef<HTMLDivElement>(null);
  
  // Pending attachment from selection (screenshot or text)
  // User can edit prompt and send, or dismiss the attachment
  const [pendingAttachment, setPendingAttachment] = useState<{
    screenshot?: string;
    text?: string;
    page?: number;
  } | null>(() => {
    // Initialize with selection if it has content
    const { screenshot, text, page } = chat.selection;
    if (screenshot || text) {
      return { screenshot, text, page };
    }
    return null;
  });
  
  // Default prompt for pending attachment
  const getDefaultPrompt = useCallback(() => {
    if (!pendingAttachment) return "";
    const pageContext = pendingAttachment.page ? ` (from page ${pendingAttachment.page})` : "";
    return `Explain this section from the document${pageContext}:`;
  }, [pendingAttachment]);

  // Set default prompt when pending attachment is added
  useEffect(() => {
    if (pendingAttachment && !input) {
      setInput(getDefaultPrompt());
    }
  }, [pendingAttachment, input, getDefaultPrompt]);
  
  // Store callbacks in refs to avoid dependency changes
  const onMessagesChangeRef = useRef(onMessagesChange);
  const onTitleChangeRef = useRef(onTitleChange);
  useEffect(() => {
    onMessagesChangeRef.current = onMessagesChange;
    onTitleChangeRef.current = onTitleChange;
  }, [onMessagesChange, onTitleChange]);

  // Set up transport - same pattern as main chat
  const transport = useMemo(
    () =>
      new DefaultChatTransport({
        api: "/api/chat",
        prepareSendMessagesRequest: ({ messages }: any) => ({
          body: {
            messages,
            chatId: chat.chatId,
            // Use free trial for margin chat (no BYOK for simplicity)
            useFreeTrial: true,
            // Use Sonnet model for document viewer chat (same as main chat default)
            modelTier: "sonnet",
          },
        }),
      } as any),
    [chat.chatId]
  );

  // Set up client tools - same hook as main chat
  const { handleToolCall, setAddToolOutput } = useClientTools({
    enabledTools: ["kb", "documents"], // Enable KB and document search tools
  });

  // Use the chat hook with the same configuration as main chat
  const { messages, sendMessage, status, addToolOutput } = useChat({
    id: chat.chatId, // Unique ID isolates this chat's state
    transport,
    messages: chat.messages, // Restore persisted messages (v6 uses 'messages' instead of 'initialMessages')
    onToolCall: handleToolCall as any,
    // CRITICAL: This tells useChat to automatically continue the conversation
    // after all tool outputs are provided, enabling multi-step tool chains
    sendAutomaticallyWhen: lastAssistantMessageIsCompleteWithToolCalls,
    onFinish: async ({ messages: finishedMessages }) => {
      // Sync messages to parent after AI response completes
      onMessagesChangeRef.current(finishedMessages);

      // Generate an AI title for the conversation after first response
      // Only generate if we have at least 2 messages (user + assistant)
      if (finishedMessages.length >= 2 && chat.title === "New Chat") {
        try {
          const response = await fetch("/api/generate-title", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ 
              messages: finishedMessages,
              // Use free trial for margin chat (no BYOK for simplicity)
            }),
          });
          
          if (response.ok) {
            const { title } = await response.json();
            if (title && typeof title === "string") {
              onTitleChangeRef.current(title);
            }
          }
        } catch (error) {
          // Title generation is non-critical, fail silently
          console.warn("[ChatInstance] Failed to generate title:", error);
        }
      }
    },
  });

  // Wire up tool output function
  useEffect(() => {
    if (addToolOutput) {
      setAddToolOutput(addToolOutput);
    }
  }, [addToolOutput, setAddToolOutput]);

  // Clear pending attachment when there are already messages (restored chat)
  useEffect(() => {
    if (chat.messages.length > 0 && pendingAttachment) {
      setPendingAttachment(null);
    }
  }, [chat.messages.length, pendingAttachment]);

  // Auto-scroll on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Sync messages to parent whenever they change (including user messages)
  // This ensures persistence even if the panel is collapsed before AI responds
  const prevMessagesLengthRef = useRef(chat.messages.length);
  useEffect(() => {
    // Only sync if message count increased (avoid initial sync loops)
    if (messages.length > prevMessagesLengthRef.current) {
      prevMessagesLengthRef.current = messages.length;
      onMessagesChangeRef.current(messages);
    }
  }, [messages]);

  // Handle form submission - supports pending attachment
  const handleSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      if (!input.trim() || status !== "ready") return;
      
      // If we have a pending screenshot attachment, send with image
      if (pendingAttachment?.screenshot) {
        const mediaType = pendingAttachment.screenshot.startsWith("data:image/jpeg") 
          ? "image/jpeg" 
          : "image/png";
        
        const sizeKB = Math.round(pendingAttachment.screenshot.length / 1024);
        console.log(`[ChatInstance] Sending image: ${sizeKB}KB, type=${mediaType}`);
        
        const parts: Array<{ type: "text"; text: string } | { type: "file"; mediaType: string; url: string }> = [
          {
            type: "file",
            mediaType,
            url: pendingAttachment.screenshot,
          },
          {
            type: "text",
            text: input.trim(),
          },
        ];
        
        sendMessage({ parts });
        setPendingAttachment(null);
        setInput("");
        return;
      }
      
      // If we have pending text attachment, include it in the message
      if (pendingAttachment?.text) {
        sendMessage({ 
          text: `${input.trim()}\n\n"${pendingAttachment.text}"` 
        });
        setPendingAttachment(null);
        setInput("");
        return;
      }
      
      // Regular text message
      sendMessage({ text: input.trim() });
      setInput("");
    },
    [input, sendMessage, status, pendingAttachment]
  );

  // Dismiss pending attachment
  const dismissAttachment = useCallback(() => {
    setPendingAttachment(null);
    setInput("");
  }, []);

  const isLoading = status === "streaming" || status === "submitted";

  return (
    <div className="h-full flex flex-col bg-white dark:bg-neutral-950">
      {/* Messages - Using shared ChatMessage component */}
      <div className="flex-1 overflow-auto p-3 space-y-3">
        {/* Empty state for new chats */}
        {messages.length === 0 && !isLoading && !pendingAttachment && (
          <div className="h-full flex items-center justify-center text-gray-400 dark:text-neutral-600 text-sm">
            <div className="text-center">
              <p>Ask anything about this document</p>
              <p className="text-xs mt-1">Or drag to select an area in the PDF</p>
            </div>
          </div>
        )}

        {messages.map((msg, index) => (
          <ChatMessage
            key={msg.id}
            message={msg as ChatMessageData}
            messageIndex={index}
            totalMessages={messages.length}
            isLoading={isLoading}
            compact={true}
          />
        ))}

        {isLoading && messages.length === 0 && (
          <div className="flex items-center gap-2 text-gray-500 dark:text-neutral-500 text-sm ml-2">
            <Loader2 className="h-3 w-3 animate-spin" />
            <span>Thinking...</span>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Input area with pending attachment */}
      <div className="border-t border-gray-200 dark:border-neutral-700 flex-shrink-0">
        {/* Pending attachment preview */}
        {pendingAttachment && (
          <div className="px-3 pt-3 pb-2">
            <div className="flex items-start gap-2 p-2 rounded-xl bg-gray-50 dark:bg-neutral-900 border border-gray-200 dark:border-neutral-700">
              {pendingAttachment.screenshot ? (
                <>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={pendingAttachment.screenshot}
                    alt="Selected area"
                    className="h-16 rounded-lg border border-gray-200 dark:border-neutral-700 object-contain shadow-sm"
                  />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1 text-xs text-gray-500 dark:text-neutral-500">
                      <ImageIcon className="h-3 w-3" />
                      <span>
                        Screenshot{pendingAttachment.page ? ` from page ${pendingAttachment.page}` : ""}
                      </span>
                    </div>
                    <p className="text-xs text-gray-400 dark:text-neutral-600 mt-0.5">
                      Edit your message below, then send
                    </p>
                  </div>
                </>
              ) : pendingAttachment.text ? (
                <div className="flex-1 min-w-0">
                  <div className="text-xs text-gray-500 dark:text-neutral-500 mb-1">
                    Text selection{pendingAttachment.page ? ` from page ${pendingAttachment.page}` : ""}:
                  </div>
                  <div className="text-xs truncate italic text-gray-600 dark:text-neutral-400">
                    &ldquo;{pendingAttachment.text.slice(0, 80)}
                    {pendingAttachment.text.length > 80 ? "..." : ""}&rdquo;
                  </div>
                </div>
              ) : null}
              <button
                onClick={dismissAttachment}
                className="p-1 rounded-lg hover:bg-gray-200 dark:hover:bg-neutral-800 transition-colors"
                title="Remove attachment"
              >
                <X className="h-3.5 w-3.5 text-gray-400 dark:text-neutral-600" />
              </button>
            </div>
          </div>
        )}

        {/* Input form */}
        <form onSubmit={handleSubmit} className="p-3 pt-2">
          <div className="flex gap-2">
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder={pendingAttachment ? "Edit your message..." : "Ask about this document..."}
              className={cn(
                "flex-1 px-3 py-2 rounded-xl text-sm transition-all duration-200",
                "bg-gray-50 dark:bg-neutral-900 text-gray-900 dark:text-neutral-100",
                "border border-gray-200 dark:border-neutral-700",
                "focus:outline-none focus:ring-2 focus:ring-fuchsia-500/50 dark:focus:ring-[#ff00ff]/50",
                "placeholder:text-gray-400 dark:placeholder:text-neutral-600"
              )}
              disabled={status !== "ready"}
              autoFocus={!!pendingAttachment}
            />
            <button
              type="submit"
              disabled={status !== "ready" || !input.trim()}
              className={cn(
                "px-4 py-2 rounded-xl text-sm font-medium transition-all duration-200 disabled:opacity-50",
                "bg-fuchsia-500 dark:bg-[#ff00ff] text-white",
                "shadow-[3px_3px_6px_rgba(0,0,0,0.15),-3px_-3px_6px_rgba(255,255,255,0.3)]",
                "hover:shadow-[4px_4px_8px_rgba(0,0,0,0.2),-4px_-4px_8px_rgba(255,255,255,0.4)]",
                "active:shadow-[inset_3px_3px_6px_rgba(0,0,0,0.2),inset_-3px_-3px_6px_rgba(255,255,255,0.1)]"
              )}
            >
              <Send className="h-4 w-4" />
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
