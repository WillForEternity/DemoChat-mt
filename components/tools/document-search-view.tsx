"use client";

/**
 * Document Search Tool View
 *
 * Beautiful neumorphic UI component for displaying document_search and document_list
 * tool invocations with expressive animations and detailed result display.
 * Shows the user what was searched and what was found in uploaded documents.
 */

import React, { useState, useCallback } from "react";
import { cn } from "@/lib/utils";
import { ChunkViewerModal, type ChunkData } from "./chunk-viewer-modal";
import {
  IoCheckmarkCircle,
  IoDocumentText,
  IoSearch,
  IoFolderOpen,
} from "react-icons/io5";
import { AiOutlineLoading3Quarters } from "react-icons/ai";
import type { LargeDocumentSearchResult, LargeDocumentMetadata } from "@/knowledge/large-documents";

// =============================================================================
// TYPES
// =============================================================================

type ToolState =
  | "input-streaming"     // Tool input is being streamed (AI SDK v6)
  | "input-available"     // Tool input is complete (AI SDK v6)
  | "output-available"    // Tool has finished with output (AI SDK v6)
  | "output-error"        // Tool execution failed (AI SDK v6)
  | "partial-call"        // Legacy: Model is still generating the tool call
  | "call"                // Legacy: Tool call is complete
  | "output-pending"      // Legacy: Tool is executing
  | "approval-requested"  // Waiting for user approval
  | "approved"
  | "denied";

interface ToolInvocation {
  type: string;
  state: ToolState;
  toolCallId: string;
  input?: Record<string, unknown>;
  output?: unknown;
}

// =============================================================================
// NEUMORPHIC STYLES
// =============================================================================

const neumorphicBase = cn(
  "rounded-2xl transition-all duration-300",
  "bg-gradient-to-br from-gray-50 to-gray-100",
  "dark:from-neutral-800 dark:to-neutral-900",
  "shadow-[6px_6px_12px_rgba(0,0,0,0.08),-6px_-6px_12px_rgba(255,255,255,0.8)]",
  "dark:shadow-[6px_6px_12px_rgba(0,0,0,0.3),-6px_-6px_12px_rgba(255,255,255,0.05)]"
);

const neumorphicInset = cn(
  "rounded-xl",
  "bg-gradient-to-br from-gray-100 to-gray-50",
  "dark:from-neutral-900 dark:to-neutral-800",
  "shadow-[inset_4px_4px_8px_rgba(0,0,0,0.06),inset_-4px_-4px_8px_rgba(255,255,255,0.7)]",
  "dark:shadow-[inset_4px_4px_8px_rgba(0,0,0,0.25),inset_-4px_-4px_8px_rgba(255,255,255,0.03)]"
);

// =============================================================================
// FORMAT HELPERS
// =============================================================================

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// =============================================================================
// DOCUMENT SEARCH LOADING STATE
// =============================================================================

