"use client";

/**
 * Main Chat Page
 *
 * Integrates the chat interface with the sidebar for conversation management.
 * Uses localStorage for persistence via the useChatHistory hook.
 *
 * ARCHITECTURE:
 * - ChatSidebar: Shows past conversations and Knowledge Base browser
 * - Chat: The main chat interface with message editing support
 * - useChatHistory: Manages state and localStorage persistence
 * - Knowledge Filesystem: Claude's persistent memory stored in IndexedDB
 *
 * PARALLEL CHAT SUPPORT:
 * To support parallel chats (where user can start a new chat while another is streaming),
 * we keep multiple Chat instances mounted but hidden. This ensures:
 * - Streaming responses continue even when user switches to a different chat
 * - Each chat's state is preserved when navigating between them
 * - Completed chats are cleaned up when no longer active
 */

import { useCallback, useEffect, useRef, useState } from "react";
import Chat from "@/components/ai-chat";
import { ChatSidebar, type SidebarTab, type ChatSidebarRef } from "@/components/chat-sidebar";
import { useChatHistory } from "@/lib/use-chat-history";
import { useSession } from "@/lib/auth-client";
import { getApiKeys, type StoredApiKeys } from "@/lib/api-keys";
import type { UIMessage } from "ai";
import type { KnowledgeBrowserRef } from "@/components/knowledge-browser";

// Represents an active chat session that should stay mounted
interface ActiveChatSession {
  chatId: string;
  conversationId: string | null;
  initialMessages: UIMessage[];
  isStreaming: boolean;
}

