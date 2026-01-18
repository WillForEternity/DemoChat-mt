/**
 * Web Search Tool View
 *
 * Beautiful neumorphic UI component for displaying web search
 * tool invocations with a conventional horizontal carousel.
 */

"use client";

import React, { useState, useRef, useEffect } from "react";
import { cn } from "@/lib/utils";
import {
  IoGlobeOutline,
  IoCheckmarkCircle,
  IoChevronBack,
  IoChevronForward,
  IoOpenOutline,
  IoSearch,
  IoTime,
} from "react-icons/io5";
import { AiOutlineLoading3Quarters } from "react-icons/ai";

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

interface WebSearchViewProps {
  invocation: ToolInvocation;
}

interface WebSearchResult {
  type: string;
  url: string;
  title: string | null;
  pageAge: string | null;
  encryptedContent: string;
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

// Round button - outset default, flat hover, inset pressed
const neumorphicButton = cn(
  "rounded-full transition-all duration-200",
  "bg-gradient-to-br from-gray-50 to-gray-100",
  "dark:from-neutral-700 dark:to-neutral-800",
  // Default: outset
  "shadow-[3px_3px_6px_rgba(0,0,0,0.08),-3px_-3px_6px_rgba(255,255,255,0.8)]",
  "dark:shadow-[3px_3px_6px_rgba(0,0,0,0.3),-3px_-3px_6px_rgba(255,255,255,0.05)]",
  // Hover: flat (no shadow)
  "hover:shadow-none",
  // Active/Pressed: inset
  "active:shadow-[inset_3px_3px_6px_rgba(0,0,0,0.08),inset_-3px_-3px_6px_rgba(255,255,255,0.5)]",
  "dark:active:shadow-[inset_3px_3px_6px_rgba(0,0,0,0.3),inset_-3px_-3px_6px_rgba(255,255,255,0.02)]"
);

// Square button - outset default, flat hover, inset pressed
const neumorphicSquareButton = cn(
  "rounded-xl transition-all duration-200",
  "bg-gradient-to-br from-gray-50 to-gray-100",
  "dark:from-neutral-700 dark:to-neutral-800",
  // Default: outset
  "shadow-[3px_3px_6px_rgba(0,0,0,0.08),-3px_-3px_6px_rgba(255,255,255,0.8)]",
  "dark:shadow-[3px_3px_6px_rgba(0,0,0,0.3),-3px_-3px_6px_rgba(255,255,255,0.05)]",
  // Hover: flat (no shadow)
  "hover:shadow-none",
  // Active/Pressed: inset
  "active:shadow-[inset_3px_3px_6px_rgba(0,0,0,0.08),inset_-3px_-3px_6px_rgba(255,255,255,0.5)]",
  "dark:active:shadow-[inset_3px_3px_6px_rgba(0,0,0,0.3),inset_-3px_-3px_6px_rgba(255,255,255,0.02)]"
);

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

function extractDomain(url: string): string {
  try {
    const domain = new URL(url).hostname;
    return domain.replace(/^www\./, "");
  } catch {
    return url;
  }
}

function getFaviconUrl(url: string): string {
  try {
    const domain = new URL(url).origin;
    return `${domain}/favicon.ico`;
  } catch {
    return "";
  }
}

// =============================================================================
// LOADING STATE COMPONENT
// =============================================================================

function SearchLoading({ query }: { query?: string }) {
  return (
    <div className={cn(neumorphicBase, "my-3 p-4 isolate")}>
      {/* Header - matches completed state layout */}
      <div className="flex items-center gap-3 mb-3">
        <div
          className={cn(
            "w-10 h-10 rounded-xl flex items-center justify-center",
            neumorphicInset,
            "text-indigo-500"
          )}
        >
          <IoSearch className="w-5 h-5" />
        </div>
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-gray-700 dark:text-neutral-300">
              Searching the web
            </span>
            <AiOutlineLoading3Quarters className="w-3.5 h-3.5 text-indigo-500 animate-spin" />
          </div>
          <p className="text-xs text-gray-500 dark:text-neutral-400">
            Finding relevant sources...
          </p>
        </div>
      </div>

      {/* Search Query Display - matches completed state */}
      {query && (
        <div className={cn(neumorphicInset, "p-3")}>
          <p className="text-xs text-gray-500 dark:text-neutral-400 mb-1">Searching for:</p>
          <p className="text-sm text-gray-800 dark:text-neutral-200 font-medium">
            &ldquo;{query}&rdquo;
          </p>
        </div>
      )}
    </div>
  );
}

// =============================================================================
// CAROUSEL COMPONENT
// =============================================================================

function SearchResults({ results, query }: { results: WebSearchResult[]; query?: string }) {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isTransitioning, setIsTransitioning] = useState(false);
  const carouselRef = useRef<HTMLDivElement>(null);
  const resultCount = results?.length || 0;

