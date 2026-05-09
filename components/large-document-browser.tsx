"use client";

/**
 * Large Document Browser Component
 *
 * UI for uploading, viewing, and managing large documents for RAG search.
 * Documents uploaded here can be searched via the document_search tool.
 */

import { useState, useEffect, useCallback, useRef } from "react";
import { Button } from "@/components/ui/button";
import {
  Upload,
  Trash2,
  FileText,
  RefreshCw,
  CheckCircle,
  AlertCircle,
  Loader2,
  Search,
  X,
  Pencil,
  Check,
  Eye,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import {
  storeLargeDocument,
  indexLargeDocumentInBackground,
  deleteLargeDocument,
  renameLargeDocument,
  getAllLargeDocuments,
  getLargeDocumentFile,
  searchLargeDocuments,
  recoverInterruptedDocuments,
  type LargeDocumentMetadata,
  type LargeDocumentSearchResult,
  type IndexingProgress,
} from "@/knowledge/large-documents";
import { DocumentViewer } from "@/components/document-viewer";

interface LargeDocumentBrowserProps {
  className?: string;
}

/**
 * Format file size for display.
 */
function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Format date for display.
 */
function formatDate(timestamp: number): string {
  return new Date(timestamp).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function LargeDocumentBrowser({ className }: LargeDocumentBrowserProps) {
  const [documents, setDocuments] = useState<LargeDocumentMetadata[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [uploadProgress, setUploadProgress] = useState<IndexingProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<LargeDocumentSearchResult[] | null>(null);
  const [isSearching, setIsSearching] = useState(false);
  const [editingDocId, setEditingDocId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState("");
  const [viewerDocument, setViewerDocument] = useState<LargeDocumentMetadata | null>(null);
  const [viewerInitialPage, setViewerInitialPage] = useState<number | undefined>(undefined);
  
  // Drag and drop state
  const [isDragging, setIsDragging] = useState(false);
  
  const fileInputRef = useRef<HTMLInputElement>(null);
  const editInputRef = useRef<HTMLInputElement>(null);

  // Load documents on mount.
  // The first load also performs Phase 6 boot recovery: any document
  // stuck in `extracting` or `embedding` for more than 5 minutes is
  // flipped to `error` so the user can retry. Single source of truth —
  // colocated here, not in `app/page.tsx`, to avoid races with the loader.
  const hasRecoveredRef = useRef(false);
  const loadDocuments = useCallback(async () => {
    try {
      setIsLoading(true);
      if (!hasRecoveredRef.current) {
        hasRecoveredRef.current = true;
        try {
          await recoverInterruptedDocuments();
        } catch (err) {
          console.error("[LargeDocs] Boot recovery failed:", err);
        }
      }
      const docs = await getAllLargeDocuments();
      docs.sort((a, b) => b.uploadedAt - a.uploadedAt);
      setDocuments(docs);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load documents");
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadDocuments();
  }, [loadDocuments]);

  // Retry indexing for an errored document. Uses Phase 7's extraction
  // cache so already-extracted pages aren't re-OCR'd.
  const handleRetry = useCallback(async (doc: LargeDocumentMetadata) => {
    try {
      setError(null);
      const stored = await getLargeDocumentFile(doc.id);
      if (!stored) {
        setError("Original file no longer available; please re-upload.");
        return;
      }
      const blob = new Blob([stored.data], { type: stored.mimeType });
      const file = new File([blob], doc.filename, { type: stored.mimeType });
      setUploadProgress({ current: 0, total: 5, status: "parsing", message: "Retrying…" });
      // Track the last status we refreshed for so we don't spam loadDocuments
      // on every per-page progress tick — only on phase transitions.
      let lastStatus: string | null = null;
      indexLargeDocumentInBackground(doc.id, file, (progress) => {
        try {
          setUploadProgress(progress);
          if (progress.status !== lastStatus) {
            lastStatus = progress.status;
            // Refresh on phase transitions so the UI moves out of the prior
            // "error" state as soon as extraction starts, and reflects each
            // pdfjs/ai/embedding/complete step in real time.
            loadDocuments();
          }
          if (progress.status === "complete" || progress.status === "error") {
            setUploadProgress(null);
            loadDocuments();
          }
        } catch {
          // unmounted
        }
      }).catch(() => {
        setUploadProgress(null);
        loadDocuments();
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Retry failed");
      setUploadProgress(null);
    }
  }, [loadDocuments]);

  // Validate file before upload
  const validateFile = useCallback((file: File): string | null => {
    // Validate file type
    const allowedTypes = [
      "text/plain",
      "text/markdown",
      "text/csv",
      "application/json",
      "application/xml",
      "text/html",
      "application/pdf",
    ];
    
    const allowedExtensions = [".md", ".txt", ".pdf"];
    const hasAllowedExtension = allowedExtensions.some(ext => file.name.toLowerCase().endsWith(ext));
    
    if (!allowedTypes.includes(file.type) && !hasAllowedExtension) {
      return "Please upload a text-based file (.txt, .md, .json, .csv, .xml, .html) or PDF (.pdf)";
    }

    // Validate file size (max 50MB for PDFs, 10MB for text)
    const maxSize = file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf") 
      ? 50 * 1024 * 1024 
      : 10 * 1024 * 1024;
    if (file.size > maxSize) {
      return `File size must be under ${maxSize === 50 * 1024 * 1024 ? "50MB" : "10MB"}`;
    }
    
    return null;
  }, []);

  // Handle file upload - always index in background, never auto-open viewer
  const handleUpload = useCallback(async (files: FileList | null) => {
    if (!files || files.length === 0) return;

    const file = files[0];
    const validationError = validateFile(file);
    
    if (validationError) {
      setError(validationError);
      return;
    }

    try {
      setError(null);
      setUploadProgress({ current: 0, total: 5, status: "parsing", message: "Storing document..." });

      // Store the file first (fast operation). Status begins as `stored`.
      const { metadata } = await storeLargeDocument(file);
      
      // Refresh document list to show the new document immediately
      await loadDocuments();
      
      // Start background indexing - this runs to completion without blocking UI
      // The indexing process handles its own error recovery and status updates
      // Note: The indexing will complete even if the user navigates away -
      // it writes directly to IndexedDB which persists independently
      let lastStatus: string | null = null;
      indexLargeDocumentInBackground(metadata.id, file, (progress) => {
        // Safe state updates - if component unmounted, these just fail silently
        try {
          setUploadProgress(progress);
          if (progress.status !== lastStatus) {
            lastStatus = progress.status;
            // Refresh on phase transitions so the row's status badge / chunk
            // count update live (extracting → embedding → ready).
            loadDocuments();
          }
          if (progress.status === "complete" || progress.status === "error") {
            setUploadProgress(null);
            // Refresh to show updated status
            loadDocuments();
          }
        } catch {
          // Component may have unmounted, but indexing continues in background
        }
      }).catch((err) => {
        console.error("[Upload] Background indexing failed:", err);
        try {
          setUploadProgress(null);
          loadDocuments();
        } catch {
          // Component may have unmounted
        }
      });
      
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed");
      setUploadProgress(null);
    }
  }, [validateFile, loadDocuments]);

  // Drag and drop handlers
  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    
    const files = e.dataTransfer.files;
    if (files && files.length > 0) {
      handleUpload(files);
    }
  }, [handleUpload]);

  // Handle delete
  const handleDelete = useCallback(async (documentId: string) => {
    if (!confirm("Delete this document? This cannot be undone.")) return;

    try {
      await deleteLargeDocument(documentId);
      await loadDocuments();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Delete failed");
    }
  }, [loadDocuments]);

  // Handle search
  const handleSearch = useCallback(async () => {
    if (!searchQuery.trim()) {
      setSearchResults(null);
      return;
    }

    try {
      setIsSearching(true);
      const results = await searchLargeDocuments(searchQuery, 10);
      setSearchResults(results);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Search failed");
    } finally {
      setIsSearching(false);
    }
  }, [searchQuery]);

  // Clear search
  const clearSearch = useCallback(() => {
    setSearchQuery("");
    setSearchResults(null);
  }, []);

  // Start editing a document name
  const startEditing = useCallback((doc: LargeDocumentMetadata) => {
    setEditingDocId(doc.id);
    setEditingName(doc.filename);
    // Focus the input after render
    setTimeout(() => editInputRef.current?.focus(), 0);
  }, []);

  // Cancel editing
  const cancelEditing = useCallback(() => {
    setEditingDocId(null);
    setEditingName("");
  }, []);

  // Save the edited name
  const saveEditing = useCallback(async () => {
    if (!editingDocId || !editingName.trim()) {
      cancelEditing();
      return;
    }

    try {
      await renameLargeDocument(editingDocId, editingName.trim());
      await loadDocuments();
      cancelEditing();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Rename failed");
    }
  }, [editingDocId, editingName, loadDocuments, cancelEditing]);

  // Handle key events during editing
  const handleEditKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      saveEditing();
    } else if (e.key === "Escape") {
      cancelEditing();
    }
  }, [saveEditing, cancelEditing]);

  return (
    <div 
      className={cn(
        "flex flex-col h-full overflow-hidden relative",
        isDragging && "ring-2 ring-blue-500 ring-inset",
        className
      )}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {/* Drag overlay */}
      {isDragging && (
        <div className="absolute inset-0 z-10 bg-blue-50/90 dark:bg-blue-950/90 flex items-center justify-center pointer-events-none">
          <div className="text-center">
            <Upload className="w-12 h-12 text-blue-500 mx-auto mb-2" />
            <p className="text-lg font-medium text-blue-700 dark:text-blue-300">
              Drop to upload & index
            </p>
            <p className="text-sm text-blue-600 dark:text-blue-400">
              Document will be indexed for RAG search
            </p>
          </div>
        </div>
      )}
      
      {/* Header */}
      <div className="p-4 border-b border-gray-200 dark:border-neutral-700 flex-shrink-0">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-medium text-gray-900 dark:text-neutral-300">
            Large Documents
          </h3>
          <Button
            size="sm"
            variant="neumorphic-secondary"
            onClick={loadDocuments}
            disabled={isLoading}
          >
            <RefreshCw className={cn("w-3.5 h-3.5", isLoading && "animate-spin")} />
          </Button>
        </div>

        {/* Upload Button */}
        <Button
          variant="neumorphic-primary"
          className="w-full justify-center gap-2"
          onClick={() => fileInputRef.current?.click()}
          disabled={uploadProgress !== null}
        >
          {uploadProgress ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />
              {uploadProgress.message}
            </>
          ) : (
            <>
              <Upload className="w-4 h-4" />
              Upload Document
            </>
          )}
        </Button>
        <input
          ref={fileInputRef}
          type="file"
          className="hidden"
          accept=".txt,.md,.json,.csv,.xml,.html,.pdf,text/plain,text/markdown,application/json,application/pdf"
          onChange={(e) => {
            handleUpload(e.target.files);
            // Reset input so same file can be selected again
            e.target.value = "";
          }}
        />

        <p className="text-xs text-gray-500 dark:text-neutral-500 mt-2">
          Upload documents (including PDFs) for RAG search. Claude can search without loading the entire document.
        </p>
      </div>

      {/* Search Bar */}
      {documents.length > 0 && (
        <div className="p-3 border-b border-gray-200 dark:border-neutral-700 flex-shrink-0">
          <div className="flex gap-2">
            <div className="flex-1 relative">
              <input
                type="text"
                placeholder="Test search your documents..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleSearch()}
                className="w-full px-3 py-2 text-sm rounded-lg border border-gray-200 dark:border-neutral-700 bg-white dark:bg-neutral-900 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
              />
              {searchQuery && (
                <button
                  onClick={clearSearch}
                  className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-gray-400 hover:text-gray-600"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
            <Button
              size="sm"
              variant="neumorphic-secondary"
              onClick={handleSearch}
              disabled={isSearching || !searchQuery.trim()}
            >
              {isSearching ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Search className="w-4 h-4" />
              )}
            </Button>
          </div>
        </div>
      )}

      {/* Error Display */}
      {error && (
        <div className="mx-3 mt-3 p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg flex-shrink-0">
          <div className="flex items-start gap-2">
            <AlertCircle className="w-4 h-4 text-red-500 mt-0.5" />
            <div className="flex-1">
              <p className="text-sm text-red-700 dark:text-red-400">{error}</p>
              <button
                onClick={() => setError(null)}
                className="text-xs text-red-600 dark:text-red-400 underline mt-1"
              >
                Dismiss
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Search Results */}
      {searchResults && (
        <div className="flex-1 overflow-y-auto p-3">
          <div className="flex items-center justify-between mb-2">
            <h4 className="text-xs font-medium text-gray-500 dark:text-neutral-500 uppercase">
              Search Results ({searchResults.length})
            </h4>
            <button
              onClick={clearSearch}
              className="text-xs text-blue-600 dark:text-blue-400 hover:underline"
            >
              Clear
            </button>
          </div>
          {searchResults.length === 0 ? (
            <p className="text-sm text-gray-500 dark:text-neutral-500 text-center py-8">
              No matching content found
            </p>
          ) : (
            <div className="space-y-2">
              {searchResults.map((result, idx) => (
                <button
                  key={`${result.documentId}-${result.chunkIndex}-${idx}`}
                  onClick={() => {
                    const doc = documents.find((d) => d.id === result.documentId);
                    if (doc) {
                      setViewerInitialPage(result.pageStart);
                      setViewerDocument(doc);
                    }
                  }}
                  className="w-full text-left p-3 bg-white dark:bg-neutral-800 rounded-lg border border-gray-200 dark:border-neutral-700 hover:border-blue-400 dark:hover:border-blue-500 transition-colors"
                >
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs font-medium text-gray-700 dark:text-neutral-300 truncate">
                      {result.filename}
                    </span>
                    <span className="text-xs text-emerald-600 dark:text-emerald-400 font-mono">
                      {(result.score * 100).toFixed(0)}%
                    </span>
                  </div>
                  <div className="flex items-center gap-2 text-xs text-gray-500 dark:text-neutral-500 mb-1">
                    <span className="font-mono text-gray-600 dark:text-neutral-400">
                      {result.pageStart === result.pageEnd
                        ? `p. ${result.pageStart}`
                        : `pp. ${result.pageStart}–${result.pageEnd}`}
                    </span>
                    {result.headingPath && (
                      <>
                        <span className="text-gray-300 dark:text-neutral-600">•</span>
                        <span className="truncate">{result.headingPath}</span>
                      </>
                    )}
                  </div>
                  <p className="text-xs text-gray-600 dark:text-neutral-400 line-clamp-3">
                    {result.chunkText}
                  </p>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Document List */}
      {!searchResults && (
        <div className="flex-1 overflow-y-auto p-3">
          {isLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="w-6 h-6 text-gray-400 animate-spin" />
            </div>
          ) : documents.length === 0 ? (
            <div className="text-center py-8">
              <FileText className="w-12 h-12 text-gray-300 dark:text-neutral-600 mx-auto mb-3" />
              <p className="text-sm text-gray-500 dark:text-neutral-500">
                No documents uploaded yet
              </p>
              <p className="text-xs text-gray-400 dark:text-neutral-600 mt-1">
                Upload a large document to search with RAG
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              {documents.map((doc) => {
                const isEditing = editingDocId === doc.id;

                return (
                  <div
                    key={doc.id}
                    className="group p-2.5 bg-white dark:bg-neutral-800 rounded-lg border border-gray-200 dark:border-neutral-700 hover:border-gray-300 dark:hover:border-neutral-600 transition-colors"
                  >
                    {isEditing ? (
                      // Editing mode - full width input
                      <div className="flex items-center gap-1.5">
                        <Input
                          ref={editInputRef}
                          value={editingName}
                          onChange={(e) => setEditingName(e.target.value)}
                          onKeyDown={handleEditKeyDown}
                          onBlur={saveEditing}
                          className="h-7 text-sm flex-1 min-w-0"
                          autoFocus
                        />
                        <button
                          onClick={saveEditing}
                          className="p-1 text-green-600 hover:text-green-700 rounded hover:bg-green-50 dark:hover:bg-green-900/20 flex-shrink-0"
                          title="Save"
                        >
                          <Check className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={cancelEditing}
                          className="p-1 text-gray-400 hover:text-gray-600 rounded hover:bg-gray-100 dark:hover:bg-neutral-700 flex-shrink-0"
                          title="Cancel"
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    ) : (
                      // Display mode - compact vertical layout
                      <>
                        {/* Top row: icon, filename, status, actions */}
                        <div className="flex items-center gap-2">
                          <div className="w-6 h-6 rounded bg-emerald-100 dark:bg-emerald-900/30 flex items-center justify-center flex-shrink-0">
                            <FileText className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
                          </div>
                          <p className="text-sm font-medium text-gray-900 dark:text-neutral-200 truncate flex-1 min-w-0">
                            {doc.filename}
                          </p>
                          {doc.status === "ready" && (
                            <CheckCircle className="w-3.5 h-3.5 text-green-500 flex-shrink-0" />
                          )}
                          {doc.status === "error" && (
                            <AlertCircle className="w-3.5 h-3.5 text-red-500 flex-shrink-0" />
                          )}
                          {doc.status !== "ready" && doc.status !== "error" && (
                            <Loader2 className="w-3.5 h-3.5 text-blue-500 animate-spin flex-shrink-0" />
                          )}
                          {/* Action buttons - compact */}
                          <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-all flex-shrink-0">
                            {/* Allow viewing as long as the file is on disk (any status
                                except "error"). Mirrors the doc-list filter in
                                document-viewer/index.tsx so legacy/unknown statuses
                                — e.g. pre-Phase-6 "uploading"/"indexing" rows — still
                                get a view button. */}
                            {doc.status !== "error" && (
                              <button
                                onClick={() => {
                                  setViewerInitialPage(undefined);
                                  setViewerDocument(doc);
                                }}
                                className="p-1 text-gray-400 hover:text-emerald-500 rounded hover:bg-emerald-50 dark:hover:bg-emerald-900/20"
                                title={doc.status === "ready" ? "View document" : "View document (still indexing for search)"}
                              >
                                <Eye className="w-3.5 h-3.5" />
                              </button>
                            )}
                            <button
                              onClick={() => startEditing(doc)}
                              className="p-1 text-gray-400 hover:text-blue-500 rounded hover:bg-blue-50 dark:hover:bg-blue-900/20"
                              title="Rename"
                            >
                              <Pencil className="w-3.5 h-3.5" />
                            </button>
                            <button
                              onClick={() => handleDelete(doc.id)}
                              className="p-1 text-gray-400 hover:text-red-500 rounded hover:bg-red-50 dark:hover:bg-red-900/20"
                              title="Delete"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </div>
                        {/* Bottom row: metadata - wraps naturally */}
                        <div className="flex items-center flex-wrap gap-x-1.5 gap-y-0.5 mt-1 ml-8 text-xs text-gray-500 dark:text-neutral-500">
                          <span>{formatFileSize(doc.fileSize)}</span>
                          <span className="text-gray-300 dark:text-neutral-600">•</span>
                          <span>{doc.chunkCount} chunks</span>
                        </div>
                        {doc.status === "error" && (
                          <div className="mt-1 ml-8 flex items-center gap-2 flex-wrap">
                            {doc.errorMessage && (
                              <p className="text-xs text-red-500">{doc.errorMessage}</p>
                            )}
                            <button
                              onClick={() => handleRetry(doc)}
                              className="text-xs text-blue-600 dark:text-blue-400 underline hover:no-underline"
                              title="Retry indexing (resumes from cached pages)"
                            >
                              Retry indexing
                            </button>
                          </div>
                        )}
                      </>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Info Footer */}
      <div className="p-3 border-t border-gray-200 dark:border-neutral-700 flex-shrink-0">
        <p className="text-xs text-gray-400 dark:text-neutral-600">
          {documents.length} document{documents.length !== 1 ? "s" : ""} •{" "}
          {documents.reduce((sum, d) => sum + d.chunkCount, 0)} total chunks
        </p>
      </div>

      {/* Document Viewer Overlay - opened via View button, not auto-opened on upload */}
      {viewerDocument && (
        <DocumentViewer
          document={viewerDocument}
          initialPage={viewerInitialPage}
          onClose={() => {
            setViewerDocument(null);
            setViewerInitialPage(undefined);
          }}
        />
      )}
    </div>
  );
}
