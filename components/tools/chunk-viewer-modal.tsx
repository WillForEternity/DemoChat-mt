/**
 * Chunk Viewer Modal
 *
 * An elegant, animated modal for viewing full semantic search result chunks.
 * Features smooth transitions, keyboard navigation, and beautiful neumorphic design.
 */

"use client";

import React, { useEffect, useCallback, useRef } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/utils";
import {
  IoClose,
  IoDocument,
  IoDocumentText,
  IoPersonCircle,
  IoSparkles,
  IoChatbubbles,
  IoChevronBack,
  IoChevronForward,
  IoSearch,
} from "react-icons/io5";

// =============================================================================
// TYPES
// =============================================================================

export interface ChunkData {
  // Common fields
  chunkText: string;
  score: number;
  chunkIndex: number;
  
  // Knowledge base search
  filePath?: string;
  headingPath?: string;
  
  // Document search
  documentId?: string;
  filename?: string;
  
  // Chat search
  conversationId?: string;
  conversationTitle?: string;
  messageRole?: "user" | "assistant";
  
  // Hybrid search fields
  matchedTerms?: string[];
  queryType?: "exact" | "semantic" | "mixed";
  reranked?: boolean;
}

export type ChunkType = "knowledge" | "document" | "chat";

interface ChunkViewerModalProps {
  isOpen: boolean;
  onClose: () => void;
  chunk: ChunkData | null;
  chunkType: ChunkType;
  query?: string;
  // Navigation
  chunks?: ChunkData[];
  currentIndex?: number;
  onNavigate?: (index: number) => void;
}

// =============================================================================
// NEUMORPHIC STYLES
// =============================================================================

const modalBackdrop = cn(
  "fixed inset-0 z-50",
  "bg-black/50 dark:bg-black/70",
  "transition-opacity duration-300"
);

const modalContainer = cn(
  "fixed inset-0 z-50",
  "flex items-center justify-center",
  "p-4 sm:p-6"
);

const modalCard = cn(
  "relative w-full max-w-2xl max-h-[85vh]",
  "rounded-2xl overflow-hidden",
  "bg-white dark:bg-neutral-900",
  "shadow-2xl",
  "flex flex-col",
  "transform transition-all duration-300"
);

const neumorphicInset = cn(
  "rounded-xl",
  "bg-gradient-to-br from-gray-100 to-gray-50",
  "dark:from-neutral-900 dark:to-neutral-800",
  "shadow-[inset_3px_3px_6px_rgba(0,0,0,0.08),inset_-3px_-3px_6px_rgba(255,255,255,0.8)]",
  "dark:shadow-[inset_3px_3px_6px_rgba(0,0,0,0.3),inset_-3px_-3px_6px_rgba(255,255,255,0.02)]"
);

const navButton = cn(
  "w-10 h-10 rounded-xl flex items-center justify-center",
  "bg-gradient-to-br from-gray-50 to-gray-100",
  "dark:from-neutral-800 dark:to-neutral-900",
  "shadow-[3px_3px_6px_rgba(0,0,0,0.1),-3px_-3px_6px_rgba(255,255,255,0.9)]",
  "dark:shadow-[3px_3px_6px_rgba(0,0,0,0.4),-3px_-3px_6px_rgba(255,255,255,0.03)]",
  "text-gray-600 dark:text-neutral-300",
  "hover:shadow-[2px_2px_4px_rgba(0,0,0,0.08),-2px_-2px_4px_rgba(255,255,255,0.8)]",
  "dark:hover:shadow-[2px_2px_4px_rgba(0,0,0,0.3),-2px_-2px_4px_rgba(255,255,255,0.02)]",
  "active:shadow-[inset_2px_2px_4px_rgba(0,0,0,0.1),inset_-2px_-2px_4px_rgba(255,255,255,0.8)]",
  "dark:active:shadow-[inset_2px_2px_4px_rgba(0,0,0,0.3),inset_-2px_-2px_4px_rgba(255,255,255,0.02)]",
  "transition-shadow duration-150",
  "disabled:opacity-40 disabled:cursor-not-allowed"
);

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

function getChunkTitle(chunk: ChunkData, type: ChunkType): string {
  switch (type) {
    case "knowledge":
      return chunk.filePath?.split("/").pop() || "Document";
    case "document":
      return chunk.filename || "Document";
    case "chat":
      return chunk.conversationTitle || "Conversation";
  }
}

function getChunkSubtitle(chunk: ChunkData, type: ChunkType): string | null {
  switch (type) {
    case "knowledge":
      return chunk.headingPath || chunk.filePath || null;
    case "document":
      return chunk.headingPath || null;
    case "chat":
      return chunk.messageRole === "user" ? "Your message" : "Claude's response";
  }
}

function getTypeIcon(type: ChunkType) {
  switch (type) {
    case "knowledge":
      return IoDocument;
    case "document":
      return IoDocumentText;
    case "chat":
      return IoChatbubbles;
  }
}

