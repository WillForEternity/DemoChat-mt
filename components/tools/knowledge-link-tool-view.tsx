/**
 * Knowledge Link Tool Views
 *
 * Neumorphic UI components for displaying knowledge graph tool
 * invocations (kb_link, kb_unlink, kb_links, kb_graph) with
 * expressive animations and visual feedback.
 */

"use client";

import React from "react";
import { cn } from "@/lib/utils";
import {
  IoLink,
  IoUnlink,
  IoGitNetwork,
  IoCheckmarkCircle,
  IoCloseCircle,
  IoArrowForward,
  IoDocument,
} from "react-icons/io5";
import { AiOutlineLoading3Quarters } from "react-icons/ai";
import type { KnowledgeLink, GraphNode, RelationshipType } from "@/knowledge";

// =============================================================================
// TYPES
// =============================================================================

type ToolState =
  | "input-streaming"
  | "input-available"
  | "output-available"
  | "output-error"
  | "partial-call"
  | "call"
  | "output-pending"
  | "approval-requested"
  | "approved"
  | "denied";

interface ToolInvocation {
  type: string;
  state: ToolState;
  toolCallId: string;
  input?: Record<string, unknown>;
  output?: unknown;
}

interface KnowledgeLinkToolViewProps {
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
// RELATIONSHIP COLORS & LABELS
// =============================================================================

const RELATIONSHIP_COLORS: Record<RelationshipType, string> = {
  extends: "text-emerald-600 dark:text-emerald-400",
  references: "text-blue-600 dark:text-blue-400",
  contradicts: "text-red-600 dark:text-red-400",
  requires: "text-amber-600 dark:text-amber-400",
  blocks: "text-rose-600 dark:text-rose-400",
  "relates-to": "text-purple-600 dark:text-purple-400",
};

const RELATIONSHIP_BG: Record<RelationshipType, string> = {
  extends: "bg-emerald-50 dark:bg-emerald-900/30",
  references: "bg-blue-50 dark:bg-blue-900/30",
  contradicts: "bg-red-50 dark:bg-red-900/30",
  requires: "bg-amber-50 dark:bg-amber-900/30",
  blocks: "bg-rose-50 dark:bg-rose-900/30",
  "relates-to": "bg-purple-50 dark:bg-purple-900/30",
};

const RELATIONSHIP_LABELS: Record<RelationshipType, string> = {
  extends: "extends",
  references: "references",
  contradicts: "contradicts",
  requires: "requires",
  blocks: "blocks",
  "relates-to": "relates to",
};

// =============================================================================
// TOOL CONFIG
// =============================================================================

const toolConfig: Record<
  string,
  { icon: React.ComponentType<{ className?: string }>; color: string; label: string; verb: string }
> = {
  kb_link: {
    icon: IoLink,
    color: "text-emerald-500 dark:text-emerald-400",
    label: "Linking",
    verb: "Linked",
  },
  kb_unlink: {
    icon: IoUnlink,
    color: "text-gray-500 dark:text-neutral-400",
    label: "Unlinking",
    verb: "Unlinked",
  },
  kb_links: {
    icon: IoGitNetwork,
    color: "text-blue-500 dark:text-blue-400",
    label: "Querying links",
    verb: "Found links",
  },
  kb_graph: {
    icon: IoGitNetwork,
    color: "text-purple-500 dark:text-purple-400",
    label: "Traversing graph",
    verb: "Traversed",
  },
};

// =============================================================================
// LOADING COMPONENT
// =============================================================================

function ToolLoading({ toolName, description }: { toolName: string; description: string }) {
  const config = toolConfig[toolName] || {
    icon: IoLink,
    color: "text-gray-500",
    label: "Processing",
    verb: "Processed",
  };
  const Icon = config.icon;

  return (
    <div className={cn(neumorphicBase, "relative my-3 p-4 overflow-hidden isolate")}>
      <div className="absolute inset-0 opacity-30 pointer-events-none">
        <div
          className="absolute inset-0 bg-gradient-to-r from-transparent via-white/50 to-transparent dark:via-white/10"
          style={{ animation: "shimmer 2s infinite" }}
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
        <div
          className={cn(
            "relative w-12 h-12 rounded-xl flex items-center justify-center",
            neumorphicInset,
            config.color
          )}
        >
          <Icon className="w-5 h-5" />
          <div
            className={cn("absolute inset-0 rounded-xl border-2 border-current opacity-50", config.color)}
            style={{ animation: "pulse-glow 1.5s ease-in-out infinite" }}
          />
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-gray-700 dark:text-neutral-300">{config.label}</span>
            <AiOutlineLoading3Quarters className={cn("w-3.5 h-3.5 animate-spin", config.color)} />
          </div>
          <p className="text-xs text-gray-500 dark:text-neutral-400 truncate mt-0.5">{description}</p>
        </div>
      </div>
    </div>
  );
}

// =============================================================================
// KB_LINK RESULT
// =============================================================================

function LinkResult({
  link,
  success,
  error,
}: {
  link?: KnowledgeLink;
  success: boolean;
  error?: string;
}) {
  if (!success) {
    return (
      <div className={cn(neumorphicBase, "my-3 p-4 isolate")}>
        <div className="flex items-center gap-3">
          <div className={cn("w-10 h-10 rounded-xl flex items-center justify-center", neumorphicInset, "text-red-500")}>
            <IoCloseCircle className="w-5 h-5" />
          </div>
          <div className="flex-1 min-w-0">
            <span className="text-sm font-medium text-gray-700 dark:text-neutral-300">Link Failed</span>
            <p className="text-xs text-red-500 dark:text-red-400 mt-0.5">{error}</p>
          </div>
        </div>
      </div>
    );
  }

  if (!link) return null;

  const relationship = link.relationship as RelationshipType;
  const sourceName = link.source.split("/").pop() || link.source;
  const targetName = link.target.split("/").pop() || link.target;

  return (
    <div className={cn(neumorphicBase, "my-3 p-4 isolate")}>
      <div className="flex items-center gap-3 mb-3">
        <div className={cn("w-10 h-10 rounded-xl flex items-center justify-center", neumorphicInset, "text-emerald-500")}>
          <IoLink className="w-5 h-5" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-gray-700 dark:text-neutral-300">Link Created</span>
            <IoCheckmarkCircle className="w-4 h-4 text-emerald-500" />
          </div>
          {link.bidirectional && (
            <span className="text-xs text-purple-500 dark:text-purple-400">bidirectional</span>
          )}
        </div>
      </div>

      <div className={cn(neumorphicInset, "p-3")}>
        <div className="flex items-center gap-2 flex-wrap">
          <div className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-white dark:bg-neutral-800 shadow-sm">
            <IoDocument className="w-3.5 h-3.5 text-gray-400" />
            <span className="text-xs font-medium text-gray-600 dark:text-neutral-300">{sourceName}</span>
          </div>

          <div className={cn("flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium", RELATIONSHIP_BG[relationship], RELATIONSHIP_COLORS[relationship])}>
            <IoArrowForward className="w-3 h-3" />
            {RELATIONSHIP_LABELS[relationship]}
            {link.bidirectional && <IoArrowForward className="w-3 h-3 rotate-180" />}
          </div>

          <div className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-white dark:bg-neutral-800 shadow-sm">
            <IoDocument className="w-3.5 h-3.5 text-gray-400" />
            <span className="text-xs font-medium text-gray-600 dark:text-neutral-300">{targetName}</span>
          </div>
        </div>

        {link.notes && (
          <p className="mt-2 text-xs text-gray-500 dark:text-neutral-400 italic">&quot;{link.notes}&quot;</p>
        )}
      </div>
    </div>
  );
}

// =============================================================================
// KB_UNLINK RESULT
// =============================================================================

function UnlinkResult({ deleted, source, target, relationship }: { deleted: boolean; source: string; target: string; relationship: RelationshipType }) {
  const sourceName = source.split("/").pop() || source;
  const targetName = target.split("/").pop() || target;

  return (
    <div className={cn(neumorphicBase, "my-3 p-4 isolate")}>
      <div className="flex items-center gap-3">
        <div className={cn("w-10 h-10 rounded-xl flex items-center justify-center", neumorphicInset, "text-gray-500 dark:text-neutral-400")}>
          <IoUnlink className="w-5 h-5" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-gray-700 dark:text-neutral-300">
              {deleted ? "Link Removed" : "Link Not Found"}
            </span>
            {deleted && <IoCheckmarkCircle className="w-4 h-4 text-gray-500 dark:text-neutral-400" />}
          </div>
          <div className="flex items-center gap-1.5 mt-1 text-xs text-gray-500 dark:text-neutral-400">
            <span>{sourceName}</span>
            <span className={RELATIONSHIP_COLORS[relationship]}>—{RELATIONSHIP_LABELS[relationship]}→</span>
            <span>{targetName}</span>
          </div>
        </div>
      </div>
    </div>
  );
}

// =============================================================================
// KB_LINKS RESULT
// =============================================================================

function LinksResult({
  path,
  outgoing,
  incoming,
  total,
}: {
  path: string;
  outgoing: KnowledgeLink[];
  incoming: KnowledgeLink[];
  total: number;
}) {
  const fileName = path.split("/").pop() || path;

  return (
    <div className={cn(neumorphicBase, "my-3 p-4 isolate")}>
      <div className="flex items-center gap-3 mb-3">
        <div className={cn("w-10 h-10 rounded-xl flex items-center justify-center", neumorphicInset, "text-blue-500")}>
          <IoGitNetwork className="w-5 h-5" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-gray-700 dark:text-neutral-300">Links for {fileName}</span>
            <IoCheckmarkCircle className="w-4 h-4 text-blue-500" />
          </div>
          <p className="text-xs text-gray-500 dark:text-neutral-400">
            {total} connection{total !== 1 ? "s" : ""} ({outgoing.length} outgoing, {incoming.length} incoming)
          </p>
        </div>
      </div>

      {total === 0 ? (
        <div className={cn(neumorphicInset, "p-3 text-center text-sm text-gray-500 dark:text-neutral-400")}>
          No links found for this file
        </div>
      ) : (
        <div className={cn(neumorphicInset, "p-3 space-y-3")}>
          {outgoing.length > 0 && (
            <div>
              <p className="text-xs font-medium text-gray-600 dark:text-neutral-300 mb-1.5">Outgoing</p>
              <div className="flex flex-wrap gap-1.5">
                {outgoing.map((link, i) => {
                  const rel = link.relationship as RelationshipType;
                  const targetName = link.target.split("/").pop() || link.target;
                  return (
                    <div
                      key={i}
                      className={cn("flex items-center gap-1 px-2 py-1 rounded-lg text-xs", RELATIONSHIP_BG[rel])}
                    >
                      <span className={RELATIONSHIP_COLORS[rel]}>{RELATIONSHIP_LABELS[rel]}</span>
                      <IoArrowForward className="w-3 h-3 text-gray-400" />
                      <span className="text-gray-600 dark:text-neutral-300">{targetName}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {incoming.length > 0 && (
            <div>
              <p className="text-xs font-medium text-gray-600 dark:text-neutral-300 mb-1.5">Incoming</p>
              <div className="flex flex-wrap gap-1.5">
                {incoming.map((link, i) => {
                  const rel = link.relationship as RelationshipType;
                  const sourceName = link.source.split("/").pop() || link.source;
                  return (
                    <div
                      key={i}
                      className={cn("flex items-center gap-1 px-2 py-1 rounded-lg text-xs", RELATIONSHIP_BG[rel])}
                    >
                      <span className="text-gray-600 dark:text-neutral-300">{sourceName}</span>
                      <IoArrowForward className="w-3 h-3 text-gray-400" />
                      <span className={RELATIONSHIP_COLORS[rel]}>{RELATIONSHIP_LABELS[rel]}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// =============================================================================
// KB_GRAPH RESULT
// =============================================================================

function GraphResult({
  rootPath,
  depth,
  nodes,
  totalLinks,
}: {
  rootPath: string;
  depth: number;
  nodes: GraphNode[];
  totalLinks: number;
}) {
  const rootName = rootPath.split("/").pop() || rootPath;

  return (
    <div className={cn(neumorphicBase, "my-3 p-4 isolate")}>
      <div className="flex items-center gap-3 mb-3">
        <div className={cn("w-10 h-10 rounded-xl flex items-center justify-center", neumorphicInset, "text-purple-500")}>
          <IoGitNetwork className="w-5 h-5" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-gray-700 dark:text-neutral-300">Graph from {rootName}</span>
            <IoCheckmarkCircle className="w-4 h-4 text-purple-500" />
          </div>
          <p className="text-xs text-gray-500 dark:text-neutral-400">
            {nodes.length} node{nodes.length !== 1 ? "s" : ""}, {totalLinks} link{totalLinks !== 1 ? "s" : ""}, depth {depth}
          </p>
        </div>
      </div>

      {nodes.length === 0 ? (
        <div className={cn(neumorphicInset, "p-3 text-center text-sm text-gray-500 dark:text-neutral-400")}>
          No connected nodes found
        </div>
      ) : (
        <div className={cn(neumorphicInset, "p-3")}>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            {nodes.map((node, i) => {
              const nodeName = node.path.split("/").pop() || node.path;
              const isRoot = node.path === rootPath;
              const linkCount = node.links.outgoing.length + node.links.incoming.length;

              return (
                <div
                  key={i}
                  className={cn(
                    "p-2 rounded-lg text-xs",
                    isRoot
                      ? "bg-purple-100 dark:bg-purple-900/30 ring-1 ring-purple-300 dark:ring-purple-700"
                      : "bg-white dark:bg-neutral-800 shadow-sm"
                  )}
                >
                  <div className="flex items-center gap-1.5">
                    <IoDocument className={cn("w-3.5 h-3.5", isRoot ? "text-purple-500" : "text-gray-400")} />
                    <span className={cn("font-medium truncate", isRoot ? "text-purple-700 dark:text-purple-300" : "text-gray-600 dark:text-neutral-300")}>
                      {nodeName}
                    </span>
                  </div>
                  {linkCount > 0 && (
                    <p className="mt-1 text-[10px] text-gray-500 dark:text-neutral-400">
                      {linkCount} link{linkCount !== 1 ? "s" : ""}
                    </p>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

// =============================================================================
// MAIN COMPONENT
// =============================================================================

export function KnowledgeLinkToolView({ toolName, invocation }: KnowledgeLinkToolViewProps) {
  const isLoading =
    invocation.state === "input-streaming" ||
    invocation.state === "input-available" ||
    invocation.state === "partial-call" ||
    invocation.state === "call" ||
    invocation.state === "output-pending";

  // Build loading description based on tool and input
  const getLoadingDescription = () => {
    const input = invocation.input || {};
    switch (toolName) {
      case "kb_link":
        return `${input.source || "..."} → ${input.target || "..."}`;
      case "kb_unlink":
        return `${input.source || "..."} → ${input.target || "..."}`;
      case "kb_links":
        return input.path as string || "...";
      case "kb_graph":
        return `Starting from ${input.startPath || "..."}`;
      default:
        return "...";
    }
  };

  if (isLoading) {
    return <ToolLoading toolName={toolName} description={getLoadingDescription()} />;
  }

  if (invocation.state === "output-available" && invocation.output) {
    const output = invocation.output as Record<string, unknown>;
    const input = invocation.input || {};

    switch (toolName) {
      case "kb_link":
        return (
          <LinkResult
            link={output.link as KnowledgeLink | undefined}
            success={output.success as boolean}
            error={output.error as string | undefined}
          />
        );

      case "kb_unlink":
        return (
          <UnlinkResult
            deleted={output.deleted as boolean}
            source={input.source as string}
            target={input.target as string}
            relationship={input.relationship as RelationshipType}
          />
        );

      case "kb_links":
        return (
          <LinksResult
            path={output.path as string}
            outgoing={(output.outgoing as KnowledgeLink[]) || []}
            incoming={(output.incoming as KnowledgeLink[]) || []}
            total={output.total as number}
          />
        );

      case "kb_graph":
        return (
          <GraphResult
            rootPath={output.rootPath as string}
            depth={output.depth as number}
            nodes={(output.nodes as GraphNode[]) || []}
            totalLinks={output.totalLinks as number}
          />
        );

      default:
        return null;
    }
  }

  return null;
}

export default KnowledgeLinkToolView;
