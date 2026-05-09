"use client";

/**
 * Document Viewer - Main Layout Component
 *
 * Full-screen overlay with Cursor-style 3-panel layout:
 * - Left: Document sidebar (collapsible)
 * - Center: PDF or text viewer
 * - Right: Chat panel with tabs (collapsible, appears on selection)
 *
 * Supports two modes:
 * 1. document prop: Load from IndexedDB (existing document)
 * 2. directFile prop: Immediate viewing (new upload, before indexing)
 */

import { useState, useEffect, useCallback, useRef } from "react";
import { Panel, PanelGroup, PanelResizeHandle, type ImperativePanelHandle } from "react-resizable-panels";
import { X, ChevronLeft, ChevronRight, Loader2, AlertCircle, FileText, MessageSquare } from "lucide-react";
import { cn } from "@/lib/utils";
import { getAllLargeDocuments, getLargeDocument, type LargeDocumentMetadata } from "@/knowledge/large-documents";
import { DocumentSidebar } from "./document-sidebar";
import { PDFViewer } from "./pdf-viewer";
import { TextViewer } from "./text-viewer";
import { ChatPanel } from "./chat-panel";

// =============================================================================
// TYPES
// =============================================================================

export interface SelectionData {
  /** Text content (legacy, now optional) */
  text?: string;
  /** Screenshot as base64 data URL */
  screenshot?: string;
  /** Page number where selection was made */
  page?: number;
}

export interface MarginChat {
  id: string;
  chatId: string;
  selection: SelectionData;
  /** Persisted messages for this chat */
  messages: import("ai").UIMessage[];
  /** Generated title for this chat */
  title: string;
  /** Pending attachment added after chat creation (e.g. new screenshot sent to existing chat) */
  incomingAttachment?: SelectionData;
}

interface DocumentViewerProps {
  /** Existing document metadata (for documents already stored in IDB) */
  document?: LargeDocumentMetadata;
  /** Direct file for immediate viewing (bypasses IDB lookup) */
  directFile?: File;
  /** Direct file data as ArrayBuffer (alternative to directFile) */
  directFileData?: ArrayBuffer;
  /** Optional 1-based page to scroll to on open (Phase 5: search-result citations) */
  initialPage?: number;
  onClose: () => void;
}

// =============================================================================
// COMPONENT
// =============================================================================

