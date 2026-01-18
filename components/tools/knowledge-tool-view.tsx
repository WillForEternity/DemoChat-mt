/**
 * Knowledge Tool Views
 *
 * Beautiful neumorphic UI components for displaying knowledge filesystem
 * tool invocations with expressive animations and visual feedback.
 */

"use client";

import React from "react";
import { cn } from "@/lib/utils";
import {
  IoFolderOpen,
  IoDocument,
  IoCheckmarkCircle,
  IoCreate,
  IoTrash,
  IoAdd,
  IoList,
  IoReader,
  IoSearch,
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

interface KnowledgeToolViewProps {
  toolName: string;
  invocation: ToolInvocation;
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
// TOOL ICON & COLORS
// =============================================================================

const toolConfig: Record<
  string,
  { icon: React.ComponentType<{ className?: string }>; color: string; label: string; verb: string }
> = {
  kb_list: {
    icon: IoList,
    color: "text-blue-500",
    label: "Exploring",
    verb: "Listed",
  },
  kb_read: {
    icon: IoReader,
    color: "text-emerald-500",
    label: "Reading",
    verb: "Read",
  },
  kb_write: {
    icon: IoCreate,
    color: "text-violet-500",
    label: "Writing",
    verb: "Saved",
  },
  kb_append: {
    icon: IoAdd,
    color: "text-amber-500",
    label: "Appending",
    verb: "Appended to",
  },
  kb_mkdir: {
    icon: IoFolderOpen,
    color: "text-cyan-500",
    label: "Creating folder",
    verb: "Created folder",
  },
  kb_delete: {
    icon: IoTrash,
    color: "text-rose-500",
    label: "Deleting",
    verb: "Deleted",
  },
  kb_search: {
    icon: IoSearch,
    color: "text-indigo-500",
    label: "Searching",
    verb: "Searched",
  },
};

// =============================================================================
// LOADING STATE COMPONENT
// =============================================================================

function ToolLoading({ toolName, path }: { toolName: string; path: string }) {
  const config = toolConfig[toolName] || {
    icon: IoDocument,
    color: "text-gray-500",
    label: "Processing",
    verb: "Processed",
  };
  const Icon = config.icon;

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
            config.color
          )}
        >
          <Icon className="w-5 h-5" />
          {/* Pulsing ring */}
          <div
            className={cn(
              "absolute inset-0 rounded-xl border-2 border-current opacity-50",
              config.color
            )}
            style={{ animation: "pulse-glow 1.5s ease-in-out infinite" }}
          />
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-gray-700 dark:text-neutral-300">
              {config.label}
            </span>
            <AiOutlineLoading3Quarters
              className={cn("w-3.5 h-3.5 animate-spin", config.color)}
            />
          </div>
          <p className="text-xs text-gray-500 dark:text-neutral-400 truncate mt-0.5 font-mono">
            {path || "/"}
          </p>
        </div>
      </div>
    </div>
  );
}

// =============================================================================
// SUCCESS STATE COMPONENTS
// =============================================================================

