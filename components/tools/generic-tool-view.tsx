/**
 * Generic Tool View
 *
 * Beautiful neumorphic UI component for displaying any tool
 * invocation that doesn't have a specific custom view.
 */

"use client";

import React from "react";
import { cn } from "@/lib/utils";
import {
  IoCheckmarkCircle,
  IoCog,
  IoAlertCircle,
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

interface GenericToolViewProps {
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
// HELPER FUNCTIONS
// =============================================================================

function formatToolName(name: string): string {
  // Convert snake_case or camelCase to Title Case
  return name
    .replace(/_/g, " ")
    .replace(/([A-Z])/g, " $1")
    .replace(/^\s+/, "")
    .split(" ")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(" ");
}

// =============================================================================
// LOADING STATE COMPONENT
// =============================================================================

function ToolLoading({ toolName }: { toolName: string }) {
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
            "text-gray-500"
          )}
        >
          <IoCog className="w-5 h-5" />
          {/* Pulsing ring */}
          <div
            className="absolute inset-0 rounded-xl border-2 border-current opacity-50 text-gray-500"
            style={{ animation: "pulse-glow 1.5s ease-in-out infinite" }}
          />
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-gray-700 dark:text-neutral-300">
              {formatToolName(toolName)}
            </span>
            <AiOutlineLoading3Quarters className="w-3.5 h-3.5 animate-spin text-gray-500" />
          </div>
          <p className="text-xs text-gray-500 dark:text-neutral-400 mt-0.5">
            Running...
          </p>
        </div>
      </div>
    </div>
  );
}

// =============================================================================
// SUCCESS STATE COMPONENT
// =============================================================================

function ToolResult({
  toolName,
  output,
}: {
  toolName: string;
  output: unknown;
}) {
  const hasError =
    output &&
    typeof output === "object" &&
    "error" in output;

  const outputStr =
    typeof output === "string"
      ? output
      : JSON.stringify(output, null, 2);
  
  const preview = outputStr.length > 300 ? outputStr.substring(0, 300) + "..." : outputStr;

  return (
    <div className={cn(neumorphicBase, "my-3 p-4 isolate")}>
      <div className="flex items-center gap-3 mb-3">
        <div
          className={cn(
            "w-10 h-10 rounded-xl flex items-center justify-center",
            neumorphicInset,
            hasError ? "text-rose-500" : "text-gray-500"
          )}
        >
          {hasError ? (
            <IoAlertCircle className="w-5 h-5" />
          ) : (
            <IoCog className="w-5 h-5" />
          )}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-gray-700 dark:text-neutral-300">
              {formatToolName(toolName)}
            </span>
            {hasError ? (
              <IoAlertCircle className="w-4 h-4 text-rose-500" />
            ) : (
              <IoCheckmarkCircle className="w-4 h-4 text-emerald-500" />
            )}
          </div>
          <p className="text-xs text-gray-500 dark:text-neutral-400">
            {hasError ? "Failed" : "Completed"}
          </p>
        </div>
      </div>

      <div className={cn(neumorphicInset, "p-3")}>
        <pre
          className={cn(
            "text-xs whitespace-pre-wrap font-mono leading-relaxed",
            hasError
              ? "text-rose-600 dark:text-rose-400"
              : "text-gray-600 dark:text-neutral-400"
          )}
        >
          {preview}
        </pre>
      </div>
    </div>
  );
}

// =============================================================================
// MAIN COMPONENT
// =============================================================================

export function GenericToolView({ toolName, invocation }: GenericToolViewProps) {
  // AI SDK v6 uses input-streaming and input-available for loading states
  // We also support legacy state names for backwards compatibility
  const isLoading =
    invocation.state === "input-streaming" ||
    invocation.state === "input-available" ||
    invocation.state === "partial-call" ||    // Legacy
    invocation.state === "call" ||            // Legacy
    invocation.state === "output-pending";    // Legacy

  // Loading state
  if (isLoading) {
    return <ToolLoading toolName={toolName} />;
  }

  // Completed state
  if (invocation.state === "output-available") {
    return <ToolResult toolName={toolName} output={invocation.output} />;
  }

  // Error state
  if (invocation.state === "output-error") {
    return <ToolResult toolName={toolName} output={invocation.output ?? { error: "Tool execution failed" }} />;
  }

  return null;
}

export default GenericToolView;