function SearchLoading({ query }: { query?: string }) {
  return (
    <div className={cn(neumorphicBase, "relative my-3 p-4 overflow-hidden isolate")}>
      {/* Animated gradient background */}
      <div className="absolute inset-0 opacity-30 pointer-events-none">
        <div
          className="absolute inset-0 bg-gradient-to-r from-transparent via-white/50 to-transparent dark:via-white/10"
          style={{
            animation: "shimmer 2s infinite",
          }}
        />
      </div>
      <style>{`
        @keyframes shimmer {
          0% { transform: translateX(-100%); }
          100% { transform: translateX(100%); }
        }
        @keyframes pulse-glow {
          0%, 100% { box-shadow: 0 0 8px 2px currentColor; opacity: 0.6; }
          50% { box-shadow: 0 0 16px 4px currentColor; opacity: 1; }
        }
      `}</style>

      <div className="relative flex items-center gap-4">
        {/* Animated icon container */}
        <div
          className={cn(
            "relative w-12 h-12 rounded-xl flex items-center justify-center",
            neumorphicInset,
            "text-gray-500 dark:text-neutral-400"
          )}
        >
          <IoDocumentText className="w-5 h-5" />
          {/* Pulsing ring */}
          <div
            className="absolute inset-0 rounded-xl border-2 border-current opacity-50 text-gray-500 dark:text-neutral-400"
            style={{ animation: "pulse-glow 1.5s ease-in-out infinite" }}
          />
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-gray-700 dark:text-neutral-300">
              Searching Documents
            </span>
            <AiOutlineLoading3Quarters
              className="w-3.5 h-3.5 animate-spin text-gray-500 dark:text-neutral-400"
            />
          </div>
          {query && (
            <p className="text-xs text-gray-500 dark:text-neutral-400 truncate mt-0.5">
              &quot;{query}&quot;
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

// =============================================================================
// DOCUMENT SEARCH RESULTS
// =============================================================================

function SearchResults({
  query,
  results,
}: {
  query: string;
  results: LargeDocumentSearchResult[];
}) {
  const isEmpty = !results || results.length === 0;
  
  // Modal state for viewing full chunk
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  
  const handleOpenChunk = useCallback((index: number) => {
    setSelectedIndex(index);
  }, []);
  
  const handleCloseModal = useCallback(() => {
    setSelectedIndex(null);
  }, []);
  
  const handleNavigate = useCallback((index: number) => {
    setSelectedIndex(index);
  }, []);
  
  // Convert to ChunkData format for the modal
  const chunkData: ChunkData[] = results.map((r) => ({
    chunkText: r.chunkText,
    score: r.score,
    chunkIndex: r.chunkIndex,
    documentId: r.documentId,
    filename: r.filename,
    headingPath: r.headingPath,
    matchedTerms: r.matchedTerms,
    queryType: r.queryType,
    reranked: r.reranked,
  }));

  return (
    <div className={cn(neumorphicBase, "my-3 p-4 isolate")}>
      {/* Header */}
      <div className="flex items-center gap-3 mb-3">
        <div
          className={cn(
            "w-10 h-10 rounded-xl flex items-center justify-center",
            neumorphicInset,
            "text-gray-500 dark:text-neutral-400"
          )}
        >
          <IoDocumentText className="w-5 h-5" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-gray-700 dark:text-neutral-300">
              Document Search
            </span>
            <IoCheckmarkCircle className="w-4 h-4 text-gray-500 dark:text-neutral-400" />
          </div>
          <p className="text-xs text-gray-500 dark:text-neutral-400 truncate">
            &quot;{query}&quot;
          </p>
        </div>
        {!isEmpty && (
          <span className="text-xs font-medium text-gray-600 bg-gray-100 dark:bg-neutral-700/50 dark:text-neutral-300 px-2 py-1 rounded-full">
            {results.length} result{results.length !== 1 ? "s" : ""}
          </span>
        )}
      </div>

      {/* Empty state */}
      {isEmpty ? (
        <div
          className={cn(
            neumorphicInset,
            "p-3 text-center text-sm text-gray-500 dark:text-neutral-400"
          )}
        >
          No matching content found in uploaded documents
        </div>
      ) : (
        <div className={cn(neumorphicInset, "p-2")}>
          {/* Pipeline explanation */}
          <div
            className={cn(
              "mb-3 px-3 py-2 rounded-lg",
              "bg-gradient-to-br from-gray-50 to-gray-100",
              "dark:from-neutral-800/50 dark:to-neutral-900/50",
              "shadow-[inset_1px_1px_2px_rgba(0,0,0,0.04),inset_-1px_-1px_2px_rgba(255,255,255,0.5)]",
              "dark:shadow-[inset_1px_1px_2px_rgba(0,0,0,0.2),inset_-1px_-1px_2px_rgba(255,255,255,0.02)]"
            )}
          >
            <p className="text-[10px] text-gray-500 dark:text-neutral-400 text-center leading-relaxed">
              <span className="font-medium">Keyword</span>
              <span className="mx-1 text-gray-300 dark:text-neutral-600">+</span>
              <span className="font-medium">Vector Search</span>
              <span className="mx-1.5 text-gray-300 dark:text-neutral-600">→</span>
              <span className="font-medium">Reciprocal Rank Fusion</span>
              {results.some((r) => r.reranked) && (
                <>
                  <span className="mx-1.5 text-gray-300 dark:text-neutral-600">→</span>
                  <span className="font-medium">LLM Reranking</span>
                </>
              )}
            </p>
          </div>
          
          {/* Grid layout for results - compact cards */}
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
            {results.map((result, i) => {
              const preview = result.chunkText.length > 80 
                ? result.chunkText.substring(0, 80) + "…" 
                : result.chunkText;

              return (
                <button
                  key={`${result.documentId}-${result.chunkIndex}-${i}`}
                  onClick={() => handleOpenChunk(i)}
                  className={cn(
                    "p-2 rounded-lg flex flex-col gap-1 text-left",
                    "bg-white dark:bg-neutral-800",
                    "shadow-[1px_1px_3px_rgba(0,0,0,0.06),-1px_-1px_3px_rgba(255,255,255,0.7)]",
                    "dark:shadow-[1px_1px_3px_rgba(0,0,0,0.25),-1px_-1px_3px_rgba(255,255,255,0.02)]",
                    "cursor-pointer",
                    "hover:shadow-[2px_2px_5px_rgba(0,0,0,0.08),-2px_-2px_5px_rgba(255,255,255,0.8)]",
                    "dark:hover:shadow-[2px_2px_5px_rgba(0,0,0,0.3),-2px_-2px_5px_rgba(255,255,255,0.03)]",
                    "hover:scale-[1.02] active:scale-[0.98]",
                    "transition-all duration-200",
                    "focus:outline-none"
                  )}
                  title="Click to view full content"
                >
                  {/* Header with filename and score */}
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-1 min-w-0 flex-1">
                      <IoDocumentText className="w-3 h-3 text-gray-400 dark:text-neutral-500 flex-shrink-0" />
                      <span className="text-[10px] text-gray-500 dark:text-neutral-400 truncate">
                        {result.filename}
                      </span>
                    </div>
                    <span
                      className={cn(
                        "text-xs font-semibold flex-shrink-0 ml-1",
                        result.score >= 0.7
                          ? "text-emerald-600 dark:text-emerald-400"
                          : result.score >= 0.5
                          ? "text-amber-600 dark:text-amber-400"
                          : "text-gray-500 dark:text-neutral-400"
                      )}
                    >
                      {Math.round(result.score * 100)}%
                    </span>
                  </div>
                  
                  {/* Heading path if available */}
                  {result.headingPath && (
                    <p className="text-[9px] text-gray-400 dark:text-neutral-500 truncate">
                      {result.headingPath}
                    </p>
                  )}
                  
                  {/* Content preview */}
                  <p className="text-xs text-gray-600 dark:text-neutral-400 line-clamp-3 leading-tight">
                    {preview}
                  </p>
                </button>
              );
            })}
          </div>
        </div>
      )}
      
      {/* Chunk Viewer Modal */}
      <ChunkViewerModal
        isOpen={selectedIndex !== null}
        onClose={handleCloseModal}
        chunk={selectedIndex !== null ? chunkData[selectedIndex] : null}
        chunkType="document"
        query={query}
        chunks={chunkData}
        currentIndex={selectedIndex ?? 0}
        onNavigate={handleNavigate}
      />
    </div>
  );
}

// =============================================================================
// DOCUMENT SEARCH VIEW - MAIN COMPONENT
// =============================================================================

interface DocumentSearchViewProps {
  invocation: ToolInvocation;
}

export function DocumentSearchView({ invocation }: DocumentSearchViewProps) {
  const query = (invocation.input?.query as string) || "";

  // AI SDK v6 uses input-streaming and input-available for loading states
  // We also support legacy state names for backwards compatibility
  const isLoading =
    invocation.state === "input-streaming" ||
    invocation.state === "input-available" ||
    invocation.state === "partial-call" ||    // Legacy
    invocation.state === "call" ||            // Legacy
    invocation.state === "output-pending";    // Legacy

  // Loading state - show animation while search is in progress
  if (isLoading) {
    return <SearchLoading query={query || undefined} />;
  }

  // Completed state
  if (invocation.state === "output-available" && invocation.output) {
    const output = invocation.output as Record<string, unknown>;
    const results = (output.results as LargeDocumentSearchResult[]) || [];
    return <SearchResults query={query} results={results} />;
  }

  // Error state
  if (invocation.state === "output-error") {
    return <SearchLoading query={query || undefined} />;
  }

  return null;
}

// =============================================================================
// DOCUMENT LIST LOADING STATE
// =============================================================================

function ListLoading() {
  return (
    <div className={cn(neumorphicBase, "relative my-3 p-4 overflow-hidden isolate")}>
      {/* Animated gradient background */}
      <div className="absolute inset-0 opacity-30 pointer-events-none">
        <div
          className="absolute inset-0 bg-gradient-to-r from-transparent via-white/50 to-transparent dark:via-white/10"
          style={{
            animation: "shimmer 2s infinite",
          }}
        />
      </div>
      <style>{`
        @keyframes shimmer {
          0% { transform: translateX(-100%); }
          100% { transform: translateX(100%); }
        }
        @keyframes pulse-glow {
          0%, 100% { box-shadow: 0 0 8px 2px currentColor; opacity: 0.6; }
          50% { box-shadow: 0 0 16px 4px currentColor; opacity: 1; }
        }
      `}</style>

      <div className="relative flex items-center gap-4">
        {/* Animated icon container */}
        <div
          className={cn(
            "relative w-12 h-12 rounded-xl flex items-center justify-center",
            neumorphicInset,
            "text-gray-500 dark:text-neutral-400"
          )}
        >
          <IoFolderOpen className="w-5 h-5" />
          {/* Pulsing ring */}
          <div
            className="absolute inset-0 rounded-xl border-2 border-current opacity-50 text-gray-500 dark:text-neutral-400"
            style={{ animation: "pulse-glow 1.5s ease-in-out infinite" }}
          />
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-gray-700 dark:text-neutral-300">
              Loading Documents
            </span>
            <AiOutlineLoading3Quarters
              className="w-3.5 h-3.5 animate-spin text-gray-500 dark:text-neutral-400"
            />
          </div>
        </div>
      </div>
    </div>
  );
}

// =============================================================================
// DOCUMENT LIST RESULTS
// =============================================================================

function ListResults({ documents }: { documents: LargeDocumentMetadata[] }) {
  const isEmpty = !documents || documents.length === 0;

  return (
    <div className={cn(neumorphicBase, "my-3 p-4 isolate")}>
      {/* Header */}
      <div className="flex items-center gap-3 mb-3">
        <div
          className={cn(
            "w-10 h-10 rounded-xl flex items-center justify-center",
            neumorphicInset,
            "text-gray-500 dark:text-neutral-400"
          )}
        >
          <IoFolderOpen className="w-5 h-5" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-gray-700 dark:text-neutral-300">
              Uploaded Documents
            </span>
            <IoCheckmarkCircle className="w-4 h-4 text-gray-500 dark:text-neutral-400" />
          </div>
          <p className="text-xs text-gray-500 dark:text-neutral-400">
            Available for RAG search
          </p>
        </div>
        {!isEmpty && (
          <span className="text-xs font-medium text-gray-600 bg-gray-100 dark:bg-neutral-700/50 dark:text-neutral-300 px-2 py-1 rounded-full">
            {documents.length} document{documents.length !== 1 ? "s" : ""}
          </span>
        )}
      </div>

      {/* Empty state */}
      {isEmpty ? (
        <div
          className={cn(
            neumorphicInset,
            "p-3 text-center text-sm text-gray-500 dark:text-neutral-400"
          )}
        >
          No documents uploaded yet. Use the Large Documents section in the sidebar to upload files.
        </div>
      ) : (
        <div className={cn(neumorphicInset, "p-2")}>
          {/* List of documents */}
          <div className="space-y-1.5">
            {documents.map((doc) => (
              <div
                key={doc.id}
                className={cn(
                  "p-2 rounded-lg flex items-center gap-3",
                  "bg-white dark:bg-neutral-800",
                  "shadow-[1px_1px_3px_rgba(0,0,0,0.06),-1px_-1px_3px_rgba(255,255,255,0.7)]",
                  "dark:shadow-[1px_1px_3px_rgba(0,0,0,0.25),-1px_-1px_3px_rgba(255,255,255,0.02)]"
                )}
              >
                <IoDocumentText className="w-4 h-4 text-gray-500 dark:text-neutral-400 flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-gray-700 dark:text-neutral-300 truncate">
                    {doc.filename}
                  </p>
                  <p className="text-xs text-gray-500 dark:text-neutral-400">
                    {formatFileSize(doc.fileSize)} • {doc.chunkCount} chunks
                  </p>
                </div>
                <span
                  className={cn(
                    "text-[10px] font-medium px-1.5 py-0.5 rounded flex-shrink-0",
                    doc.status === "ready"
                      ? "text-emerald-600 bg-emerald-100 dark:bg-emerald-900/30 dark:text-emerald-300"
                      : doc.status === "error"
                      ? "text-red-600 bg-red-100 dark:bg-red-900/30 dark:text-red-300"
                      : "text-emerald-600 bg-emerald-100 dark:bg-emerald-900/30 dark:text-emerald-300"
                  )}
                >
                  {doc.status}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// =============================================================================
// DOCUMENT LIST VIEW - MAIN COMPONENT
// =============================================================================

interface DocumentListViewProps {
  invocation: ToolInvocation;
}

export function DocumentListView({ invocation }: DocumentListViewProps) {
  // AI SDK v6 uses input-streaming and input-available for loading states
  // We also support legacy state names for backwards compatibility
  const isLoading =
    invocation.state === "input-streaming" ||
    invocation.state === "input-available" ||
    invocation.state === "partial-call" ||    // Legacy
    invocation.state === "call" ||            // Legacy
    invocation.state === "output-pending";    // Legacy

  // Loading state - show animation while loading
  if (isLoading) {
    return <ListLoading />;
  }

  // Completed state
  if (invocation.state === "output-available" && invocation.output) {
    const output = invocation.output as Record<string, unknown>;
    const documents = (output.documents as LargeDocumentMetadata[]) || [];
    return <ListResults documents={documents} />;
  }

  // Error state
  if (invocation.state === "output-error") {
    return <ListLoading />;
  }

  return null;
}

export default DocumentSearchView;