  const goToSlide = (index: number) => {
    if (isTransitioning) return;
    setIsTransitioning(true);
    setCurrentIndex(index);
    setTimeout(() => setIsTransitioning(false), 300);
  };

  const goToPrev = () => {
    if (currentIndex > 0) {
      goToSlide(currentIndex - 1);
    }
  };

  const goToNext = () => {
    if (currentIndex < resultCount - 1) {
      goToSlide(currentIndex + 1);
    }
  };

  // Keyboard navigation
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "ArrowLeft") goToPrev();
      if (e.key === "ArrowRight") goToNext();
    };

    const carousel = carouselRef.current;
    if (carousel) {
      carousel.addEventListener("keydown", handleKeyDown);
      return () => carousel.removeEventListener("keydown", handleKeyDown);
    }
  }, [currentIndex, resultCount]);

  if (resultCount === 0) {
    return (
      <div className={cn(neumorphicBase, "my-3 p-4 isolate")}>
        <div className="flex items-center gap-3">
          <div
            className={cn(
              "w-10 h-10 rounded-xl flex items-center justify-center",
              neumorphicInset,
              "text-gray-400"
            )}
          >
            <IoSearch className="w-5 h-5" />
          </div>
          <div className="flex-1">
            <span className="text-sm text-gray-600 dark:text-neutral-400">
              No results found
            </span>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={cn(neumorphicBase, "my-3 p-4 isolate")}>
      {/* Header */}
      <div className="flex items-center gap-3 mb-3">
        <div
          className={cn(
            "w-10 h-10 rounded-xl flex items-center justify-center",
            neumorphicInset,
            "text-indigo-500"
          )}
        >
          <IoSearch className="w-5 h-5" />
        </div>
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-gray-700 dark:text-neutral-300">
              Web Search Complete
            </span>
            <IoCheckmarkCircle className="w-4 h-4 text-emerald-500" />
          </div>
          <p className="text-xs text-gray-500 dark:text-neutral-400">
            Found {resultCount} source{resultCount !== 1 ? "s" : ""} of truth
          </p>
        </div>
      </div>

      {/* Search Query Display */}
      {query && (
        <div className={cn(neumorphicInset, "p-3 mb-4")}>
          <p className="text-xs text-gray-500 dark:text-neutral-400 mb-1">Searched for:</p>
          <p className="text-sm text-gray-800 dark:text-neutral-200 font-medium">
            &ldquo;{query}&rdquo;
          </p>
        </div>
      )}

      {/* Carousel Container */}
      <div
        ref={carouselRef}
        tabIndex={0}
        className="relative focus:outline-none"
      >
        {/* Card Container - Inset */}
        <div className={cn(neumorphicInset, "overflow-hidden")}>
          <div
            className="flex transition-transform duration-300 ease-out"
            style={{ transform: `translateX(-${currentIndex * 100}%)` }}
          >
            {results.map((result, i) => {
              const resultDomain = extractDomain(result.url);
              const resultFavicon = getFaviconUrl(result.url);

              return (
                <div
                  key={i}
                  className="w-full flex-shrink-0 p-4"
                >
                  {/* Card Content */}
                  <div className="space-y-3">
                    {/* Header with favicon and domain */}
                    <div className="flex items-center gap-2">
                      <div className="w-6 h-6 rounded-lg bg-white dark:bg-neutral-700 flex items-center justify-center overflow-hidden flex-shrink-0 shadow-sm">
                        <img
                          src={resultFavicon}
                          alt=""
                          className="w-4 h-4 object-contain"
                          onError={(e) => {
                            (e.target as HTMLImageElement).style.display = "none";
                            const sibling = (e.target as HTMLImageElement).nextElementSibling;
                            if (sibling) sibling.classList.remove("hidden");
                          }}
                        />
                        <IoGlobeOutline className="w-3 h-3 text-gray-400 hidden" />
                      </div>
                      <span className="text-xs text-indigo-500 dark:text-indigo-400 truncate flex-1 font-medium">
                        {resultDomain}
                      </span>
                      {result.pageAge && (
                        <div className="flex items-center gap-1 text-gray-400 dark:text-neutral-500">
                          <IoTime className="w-3 h-3" />
                          <span className="text-[10px]">{result.pageAge}</span>
                        </div>
                      )}
                    </div>

                    {/* Title */}
                    <h3 className="text-sm font-semibold text-gray-800 dark:text-neutral-200 leading-relaxed">
                      {result.title || "Untitled"}
                    </h3>

                    {/* URL */}
                    <p className="text-xs text-gray-400 dark:text-neutral-500 truncate">
                      {result.url}
                    </p>

                    {/* Open Link Button */}
                    <a
                      href={result.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className={cn(
                        neumorphicButton,
                        "inline-flex items-center gap-2 px-4 py-2 text-xs font-medium text-indigo-600 dark:text-indigo-400"
                      )}
                    >
                      <IoOpenOutline className="w-4 h-4" />
                      View Source
                    </a>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Bottom Navigation Bar - Buttons + Position Indicator */}
        {resultCount > 1 && (
          <div className="flex items-center justify-center gap-3 mt-4">
            {/* Previous Button - Square neumorphic */}
            <button
              onClick={goToPrev}
              disabled={currentIndex === 0}
              className={cn(
                neumorphicSquareButton,
                "w-9 h-9 flex items-center justify-center",
                currentIndex === 0 && "opacity-40 cursor-not-allowed pointer-events-none"
              )}
              aria-label="Previous result"
            >
              <IoChevronBack className="w-4 h-4 text-gray-600 dark:text-neutral-400" />
            </button>

            {/* Position Indicator */}
            <div className={cn(neumorphicInset, "px-4 py-2 flex items-center gap-3")}>
              {/* Dot indicators */}
              <div className="flex items-center gap-1.5">
                {results.map((_, i) => (
                  <button
                    key={i}
                    onClick={() => goToSlide(i)}
                    className={cn(
                      "transition-all duration-200 rounded-full",
                      i === currentIndex
                        ? "w-5 h-1.5 bg-indigo-500"
                        : "w-1.5 h-1.5 bg-gray-300 dark:bg-neutral-600 hover:bg-gray-400 dark:hover:bg-neutral-500"
                    )}
                    aria-label={`Go to result ${i + 1}`}
                  />
                ))}
              </div>
              {/* Counter text */}
              <span className="text-xs text-gray-500 dark:text-neutral-400 font-medium">
                {currentIndex + 1} / {resultCount}
              </span>
            </div>

            {/* Next Button - Square neumorphic */}
            <button
              onClick={goToNext}
              disabled={currentIndex === resultCount - 1}
              className={cn(
                neumorphicSquareButton,
                "w-9 h-9 flex items-center justify-center",
                currentIndex === resultCount - 1 && "opacity-40 cursor-not-allowed pointer-events-none"
              )}
              aria-label="Next result"
            >
              <IoChevronForward className="w-4 h-4 text-gray-600 dark:text-neutral-400" />
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

export function WebSearchView({ invocation }: WebSearchViewProps) {
  const query = invocation.input?.query as string | undefined;
  
  // AI SDK v6 uses input-streaming and input-available for loading states
  // We also support legacy state names for backwards compatibility
  const isLoading =
    invocation.state === "input-streaming" ||
    invocation.state === "input-available" ||
    invocation.state === "partial-call" ||    // Legacy
    invocation.state === "call" ||            // Legacy
    invocation.state === "output-pending";    // Legacy

  // Loading state - show animation while web search is in progress
  if (isLoading) {
    return <SearchLoading query={query} />;
  }

  // Completed state
  if (invocation.state === "output-available" && invocation.output) {
    const results = invocation.output as WebSearchResult[];
    return <SearchResults results={results} query={query} />;
  }

  // Error state
  if (invocation.state === "output-error") {
    return <SearchLoading query={query} />; // Show loading state for now, could add error UI
  }

  return null;
}

export default WebSearchView;
