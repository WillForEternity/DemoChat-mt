"use client";

/**
 * Chat Sidebar Component
 *
 * Displays past chat conversations and allows navigation between them.
 * Implements:
 * - Conversation list with timestamps
 * - Knowledge Base browser tab
 * - New chat button
 * - Rename and delete actions
 * - Clear all functionality
 * - Collapsible sidebar for mobile
 * - Settings panel with theme toggle
 */

import { useState, useCallback, useRef, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  MessageSquarePlus,
  Trash2,
  Pencil,
  Check,
  X,
  ChevronLeft,
  ChevronRight,
  MoreHorizontal,
  Trash,
  Settings,
  Moon,
  Sun,
  Monitor,
  Palette,
  Bell,
  HelpCircle,
  MessageCircle,
  Brain,
  Sparkles,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { ChatConversation } from "@/lib/chat-types";
import { KnowledgeBrowser, type KnowledgeBrowserRef } from "./knowledge-browser";
import { EmbeddingsViewer } from "./embeddings-viewer";

// =============================================================================
// SETTINGS TYPES
// =============================================================================

type ThemeMode = "light" | "dark" | "system";

interface AppSettings {
  theme: ThemeMode;
  fontSize: "small" | "medium" | "large";
  sendWithEnter: boolean;
  showTimestamps: boolean;
}

// =============================================================================
// TYPES
// =============================================================================

interface ChatSidebarProps {
  conversations: ChatConversation[];
  activeConversationId: string | null;
  onSelectConversation: (id: string) => void;
  onNewChat: () => void;
  onRenameConversation: (id: string, title: string) => void;
  onDeleteConversation: (id: string) => void;
  onClearAll: () => void;
  isCollapsed: boolean;
  onToggleCollapse: () => void;
  knowledgeBrowserRef?: React.RefObject<KnowledgeBrowserRef | null>;
}

// =============================================================================
// UTILITIES
// =============================================================================

/**
 * Format timestamp for display
 */
function formatTimestamp(timestamp: number): string {
  const now = Date.now();
  const diff = now - timestamp;

  // Less than 1 minute
  if (diff < 60 * 1000) {
    return "Just now";
  }

  // Less than 1 hour
  if (diff < 60 * 60 * 1000) {
    const minutes = Math.floor(diff / (60 * 1000));
    return `${minutes}m ago`;
  }

  // Less than 24 hours
  if (diff < 24 * 60 * 60 * 1000) {
    const hours = Math.floor(diff / (60 * 60 * 1000));
    return `${hours}h ago`;
  }

  // Less than 7 days
  if (diff < 7 * 24 * 60 * 60 * 1000) {
    const days = Math.floor(diff / (24 * 60 * 60 * 1000));
    return `${days}d ago`;
  }

  // Show date
  return new Date(timestamp).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

/**
 * Group conversations by time period
 */
function groupConversations(
  conversations: ChatConversation[]
): Map<string, ChatConversation[]> {
  const now = Date.now();
  const groups = new Map<string, ChatConversation[]>();

  const dayMs = 24 * 60 * 60 * 1000;
  const weekMs = 7 * dayMs;
  const monthMs = 30 * dayMs;

  for (const conv of conversations) {
    const diff = now - conv.updatedAt;
    let group: string;

    if (diff < dayMs) {
      group = "Today";
    } else if (diff < 2 * dayMs) {
      group = "Yesterday";
    } else if (diff < weekMs) {
      group = "This Week";
    } else if (diff < monthMs) {
      group = "This Month";
    } else {
      group = "Older";
    }

    const existing = groups.get(group) || [];
    existing.push(conv);
    groups.set(group, existing);
  }

  return groups;
}

// =============================================================================
// SETTINGS PANEL
// =============================================================================

interface SettingsPanelProps {
  isOpen: boolean;
  onClose: () => void;
  onClearAll: () => void;
  hasConversations: boolean;
}

function SettingsPanel({
  isOpen,
  onClose,
  onClearAll,
  hasConversations,
}: SettingsPanelProps) {
  const [showClearConfirm, setShowClearConfirm] = useState(false);
  const [settings, setSettings] = useState<AppSettings>(() => {
    if (typeof window !== "undefined") {
      const stored = localStorage.getItem("app-settings");
      if (stored) {
        try {
          return JSON.parse(stored);
        } catch {
          // Fall through to defaults
        }
      }
    }
    return {
      theme: "system" as ThemeMode,
      fontSize: "medium" as const,
      sendWithEnter: true,
      showTimestamps: true,
    };
  });

  const panelRef = useRef<HTMLDivElement>(null);

  // Apply theme to document
  useEffect(() => {
    const applyTheme = (theme: ThemeMode) => {
      const root = document.documentElement;
      
      if (theme === "system") {
        const systemDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
        root.classList.toggle("dark", systemDark);
      } else {
        root.classList.toggle("dark", theme === "dark");
      }
    };

    applyTheme(settings.theme);

    // Listen for system theme changes when in system mode
    if (settings.theme === "system") {
      const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
      const handler = () => applyTheme("system");
      mediaQuery.addEventListener("change", handler);
      return () => mediaQuery.removeEventListener("change", handler);
    }
  }, [settings.theme]);

  // Persist settings
  useEffect(() => {
    if (typeof window !== "undefined") {
      localStorage.setItem("app-settings", JSON.stringify(settings));
    }
  }, [settings]);

  // Close on click outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (panelRef.current && !panelRef.current.contains(event.target as Node)) {
        onClose();
      }
    }

    if (isOpen) {
      // Delay to prevent immediate close from the click that opened it
      setTimeout(() => {
        document.addEventListener("mousedown", handleClickOutside);
      }, 0);
      return () => document.removeEventListener("mousedown", handleClickOutside);
    }
  }, [isOpen, onClose]);

  // Close on Escape
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        onClose();
      }
    }

    if (isOpen) {
      document.addEventListener("keydown", handleKeyDown);
      return () => document.removeEventListener("keydown", handleKeyDown);
    }
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const updateSetting = <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => {
    setSettings(prev => ({ ...prev, [key]: value }));
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div
        ref={panelRef}
        className="bg-white dark:bg-neutral-900 rounded-2xl shadow-2xl w-full max-w-md mx-4 max-h-[80vh] overflow-hidden flex flex-col neu-context-white"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 dark:border-neutral-700">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-neutral-500">Settings</h2>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-neutral-800 transition-colors"
          >
            <X className="w-5 h-5 text-gray-500 dark:text-neutral-500" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-6">
          {/* Appearance Section */}
          <div>
            <div className="flex items-center gap-2 mb-3">
              <Palette className="w-4 h-4 text-gray-500 dark:text-neutral-500" />
              <h3 className="text-sm font-medium text-gray-900 dark:text-neutral-500">Appearance</h3>
            </div>

            {/* Theme Toggle */}
            <div className="space-y-3">
              <label className="text-sm text-gray-600 dark:text-neutral-500">Theme</label>
              <div className="grid grid-cols-3 gap-2">
                <button
                  onClick={() => updateSetting("theme", "light")}
                  className={cn(
                    "flex flex-col items-center gap-2 p-3 rounded-xl border-2 transition-all",
                    settings.theme === "light"
                      ? "border-blue-500 bg-blue-50 dark:bg-neutral-800/50"
                      : "border-gray-200 dark:border-neutral-700 hover:border-gray-300 dark:hover:border-neutral-600"
                  )}
                >
                  <Sun className={cn(
                    "w-5 h-5",
                    settings.theme === "light" ? "text-blue-600" : "text-gray-500 dark:text-neutral-500"
                  )} />
                  <span className={cn(
                    "text-xs font-medium",
                    settings.theme === "light" ? "text-blue-600" : "text-gray-600 dark:text-neutral-500"
                  )}>Light</span>
                </button>
                <button
                  onClick={() => updateSetting("theme", "dark")}
                  className={cn(
                    "flex flex-col items-center gap-2 p-3 rounded-xl border-2 transition-all",
                    settings.theme === "dark"
                      ? "border-blue-500 bg-blue-50 dark:bg-neutral-800/50"
                      : "border-gray-200 dark:border-neutral-700 hover:border-gray-300 dark:hover:border-neutral-600"
                  )}
                >
                  <Moon className={cn(
                    "w-5 h-5",
                    settings.theme === "dark" ? "text-blue-600" : "text-gray-500 dark:text-neutral-500"
                  )} />
                  <span className={cn(
                    "text-xs font-medium",
                    settings.theme === "dark" ? "text-blue-600" : "text-gray-600 dark:text-neutral-500"
                  )}>Dark</span>
                </button>
                <button
                  onClick={() => updateSetting("theme", "system")}
                  className={cn(
                    "flex flex-col items-center gap-2 p-3 rounded-xl border-2 transition-all",
                    settings.theme === "system"
                      ? "border-blue-500 bg-blue-50 dark:bg-neutral-800/50"
                      : "border-gray-200 dark:border-neutral-700 hover:border-gray-300 dark:hover:border-neutral-600"
                  )}
                >
                  <Monitor className={cn(
                    "w-5 h-5",
                    settings.theme === "system" ? "text-blue-600" : "text-gray-500 dark:text-neutral-500"
                  )} />
                  <span className={cn(
                    "text-xs font-medium",
                    settings.theme === "system" ? "text-blue-600" : "text-gray-600 dark:text-neutral-500"
                  )}>System</span>
                </button>
              </div>
            </div>

            {/* Font Size */}
            <div className="mt-4 space-y-3">
              <label className="text-sm text-gray-600 dark:text-neutral-500">Font Size</label>
              <div className="flex gap-2">
                {(["small", "medium", "large"] as const).map((size) => (
                  <button
                    key={size}
                    onClick={() => updateSetting("fontSize", size)}
                    className={cn(
                      "flex-1 py-2 px-3 rounded-lg text-sm font-medium transition-all capitalize",
                      settings.fontSize === size
                        ? "bg-gray-900 text-white dark:bg-white dark:text-neutral-900"
                        : "bg-gray-100 text-gray-700 hover:bg-gray-200 dark:bg-neutral-800 dark:text-neutral-500 dark:hover:bg-neutral-700"
                    )}
                  >
                    {size}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Chat Settings Section */}
          <div>
            <div className="flex items-center gap-2 mb-3">
              <Bell className="w-4 h-4 text-gray-500 dark:text-neutral-500" />
              <h3 className="text-sm font-medium text-gray-900 dark:text-neutral-500">Chat Preferences</h3>
            </div>

            <div className="space-y-3">
              {/* Send with Enter */}
              <label className="flex items-center justify-between p-3 rounded-lg bg-gray-50 dark:bg-neutral-800 cursor-pointer hover:bg-gray-100 dark:hover:bg-neutral-700 transition-colors">
                <div>
                  <p className="text-sm font-medium text-gray-900 dark:text-neutral-500">Send with Enter</p>
                  <p className="text-xs text-gray-500 dark:text-neutral-500">Press Enter to send messages</p>
                </div>
                <div
                  onClick={() => updateSetting("sendWithEnter", !settings.sendWithEnter)}
                  className={cn(
                    "w-10 h-6 rounded-full transition-colors relative cursor-pointer",
                    settings.sendWithEnter ? "bg-blue-500" : "bg-gray-300 dark:bg-neutral-600"
                  )}
                >
                  <div
                    className={cn(
                      "absolute top-1 w-4 h-4 rounded-full bg-white shadow-sm transition-transform",
                      settings.sendWithEnter ? "translate-x-5" : "translate-x-1"
                    )}
                  />
                </div>
              </label>

              {/* Show Timestamps */}
              <label className="flex items-center justify-between p-3 rounded-lg bg-gray-50 dark:bg-neutral-800 cursor-pointer hover:bg-gray-100 dark:hover:bg-neutral-700 transition-colors">
                <div>
                  <p className="text-sm font-medium text-gray-900 dark:text-neutral-500">Show Timestamps</p>
                  <p className="text-xs text-gray-500 dark:text-neutral-500">Display time for each message</p>
                </div>
                <div
                  onClick={() => updateSetting("showTimestamps", !settings.showTimestamps)}
                  className={cn(
                    "w-10 h-6 rounded-full transition-colors relative cursor-pointer",
                    settings.showTimestamps ? "bg-blue-500" : "bg-gray-300 dark:bg-neutral-600"
                  )}
                >
                  <div
                    className={cn(
                      "absolute top-1 w-4 h-4 rounded-full bg-white shadow-sm transition-transform",
                      settings.showTimestamps ? "translate-x-5" : "translate-x-1"
                    )}
                  />
                </div>
              </label>
            </div>
          </div>

          {/* Danger Zone Section */}
          {hasConversations && (
            <div>
              <div className="flex items-center gap-2 mb-3">
                <Trash className="w-4 h-4 text-red-500" />
                <h3 className="text-sm font-medium text-gray-900 dark:text-neutral-500">Danger Zone</h3>
              </div>

              <div className="p-3 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800/50">
                {showClearConfirm ? (
                  <div className="space-y-3">
                    <p className="text-sm text-red-700 dark:text-red-400">
                      Are you sure you want to delete all conversations? This action cannot be undone.
                    </p>
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        variant="neumorphic-destructive"
                        className="flex-1"
                        onClick={() => {
                          onClearAll();
                          setShowClearConfirm(false);
                          onClose();
                        }}
                      >
                        Delete All
                      </Button>
                      <Button
                        size="sm"
                        variant="neumorphic-secondary"
                        className="flex-1"
                        onClick={() => setShowClearConfirm(false)}
                      >
                        Cancel
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm font-medium text-gray-900 dark:text-neutral-500">Clear All Chats</p>
                      <p className="text-xs text-gray-500 dark:text-neutral-500">Delete all conversation history</p>
                    </div>
                    <Button
                      size="sm"
                      variant="neumorphic-destructive"
                      onClick={() => setShowClearConfirm(true)}
                    >
                      Clear All
                    </Button>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* About Section */}
          <div>
            <div className="flex items-center gap-2 mb-3">
              <HelpCircle className="w-4 h-4 text-gray-500 dark:text-neutral-500" />
              <h3 className="text-sm font-medium text-gray-900 dark:text-neutral-500">About</h3>
            </div>

            <div className="p-3 rounded-lg bg-gray-50 dark:bg-neutral-800">
              <p className="text-sm font-medium text-gray-900 dark:text-neutral-500">Le Chat Noir</p>
              <p className="text-xs text-gray-500 dark:text-neutral-500 mt-1">Version 1.0.0</p>
              <p className="text-xs text-gray-500 dark:text-neutral-500 mt-2">
                An AI-powered chat application built with Next.js and the AI SDK.
              </p>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-gray-200 dark:border-neutral-700">
          <Button
            onClick={onClose}
            variant="neumorphic-primary"
            className="w-full"
          >
            Done
          </Button>
        </div>
      </div>
    </div>
  );
}

// =============================================================================
// CONVERSATION ITEM
// =============================================================================

interface ConversationItemProps {
  conversation: ChatConversation;
  isActive: boolean;
  onSelect: () => void;
  onRename: (title: string) => void;
  onDelete: () => void;
}

function ConversationItem({
  conversation,
  isActive,
  onSelect,
  onRename,
  onDelete,
}: ConversationItemProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [editTitle, setEditTitle] = useState(conversation.title);
  const [showMenu, setShowMenu] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  // Focus input when editing starts
  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [isEditing]);

  // Close menu when clicking outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setShowMenu(false);
      }
    }

    if (showMenu) {
      document.addEventListener("mousedown", handleClickOutside);
      return () =>
        document.removeEventListener("mousedown", handleClickOutside);
    }
  }, [showMenu]);

  const handleSaveEdit = useCallback(() => {
    const trimmedTitle = editTitle.trim();
    if (trimmedTitle && trimmedTitle !== conversation.title) {
      onRename(trimmedTitle);
    }
    setIsEditing(false);
  }, [editTitle, conversation.title, onRename]);

  const handleCancelEdit = useCallback(() => {
    setEditTitle(conversation.title);
    setIsEditing(false);
  }, [conversation.title]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter") {
        handleSaveEdit();
      } else if (e.key === "Escape") {
        handleCancelEdit();
      }
    },
    [handleSaveEdit, handleCancelEdit]
  );

  if (isEditing) {
    return (
      <div className="flex items-center gap-1 px-2 py-1.5">
        <Input
          ref={inputRef}
          value={editTitle}
          onChange={(e) => setEditTitle(e.target.value)}
          onKeyDown={handleKeyDown}
          onBlur={handleSaveEdit}
          className="h-7 text-sm flex-1"
        />
        <Button
          size="icon"
          variant="neumorphic-success"
          className="h-6 w-6 shrink-0"
          onClick={handleSaveEdit}
        >
          <Check className="h-3.5 w-3.5" />
        </Button>
        <Button
          size="icon"
          variant="neumorphic-secondary"
          className="h-6 w-6 shrink-0"
          onClick={handleCancelEdit}
        >
          <X className="h-3.5 w-3.5" />
        </Button>
      </div>
    );
  }

  return (
    <div
      className={cn(
        "group relative flex items-center gap-2 px-3 py-2 rounded-lg cursor-pointer transition-colors",
        isActive
          ? "bg-gray-100 dark:bg-neutral-800 text-gray-900 dark:text-neutral-500"
          : "hover:bg-gray-50 dark:hover:bg-neutral-800/50 text-gray-700 dark:text-neutral-500"
      )}
      onClick={onSelect}
    >
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium truncate">{conversation.title}</p>
        <p className="text-xs text-gray-500 dark:text-neutral-500">
          {formatTimestamp(conversation.updatedAt)}
        </p>
      </div>

      {/* Menu button */}
      <div className="relative" ref={menuRef}>
        <button
          onClick={(e) => {
            e.stopPropagation();
            setShowMenu(!showMenu);
          }}
          className={cn(
            "p-1 rounded hover:bg-gray-200 dark:hover:bg-neutral-700 transition-opacity",
            showMenu ? "opacity-100" : "opacity-0 group-hover:opacity-100"
          )}
        >
          <MoreHorizontal className="h-4 w-4 text-gray-500 dark:text-neutral-500" />
        </button>

        {/* Dropdown menu */}
        {showMenu && (
          <div className="absolute right-0 top-full mt-1 w-32 bg-white dark:bg-neutral-800 rounded-lg shadow-lg border border-gray-200 dark:border-neutral-700 py-1 z-10">
            <button
              onClick={(e) => {
                e.stopPropagation();
                setShowMenu(false);
                setIsEditing(true);
              }}
              className="w-full flex items-center gap-2 px-3 py-1.5 text-sm text-gray-700 dark:text-neutral-500 hover:bg-gray-50 dark:hover:bg-neutral-700 transition-colors"
            >
              <Pencil className="h-3.5 w-3.5" />
              Rename
            </button>
            <button
              onClick={(e) => {
                e.stopPropagation();
                setShowMenu(false);
                onDelete();
              }}
              className="w-full flex items-center gap-2 px-3 py-1.5 text-sm text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
            >
              <Trash2 className="h-3.5 w-3.5" />
              Delete
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// =============================================================================
// MAIN COMPONENT
// =============================================================================

const MIN_SIDEBAR_WIDTH = 256; // 16rem = w-64
const MAX_SIDEBAR_WIDTH = 800; // Max width when dragging

export function ChatSidebar({
  conversations,
  activeConversationId,
  onSelectConversation,
  onNewChat,
  onRenameConversation,
  onDeleteConversation,
  onClearAll,
  isCollapsed,
  onToggleCollapse,
  knowledgeBrowserRef,
}: ChatSidebarProps) {
  const [isMounted, setIsMounted] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [activeTab, setActiveTab] = useState<"chats" | "knowledge" | "embeddings">("chats");
  const [sidebarWidth, setSidebarWidth] = useState(MIN_SIDEBAR_WIDTH);
  const [isResizing, setIsResizing] = useState(false);
  const sidebarRef = useRef<HTMLDivElement>(null);

  // Handle resize drag
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setIsResizing(true);
  }, []);

  // Handle mouse move during resize
  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isResizing) return;
      
      const newWidth = e.clientX;
      if (newWidth >= MIN_SIDEBAR_WIDTH && newWidth <= MAX_SIDEBAR_WIDTH) {
        setSidebarWidth(newWidth);
      }
    };

    const handleMouseUp = () => {
      setIsResizing(false);
    };

    if (isResizing) {
      document.addEventListener("mousemove", handleMouseMove);
      document.addEventListener("mouseup", handleMouseUp);
      // Prevent text selection while dragging
      document.body.style.userSelect = "none";
      document.body.style.cursor = "ew-resize";
    }

    return () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
      document.body.style.userSelect = "";
      document.body.style.cursor = "";
    };
  }, [isResizing]);

  // Prevent hydration mismatch by only grouping after mount
  useEffect(() => {
    setIsMounted(true);
  }, []);

  const groupedConversations = isMounted ? groupConversations(conversations) : new Map<string, ChatConversation[]>();

  // Collapsed state - just show toggle button
  if (isCollapsed) {
    return (
      <div className="flex flex-col h-full w-12 border-r border-gray-200 dark:border-neutral-700 bg-gray-50/50 dark:bg-neutral-950 neu-context-gray">
        <div className="p-2">
          <Button
            size="icon"
            variant="neumorphic-secondary"
            onClick={onToggleCollapse}
            className="h-8 w-8"
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
        <div className="p-2">
          <Button
            size="icon"
            variant="neumorphic-primary"
            onClick={onNewChat}
            className="h-8 w-8"
            title="New Chat"
          >
            <MessageSquarePlus className="h-4 w-4" />
          </Button>
        </div>
        {/* Spacer to push settings to bottom */}
        <div className="flex-1" />
        {/* Settings Button */}
        <div className="p-2 border-t border-gray-200 dark:border-neutral-700">
          <Button
            size="icon"
            variant="neumorphic-secondary"
            className="h-8 w-8"
            title="Settings"
            onClick={() => setShowSettings(true)}
          >
            <Settings className="h-4 w-4" />
          </Button>
        </div>
        
        {/* Settings Panel */}
        <SettingsPanel
          isOpen={showSettings}
          onClose={() => setShowSettings(false)}
          onClearAll={onClearAll}
          hasConversations={conversations.length > 0}
        />
      </div>
    );
  }

  return (
    <div 
      ref={sidebarRef}
      className="flex flex-col h-full border-r border-gray-200 dark:border-neutral-700 bg-gray-50/50 dark:bg-neutral-950 neu-context-gray relative"
      style={{ width: sidebarWidth }}
    >
      {/* Resize Handle */}
      <div
        onMouseDown={handleMouseDown}
        className={cn(
          "absolute top-0 right-0 w-1 h-full cursor-ew-resize z-10 transition-colors",
          isResizing 
            ? "bg-blue-500" 
            : "bg-transparent hover:bg-gray-300 dark:hover:bg-neutral-600"
        )}
      />
      
      {/* Header with collapse button */}
      <div className="flex items-center justify-between p-3 border-b border-gray-200 dark:border-neutral-700 h-[52px] flex-shrink-0">
        <div className="flex items-center gap-2">
          <Button
            size="icon"
            variant="neumorphic-secondary"
            onClick={onToggleCollapse}
            className="h-7 w-7"
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
        </div>
        {/* Tab buttons */}
        <div className="flex items-center gap-1">
          <button
            onClick={() => setActiveTab("chats")}
            className={cn(
              "flex items-center gap-1.5 px-2 py-1.5 rounded-lg text-sm font-medium transition-colors",
              activeTab === "chats"
                ? "bg-gray-200 dark:bg-neutral-700 text-gray-900 dark:text-neutral-100"
                : "text-gray-500 dark:text-neutral-400 hover:bg-gray-100 dark:hover:bg-neutral-800"
            )}
            title="Chats"
          >
            <MessageCircle className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Chats</span>
          </button>
          <button
            onClick={() => setActiveTab("knowledge")}
            className={cn(
              "flex items-center gap-1.5 px-2 py-1.5 rounded-lg text-sm font-medium transition-colors",
              activeTab === "knowledge"
                ? "bg-gray-200 dark:bg-neutral-700 text-gray-900 dark:text-neutral-100"
                : "text-gray-500 dark:text-neutral-400 hover:bg-gray-100 dark:hover:bg-neutral-800"
            )}
            title="Knowledge Base"
          >
            <Brain className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">KB</span>
          </button>
          <button
            onClick={() => setActiveTab("embeddings")}
            className={cn(
              "flex items-center gap-1.5 px-2 py-1.5 rounded-lg text-sm font-medium transition-colors",
              activeTab === "embeddings"
                ? "bg-gray-200 dark:bg-neutral-700 text-gray-900 dark:text-neutral-100"
                : "text-gray-500 dark:text-neutral-400 hover:bg-gray-100 dark:hover:bg-neutral-800"
            )}
            title="Embedding Space Visualization"
          >
            <Sparkles className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Viz</span>
          </button>
        </div>
      </div>

      {activeTab === "chats" ? (
        <>
          {/* New Chat Button - Neumorphic Style */}
          <div className="p-3">
            <Button
              onClick={onNewChat}
              variant="neumorphic-primary"
              className="w-full justify-start gap-2"
            >
              <MessageSquarePlus className="h-4 w-4" />
              New Chat
            </Button>
          </div>

          {/* Conversation List */}
          <div className="flex-1 overflow-y-auto px-2 pb-2">
            {!isMounted ? (
              <div className="text-center py-8 text-gray-500 dark:text-neutral-500 text-sm">
                <p>Loading...</p>
              </div>
            ) : conversations.length === 0 ? (
              <div className="text-center py-8 text-gray-500 dark:text-neutral-500 text-sm">
                <p>No conversations yet</p>
                <p className="text-xs mt-1">Start a new chat to begin</p>
              </div>
            ) : (
              Array.from(groupedConversations.entries()).map(([group, convs]) => (
                <div key={group} className="mb-4">
                  <h3 className="text-xs font-medium text-gray-500 dark:text-neutral-500 uppercase tracking-wide px-2 mb-1">
                    {group}
                  </h3>
                  <div className="space-y-0.5">
                    {convs.map((conv) => (
                      <ConversationItem
                        key={conv.id}
                        conversation={conv}
                        isActive={conv.id === activeConversationId}
                        onSelect={() => onSelectConversation(conv.id)}
                        onRename={(title) => onRenameConversation(conv.id, title)}
                        onDelete={() => onDeleteConversation(conv.id)}
                      />
                    ))}
                  </div>
                </div>
              ))
            )}
          </div>
        </>
      ) : activeTab === "knowledge" ? (
        /* Knowledge Browser Tab */
        <KnowledgeBrowser ref={knowledgeBrowserRef} className="flex-1" />
      ) : (
        /* Embeddings Viewer Tab */
        <EmbeddingsViewer className="flex-1" />
      )}

      {/* Settings Button */}
      <div className="p-3 border-t border-gray-200 dark:border-neutral-700">
        <Button
          variant="neumorphic-secondary"
          className="w-full justify-start gap-2"
          onClick={() => setShowSettings(true)}
        >
          <Settings className="h-4 w-4" />
          Settings
        </Button>
      </div>
      
      {/* Settings Panel */}
      <SettingsPanel
        isOpen={showSettings}
        onClose={() => setShowSettings(false)}
        onClearAll={onClearAll}
        hasConversations={conversations.length > 0}
      />
    </div>
  );
}
