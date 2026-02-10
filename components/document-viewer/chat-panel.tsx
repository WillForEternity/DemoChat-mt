"use client";

/**
 * Chat Panel Component
 *
 * Right-side panel with horizontal tabs for multiple concurrent chats.
 * Each tab is a separate conversation about a text selection or general document chat.
 */

import { X, ChevronRight, Plus } from "lucide-react";
import { cn } from "@/lib/utils";
import { ChatInstance } from "./chat-instance";
import type { MarginChat } from "./index";

interface ChatPanelProps {
  chats: MarginChat[];
  activeChat: string | null;
  onTabChange: (id: string) => void;
  onCloseTab: (id: string) => void;
  onCollapse: () => void;
  onMessagesChange: (chatId: string, messages: import("ai").UIMessage[]) => void;
  onTitleChange: (chatId: string, title: string) => void;
  onNewChat: () => void;
}

export function ChatPanel({
  chats,
  activeChat,
  onTabChange,
  onCloseTab,
  onCollapse,
  onMessagesChange,
  onTitleChange,
  onNewChat,
}: ChatPanelProps) {
  return (
    <div className="h-full flex flex-col bg-white dark:bg-neutral-950 neu-context-white">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-gray-200 dark:border-neutral-700 h-[48px]">
        <span className="font-semibold text-sm text-gray-900 dark:text-neutral-100">Document Chat</span>
        <div className="flex items-center gap-2">
          <button
            onClick={onNewChat}
            className={cn(
              "p-2 rounded-xl transition-all duration-200",
              "bg-white dark:bg-neutral-950",
              "shadow-[3px_3px_6px_rgba(0,0,0,0.08),-3px_-3px_6px_rgba(255,255,255,0.8)]",
              "dark:shadow-[3px_3px_6px_rgba(0,0,0,0.4),-3px_-3px_6px_rgba(255,255,255,0.03)]",
              "hover:shadow-[4px_4px_8px_rgba(0,0,0,0.1),-4px_-4px_8px_rgba(255,255,255,0.9)]",
              "dark:hover:shadow-[4px_4px_8px_rgba(0,0,0,0.5),-4px_-4px_8px_rgba(255,255,255,0.04)]",
              "active:shadow-[inset_3px_3px_6px_rgba(0,0,0,0.1),inset_-3px_-3px_6px_rgba(255,255,255,0.9)]",
              "dark:active:shadow-[inset_3px_3px_6px_rgba(0,0,0,0.5),inset_-3px_-3px_6px_rgba(255,255,255,0.04)]"
            )}
            title="New chat"
          >
            <Plus className="h-4 w-4 text-gray-500 dark:text-neutral-500" />
          </button>
          <button
            onClick={onCollapse}
            className={cn(
              "p-2 rounded-xl transition-all duration-200",
              "bg-white dark:bg-neutral-950",
              "shadow-[3px_3px_6px_rgba(0,0,0,0.08),-3px_-3px_6px_rgba(255,255,255,0.8)]",
              "dark:shadow-[3px_3px_6px_rgba(0,0,0,0.4),-3px_-3px_6px_rgba(255,255,255,0.03)]",
              "hover:shadow-[4px_4px_8px_rgba(0,0,0,0.1),-4px_-4px_8px_rgba(255,255,255,0.9)]",
              "dark:hover:shadow-[4px_4px_8px_rgba(0,0,0,0.5),-4px_-4px_8px_rgba(255,255,255,0.04)]",
              "active:shadow-[inset_3px_3px_6px_rgba(0,0,0,0.1),inset_-3px_-3px_6px_rgba(255,255,255,0.9)]",
              "dark:active:shadow-[inset_3px_3px_6px_rgba(0,0,0,0.5),inset_-3px_-3px_6px_rgba(255,255,255,0.04)]"
            )}
            title="Collapse chat panel"
          >
            <ChevronRight className="h-4 w-4 text-gray-500 dark:text-neutral-500" />
          </button>
        </div>
      </div>

      {/* Tab Bar - Horizontal, side by side */}
      {chats.length > 0 && (
        <div className="flex border-b border-gray-200 dark:border-neutral-700 overflow-x-auto scrollbar-thin bg-gray-50/50 dark:bg-neutral-900/50">
          {chats.map((chat) => (
            <button
              key={chat.id}
              onClick={() => onTabChange(chat.id)}
              className={cn(
                "flex items-center gap-1.5 px-3 py-2 text-sm whitespace-nowrap border-r border-gray-200 dark:border-neutral-700",
                "transition-all duration-200 min-w-0 max-w-[200px]",
                activeChat === chat.id
                  ? cn(
                      "bg-white dark:bg-neutral-950 -mb-px font-medium",
                      "text-gray-900 dark:text-neutral-100",
                      "border-b-2 border-b-fuchsia-500 dark:border-b-[#ff00ff]"
                    )
                  : "bg-gray-50/50 dark:bg-neutral-900/50 hover:bg-gray-100 dark:hover:bg-neutral-800 text-gray-500 dark:text-neutral-500"
              )}
              title={chat.title}
            >
              <span className="truncate">{chat.title}</span>
              <span
                onClick={(e) => {
                  e.stopPropagation();
                  onCloseTab(chat.id);
                }}
                className="ml-1 p-0.5 rounded hover:bg-red-100 dark:hover:bg-red-900/30 hover:text-red-600 dark:hover:text-red-400 transition-colors flex-shrink-0"
              >
                <X className="h-3 w-3" />
              </span>
            </button>
          ))}
        </div>
      )}

      {/* Chat Content - Only active chat visible */}
      <div className="flex-1 overflow-hidden relative">
        {chats.map((chat) => (
          <div
            key={chat.id}
            className={cn("absolute inset-0", activeChat !== chat.id && "hidden")}
          >
            <ChatInstance
              chat={chat}
              onMessagesChange={(messages) => onMessagesChange(chat.id, messages)}
              onTitleChange={(title) => onTitleChange(chat.id, title)}
            />
          </div>
        ))}

        {chats.length === 0 && (
          <div className="h-full flex items-center justify-center text-gray-500 dark:text-neutral-500 text-sm p-4 text-center">
            <div>
              <p className="mb-2">Start a new chat about this document</p>
              <p className="text-xs text-gray-400 dark:text-neutral-600 mb-3">
                Or drag to select an area and press Enter to capture
              </p>
              <button
                onClick={onNewChat}
                className={cn(
                  "px-4 py-2 rounded-xl text-sm font-medium transition-all duration-200",
                  "bg-fuchsia-500 dark:bg-[#ff00ff] text-white",
                  "shadow-[3px_3px_6px_rgba(0,0,0,0.15),-3px_-3px_6px_rgba(255,255,255,0.3)]",
                  "hover:shadow-[4px_4px_8px_rgba(0,0,0,0.2),-4px_-4px_8px_rgba(255,255,255,0.4)]",
                  "active:shadow-[inset_3px_3px_6px_rgba(0,0,0,0.2),inset_-3px_-3px_6px_rgba(255,255,255,0.1)]"
                )}
              >
                <Plus className="h-4 w-4 inline mr-1.5 -mt-0.5" />
                New Chat
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