export default function Home() {
  // Chat history state and actions from our custom hook
  const {
    conversations,
    activeConversationId,
    activeConversation,
    isHydrated,
    createConversation,
    setActiveConversation,
    updateConversationMessages,
    renameConversation,
    updateConversationTitle, // AI-generated title updates
    deleteConversation,
    clearAllConversations,
  } = useChatHistory();

  // Sidebar collapse state (persisted to localStorage)
  // Default to collapsed (closed) - user preference will override on mount
  const [sidebarCollapsed, setSidebarCollapsed] = useState(true);
  
  // Sidebar tab state - controlled from here and the hamburger menu
  const [sidebarTab, setSidebarTab] = useState<SidebarTab>("chats");
  
  // Sidebar ref for opening settings programmatically
  const sidebarRef = useRef<ChatSidebarRef>(null);
  
  // Force open settings state (when free trial exhausted)
  const [forceOpenSettings, setForceOpenSettings] = useState(false);
  
  // Auth session and owner check
  const { data: session } = useSession();
  const userId = session?.user?.id;
  
  // API keys state
  const [apiKeys, setApiKeys] = useState<StoredApiKeys>({});
  
  // Load API keys when user changes
  useEffect(() => {
    const keys = getApiKeys(userId);
    setApiKeys(keys);
  }, [userId]);
  
  // Check owner status - would need to be fetched from server in production
  // For now, we'll pass undefined and let the server determine
  const [isOwner, setIsOwner] = useState(false);
  
  // Fetch owner status from server
  useEffect(() => {
    if (session?.user?.email) {
      // We need to check with the server if this user is an owner
      // This is done via the auth context on API calls
      // For the UI, we'll make a simple check endpoint
      fetch("/api/auth/check-owner")
        .then(res => res.json())
        .then(data => setIsOwner(data.isOwner ?? false))
        .catch(() => setIsOwner(false));
    } else {
      setIsOwner(false);
    }
  }, [session?.user?.email]);
  
  // Handle request to open settings (e.g., from free trial exhausted)
  const handleRequestSettings = useCallback(() => {
    setForceOpenSettings(true);
    sidebarRef.current?.openSettings();
  }, []);
  
  // Handle settings closed
  const handleSettingsClosed = useCallback(() => {
    setForceOpenSettings(false);
  }, []);
  
  // Handle API keys change
  const handleApiKeysChange = useCallback((keys: StoredApiKeys) => {
    setApiKeys(keys);
  }, []);

  // Track all active chat sessions (keeps streaming chats alive when switching)
  const [activeSessions, setActiveSessions] = useState<ActiveChatSession[]>([]);
  
  // The currently visible chat session ID
  const [visibleChatId, setVisibleChatId] = useState<string>("new");
  
  // Map from chatId to conversationId (for chats that haven't been persisted yet)
  const chatToConversationRef = useRef<Map<string, string>>(new Map());

  // Ref for the Knowledge Browser so we can refresh it when Claude modifies the KB
  const knowledgeBrowserRef = useRef<KnowledgeBrowserRef>(null);

  // Callback to refresh the Knowledge Browser when Claude makes changes
  const handleKnowledgeChange = useCallback(() => {
    knowledgeBrowserRef.current?.refresh();
  }, []);

  // Load sidebar state from localStorage on mount
  useEffect(() => {
    if (typeof window !== "undefined") {
      const stored = localStorage.getItem("sidebar-collapsed");
      if (stored !== null) {
        setSidebarCollapsed(JSON.parse(stored));
      }
    }
  }, []);

  // Initialize with a default session or restore from localStorage
  // This only runs once on mount - we use a ref to track initialization
  const isInitializedRef = useRef(false);
  useEffect(() => {
    if (!isInitializedRef.current && isHydrated) {
      isInitializedRef.current = true;
      const initialChatId = activeConversationId ?? "new";
      setActiveSessions([
        {
          chatId: initialChatId,
          conversationId: activeConversationId,
          initialMessages: activeConversation?.messages ?? [],
          isStreaming: false,
        },
      ]);
      setVisibleChatId(initialChatId);
      if (activeConversationId) {
        chatToConversationRef.current.set(initialChatId, activeConversationId);
      }
    }
  }, [activeConversationId, activeConversation?.messages, isHydrated]);

  // Persist sidebar state
  const handleToggleSidebar = useCallback(() => {
    setSidebarCollapsed((prev) => {
      const newValue = !prev;
      if (typeof window !== "undefined") {
        localStorage.setItem("sidebar-collapsed", JSON.stringify(newValue));
      }
      return newValue;
    });
  }, []);

  // Handle creating a new chat (user-initiated)
  const handleNewChat = useCallback(() => {
    const newChatId = `new-${Date.now()}`;
    
    // Add a new session, keeping existing streaming sessions alive
    setActiveSessions(prev => {
      // Keep sessions that are streaming, remove idle non-visible sessions
      const sessionsToKeep = prev.filter(s => s.isStreaming || s.chatId === visibleChatId);
      return [...sessionsToKeep, {
        chatId: newChatId,
        conversationId: null,
        initialMessages: [],
        isStreaming: false,
      }];
    });
    
    setVisibleChatId(newChatId);
    setActiveConversation(null);
  }, [setActiveConversation, visibleChatId]);

  // Handle selecting a conversation (user-initiated)
  const handleSelectConversation = useCallback(
    (id: string) => {
      // Check if we already have a session for this conversation
      const existingSession = activeSessions.find(s => 
        s.conversationId === id || chatToConversationRef.current.get(s.chatId) === id
      );
      
      if (existingSession) {
        // Switch to existing session
        setVisibleChatId(existingSession.chatId);
      } else {
        // Create a new session for this conversation
        const conversation = conversations.find(c => c.id === id);
        const newSession: ActiveChatSession = {
          chatId: id, // Use conversation ID as chat ID for existing conversations
          conversationId: id,
          initialMessages: conversation?.messages ?? [],
          isStreaming: false,
        };
        
        setActiveSessions(prev => {
          // Keep streaming sessions, remove idle non-visible sessions
          const sessionsToKeep = prev.filter(s => s.isStreaming || s.chatId === visibleChatId);
          return [...sessionsToKeep, newSession];
        });
        
        chatToConversationRef.current.set(id, id);
        setVisibleChatId(id);
      }
      
      setActiveConversation(id);
    },
    [activeSessions, conversations, setActiveConversation, visibleChatId]
  );

  // Ref to track the current visible chat ID for use in callbacks
  const visibleChatIdRef = useRef(visibleChatId);
  useEffect(() => {
    visibleChatIdRef.current = visibleChatId;
  }, [visibleChatId]);

  // Handle conversation deletion - reset UI when active conversation is deleted
  // This tracks the conversation IDs and detects when one is removed
  const prevConversationIdsRef = useRef<Set<string>>(new Set(conversations.map(c => c.id)));
  useEffect(() => {
    const currentIds = new Set(conversations.map(c => c.id));
    const prevIds = prevConversationIdsRef.current;
    
    // Find deleted conversation IDs
    const deletedIds = [...prevIds].filter(id => !currentIds.has(id));
    
    if (deletedIds.length > 0) {
      // Check if the currently visible chat was deleted
      const visibleConvId = chatToConversationRef.current.get(visibleChatId) ?? visibleChatId;
      const wasVisibleDeleted = deletedIds.includes(visibleConvId);
      
      if (wasVisibleDeleted) {
        // Clean up the deleted session from activeSessions
        // and create a fresh session for the new active conversation (or empty state)
        if (activeConversationId && currentIds.has(activeConversationId)) {
          // There's another conversation to show - switch to it
          const conversation = conversations.find(c => c.id === activeConversationId);
          const newSession: ActiveChatSession = {
            chatId: activeConversationId,
            conversationId: activeConversationId,
            initialMessages: conversation?.messages ?? [],
            isStreaming: false,
          };
          
          setActiveSessions(prev => {
            // Remove the deleted session and add the new one
            const filtered = prev.filter(s => {
              const convId = chatToConversationRef.current.get(s.chatId) ?? s.chatId;
              return !deletedIds.includes(convId) && s.isStreaming;
            });
            return [...filtered, newSession];
          });
          
          chatToConversationRef.current.set(activeConversationId, activeConversationId);
          setVisibleChatId(activeConversationId);
        } else {
          // No conversations left - reset to empty state
          const newChatId = `new-${Date.now()}`;
          setActiveSessions([{
            chatId: newChatId,
            conversationId: null,
            initialMessages: [],
            isStreaming: false,
          }]);
          setVisibleChatId(newChatId);
        }
        
        // Clean up callback cache for deleted sessions
        deletedIds.forEach(id => {
          callbackCacheRef.current.delete(id);
        });
      }
    }
    
    prevConversationIdsRef.current = currentIds;
  }, [conversations, visibleChatId, activeConversationId]);

  // Refs for stable callback access (avoid stale closures)
  const createConversationRef = useRef(createConversation);
  const updateConversationMessagesRef = useRef(updateConversationMessages);
  const updateConversationTitleRef = useRef(updateConversationTitle);
  useEffect(() => {
    createConversationRef.current = createConversation;
    updateConversationMessagesRef.current = updateConversationMessages;
    updateConversationTitleRef.current = updateConversationTitle;
  }, [createConversation, updateConversationMessages, updateConversationTitle]);

  // Stable callback cache - persists across renders
  // We use a ref to store callbacks so they maintain referential equality
  const callbackCacheRef = useRef<Map<string, {
    onMessagesChange: (messages: UIMessage[]) => void;
    onStreamingChange: (isStreaming: boolean) => void;
    onKnowledgeChange: () => void;
    onTitleChange: (title: string) => void;
  }>>(new Map());

  // Get or create stable callbacks for a session
  const getSessionCallbacks = useCallback((chatId: string) => {
    let callbacks = callbackCacheRef.current.get(chatId);
    
    if (!callbacks) {
      callbacks = {
        onMessagesChange: (messages: UIMessage[]) => {
          let convId = chatToConversationRef.current.get(chatId);
          
          if (!convId && messages.length > 0) {
            // Create a new conversation for this chat
            convId = createConversationRef.current();
            chatToConversationRef.current.set(chatId, convId);
            
            // Update the session's conversationId
            setActiveSessions(prev => prev.map(s => 
              s.chatId === chatId ? { ...s, conversationId: convId! } : s
            ));
          }
          
          if (convId) {
            updateConversationMessagesRef.current(convId, messages);
          }
        },
        
        onStreamingChange: (isStreaming: boolean) => {
          setActiveSessions(prev => {
            const updated = prev.map(s => 
              s.chatId === chatId ? { ...s, isStreaming } : s
            );
            
            // Clean up completed non-visible sessions
            if (!isStreaming) {
              return updated.filter(s => s.isStreaming || s.chatId === visibleChatIdRef.current);
            }
            
            return updated;
          });
        },
        
        onKnowledgeChange: handleKnowledgeChange,
        
        onTitleChange: (title: string) => {
          // Update the conversation title (AI-generated)
          // This respects userRenamed - won't override manual renames
          const convId = chatToConversationRef.current.get(chatId);
          if (convId) {
            updateConversationTitleRef.current(convId, title);
          }
        },
      };
      
      callbackCacheRef.current.set(chatId, callbacks);
    }
    
    return callbacks;
  }, [handleKnowledgeChange]);

  return (
    <main className="flex h-screen w-full overflow-hidden">
      {/* Sidebar */}
      <ChatSidebar
        ref={sidebarRef}
        conversations={conversations}
        activeConversationId={activeConversationId}
        onSelectConversation={handleSelectConversation}
        onNewChat={handleNewChat}
        onRenameConversation={renameConversation}
        onDeleteConversation={deleteConversation}
        onClearAll={clearAllConversations}
        isCollapsed={sidebarCollapsed}
        onToggleCollapse={handleToggleSidebar}
        knowledgeBrowserRef={knowledgeBrowserRef}
        activeTab={sidebarTab}
        onTabChange={setSidebarTab}
        isOwner={isOwner}
        onApiKeysChange={handleApiKeysChange}
        forceOpenSettings={forceOpenSettings}
        onSettingsClosed={handleSettingsClosed}
      />

      {/* Chat Area - render all active sessions, but only show the visible one */}
      {/* Uses h-full and overflow-hidden to ensure chat stays within viewport */}
      <div className="flex-1 flex flex-col min-w-0 h-full overflow-hidden">
        {activeSessions.map((session) => {
          const callbacks = getSessionCallbacks(session.chatId);
          return (
            <div 
              key={session.chatId}
              className={session.chatId === visibleChatId ? "flex-1 flex flex-col h-full overflow-hidden" : "hidden"}
            >
              <Chat
                chatId={session.chatId}
                conversationId={session.conversationId}
                initialMessages={session.initialMessages}
                onMessagesChange={callbacks.onMessagesChange}
                onStreamingChange={callbacks.onStreamingChange}
                onKnowledgeChange={callbacks.onKnowledgeChange}
                onTitleChange={callbacks.onTitleChange}
                isOwner={isOwner}
                onRequestSettings={handleRequestSettings}
                onApiKeysChange={handleApiKeysChange}
              />
            </div>
          );
        })}
      </div>
    </main>
  );
}
