/**
 * Chat History Hook
 *
 * Manages chat conversations in localStorage with full CRUD operations.
 * Follows React best practices for state management and side effects.
 *
 * ARCHITECTURE:
 * - Uses IndexedDB for persistence (SSR-safe)
 * - Keeps a lightweight localStorage summary for fast sidebar loads
 * - Debounces writes to prevent excessive storage operations
 * - Provides optimistic updates for better UX
 */

import { useState, useEffect, useCallback, useRef } from "react";
import type { UIMessage } from "ai";
import type { ChatConversation, ChatHistoryState } from "@/lib/chat-types";
import {
  clearChatState,
  loadChatState,
  readSummaryFromStorage,
  saveChatState,
} from "@/lib/storage/chat-store";

// =============================================================================
// CONSTANTS
// =============================================================================

const DEBOUNCE_MS = 500;
const MAX_CONVERSATIONS = 50; // Limit to prevent localStorage overflow

// =============================================================================
// UTILITIES
// =============================================================================

/**
 * Generate a unique ID for conversations
 */
function generateId(): string {
  return `chat_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
}

/**
 * Generate a title from the first user message
 */
function generateTitle(messages: UIMessage[]): string {
  const firstUserMessage = messages.find((m) => m.role === "user");
  if (!firstUserMessage || !firstUserMessage.parts) {
    return "New Chat";
  }

  // Extract text from message parts
  const textParts = firstUserMessage.parts
    .filter((p) => p.type === "text")
    .map((p) => (p as { type: "text"; text: string }).text)
    .join(" ");

  if (!textParts) {
    return "New Chat";
  }

  // Truncate to reasonable length
  const maxLength = 50;
  if (textParts.length <= maxLength) {
    return textParts;
  }
  return textParts.substring(0, maxLength).trim() + "...";
}

// =============================================================================
// HOOK
// =============================================================================

export function useChatHistory() {
  const [state, setState] = useState<ChatHistoryState>(() =>
    readSummaryFromStorage()
  );
  const [isHydrated, setIsHydrated] = useState(false);
  const debounceTimerRef = useRef<NodeJS.Timeout | null>(null);
  const hasLocalEditsRef = useRef(false);

  // Load full history from IndexedDB on mount (with legacy migration)
  useEffect(() => {
    let cancelled = false;
    loadChatState()
      .then((loaded) => {
        if (cancelled) return;
        if (!hasLocalEditsRef.current) {
          setState(loaded);
        }
      })
      .catch((error) => {
        console.error("[ChatHistory] Failed to load from IndexedDB:", error);
      })
      .finally(() => {
        if (!cancelled) {
          setIsHydrated(true);
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  // Persist state to IndexedDB with debouncing
  useEffect(() => {
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }
    debounceTimerRef.current = setTimeout(() => {
      const limitedState = {
        ...state,
        conversations: state.conversations.slice(0, MAX_CONVERSATIONS),
      };
      saveChatState(limitedState).catch((error) => {
        console.error("[ChatHistory] Failed to save to IndexedDB:", error);
      });
    }, DEBOUNCE_MS);

    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
    };
  }, [state]);

  // ---------------------------------------------------------------------------
  // CONVERSATION MANAGEMENT
  // ---------------------------------------------------------------------------

  /**
   * Create a new conversation
   */
  const createConversation = useCallback((): string => {
    const id = generateId();
    const now = Date.now();

    hasLocalEditsRef.current = true;
    setState((prev) => ({
      conversations: [
        {
          id,
          title: "New Chat",
          messages: [],
          createdAt: now,
          updatedAt: now,
        },
        ...prev.conversations,
      ],
      activeConversationId: id,
    }));

    return id;
  }, []);

  /**
   * Set the active conversation
   */
  const setActiveConversation = useCallback((id: string | null) => {
    hasLocalEditsRef.current = true;
    setState((prev) => ({
      ...prev,
      activeConversationId: id,
    }));
  }, []);

  /**
   * Update messages for a conversation
   */
  const updateConversationMessages = useCallback(
    (id: string, messages: UIMessage[]) => {
      hasLocalEditsRef.current = true;
      setState((prev) => {
        const conversationIndex = prev.conversations.findIndex(
          (c) => c.id === id
        );

        if (conversationIndex === -1) {
          // Create a new conversation if it doesn't exist
          const now = Date.now();
          return {
            ...prev,
            conversations: [
              {
                id,
                title: generateTitle(messages),
                messages,
                createdAt: now,
                updatedAt: now,
              },
              ...prev.conversations,
            ],
            activeConversationId: id,
          };
        }

        const updatedConversations = [...prev.conversations];
        const conversation = updatedConversations[conversationIndex];

        updatedConversations[conversationIndex] = {
          ...conversation,
          messages,
          title:
            conversation.messages.length === 0
              ? generateTitle(messages)
              : conversation.title,
          updatedAt: Date.now(),
        };

        return {
          ...prev,
          conversations: updatedConversations,
        };
      });
    },
    []
  );

  /**
   * Rename a conversation (user-initiated)
   * Sets userRenamed flag to prevent AI from overwriting
   */
  const renameConversation = useCallback((id: string, title: string) => {
    hasLocalEditsRef.current = true;
    setState((prev) => ({
      ...prev,
      conversations: prev.conversations.map((c) =>
        c.id === id ? { ...c, title, userRenamed: true, updatedAt: Date.now() } : c
      ),
    }));
  }, []);

  /**
   * Update conversation title (AI-generated)
   * Only updates if userRenamed is false - respects user's custom titles
   */
  const updateConversationTitle = useCallback((id: string, title: string) => {
    hasLocalEditsRef.current = true;
    setState((prev) => ({
      ...prev,
      conversations: prev.conversations.map((c) =>
        c.id === id && !c.userRenamed 
          ? { ...c, title, updatedAt: Date.now() } 
          : c
      ),
    }));
  }, []);

  /**
   * Delete a conversation
   */
  const deleteConversation = useCallback((id: string) => {
    hasLocalEditsRef.current = true;
    setState((prev) => {
      const newConversations = prev.conversations.filter((c) => c.id !== id);
      return {
        conversations: newConversations,
        activeConversationId:
          prev.activeConversationId === id
            ? newConversations[0]?.id ?? null
            : prev.activeConversationId,
      };
    });
  }, []);

  /**
   * Clear all conversations
   */
  const clearAllConversations = useCallback(() => {
    hasLocalEditsRef.current = true;
    setState({
      conversations: [],
      activeConversationId: null,
    });
    clearChatState().catch((error) => {
      console.error("[ChatHistory] Failed to clear IndexedDB:", error);
    });
  }, []);

  /**
   * Get the active conversation
   */
  const activeConversation = state.conversations.find(
    (c) => c.id === state.activeConversationId
  );

  return {
    // State
    conversations: state.conversations,
    activeConversationId: state.activeConversationId,
    activeConversation,
    isHydrated,

    // Actions
    createConversation,
    setActiveConversation,
    updateConversationMessages,
    renameConversation,
    updateConversationTitle, // AI-generated title updates (respects userRenamed)
    deleteConversation,
    clearAllConversations,
  };
}

export type { ChatConversation, ChatHistoryState } from "@/lib/chat-types";