function getTypeColor(type: ChunkType) {
  switch (type) {
    case "knowledge":
      return "text-gray-500 dark:text-neutral-400";
    case "document":
      return "text-gray-500 dark:text-neutral-400";
    case "chat":
      return "text-gray-500 dark:text-neutral-400";
  }
}

function getTypeBadge(type: ChunkType) {
  switch (type) {
    case "knowledge":
      return { label: "Knowledge Base", color: "bg-gray-100 text-gray-600 dark:bg-neutral-700/50 dark:text-neutral-300" };
    case "document":
      return { label: "Document", color: "bg-gray-100 text-gray-600 dark:bg-neutral-700/50 dark:text-neutral-300" };
    case "chat":
      return { label: "Chat History", color: "bg-gray-100 text-gray-600 dark:bg-neutral-700/50 dark:text-neutral-300" };
  }
}

// =============================================================================
// MAIN COMPONENT
// =============================================================================

export function ChunkViewerModal({
  isOpen,
  onClose,
  chunk,
  chunkType,
  query,
  chunks,
  currentIndex = 0,
  onNavigate,
}: ChunkViewerModalProps) {
  const contentRef = useRef<HTMLDivElement>(null);
  const [mounted, setMounted] = React.useState(false);
  const [animateIn, setAnimateIn] = React.useState(false);

  // Handle mount/unmount animations
  useEffect(() => {
    if (isOpen) {
      setMounted(true);
      // Small delay for animation
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          setAnimateIn(true);
        });
      });
    } else {
      setAnimateIn(false);
      const timer = setTimeout(() => setMounted(false), 300);
      return () => clearTimeout(timer);
    }
  }, [isOpen]);

  // Keyboard navigation
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (!isOpen) return;

      switch (e.key) {
        case "Escape":
          onClose();
          break;
        case "ArrowLeft":
          if (chunks && currentIndex > 0 && onNavigate) {
            onNavigate(currentIndex - 1);
          }
          break;
        case "ArrowRight":
          if (chunks && currentIndex < chunks.length - 1 && onNavigate) {
            onNavigate(currentIndex + 1);
          }
          break;
      }
    },
    [isOpen, onClose, chunks, currentIndex, onNavigate]
  );

  useEffect(() => {
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleKeyDown]);

  // Prevent body scroll when modal is open
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }
    return () => {
      document.body.style.overflow = "";
    };
  }, [isOpen]);

  // Scroll to top when chunk changes
  useEffect(() => {
    if (contentRef.current) {
      contentRef.current.scrollTop = 0;
    }
  }, [currentIndex]);

  if (!mounted || !chunk) return null;

  const TypeIcon = getTypeIcon(chunkType);
  const typeColor = getTypeColor(chunkType);
  const typeBadge = getTypeBadge(chunkType);
  const title = getChunkTitle(chunk, chunkType);
  const subtitle = getChunkSubtitle(chunk, chunkType);

  const canGoPrev = chunks && currentIndex > 0;
  const canGoNext = chunks && currentIndex < chunks.length - 1;

  const modalContent = (
    <>
      {/* Backdrop */}
      <div
        className={cn(modalBackdrop, animateIn ? "opacity-100" : "opacity-0")}
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Modal */}
      <div className={modalContainer} role="dialog" aria-modal="true">
        <div
          className={cn(
            modalCard,
            animateIn
              ? "opacity-100 scale-100 translate-y-0"
              : "opacity-0 scale-95 translate-y-4"
          )}
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div className="flex-shrink-0 p-5 border-b border-gray-200/50 dark:border-neutral-700/50">
            <div className="flex items-start gap-4">
              {/* Icon */}
              <div
                className={cn(
                  "w-12 h-12 rounded-xl flex items-center justify-center flex-shrink-0",
                  neumorphicInset,
                  typeColor
                )}
              >
                {chunkType === "chat" ? (
                  chunk.messageRole === "user" ? (
                    <IoPersonCircle className="w-6 h-6" />
                  ) : (
                    <IoSparkles className="w-6 h-6" />
                  )
                ) : (
                  <TypeIcon className="w-6 h-6" />
                )}
              </div>

              {/* Title and metadata */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <h2 className="text-lg font-semibold text-gray-800 dark:text-neutral-100 truncate">
                    {title}
                  </h2>
                  <span
                    className={cn(
                      "text-[10px] font-medium px-2 py-0.5 rounded-full flex-shrink-0",
                      typeBadge.color
                    )}
                  >
                    {typeBadge.label}
                  </span>
                </div>
                {subtitle && (
                  <p className="text-sm text-gray-500 dark:text-neutral-400 mt-0.5 truncate">
                    {subtitle}
                  </p>
                )}
                <div className="flex items-center gap-3 mt-2 flex-wrap">
                  {/* Score */}
                  <div className="flex items-center gap-1.5">
                    <div
                      className={cn(
                        "w-2 h-2 rounded-full",
                        chunk.score >= 0.7
                          ? "bg-emerald-500"
                          : chunk.score >= 0.5
                          ? "bg-amber-500"
                          : "bg-gray-400"
                      )}
                    />
                    <span className="text-xs font-medium text-gray-600 dark:text-neutral-300">
                      {Math.round(chunk.score * 100)}% match
                    </span>
                  </div>
                  {/* Chunk index */}
                  {chunks && chunks.length > 1 && (
                    <span className="text-xs text-gray-400 dark:text-neutral-500">
                      Result {currentIndex + 1} of {chunks.length}
                    </span>
                  )}
                  {/* Reranked indicator */}
                  {chunk.reranked && (
                    <span className="text-[10px] font-medium px-1.5 py-0.5 rounded text-violet-600 bg-violet-100 dark:bg-violet-900/30 dark:text-violet-300">
                      Reranked
                    </span>
                  )}
                </div>
                {/* Matched terms */}
                {chunk.matchedTerms && chunk.matchedTerms.length > 0 && (
                  <div className="flex items-center gap-1.5 mt-2 flex-wrap">
                    <span className="text-xs text-gray-400 dark:text-neutral-500">Matched:</span>
                    {chunk.matchedTerms.slice(0, 5).map((term, i) => (
                      <span
                        key={i}
                        className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-blue-100 text-blue-600 dark:bg-blue-900/30 dark:text-blue-300"
                      >
                        {term}
                      </span>
                    ))}
                    {chunk.matchedTerms.length > 5 && (
                      <span className="text-[10px] text-gray-400 dark:text-neutral-500">
                        +{chunk.matchedTerms.length - 5} more
                      </span>
                    )}
                  </div>
                )}
              </div>

              {/* Close button */}
              <button
                onClick={onClose}
                className={cn(navButton, "flex-shrink-0")}
                aria-label="Close"
              >
                <IoClose className="w-5 h-5" />
              </button>
            </div>

            {/* Query display */}
            {query && (
              <div className="mt-4 flex items-center gap-2">
                <IoSearch className="w-4 h-4 text-gray-400 dark:text-neutral-500" />
                <span className="text-sm text-gray-500 dark:text-neutral-400 italic">
                  &quot;{query}&quot;
                </span>
              </div>
            )}
          </div>

          {/* Content */}
          <div
            ref={contentRef}
            className="flex-1 overflow-y-auto p-5 scroll-smooth"
          >
            <div className={cn(neumorphicInset, "p-4")}>
              <pre className="text-sm text-gray-700 dark:text-neutral-200 whitespace-pre-wrap font-sans leading-relaxed">
                {chunk.chunkText}
              </pre>
            </div>
          </div>

          {/* Footer with navigation */}
          {chunks && chunks.length > 1 && (
            <div className="flex-shrink-0 p-4 border-t border-gray-200/50 dark:border-neutral-700/50">
              <div className="flex items-center justify-between">
                {/* Previous */}
                <button
                  onClick={() => canGoPrev && onNavigate?.(currentIndex - 1)}
                  disabled={!canGoPrev}
                  className={navButton}
                  aria-label="Previous result"
                >
                  <IoChevronBack className="w-5 h-5" />
                </button>

                {/* Dots indicator */}
                <div className="flex items-center justify-center gap-1.5 flex-1 px-2 flex-wrap">
                  {chunks.map((_, i) => (
                    <button
                      key={i}
                      onClick={() => onNavigate?.(i)}
                      className={cn(
                        "w-2 h-2 rounded-full transition-all duration-200 flex-shrink-0",
                        i === currentIndex
                          ? "bg-gray-600 dark:bg-neutral-300 scale-125"
                          : "bg-gray-300 dark:bg-neutral-600 hover:bg-gray-400 dark:hover:bg-neutral-500"
                      )}
                      aria-label={`Go to result ${i + 1}`}
                    />
                  ))}
                </div>

                {/* Next */}
                <button
                  onClick={() => canGoNext && onNavigate?.(currentIndex + 1)}
                  disabled={!canGoNext}
                  className={navButton}
                  aria-label="Next result"
                >
                  <IoChevronForward className="w-5 h-5" />
                </button>
              </div>

              {/* Keyboard hint */}
              <p className="text-[10px] text-gray-400 dark:text-neutral-500 text-center mt-3">
                Use <kbd className="px-1 py-0.5 rounded bg-gray-200 dark:bg-neutral-700 font-mono">←</kbd>{" "}
                <kbd className="px-1 py-0.5 rounded bg-gray-200 dark:bg-neutral-700 font-mono">→</kbd> to navigate,{" "}
                <kbd className="px-1 py-0.5 rounded bg-gray-200 dark:bg-neutral-700 font-mono">Esc</kbd> to close
              </p>
            </div>
          )}
        </div>
      </div>
    </>
  );

  // Use portal to render at document root
  if (typeof document === "undefined") return null;
  return createPortal(modalContent, document.body);
}

export default ChunkViewerModal;
