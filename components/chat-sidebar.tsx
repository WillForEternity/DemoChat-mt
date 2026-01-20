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

import { useState, useCallback, useRef, useEffect, useImperativeHandle, forwardRef } from "react";
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
  Menu,
  User,
  Key,
  LogOut,
  CheckCircle,
  AlertTriangle,
  FileStack,
} from "lucide-react";
import { IoLogoGithub, IoLogoGoogle } from "react-icons/io5";
import { cn } from "@/lib/utils";
import type { ChatConversation } from "@/lib/chat-types";
import { KnowledgeBrowser, type KnowledgeBrowserRef } from "./knowledge-browser";
import { EmbeddingsViewer } from "./embeddings-viewer";
import { ChatEmbeddingsViewer } from "./chat-embeddings-viewer";
import { DocumentEmbeddingsViewer } from "./document-embeddings-viewer";
import { LargeDocumentBrowser } from "./large-document-browser";
import { KnowledgeGraphViewer } from "./knowledge-graph-viewer";
import { useSession, signIn, signOut } from "@/lib/auth-client";
import { getApiKeys, saveApiKeys, clearApiKeys, migrateAnonymousKeys, type StoredApiKeys } from "@/lib/api-keys";
import { getFreeChatsRemaining, getFreeChatLimit } from "@/lib/free-trial";

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

export type SidebarTab = "chats" | "knowledge" | "large-documents" | "embeddings";

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
  // Tab state controlled from parent
  activeTab: SidebarTab;
  onTabChange: (tab: SidebarTab) => void;
  // Auth & API settings
  isOwner?: boolean;
  onApiKeysChange?: (keys: StoredApiKeys) => void;
  forceOpenSettings?: boolean;
  onSettingsClosed?: () => void;
}

// Export type for ref handle
export interface ChatSidebarRef {
  openSettings: () => void;
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
  isOwner?: boolean;
  onApiKeysChange?: (keys: StoredApiKeys) => void;
}