export function DocumentViewer({ document, directFile, directFileData, initialPage, onClose }: DocumentViewerProps) {
  // Panel refs for imperative control
  const sidebarRef = useRef<ImperativePanelHandle>(null);
  const chatPanelRef = useRef<ImperativePanelHandle>(null);

  // Track collapsed state (synced with panel state)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [chatPanelCollapsed, setChatPanelCollapsed] = useState(true);

  // Multiple chat tabs
  const [chats, setChats] = useState<MarginChat[]>([]);
  const [activeChat, setActiveChat] = useState<string | null>(null);
  
  // Track if PDF viewer has an active selection (to coordinate Escape key handling)
  const [hasActiveSelection, setHasActiveSelection] = useState(false);

  // All uploaded documents for sidebar
  const [allDocuments, setAllDocuments] = useState<LargeDocumentMetadata[]>([]);
  
  // For direct file viewing, create a temporary metadata object
  const initialDocument: LargeDocumentMetadata | null = document || (directFile ? {
    id: "pending-" + crypto.randomUUID(),
    filename: directFile.name,
    mimeType: directFile.type || "application/pdf",
    fileSize: directFile.size,
    chunkCount: 0,
    uploadedAt: Date.now(),
    indexedAt: 0,
    status: "extracting" as const,
  } : null);
  
  const [currentDocument, setCurrentDocument] = useState<LargeDocumentMetadata | null>(initialDocument);
  
  // Convert directFile to ArrayBuffer for immediate rendering
  const [directArrayBuffer, setDirectArrayBuffer] = useState<ArrayBuffer | null>(directFileData || null);
  
  // Convert File to ArrayBuffer when directFile is provided
  useEffect(() => {
    if (directFile && !directArrayBuffer) {
      directFile.arrayBuffer().then(setDirectArrayBuffer);
    }
  }, [directFile, directArrayBuffer]);

  // Load all documents for sidebar. Show every document the parent browser
  // shows (no status filter) — if a row exists in the list, it's viewable.
  useEffect(() => {
    getAllLargeDocuments()
      .then((docs) => {
        docs.sort((a, b) => b.uploadedAt - a.uploadedAt);
        setAllDocuments(docs);
      })
      .catch((err) => {
        console.error("[DocViewer] Failed to load document list:", err);
      });
  }, []);

  // Poll for document status updates when viewing a processing document.
  // Also handles reconciliation: when viewing a direct file (pending- ID),
  // poll the document list to find the real indexed document by filename
  // and transition to it seamlessly.
  useEffect(() => {
    if (!currentDocument) return;
    if (currentDocument.status === "ready" && !currentDocument.id.startsWith("pending-")) return;
    
    const pollInterval = setInterval(async () => {
      if (currentDocument.id.startsWith("pending-")) {
        // Direct file view — look for a real document with matching filename
        // that has been stored (status !== undefined means it exists in IDB)
        const docs = await getAllLargeDocuments();
        const match = docs.find(
          (d) => d.filename === currentDocument.filename && !d.id.startsWith("pending-")
        );
        if (match) {
          console.log(`[DocViewer] Reconciled pending document → ${match.id} (${match.status})`);
          setCurrentDocument(match);
          // Clear direct file data so the viewer loads from IDB instead
          setDirectArrayBuffer(null);
          // Refresh sidebar
          docs.sort((a, b) => b.uploadedAt - a.uploadedAt);
          setAllDocuments(docs);
        }
      } else {
        // Known document — poll for status changes
        const updated = await getLargeDocument(currentDocument.id);
        if (updated && updated.status !== currentDocument.status) {
          setCurrentDocument(updated);
          // Also refresh the sidebar
          const docs = await getAllLargeDocuments();
          docs.sort((a, b) => b.uploadedAt - a.uploadedAt);
          setAllDocuments(docs);
        }
      }
    }, 2000); // Poll every 2 seconds

    return () => clearInterval(pollInterval);
  }, [currentDocument]);

  // Handle text selection - creates new chat tab with pending attachment
  const handleSelection = useCallback((selection: SelectionData) => {
    const id = crypto.randomUUID();
    const newChat: MarginChat = {
      id,
      chatId: `margin-${id}`,
      selection,
      messages: [],
      title: "New Chat",
    };
    setChats((prev) => [...prev, newChat]);
    setActiveChat(id);
    // Auto-expand chat panel on first selection
    setChatPanelCollapsed(false);
  }, []);

  // Handle selection sent to the active (current) chat tab
  const handleSelectionToActiveChat = useCallback((selection: SelectionData) => {
    if (!activeChat) {
      // No active chat — fall back to creating a new one
      handleSelection(selection);
      return;
    }
    // Set incomingAttachment on the active chat so the ChatInstance picks it up
    setChats((prev) => prev.map((chat) =>
      chat.id === activeChat ? { ...chat, incomingAttachment: selection } : chat
    ));
    // Make sure the chat panel is visible
    setChatPanelCollapsed(false);
  }, [activeChat, handleSelection]);

  // Create a new empty chat (no selection)
  const handleNewChat = useCallback(() => {
    const id = crypto.randomUUID();
    const newChat: MarginChat = {
      id,
      chatId: `margin-${id}`,
      selection: {}, // Empty selection
      messages: [],
      title: "New Chat",
    };
    setChats((prev) => [...prev, newChat]);
    setActiveChat(id);
    // Auto-expand chat panel
    setChatPanelCollapsed(false);
  }, []);

  // Update messages for a specific chat (called by ChatInstance)
  const handleMessagesChange = useCallback((chatId: string, messages: import("ai").UIMessage[]) => {
    setChats((prev) => prev.map((chat) =>
      chat.id === chatId ? { ...chat, messages } : chat
    ));
  }, []);

  // Update title for a specific chat (called by ChatInstance after AI generates title)
  const handleTitleChange = useCallback((chatId: string, title: string) => {
    setChats((prev) => prev.map((chat) =>
      chat.id === chatId ? { ...chat, title } : chat
    ));
  }, []);

  // Clear incoming attachment after ChatInstance consumes it
  const handleClearIncomingAttachment = useCallback((chatId: string) => {
    setChats((prev) => prev.map((chat) =>
      chat.id === chatId ? { ...chat, incomingAttachment: undefined } : chat
    ));
  }, []);

  // Close a chat tab
  const handleCloseTab = useCallback((id: string) => {
    setChats((prev) => {
      const updated = prev.filter((c) => c.id !== id);
      // If we closed the active tab, select another
      if (activeChat === id && updated.length > 0) {
        setActiveChat(updated[updated.length - 1].id);
      } else if (updated.length === 0) {
        setActiveChat(null);
      }
      return updated;
    });
  }, [activeChat]);

  // Handle escape key to close (only when no active selection in PDF viewer)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !hasActiveSelection) {
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose, hasActiveSelection]);

  // Check if document is still processing
  const isDirectView = !!directFile || !!directFileData;
  const isProcessing = isDirectView || (currentDocument && (currentDocument.status === "extracting" || currentDocument.status === "embedding" || currentDocument.status === "stored"));
  const hasError = currentDocument?.status === "error";

  // Handle case where no document is available
  if (!currentDocument && !isDirectView) {
    return (
      <div className="fixed inset-0 z-50 bg-background flex items-center justify-center">
        <div className="text-center">
          <AlertCircle className="h-8 w-8 text-muted-foreground mx-auto mb-2" />
          <p className="text-muted-foreground">No document to display</p>
          <button onClick={onClose} className="mt-4 px-4 py-2 bg-primary text-primary-foreground rounded-lg">
            Close
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 bg-background flex flex-col neu-context-white">
      {/* Header bar with document title and close button */}
      <div className="flex-shrink-0 flex items-center justify-between px-4 py-2 border-b border-gray-200 dark:border-neutral-700 bg-gray-50/50 dark:bg-neutral-950 h-[48px]">
        <div className="flex items-center gap-2 min-w-0">
          <FileText className="h-4 w-4 text-gray-500 dark:text-neutral-500 flex-shrink-0" />
          <span className="text-sm font-medium text-gray-900 dark:text-neutral-100 truncate">
            {currentDocument?.filename || "Document Viewer"}
          </span>
          {(isProcessing || hasError) && (
            <span className={cn(
              "text-xs px-2 py-0.5 rounded-full flex-shrink-0",
              hasError 
                ? "bg-red-100 dark:bg-red-950 text-red-600 dark:text-red-400" 
                : "bg-blue-100 dark:bg-blue-950 text-blue-600 dark:text-blue-400"
            )}>
              {hasError ? "Error" : "Indexing..."}
            </span>
          )}
        </div>
        <button
          onClick={onClose}
          className={cn(
            "p-2 rounded-xl transition-all duration-200",
            "bg-gray-50 dark:bg-neutral-950",
            "shadow-[3px_3px_6px_rgba(0,0,0,0.08),-3px_-3px_6px_rgba(255,255,255,0.8)]",
            "dark:shadow-[3px_3px_6px_rgba(0,0,0,0.4),-3px_-3px_6px_rgba(255,255,255,0.03)]",
            "hover:shadow-[4px_4px_8px_rgba(0,0,0,0.1),-4px_-4px_8px_rgba(255,255,255,0.9)]",
            "dark:hover:shadow-[4px_4px_8px_rgba(0,0,0,0.5),-4px_-4px_8px_rgba(255,255,255,0.04)]",
            "active:shadow-[inset_3px_3px_6px_rgba(0,0,0,0.1),inset_-3px_-3px_6px_rgba(255,255,255,0.9)]",
            "dark:active:shadow-[inset_3px_3px_6px_rgba(0,0,0,0.5),inset_-3px_-3px_6px_rgba(255,255,255,0.04)]"
          )}
          title="Close (Esc)"
        >
          <X className="h-4 w-4 text-gray-500 dark:text-neutral-500" />
        </button>
      </div>

      {/* Processing status banner - improved messaging */}
      {isProcessing && (
        <div className="flex-shrink-0 flex items-center justify-center gap-2 px-4 py-1.5 bg-blue-50 dark:bg-blue-950/50 border-b border-blue-200 dark:border-blue-800 text-blue-700 dark:text-blue-300 text-xs">
          <Loader2 className="h-3 w-3 animate-spin" />
          <span>
            You can view and chat now. RAG search will be available when indexing completes.
          </span>
        </div>
      )}
      {hasError && currentDocument && (
        <div className="flex-shrink-0 flex items-center justify-center gap-2 px-4 py-1.5 bg-red-50 dark:bg-red-950/50 border-b border-red-200 dark:border-red-800 text-red-700 dark:text-red-300 text-xs">
          <AlertCircle className="h-3 w-3" />
          <span>
            Indexing failed: {currentDocument.errorMessage || "Unknown error"}
          </span>
        </div>
      )}

      <div className="flex-1 min-h-0 flex">
        {/* Sidebar expand button when collapsed (outside PanelGroup for balanced centering) */}
        {sidebarCollapsed && !isDirectView && (
          <div
            onClick={() => setSidebarCollapsed(false)}
            className={cn(
              "w-12 flex-shrink-0 flex flex-col items-center justify-center gap-1 cursor-pointer transition-all group",
              "bg-gray-50/50 dark:bg-neutral-950 border-r border-gray-200 dark:border-neutral-700"
            )}
            title="Show documents sidebar"
          >
            <FileText className="h-4 w-4 text-gray-500 dark:text-neutral-500 group-hover:text-gray-700 dark:group-hover:text-neutral-300 transition-colors" />
            <ChevronRight className="h-3 w-3 text-gray-500 dark:text-neutral-500 group-hover:text-gray-700 dark:group-hover:text-neutral-300 transition-colors" />
          </div>
        )}

        <PanelGroup direction="horizontal" className="flex-1 min-w-0">
          {/* Left Sidebar - Collapsible (hide when viewing direct file) */}
          {!isDirectView && currentDocument && !sidebarCollapsed && (
            <>
              <Panel
                ref={sidebarRef}
                defaultSize={20}
                minSize={15}
                maxSize={30}
                collapsible
                collapsedSize={0}
                onCollapse={() => setSidebarCollapsed(true)}
                onExpand={() => setSidebarCollapsed(false)}
              >
                <DocumentSidebar
                  documents={
                    // Guarantee the currently-open document is always in the list,
                    // even before the async fetch resolves or if it fails. Without
                    // this, the sidebar can briefly (or permanently) show
                    // "No documents available" while a PDF is open.
                    allDocuments.some((d) => d.id === currentDocument.id)
                      ? allDocuments
                      : [currentDocument, ...allDocuments]
                  }
                  current={currentDocument}
                  onSelect={setCurrentDocument}
                  onCollapse={() => setSidebarCollapsed(true)}
                />
              </Panel>
              <PanelResizeHandle className="w-1 bg-gray-200 dark:bg-neutral-700 hover:bg-fuchsia-500 dark:hover:bg-[#ff00ff] transition-colors" />
            </>
          )}

          {/* Center - Document Viewer */}
          <Panel defaultSize={sidebarCollapsed || isDirectView ? 100 : 60} minSize={30}>
            {currentDocument && currentDocument.mimeType === "application/pdf" ? (
              <PDFViewer
                documentId={isDirectView ? undefined : currentDocument.id}
                directFileData={directArrayBuffer || undefined}
                initialPage={initialPage}
                onSelection={handleSelection}
                onSelectionToActiveChat={handleSelectionToActiveChat}
                hasActiveChat={!!activeChat && !chatPanelCollapsed}
                onSelectionStateChange={setHasActiveSelection}
              />
            ) : currentDocument ? (
              <TextViewer
                documentId={currentDocument.id}
                onSelection={handleSelection}
              />
            ) : null}
          </Panel>

          {/* Right - Chat Panel (always in DOM, collapsible) */}
          {!chatPanelCollapsed && (
            <>
              <PanelResizeHandle className="w-1 bg-gray-200 dark:bg-neutral-700 hover:bg-fuchsia-500 dark:hover:bg-[#ff00ff] transition-colors" />
              <Panel
                ref={chatPanelRef}
                defaultSize={30}
                minSize={20}
                maxSize={50}
                collapsible
                collapsedSize={0}
                onCollapse={() => setChatPanelCollapsed(true)}
                onExpand={() => setChatPanelCollapsed(false)}
              >
                <ChatPanel
                  chats={chats}
                  activeChat={activeChat}
                  onTabChange={setActiveChat}
                  onCloseTab={handleCloseTab}
                  onCollapse={() => setChatPanelCollapsed(true)}
                  onMessagesChange={handleMessagesChange}
                  onTitleChange={handleTitleChange}
                  onClearIncomingAttachment={handleClearIncomingAttachment}
                  onNewChat={handleNewChat}
                />
              </Panel>
            </>
          )}
        </PanelGroup>

        {/* Chat panel expand button when collapsed (outside PanelGroup for balanced centering) */}
        {chatPanelCollapsed && (
          <div
            onClick={() => setChatPanelCollapsed(false)}
            className={cn(
              "w-12 flex-shrink-0 flex flex-col items-center justify-center gap-1 cursor-pointer transition-all group relative",
              "bg-gray-50/50 dark:bg-neutral-950 border-l border-gray-200 dark:border-neutral-700"
            )}
            title="Show chat panel"
          >
            <div className="relative">
              <MessageSquare className="h-4 w-4 text-gray-500 dark:text-neutral-500 group-hover:text-gray-700 dark:group-hover:text-neutral-300 transition-colors" />
              {/* Badge showing number of active chats (only when there are chats) */}
              {chats.length > 0 && (
                <span className="absolute -top-1.5 -right-1.5 min-w-[14px] h-[14px] flex items-center justify-center bg-fuchsia-500 dark:bg-[#ff00ff] text-white text-[10px] font-medium rounded-full px-0.5 shadow-lg shadow-fuchsia-500/30 dark:shadow-[#ff00ff]/30">
                  {chats.length}
                </span>
              )}
            </div>
            <ChevronLeft className="h-3 w-3 text-gray-500 dark:text-neutral-500 group-hover:text-gray-700 dark:group-hover:text-neutral-300 transition-colors" />
          </div>
        )}
      </div>
    </div>
  );
}
