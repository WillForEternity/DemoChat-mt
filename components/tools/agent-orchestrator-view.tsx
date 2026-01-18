/**
 * Agent Orchestrator View
 *
 * A unified visualization showing all agents being spawned for a request.
 * Displays a neumorphic slot-based indicator where each slot represents
 * an agent and fills with a checkmark when complete.
 *
 * Features:
 * - Max 6 agent slots displayed in a row
 * - Each slot is an inset rounded-square "hole"
 * - Slots fill with outset checkmarks when agents complete
 * - Clean neumorphic design matching system theme
 */

"use client";

import React, { useMemo } from "react";
import { cn } from "@/lib/utils";
import { IoCheckmark, IoClose } from "react-icons/io5";
import { AiOutlineLoading3Quarters } from "react-icons/ai";

// =============================================================================
// CONSTANTS
// =============================================================================

export const MAX_AGENTS = 6;

// =============================================================================
// TYPES
// =============================================================================

export type AgentStatus = "pending" | "running" | "complete" | "error";

export interface AgentTask {
  id: string;
  name: string;
  type: "context-saver" | "kb-operation" | "main-chat";
  status: AgentStatus;
  description?: string;
  progress?: number;
}

export interface OrchestratorState {
  orchestratorId: string;
  totalAgents: number;
  agents: AgentTask[];
  startTime: number;
  isActive: boolean;
}

interface AgentOrchestratorViewProps {
  state: OrchestratorState;
  /** Override the total agent count (e.g., from counting tool calls) */
  expectedAgentCount?: number;
}

// =============================================================================
// NEUMORPHIC STYLES
// =============================================================================

// Wrapper - uses pure system theme background color (no gradients)
// Compact width that just fits the slots, taller vertically
const neumorphicWrapper = cn(
  "rounded-2xl transition-all duration-300",
  // System background color - matches the theme exactly
  "bg-[#f5f5f5] dark:bg-[#1a1a1a]",
  // Neumorphic shadow effect
  "shadow-[8px_8px_16px_rgba(0,0,0,0.1),-8px_-8px_16px_rgba(255,255,255,0.9)]",
  "dark:shadow-[8px_8px_16px_rgba(0,0,0,0.4),-8px_-8px_16px_rgba(255,255,255,0.05)]"
);

// Inset slot - rounded-square "hole" with pressed-in effect
// Larger slots for better visibility
const neumorphicSlotInset = cn(
  // Rounded square
  "rounded-xl transition-all duration-300",
  // System background color
  "bg-[#f5f5f5] dark:bg-[#1a1a1a]",
  // Inset shadow for "hole" effect - deeper shadows for more pronounced look
  "shadow-[inset_5px_5px_10px_rgba(0,0,0,0.15),inset_-5px_-5px_10px_rgba(255,255,255,0.85)]",
  "dark:shadow-[inset_5px_5px_10px_rgba(0,0,0,0.5),inset_-5px_-5px_10px_rgba(255,255,255,0.05)]"
);

// Outset checkmark button - raised "button" effect when complete
const neumorphicSlotOutset = cn(
  "rounded-xl transition-all duration-300",
  // System background color
  "bg-[#f5f5f5] dark:bg-[#1a1a1a]",
  // Outset shadow for raised button effect
  "shadow-[5px_5px_10px_rgba(0,0,0,0.12),-5px_-5px_10px_rgba(255,255,255,0.9)]",
  "dark:shadow-[5px_5px_10px_rgba(0,0,0,0.4),-5px_-5px_10px_rgba(255,255,255,0.06)]"
);

// =============================================================================
// SLOT COMPONENT
// =============================================================================

interface AgentSlotProps {
  agent?: AgentTask;
  index: number;
}

function AgentSlot({ agent, index }: AgentSlotProps) {
  const status = agent?.status ?? "pending";
  const isComplete = status === "complete";
  const isError = status === "error";
  const isRunning = status === "running";

  return (
    <div
      className={cn(
        // Larger rounded-square slots for better visibility
        "w-14 h-14 flex items-center justify-center",
        // Use inset for empty/pending/running (hole effect), outset for complete/error (button effect)
        isComplete || isError ? neumorphicSlotOutset : neumorphicSlotInset
      )}
      title={agent?.name ?? `Slot ${index + 1}`}
    >
      {isComplete && (
        <IoCheckmark className="w-7 h-7 text-emerald-500 dark:text-emerald-400" />
      )}
      {isError && (
        <IoClose className="w-7 h-7 text-red-500 dark:text-red-400" />
      )}
      {isRunning && (
        <AiOutlineLoading3Quarters className="w-5 h-5 text-gray-400 dark:text-neutral-500 animate-spin" />
      )}
      {/* Pending slots are empty holes - the inset shadow creates the "hole" look */}
    </div>
  );
}

// =============================================================================
// MAIN COMPONENT
// =============================================================================

export function AgentOrchestratorView({ state, expectedAgentCount }: AgentOrchestratorViewProps) {
  const { agents, totalAgents, isActive } = state;

  // Use expectedAgentCount if provided, otherwise fall back to totalAgents
  // This allows us to show all slots immediately when we know how many tool calls there are
  const actualCount = expectedAgentCount ?? totalAgents;
  
  // Cap display at MAX_AGENTS
  const displayCount = Math.min(actualCount, MAX_AGENTS);

  // Calculate stats
  const stats = useMemo(() => {
    const completed = agents.filter((a) => a.status === "complete").length;
    const errors = agents.filter((a) => a.status === "error").length;
    const allDone = displayCount > 0 && completed + errors >= displayCount;

    return { completed, errors, allDone };
  }, [agents, displayCount]);

  // Don't render if no agents expected
  if (displayCount === 0) return null;

  // Create slot array - one slot per expected agent (shows all slots immediately)
  const slots = useMemo(() => {
    const result: (AgentTask | undefined)[] = [];
    for (let i = 0; i < displayCount; i++) {
      result.push(agents[i]);
    }
    return result;
  }, [agents, displayCount]);

  return (
    // Inline-flex so it only takes up as much width as needed
    <div className={cn(neumorphicWrapper, "my-4 py-12 px-10 inline-flex flex-col items-center")}>
      {/* Header row */}
      <div className="flex items-center gap-4 mb-8">
        <span className="text-xs font-medium text-gray-500 dark:text-neutral-400 uppercase tracking-wider">
          Context Agents
        </span>
        <span className={cn(
          "text-xs font-mono",
          stats.allDone
            ? stats.errors > 0
              ? "text-amber-500 dark:text-amber-400"
              : "text-emerald-500 dark:text-emerald-400"
            : "text-gray-400 dark:text-neutral-500"
        )}>
          {stats.completed}/{displayCount}
        </span>
      </div>

      {/* Slots row - larger gap for bigger slots */}
      <div className="flex items-center justify-center gap-3">
        {slots.map((agent, index) => (
          <AgentSlot key={agent?.id ?? `slot-${index}`} agent={agent} index={index} />
        ))}
      </div>

      {/* Status text */}
      {isActive && !stats.allDone && (
        <p className="text-xs text-center text-gray-400 dark:text-neutral-500 mt-8">
          Saving to knowledge base...
        </p>
      )}
    </div>
  );
}

export default AgentOrchestratorView;
