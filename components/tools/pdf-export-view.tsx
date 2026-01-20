/**
 * PDF Export Tool View
 *
 * Beautiful neumorphic UI component for displaying PDF export
 * tool invocations with download progress and success states.
 */

"use client";

import React, { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import {
  IoDocumentText,
  IoCheckmarkCircle,
  IoDownload,
  IoAlertCircle,
} from "react-icons/io5";
import { AiOutlineLoading3Quarters, AiOutlineFilePdf } from "react-icons/ai";

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

interface PdfExportViewProps {
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

const neumorphicButton = cn(
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
// LOADING STATE COMPONENT
// =============================================================================

function ExportLoading({ filename }: { filename?: string }) {
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    // Simulate progress
    const interval = setInterval(() => {
      setProgress((prev) => {
        if (prev >= 90) return prev;
        return prev + Math.random() * 15;
      });
    }, 200);

    return () => clearInterval(interval);
  }, []);

  return (
    <div className={cn(neumorphicBase, "my-3 p-4 isolate")}>
      <div className="flex items-center gap-3 mb-3">
        <div
          className={cn(
            "w-10 h-10 rounded-xl flex items-center justify-center",
            neumorphicInset,
            "text-gray-500 dark:text-neutral-400"
          )}
        >
          <AiOutlineFilePdf className="w-5 h-5" />
        </div>
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-gray-700 dark:text-neutral-300">
              Generating PDF
            </span>
            <AiOutlineLoading3Quarters className="w-3.5 h-3.5 text-gray-500 dark:text-neutral-400 animate-spin" />
          </div>
          <p className="text-xs text-gray-500 dark:text-neutral-400">
            Rendering markdown and LaTeX...
          </p>
        </div>
      </div>

      {/* Progress bar */}
      <div className={cn(neumorphicInset, "p-3")}>
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs text-gray-500 dark:text-neutral-400">
            {filename || "chat-export"}.pdf
          </span>
          <span className="text-xs font-medium text-gray-600 dark:text-neutral-300">
            {Math.round(progress)}%
          </span>
        </div>
        <div className="h-2 bg-gray-200 dark:bg-neutral-700 rounded-full overflow-hidden">
          <div
            className="h-full bg-gradient-to-r from-gray-400 to-gray-500 dark:from-neutral-500 dark:to-neutral-400 rounded-full transition-all duration-300"
            style={{ width: `${progress}%` }}
          />
        </div>
      </div>
    </div>
  );
}

// =============================================================================
// SUCCESS STATE COMPONENT
// =============================================================================

function ExportSuccess({
  filename,
  onRedownload,
}: {
  filename: string;
  onRedownload?: () => void;
}) {
  return (
    <div className={cn(neumorphicBase, "my-3 p-4 isolate")}>
      <div className="flex items-center gap-3 mb-3">
        <div
          className={cn(
            "w-10 h-10 rounded-xl flex items-center justify-center",
            neumorphicInset,
            "text-emerald-500 dark:text-emerald-400"
          )}
        >
          <IoCheckmarkCircle className="w-5 h-5" />
        </div>
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-gray-700 dark:text-neutral-300">
              PDF Exported
            </span>
            <IoCheckmarkCircle className="w-4 h-4 text-emerald-500 dark:text-emerald-400" />
          </div>
          <p className="text-xs text-gray-500 dark:text-neutral-400">
            Download started automatically
          </p>
        </div>
      </div>

      <div className={cn(neumorphicInset, "p-3")}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <AiOutlineFilePdf className="w-5 h-5 text-red-500" />
            <span className="text-sm text-gray-700 dark:text-neutral-300 font-medium">
              {filename}.pdf
            </span>
          </div>
          {onRedownload && (
            <button
              onClick={onRedownload}
              className={cn(
                neumorphicButton,
                "px-3 py-1.5 flex items-center gap-1.5 text-xs font-medium text-gray-600 dark:text-neutral-400"
              )}
            >
              <IoDownload className="w-3.5 h-3.5" />
              Download Again
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// =============================================================================
// ERROR STATE COMPONENT
// =============================================================================

function ExportError({ error }: { error: string }) {
  return (
    <div className={cn(neumorphicBase, "my-3 p-4 isolate")}>
      <div className="flex items-center gap-3">
        <div
          className={cn(
            "w-10 h-10 rounded-xl flex items-center justify-center",
            neumorphicInset,
            "text-red-500 dark:text-red-400"
          )}
        >
          <IoAlertCircle className="w-5 h-5" />
        </div>
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-gray-700 dark:text-neutral-300">
              Export Failed
            </span>
          </div>
          <p className="text-xs text-red-500 dark:text-red-400 mt-1">
            {error}
          </p>
        </div>
      </div>
    </div>
  );
}

// =============================================================================
// MAIN COMPONENT
// =============================================================================

export function PdfExportView({ invocation }: PdfExportViewProps) {
  const filename = (invocation.input?.filename as string) || "chat-export";

  // AI SDK v6 uses input-streaming and input-available for loading states
  const isLoading =
    invocation.state === "input-streaming" ||
    invocation.state === "input-available" ||
    invocation.state === "partial-call" ||
    invocation.state === "call" ||
    invocation.state === "output-pending";

  // Loading state
  if (isLoading) {
    return <ExportLoading filename={filename} />;
  }

  // Error state
  if (invocation.state === "output-error") {
    const error = (invocation.output as { error?: string })?.error || "Unknown error occurred";
    return <ExportError error={error} />;
  }

  // Completed state
  if (invocation.state === "output-available" && invocation.output) {
    const output = invocation.output as { success?: boolean; filename?: string; error?: string; redownload?: () => void };

    if (output.success) {
      return (
        <ExportSuccess
          filename={output.filename || filename}
          onRedownload={output.redownload}
        />
      );
    } else {
      return <ExportError error={output.error || "Export failed"} />;
    }
  }

  return null;
}

export default PdfExportView;
