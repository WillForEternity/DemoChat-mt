/**
 * Context Saver View
 *
 * Displays the Context Saver agent's streaming output as it decides
 * how to organize and save information to the knowledge base.
 *
 * Shows:
 * - "Storing information as context..." header with spinner during streaming
 * - The agent's "thinking" text as it streams
 * - Completion state with checkmark when done
 */

"use client";

import React from "react";
import { cn } from "@/lib/utils";
import { IoCreate, IoCheckmarkCircle } from "react-icons/io5";
import { AiOutlineLoading3Quarters } from "react-icons/ai";

// =============================================================================
// NEUMORPHIC STYLES (matching knowledge-tool-view.tsx)
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
// TYPES
// =============================================================================

export interface ParallelTask {
  taskId: string;
  type: "context-save";
  status: "running" | "complete" | "error";
  streamedText: string;
  savedPath?: string;
  error?: string;
}

interface ContextSaverViewProps {
  task: ParallelTask;
}

// =============================================================================
// MAIN COMPONENT
// =============================================================================

export function ContextSaverView({ task }: ContextSaverViewProps) {
  const isRunning = task.status === "running";
  const isComplete = task.status === "complete";
  const isError = task.status === "error";

  // Truncate long streamed text for display
  const maxDisplayLength = 500;
  const displayText = task.streamedText.length > maxDisplayLength
    ? task.streamedText.slice(-maxDisplayLength) + "..."
    : task.streamedText;

  return (
    <div className={cn(neumorphicBase, "relative my-3 p-4 overflow-hidden isolate")}>
      {/* Animated gradient background when running */}
      {isRunning && (
        <>
          <div className="absolute inset-0 opacity-30 pointer-events-none">
            <div
              className="absolute inset-0 bg-gradient-to-r from-transparent via-violet-200/50 to-transparent dark:via-violet-500/10"
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
        </>
      )}

      {/* Subtle completed gradient overlay */}
      {isComplete && (
        <div
          className={cn(
            "absolute inset-0 bg-gradient-to-br opacity-50 pointer-events-none",
            "from-violet-50 to-purple-50 dark:from-neutral-800/50 dark:to-neutral-800/30"
          )}
        />
      )}

      {/* Error gradient overlay */}
      {isError && (
        <div
          className={cn(
            "absolute inset-0 bg-gradient-to-br opacity-50 pointer-events-none",
            "from-red-50 to-rose-50 dark:from-neutral-800/50 dark:to-neutral-800/30"
          )}
        />
      )}

      {/* Header */}
      <div className="relative flex items-center gap-3 mb-3">
        {/* Icon container */}
        <div
          className={cn(
            "relative w-10 h-10 rounded-xl flex items-center justify-center",
            neumorphicInset,
            isError ? "text-red-500" : "text-violet-500"
          )}
        >
          <IoCreate className="w-5 h-5" />
          {/* Pulsing ring when running */}
          {isRunning && (
            <div
              className="absolute inset-0 rounded-xl border-2 border-current opacity-50 text-violet-500"
              style={{ animation: "pulse-glow 1.5s ease-in-out infinite" }}
            />
          )}
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-gray-700 dark:text-neutral-300">
              {isRunning && "Storing information as context..."}
              {isComplete && "Saved to context"}
              {isError && "Failed to save"}
            </span>
            {isRunning && (
              <AiOutlineLoading3Quarters className="w-3.5 h-3.5 animate-spin text-violet-500" />
            )}
            {isComplete && (
              <IoCheckmarkCircle className="w-4 h-4 text-emerald-500" />
            )}
          </div>
          {task.savedPath && (
            <p className="text-xs text-gray-500 dark:text-neutral-400 truncate font-mono">
              {task.savedPath}
            </p>
          )}
        </div>
      </div>

      {/* Streaming text content */}
      {(task.streamedText || isError) && (
        <div className={cn(neumorphicInset, "p-3 max-h-48 overflow-y-auto")}>
          {isError && task.error ? (
            <p className="text-xs text-red-600 dark:text-red-400">
              {task.error}
            </p>
          ) : (
            <div className="relative">
              <pre className="text-xs text-gray-600 dark:text-neutral-400 whitespace-pre-wrap font-mono leading-relaxed">
                {displayText}
                {isRunning && (
                  <span className="inline-block w-2 h-4 ml-0.5 bg-violet-500 dark:bg-violet-400 animate-pulse" />
                )}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default ContextSaverView;