function ListResult({ path, contents }: { path: string; contents: string[] }) {
  const isEmpty = !contents || contents.length === 0;

  return (
    <div className={cn(neumorphicBase, "my-3 p-4 isolate")}>
      <div className="flex items-center gap-3 mb-3">
        <div
          className={cn(
            "w-10 h-10 rounded-xl flex items-center justify-center",
            neumorphicInset,
            "text-blue-500"
          )}
        >
          <IoFolderOpen className="w-5 h-5" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-gray-700 dark:text-neutral-300">
              Explored
            </span>
            <IoCheckmarkCircle className="w-4 h-4 text-emerald-500" />
          </div>
          <p className="text-xs text-gray-500 dark:text-neutral-400 truncate font-mono">
            {path || "/"}
          </p>
        </div>
      </div>

      {isEmpty ? (
        <div
          className={cn(
            neumorphicInset,
            "p-3 text-center text-sm text-gray-500 dark:text-neutral-400"
          )}
        >
          Folder is empty
        </div>
      ) : (
        <div className={cn(neumorphicInset, "p-3")}>
          <div className="flex flex-wrap gap-2">
            {contents.map((item, i) => {
              const isFolder = !item.includes(".");
              return (
                <div
                  key={i}
                  className={cn(
                    "inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium",
                    "bg-white dark:bg-neutral-800",
                    "shadow-[2px_2px_4px_rgba(0,0,0,0.05),-2px_-2px_4px_rgba(255,255,255,0.6)]",
                    "dark:shadow-[2px_2px_4px_rgba(0,0,0,0.2),-2px_-2px_4px_rgba(255,255,255,0.02)]",
                    isFolder
                      ? "text-blue-600 dark:text-neutral-300"
                      : "text-gray-600 dark:text-neutral-400"
                  )}
                >
                  {isFolder ? (
                    <IoFolderOpen className="w-3.5 h-3.5" />
                  ) : (
                    <IoDocument className="w-3.5 h-3.5" />
                  )}
                  {item}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

function ReadResult({ path, content }: { path: string; content: string }) {
  const fileName = path.split("/").pop() || path;
  const preview =
    content.length > 200 ? content.substring(0, 200) + "..." : content;

  return (
    <div className={cn(neumorphicBase, "my-3 p-4 isolate")}>
      <div className="flex items-center gap-3 mb-3">
        <div
          className={cn(
            "w-10 h-10 rounded-xl flex items-center justify-center",
            neumorphicInset,
            "text-emerald-500"
          )}
        >
          <IoReader className="w-5 h-5" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-gray-700 dark:text-neutral-300">
              Read
            </span>
            <IoCheckmarkCircle className="w-4 h-4 text-emerald-500" />
          </div>
          <p className="text-xs text-gray-500 dark:text-neutral-400 truncate font-mono">
            {fileName}
          </p>
        </div>
      </div>

      <div className={cn(neumorphicInset, "p-3")}>
        <pre className="text-xs text-gray-600 dark:text-neutral-400 whitespace-pre-wrap font-mono leading-relaxed">
          {preview}
        </pre>
      </div>
    </div>
  );
}

interface SearchResultItem {
  filePath: string;
  chunkText: string;
  headingPath: string;
  score: number;
  chunkIndex: number;
  // Hybrid search additions
  semanticScore?: number;
  lexicalScore?: number;
  matchedTerms?: string[];
  queryType?: "exact" | "semantic" | "mixed";
}

// Query type badge configuration
const queryTypeConfig = {
  exact: {
    label: "Exact",
    color: "text-violet-600 bg-violet-50 dark:bg-violet-900/30 dark:text-violet-400",
    description: "Term matching prioritized",
  },
  semantic: {
    label: "Semantic",
    color: "text-blue-600 bg-blue-50 dark:bg-blue-900/30 dark:text-blue-400",
    description: "Meaning-based search",
  },
  mixed: {
    label: "Hybrid",
    color: "text-indigo-600 bg-indigo-50 dark:bg-indigo-900/30 dark:text-indigo-400",
    description: "Balanced search",
  },
};

function SearchResult({
  query,
  results,
}: {
  query: string;
  results: SearchResultItem[];
}) {
  const isEmpty = !results || results.length === 0;
  const queryType = results[0]?.queryType || "mixed";
  const typeConfig = queryTypeConfig[queryType];

  return (
    <div className={cn(neumorphicBase, "my-3 p-4 isolate")}>
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
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-gray-700 dark:text-neutral-300">
              Searched
            </span>
            <IoCheckmarkCircle className="w-4 h-4 text-emerald-500" />
            {/* Query type badge */}
            <span
              className={cn(
                "text-[10px] font-medium px-1.5 py-0.5 rounded",
                typeConfig.color
              )}
              title={typeConfig.description}
            >
              {typeConfig.label}
            </span>
          </div>
          <p className="text-xs text-gray-500 dark:text-neutral-400 truncate">
            &quot;{query}&quot;
          </p>
        </div>
        {!isEmpty && (
          <span className="text-xs font-medium text-indigo-500 bg-indigo-50 dark:bg-indigo-900/30 px-2 py-1 rounded-full">
            {results.length} result{results.length !== 1 ? "s" : ""}
          </span>
        )}
      </div>

      {isEmpty ? (
        <div
          className={cn(
            neumorphicInset,
            "p-3 text-center text-sm text-gray-500 dark:text-neutral-400"
          )}
        >
          No matching content found
        </div>
      ) : (
        <div className={cn(neumorphicInset, "p-3 space-y-3")}>
          {results.map((result, i) => {
            const fileName = result.filePath.split("/").pop() || result.filePath;
            const scoreColor =
              result.score >= 0.7
                ? "text-emerald-500 bg-emerald-50 dark:bg-emerald-900/30"
                : result.score >= 0.5
                ? "text-amber-500 bg-amber-50 dark:bg-amber-900/30"
                : "text-gray-500 bg-gray-50 dark:bg-gray-900/30";
            const preview =
              result.chunkText.length > 150
                ? result.chunkText.substring(0, 150) + "..."
                : result.chunkText;
            
            // Check if we have matched terms to display
            const hasMatchedTerms = result.matchedTerms && result.matchedTerms.length > 0;

            return (
              <div
                key={i}
                className={cn(
                  "p-3 rounded-lg",
                  "bg-white dark:bg-neutral-800",
                  "shadow-[2px_2px_4px_rgba(0,0,0,0.05),-2px_-2px_4px_rgba(255,255,255,0.6)]",
                  "dark:shadow-[2px_2px_4px_rgba(0,0,0,0.2),-2px_-2px_4px_rgba(255,255,255,0.02)]"
                )}
              >
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2 min-w-0 flex-1">
                    <IoDocument className="w-3.5 h-3.5 text-gray-400 flex-shrink-0" />
                    <span className="text-xs font-medium text-gray-600 dark:text-neutral-400 truncate font-mono">
                      {fileName}
                    </span>
                    {result.headingPath && (
                      <span className="text-xs text-gray-400 dark:text-neutral-500 truncate hidden sm:inline">
                        • {result.headingPath}
                      </span>
                    )}
                  </div>
                  <span
                    className={cn(
                      "text-xs font-medium px-2 py-0.5 rounded-full flex-shrink-0 ml-2",
                      scoreColor
                    )}
                    title={
                      result.semanticScore !== undefined && result.lexicalScore !== undefined
                        ? `Semantic: ${Math.round(result.semanticScore * 100)}% | Lexical: ${Math.round(result.lexicalScore * 100)}%`
                        : undefined
                    }
                  >
                    {Math.round(result.score * 100)}%
                  </span>
                </div>
                
                {/* Matched terms pills - only show if we have matches */}
                {hasMatchedTerms && (
                  <div className="flex flex-wrap gap-1 mb-2">
                    {result.matchedTerms!.slice(0, 5).map((term, j) => (
                      <span
                        key={j}
                        className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300"
                      >
                        {term}
                      </span>
                    ))}
                    {result.matchedTerms!.length > 5 && (
                      <span className="text-[10px] text-gray-400 dark:text-neutral-500 self-center">
                        +{result.matchedTerms!.length - 5} more
                      </span>
                    )}
                  </div>
                )}
                
                <p className="text-xs text-gray-600 dark:text-neutral-400 whitespace-pre-wrap line-clamp-3">
                  {preview}
                </p>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function WriteResult({
  path,
  action,
}: {
  path: string;
  action: "write" | "append" | "mkdir" | "delete";
}) {
  const fileName = path.split("/").pop() || path;

  const configs = {
    write: {
      icon: IoCreate,
      color: "text-violet-500",
      label: "Saved",
      bg: "from-violet-50 to-purple-50 dark:from-neutral-800/50 dark:to-neutral-800/30",
    },
    append: {
      icon: IoAdd,
      color: "text-amber-500",
      label: "Appended",
      bg: "from-amber-50 to-yellow-50 dark:from-neutral-800/50 dark:to-neutral-800/30",
    },
    mkdir: {
      icon: IoFolderOpen,
      color: "text-cyan-500",
      label: "Created folder",
      bg: "from-cyan-50 to-blue-50 dark:from-neutral-800/50 dark:to-neutral-800/30",
    },
    delete: {
      icon: IoTrash,
      color: "text-rose-500",
      label: "Deleted",
      bg: "from-rose-50 to-red-50 dark:from-neutral-800/50 dark:to-neutral-800/30",
    },
  };

  const config = configs[action];
  const Icon = config.icon;

  return (
    <div className={cn(neumorphicBase, "relative my-3 p-4 overflow-hidden isolate")}>
      {/* Subtle gradient overlay */}
      <div
        className={cn(
          "absolute inset-0 bg-gradient-to-br opacity-50 pointer-events-none",
          config.bg
        )}
      />

      <div className="relative flex items-center gap-3">
        <div
          className={cn(
            "w-10 h-10 rounded-xl flex items-center justify-center",
            neumorphicInset,
            config.color
          )}
        >
          <Icon className="w-5 h-5" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-gray-700 dark:text-neutral-300">
              {config.label}
            </span>
            <IoCheckmarkCircle className="w-4 h-4 text-emerald-500" />
          </div>
          <p className="text-xs text-gray-500 dark:text-neutral-400 truncate font-mono">
            {fileName}
          </p>
        </div>
      </div>
    </div>
  );
}

// =============================================================================
// MAIN COMPONENT
// =============================================================================

export function KnowledgeToolView({
  toolName,
  invocation,
}: KnowledgeToolViewProps) {
  // Safely access path - input may be undefined during input-streaming state
  const path = (invocation.input?.path as string) || "/";
  const query = (invocation.input?.query as string) || "";
  
  // AI SDK v6 uses input-streaming and input-available for loading states
  // We also support legacy state names for backwards compatibility
  const isLoading =
    invocation.state === "input-streaming" ||
    invocation.state === "input-available" ||
    invocation.state === "partial-call" ||    // Legacy
    invocation.state === "call" ||            // Legacy
    invocation.state === "output-pending";    // Legacy

  // Loading state - show query for kb_search, path for others
  if (isLoading) {
    const displayPath = toolName === "kb_search" ? (query || "searching...") : path;
    return <ToolLoading toolName={toolName} path={displayPath} />;
  }

  // Completed state
  if (invocation.state === "output-available" && invocation.output) {
    const output = invocation.output as Record<string, unknown>;

    switch (toolName) {
      case "kb_list":
        return (
          <ListResult
            path={path}
            contents={(output.contents as string[]) || []}
          />
        );

      case "kb_read":
        return (
          <ReadResult path={path} content={(output.content as string) || ""} />
        );

      case "kb_write":
        return <WriteResult path={path} action="write" />;

      case "kb_append":
        return <WriteResult path={path} action="append" />;

      case "kb_mkdir":
        return <WriteResult path={path} action="mkdir" />;

      case "kb_delete":
        return <WriteResult path={path} action="delete" />;

      case "kb_search":
        return (
          <SearchResult
            query={query}
            results={(output.results as SearchResultItem[]) || []}
          />
        );

      default:
        return null;
    }
  }

  return null;
}

export default KnowledgeToolView;