function SettingsPanel({
  isOpen,
  onClose,
  onClearAll,
  hasConversations,
  isOwner: externalIsOwner,
  onApiKeysChange,
}: SettingsPanelProps) {
  const [showClearConfirm, setShowClearConfirm] = useState(false);
  const { data: session, isPending: isSessionPending } = useSession();
  
  // API keys state
  const [anthropicKey, setAnthropicKey] = useState("");
  const [openaiKey, setOpenaiKey] = useState("");
  const [keysSaved, setKeysSaved] = useState(false);
  
  // Get user info
  const isAuthenticated = Boolean(session?.user);
  const userId = session?.user?.id;
  const userEmail = session?.user?.email;
  const userName = session?.user?.name;
  const userImage = session?.user?.image;
  const isOwner = externalIsOwner ?? false;
  
  // Free trial info
  const freeChatsRemaining = getFreeChatsRemaining();
  const freeChatLimit = getFreeChatLimit();
  
  // Load saved keys on mount and when user changes
  useEffect(() => {
    const keys = getApiKeys(userId);
    setAnthropicKey(keys.anthropicApiKey || "");
    setOpenaiKey(keys.openaiApiKey || "");
  }, [userId, isOpen]);
  
  // Migrate anonymous keys when user logs in
  useEffect(() => {
    if (userId) {
      migrateAnonymousKeys(userId);
    }
  }, [userId]);
  
  // Handle save keys
  const handleSaveKeys = useCallback(() => {
    const keys: StoredApiKeys = {};
    if (anthropicKey.trim()) keys.anthropicApiKey = anthropicKey.trim();
    if (openaiKey.trim()) keys.openaiApiKey = openaiKey.trim();
    
    saveApiKeys(keys, userId);
    setKeysSaved(true);
    onApiKeysChange?.(keys);
    
    // Reset saved indicator after 2 seconds
    setTimeout(() => setKeysSaved(false), 2000);
  }, [anthropicKey, openaiKey, userId, onApiKeysChange]);
  
  // Handle clear keys
  const handleClearKeys = useCallback(() => {
    clearApiKeys(userId);
    setAnthropicKey("");
    setOpenaiKey("");
    onApiKeysChange?.({});
  }, [userId, onApiKeysChange]);
  
  // Handle sign in
  const handleSignIn = useCallback(async (provider: "github" | "google") => {
    await signIn.social({
      provider,
      callbackURL: window.location.href,
    });
  }, []);
  
  // Handle sign out
  const handleSignOut = useCallback(async () => {
    await signOut();
  }, []);

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
          {/* Account Section */}
          <div>
            <div className="flex items-center gap-2 mb-3">
              <User className="w-4 h-4 text-gray-500 dark:text-neutral-500" />
              <h3 className="text-sm font-medium text-gray-900 dark:text-neutral-500">Account</h3>
            </div>

            {isSessionPending ? (
              <div className="text-sm text-gray-500 dark:text-neutral-500">Loading...</div>
            ) : isAuthenticated ? (
              <div className="space-y-3">
                {/* User info */}
                <div className="flex items-center gap-3 p-3 bg-gray-50 dark:bg-neutral-800 rounded-lg">
                  {userImage && (
                    <img
                      src={userImage}
                      alt={userName || "User"}
                      className="h-10 w-10 rounded-full"
                    />
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="font-medium text-gray-900 dark:text-neutral-100 truncate">{userName}</div>
                    <div className="text-sm text-gray-500 dark:text-neutral-500 truncate">
                      {userEmail}
                    </div>
                  </div>
                  {isOwner && (
                    <div className="flex items-center gap-1 text-xs text-green-600 dark:text-green-400 bg-green-100 dark:bg-green-900/30 px-2 py-1 rounded-full">
                      <CheckCircle className="h-3 w-3" />
                      Owner
                    </div>
                  )}
                </div>

                {isOwner && (
                  <div className="text-sm text-gray-600 dark:text-neutral-400 bg-green-50 dark:bg-green-900/20 p-3 rounded-lg border border-green-200 dark:border-green-800/50">
                    <CheckCircle className="inline h-4 w-4 text-green-500 mr-1" />
                    You have owner access. API keys are provided automatically.
                  </div>
                )}

                <Button
                  variant="neumorphic-secondary"
                  className="w-full justify-center gap-2"
                  onClick={handleSignOut}
                >
                  <LogOut className="h-4 w-4" />
                  Sign Out
                </Button>
              </div>
            ) : (
              <div className="space-y-3">
                <p className="text-sm text-gray-500 dark:text-neutral-500">
                  Sign in to save your preferences and check owner status.
                </p>
                
                {/* Free trial indicator */}
                <div className="text-sm text-gray-600 dark:text-neutral-400 bg-blue-50 dark:bg-blue-900/20 p-3 rounded-lg border border-blue-200 dark:border-blue-800/50">
                  <span className="font-medium">{freeChatsRemaining}</span> of {freeChatLimit} free chats remaining
                </div>
                
                <Button
                  variant="neumorphic-secondary"
                  className="w-full justify-start gap-2"
                  onClick={() => handleSignIn("github")}
                >
                  <IoLogoGithub className="h-5 w-5" />
                  Continue with GitHub
                </Button>
                <Button
                  variant="neumorphic-secondary"
                  className="w-full justify-start gap-2"
                  onClick={() => handleSignIn("google")}
                >
                  <IoLogoGoogle className="h-5 w-5" />
                  Continue with Google
                </Button>
              </div>
            )}
          </div>

          {/* API Keys Section */}
          {!isOwner && (
            <div>
              <div className="flex items-center gap-2 mb-3">
                <Key className="w-4 h-4 text-gray-500 dark:text-neutral-500" />
                <h3 className="text-sm font-medium text-gray-900 dark:text-neutral-500">API Keys</h3>
              </div>

              <div className="text-sm text-gray-500 dark:text-neutral-500 mb-3 bg-amber-50 dark:bg-amber-900/20 p-3 rounded-lg border border-amber-200 dark:border-amber-800/50">
                <AlertTriangle className="inline h-4 w-4 text-amber-500 mr-1" />
                Enter your own API keys to use this app. Keys are stored locally
                in your browser and never sent to our servers.
              </div>

              <div className="space-y-3">
                <div>
                  <label className="text-sm font-medium text-gray-900 dark:text-neutral-300 mb-1.5 block">
                    Anthropic API Key
                  </label>
                  <Input
                    type="password"
                    placeholder="sk-ant-..."
                    value={anthropicKey}
                    onChange={(e) => setAnthropicKey(e.target.value)}
                    className="bg-white dark:bg-neutral-800"
                  />
                  <p className="text-xs text-gray-500 dark:text-neutral-500 mt-1">
                    Get your key at{" "}
                    <a
                      href="https://console.anthropic.com/settings/keys"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-blue-500 hover:underline"
                    >
                      console.anthropic.com
                    </a>
                  </p>
                </div>

                <div>
                  <label className="text-sm font-medium text-gray-900 dark:text-neutral-300 mb-1.5 block">
                    OpenAI API Key
                  </label>
                  <Input
                    type="password"
                    placeholder="sk-proj-..."
                    value={openaiKey}
                    onChange={(e) => setOpenaiKey(e.target.value)}
                    className="bg-white dark:bg-neutral-800"
                  />
                  <p className="text-xs text-gray-500 dark:text-neutral-500 mt-1">
                    Required for semantic search. Get your key at{" "}
                    <a
                      href="https://platform.openai.com/api-keys"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-blue-500 hover:underline"
                    >
                      platform.openai.com
                    </a>
                  </p>
                </div>

                <div className="flex gap-2 pt-2">
                  <Button
                    onClick={handleSaveKeys}
                    variant="neumorphic-primary"
                    className="flex-1"
                    disabled={!anthropicKey.trim() && !openaiKey.trim()}
                  >
                    {keysSaved ? (
                      <>
                        <CheckCircle className="h-4 w-4 mr-2" />
                        Saved!
                      </>
                    ) : (
                      "Save Keys"
                    )}
                  </Button>
                  <Button
                    variant="neumorphic-secondary"
                    onClick={handleClearKeys}
                    disabled={!anthropicKey && !openaiKey}
                  >
                    Clear
                  </Button>
                </div>
              </div>
            </div>
          )}

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

export const ChatSidebar = forwardRef<ChatSidebarRef, ChatSidebarProps>(function ChatSidebar({
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
  activeTab,
  onTabChange,
  isOwner,
  onApiKeysChange,
  forceOpenSettings,
  onSettingsClosed,
}, ref) {
  const [isMounted, setIsMounted] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  
  // Expose openSettings method via ref
  useImperativeHandle(ref, () => ({
    openSettings: () => setShowSettings(true),
  }), []);
  
  // Handle forceOpenSettings prop
  useEffect(() => {
    if (forceOpenSettings) {
      setShowSettings(true);
    }
  }, [forceOpenSettings]);
  
  // Handle settings close
  const handleSettingsClose = useCallback(() => {
    setShowSettings(false);
    onSettingsClosed?.();
  }, [onSettingsClosed]);
  const [embeddingsSubTab, setEmbeddingsSubTab] = useState<"kb" | "chats" | "docs" | "graph">("kb");
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
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

  // Close hamburger menu when clicking outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setIsMenuOpen(false);
      }
    }

    if (isMenuOpen) {
      document.addEventListener("mousedown", handleClickOutside);
      return () => document.removeEventListener("mousedown", handleClickOutside);
    }
  }, [isMenuOpen]);

  // Close hamburger menu on Escape key
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape" && isMenuOpen) {
        setIsMenuOpen(false);
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [isMenuOpen]);

  // Prevent hydration mismatch by only grouping after mount
  useEffect(() => {
    setIsMounted(true);
  }, []);

  const groupedConversations = isMounted ? groupConversations(conversations) : new Map<string, ChatConversation[]>();

  // Collapsed state - just show toggle button
  if (isCollapsed) {
    return (
      <div className="flex flex-col h-full w-14 border-r border-gray-200 dark:border-neutral-700 bg-gray-50/50 dark:bg-neutral-950 neu-context-gray">
        {/* Expand button in header position */}
        <div className="flex items-center justify-center h-[48px] flex-shrink-0">
          <Button
            size="icon"
            variant="neumorphic-secondary"
            onClick={onToggleCollapse}
            className="h-9 w-9"
            title="Expand Sidebar"
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
        {/* New Chat button - aligned with expanded view */}
        <div className="p-3 flex justify-center">
          <Button
            size="icon"
            variant="neumorphic-primary"
            onClick={onNewChat}
            className="h-9 w-9"
            title="New Chat"
          >
            <MessageSquarePlus className="h-4 w-4" />
          </Button>
        </div>
        {/* Spacer to push settings to bottom */}
        <div className="flex-1" />
        {/* Settings Button */}
        <div className="p-2 border-t border-gray-200 dark:border-neutral-700 flex justify-center">
          <Button
            size="icon"
            variant="neumorphic-secondary"
            className="h-9 w-9"
            title="Settings"
            onClick={() => setShowSettings(true)}
          >
            <Settings className="h-4 w-4" />
          </Button>
        </div>
        
        {/* Settings Panel */}
        <SettingsPanel
          isOpen={showSettings}
          onClose={handleSettingsClose}
          onClearAll={onClearAll}
          hasConversations={conversations.length > 0}
          isOwner={isOwner}
          onApiKeysChange={onApiKeysChange}
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
      
      {/* Header with collapse button and hamburger menu */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-gray-200 dark:border-neutral-700 h-[48px] flex-shrink-0">
        <div className="flex items-center gap-2">
          <Button
            size="icon"
            variant="neumorphic-secondary"
            onClick={onToggleCollapse}
            className="h-9 w-9"
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
        </div>
        
        {/* Hamburger Menu Button with beautiful UI effects */}
        <div ref={menuRef} className="relative">
          <button
            onClick={() => setIsMenuOpen(!isMenuOpen)}
            className={cn(
              "relative w-9 h-9 rounded-xl flex items-center justify-center transition-all duration-300",
              // Neumorphic styling
              "bg-gray-50 dark:bg-neutral-950",
              isMenuOpen
                ? "shadow-[inset_3px_3px_6px_rgba(0,0,0,0.1),inset_-3px_-3px_6px_rgba(255,255,255,0.9)] dark:shadow-[inset_3px_3px_6px_rgba(0,0,0,0.5),inset_-3px_-3px_6px_rgba(255,255,255,0.04)]"
                : "shadow-[3px_3px_6px_rgba(0,0,0,0.08),-3px_-3px_6px_rgba(255,255,255,0.8)] dark:shadow-[3px_3px_6px_rgba(0,0,0,0.4),-3px_-3px_6px_rgba(255,255,255,0.03)]",
              // Hover effects
              "hover:shadow-[4px_4px_8px_rgba(0,0,0,0.1),-4px_-4px_8px_rgba(255,255,255,0.9)]",
              "dark:hover:shadow-[4px_4px_8px_rgba(0,0,0,0.5),-4px_-4px_8px_rgba(255,255,255,0.04)]",
              // Active state
              "active:shadow-[inset_4px_4px_8px_rgba(0,0,0,0.12),inset_-4px_-4px_8px_rgba(255,255,255,0.7)]",
              "dark:active:shadow-[inset_4px_4px_8px_rgba(0,0,0,0.6),inset_-4px_-4px_8px_rgba(255,255,255,0.02)]"
            )}
            title="Toggle navigation menu"
          >
            {/* Animated hamburger icon */}
            <div className="relative w-3.5 h-3.5 flex flex-col justify-center items-center">
              <span 
                className={cn(
                  "absolute w-3.5 h-0.5 rounded-full bg-gray-600 dark:bg-neutral-400 transition-all duration-300 ease-out",
                  isMenuOpen ? "rotate-45 translate-y-0" : "-translate-y-1"
                )}
              />
              <span 
                className={cn(
                  "absolute w-3.5 h-0.5 rounded-full bg-gray-600 dark:bg-neutral-400 transition-all duration-300 ease-out",
                  isMenuOpen ? "opacity-0 scale-x-0" : "opacity-100 scale-x-100"
                )}
              />
              <span 
                className={cn(
                  "absolute w-3.5 h-0.5 rounded-full bg-gray-600 dark:bg-neutral-400 transition-all duration-300 ease-out",
                  isMenuOpen ? "-rotate-45 translate-y-0" : "translate-y-1"
                )}
              />
            </div>
          </button>

          {/* Dropdown Menu with beautiful animations */}
          <div
            className={cn(
              "absolute right-0 top-full mt-2 w-56 origin-top-right transition-all duration-300 ease-out z-50",
              isMenuOpen
                ? "opacity-100 scale-100 translate-y-0"
                : "opacity-0 scale-95 -translate-y-2 pointer-events-none"
            )}
          >
            <div 
              className={cn(
                "rounded-2xl overflow-hidden",
                // Neumorphic card styling
                "bg-white dark:bg-neutral-900",
                "shadow-[8px_8px_20px_rgba(0,0,0,0.1),-8px_-8px_20px_rgba(255,255,255,0.9)]",
                "dark:shadow-[8px_8px_20px_rgba(0,0,0,0.5),-8px_-8px_20px_rgba(255,255,255,0.03)]",
                "border border-gray-100 dark:border-neutral-800"
              )}
            >
              {/* Menu header */}
              <div className="px-4 py-3 border-b border-gray-100 dark:border-neutral-800">
                <p className="text-xs font-medium text-gray-400 dark:text-neutral-500 uppercase tracking-wider">
                  Navigation
                </p>
              </div>

              {/* Menu items */}
              <div className="py-2 px-2">
                {/* Chats */}
                <button
                  onClick={() => {
                    onTabChange("chats");
                    setIsMenuOpen(false);
                  }}
                  className={cn(
                    "w-full flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all duration-200",
                    activeTab === "chats"
                      ? "bg-gray-100 dark:bg-neutral-800 shadow-[inset_2px_2px_4px_rgba(0,0,0,0.05),inset_-2px_-2px_4px_rgba(255,255,255,0.8)] dark:shadow-[inset_2px_2px_4px_rgba(0,0,0,0.3),inset_-2px_-2px_4px_rgba(255,255,255,0.02)]"
                      : "hover:bg-gray-50 dark:hover:bg-neutral-800/50"
                  )}
                >
                  <div className={cn(
                    "w-8 h-8 rounded-lg flex items-center justify-center transition-all duration-200",
                    activeTab === "chats"
                      ? "bg-blue-500 text-white shadow-lg shadow-blue-500/30"
                      : "bg-gray-100 dark:bg-neutral-800 text-gray-500 dark:text-neutral-400"
                  )}>
                    <MessageCircle className="w-4 h-4" />
                  </div>
                  <div className="flex-1 text-left">
                    <p className={cn(
                      "text-sm font-medium",
                      activeTab === "chats"
                        ? "text-gray-900 dark:text-neutral-100"
                        : "text-gray-700 dark:text-neutral-300"
                    )}>
                      Chats
                    </p>
                    <p className="text-xs text-gray-400 dark:text-neutral-500">
                      Conversation history
                    </p>
                  </div>
                  {activeTab === "chats" && (
                    <div className="w-2 h-2 rounded-full bg-blue-500 animate-pulse" />
                  )}
                </button>

                {/* Knowledge Base */}
                <button
                  onClick={() => {
                    onTabChange("knowledge");
                    setIsMenuOpen(false);
                  }}
                  className={cn(
                    "w-full flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all duration-200 mt-1",
                    activeTab === "knowledge"
                      ? "bg-gray-100 dark:bg-neutral-800 shadow-[inset_2px_2px_4px_rgba(0,0,0,0.05),inset_-2px_-2px_4px_rgba(255,255,255,0.8)] dark:shadow-[inset_2px_2px_4px_rgba(0,0,0,0.3),inset_-2px_-2px_4px_rgba(255,255,255,0.02)]"
                      : "hover:bg-gray-50 dark:hover:bg-neutral-800/50"
                  )}
                >
                  <div className={cn(
                    "w-8 h-8 rounded-lg flex items-center justify-center transition-all duration-200",
                    activeTab === "knowledge"
                      ? "bg-purple-500 text-white shadow-lg shadow-purple-500/30"
                      : "bg-gray-100 dark:bg-neutral-800 text-gray-500 dark:text-neutral-400"
                  )}>
                    <Brain className="w-4 h-4" />
                  </div>
                  <div className="flex-1 text-left">
                    <p className={cn(
                      "text-sm font-medium",
                      activeTab === "knowledge"
                        ? "text-gray-900 dark:text-neutral-100"
                        : "text-gray-700 dark:text-neutral-300"
                    )}>
                      Knowledge Base
                    </p>
                    <p className="text-xs text-gray-400 dark:text-neutral-500">
                      Persistent memory
                    </p>
                  </div>
                  {activeTab === "knowledge" && (
                    <div className="w-2 h-2 rounded-full bg-purple-500 animate-pulse" />
                  )}
                </button>

                {/* Large Documents */}
                <button
                  onClick={() => {
                    onTabChange("large-documents");
                    setIsMenuOpen(false);
                  }}
                  className={cn(
                    "w-full flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all duration-200 mt-1",
                    activeTab === "large-documents"
                      ? "bg-gray-100 dark:bg-neutral-800 shadow-[inset_2px_2px_4px_rgba(0,0,0,0.05),inset_-2px_-2px_4px_rgba(255,255,255,0.8)] dark:shadow-[inset_2px_2px_4px_rgba(0,0,0,0.3),inset_-2px_-2px_4px_rgba(255,255,255,0.02)]"
                      : "hover:bg-gray-50 dark:hover:bg-neutral-800/50"
                  )}
                >
                  <div className={cn(
                    "w-8 h-8 rounded-lg flex items-center justify-center transition-all duration-200",
                    activeTab === "large-documents"
                      ? "bg-emerald-500 text-white shadow-lg shadow-emerald-500/30"
                      : "bg-gray-100 dark:bg-neutral-800 text-gray-500 dark:text-neutral-400"
                  )}>
                    <FileStack className="w-4 h-4" />
                  </div>
                  <div className="flex-1 text-left">
                    <p className={cn(
                      "text-sm font-medium",
                      activeTab === "large-documents"
                        ? "text-gray-900 dark:text-neutral-100"
                        : "text-gray-700 dark:text-neutral-300"
                    )}>
                      Large Documents
                    </p>
                    <p className="text-xs text-gray-400 dark:text-neutral-500">
                      RAG document search
                    </p>
                  </div>
                  {activeTab === "large-documents" && (
                    <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                  )}
                </button>

                {/* Visualization */}
                <button
                  onClick={() => {
                    onTabChange("embeddings");
                    setIsMenuOpen(false);
                  }}
                  className={cn(
                    "w-full flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all duration-200 mt-1",
                    activeTab === "embeddings"
                      ? "bg-gray-100 dark:bg-neutral-800 shadow-[inset_2px_2px_4px_rgba(0,0,0,0.05),inset_-2px_-2px_4px_rgba(255,255,255,0.8)] dark:shadow-[inset_2px_2px_4px_rgba(0,0,0,0.3),inset_-2px_-2px_4px_rgba(255,255,255,0.02)]"
                      : "hover:bg-gray-50 dark:hover:bg-neutral-800/50"
                  )}
                >
                  <div className={cn(
                    "w-8 h-8 rounded-lg flex items-center justify-center transition-all duration-200",
                    activeTab === "embeddings"
                      ? "bg-amber-500 text-white shadow-lg shadow-amber-500/30"
                      : "bg-gray-100 dark:bg-neutral-800 text-gray-500 dark:text-neutral-400"
                  )}>
                    <Sparkles className="w-4 h-4" />
                  </div>
                  <div className="flex-1 text-left">
                    <p className={cn(
                      "text-sm font-medium",
                      activeTab === "embeddings"
                        ? "text-gray-900 dark:text-neutral-100"
                        : "text-gray-700 dark:text-neutral-300"
                    )}>
                      Visualization
                    </p>
                    <p className="text-xs text-gray-400 dark:text-neutral-500">
                      Embedding space
                    </p>
                  </div>
                  {activeTab === "embeddings" && (
                    <div className="w-2 h-2 rounded-full bg-amber-500 animate-pulse" />
                  )}
                </button>
              </div>

              {/* Footer with subtle hint */}
              <div className="px-4 py-2 border-t border-gray-100 dark:border-neutral-800 bg-gray-50/50 dark:bg-neutral-900/50">
                <p className="text-[10px] text-gray-400 dark:text-neutral-600 text-center">
                  Press <kbd className="px-1 py-0.5 rounded bg-gray-200 dark:bg-neutral-700 text-gray-600 dark:text-neutral-400">Esc</kbd> to close
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>

      {activeTab === "chats" ? (
        <>
          {/* New Chat Button - Neumorphic Style */}
          <div className="p-3">
            <Button
              onClick={onNewChat}
              variant="neumorphic-primary"
              size="lg"
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
      ) : activeTab === "large-documents" ? (
        /* Large Documents Tab */
        <LargeDocumentBrowser className="flex-1" />
      ) : (
        /* Embeddings Viewer Tab with KB/Chats/Docs subtabs */
        <div className="flex flex-col flex-1 overflow-hidden">
          {/* Sub-tab toggle */}
          <div className="px-3 py-2 border-b border-gray-200 dark:border-neutral-700 bg-gray-50/50 dark:bg-neutral-900/50 flex-shrink-0">
            <div className="flex items-center gap-1 bg-gray-100 dark:bg-neutral-800 rounded-lg p-0.5">
              <button
                onClick={() => setEmbeddingsSubTab("kb")}
                className={cn(
                  "flex-1 px-2 py-1.5 rounded-md text-xs font-medium transition-all",
                  embeddingsSubTab === "kb"
                    ? "bg-white dark:bg-neutral-700 text-gray-900 dark:text-neutral-100 shadow-sm"
                    : "text-gray-500 dark:text-neutral-400 hover:text-gray-700 dark:hover:text-neutral-300"
                )}
              >
                KB
              </button>
              <button
                onClick={() => setEmbeddingsSubTab("chats")}
                className={cn(
                  "flex-1 px-2 py-1.5 rounded-md text-xs font-medium transition-all",
                  embeddingsSubTab === "chats"
                    ? "bg-white dark:bg-neutral-700 text-gray-900 dark:text-neutral-100 shadow-sm"
                    : "text-gray-500 dark:text-neutral-400 hover:text-gray-700 dark:hover:text-neutral-300"
                )}
              >
                Chats
              </button>
              <button
                onClick={() => setEmbeddingsSubTab("docs")}
                className={cn(
                  "flex-1 px-2 py-1.5 rounded-md text-xs font-medium transition-all",
                  embeddingsSubTab === "docs"
                    ? "bg-white dark:bg-neutral-700 text-gray-900 dark:text-neutral-100 shadow-sm"
                    : "text-gray-500 dark:text-neutral-400 hover:text-gray-700 dark:hover:text-neutral-300"
                )}
              >
                Docs
              </button>
              <button
                onClick={() => setEmbeddingsSubTab("graph")}
                className={cn(
                  "flex-1 px-2 py-1.5 rounded-md text-xs font-medium transition-all",
                  embeddingsSubTab === "graph"
                    ? "bg-white dark:bg-neutral-700 text-gray-900 dark:text-neutral-100 shadow-sm"
                    : "text-gray-500 dark:text-neutral-400 hover:text-gray-700 dark:hover:text-neutral-300"
                )}
              >
                Graph
              </button>
            </div>
          </div>
          {/* Viewer based on selected sub-tab */}
          {embeddingsSubTab === "kb" ? (
            <EmbeddingsViewer className="flex-1" />
          ) : embeddingsSubTab === "chats" ? (
            <ChatEmbeddingsViewer className="flex-1" />
          ) : embeddingsSubTab === "docs" ? (
            <DocumentEmbeddingsViewer className="flex-1" />
          ) : (
            <KnowledgeGraphViewer className="flex-1" />
          )}
        </div>
      )}

      {/* Settings Button */}
      <div className="p-3 border-t border-gray-200 dark:border-neutral-700">
        <Button
          variant="neumorphic-secondary"
          size="lg"
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
        onClose={handleSettingsClose}
        onClearAll={onClearAll}
        hasConversations={conversations.length > 0}
        isOwner={isOwner}
        onApiKeysChange={onApiKeysChange}
      />
    </div>
  );
});
