/**
 * Tools Index
 *
 * AI SDK v6 TOOLS ARCHITECTURE
 * ============================
 *
 * This file exports all tools that are available to your agents.
 * Each tool should be defined in its own file in this directory.
 *
 * HOW TO CREATE A NEW TOOL:
 * -------------------------
 *
 * 1. Create a new file in this directory (e.g., web-search.ts)
 *
 * 2. Define your tool using the `tool` function from 'ai':
 *
 *    import { tool } from "ai";
 *    import { z } from "zod";
 *
 *    export const webSearchTool = tool({
 *      description: "Search the web for information",
 *      inputSchema: z.object({
 *        query: z.string().describe("The search query"),
 *      }),
 *      execute: async ({ query }) => {
 *        // Your tool logic here
 *        return { results: [...] };
 *      },
 *    });
 *
 * 3. Import and add it to the tools object below
 *
 * 4. (Optional) Create a UI component in /components/tools/ to render the tool
 *
 *
 * TOOL FEATURES (AI SDK v6):
 * --------------------------
 *
 * - `needsApproval`: Require user confirmation before execution
 *     needsApproval: true,
 *     // or dynamically:
 *     needsApproval: async ({ input }) => input.isDestructive,
 *
 * - `strict`: Enable strict JSON schema validation (provider-dependent)
 *     strict: true,
 *
 * - `inputExamples`: Help the model understand expected inputs
 *     inputExamples: [
 *       { input: { query: "weather in Tokyo" } },
 *     ],
 *
 * - `toModelOutput`: Control what gets sent back to the model
 *     toModelOutput: async ({ input, output }) => ({
 *       type: "text",
 *       value: `Summary: ${output.summary}`,
 *     }),
 *
 * - Generator functions for streaming tool state:
 *     async *execute({ city }) {
 *       yield { state: "loading" };
 *       const data = await fetchWeather(city);
 *       yield { state: "ready", data };
 *     },
 */

// =============================================================================
// TOOL IMPORTS
// =============================================================================

import type { ToolSet } from "ai";
import { knowledgeTools } from "./knowledge-tools";
import { saveToContextTool } from "./save-to-context";
import { createWebSearchTool } from "./web-search";

// =============================================================================
// TOOLS EXPORT
// =============================================================================

/**
 * All tools available to agents.
 *
 * Knowledge tools (kb_list, kb_read, kb_write, kb_append, kb_mkdir, kb_delete)
 * are executed client-side via the onToolCall callback since IndexedDB runs
 * in the browser.
 *
 * save_to_context spawns a parallel Context Saver agent for background saving.
 */
/**
 * Creates the tools object with the web search tool.
 *
 * We use a factory function because the web search tool requires
 * the Anthropic API key to be configured.
 *
 * @param apiKey - Anthropic API key (required for web search)
 * @returns All tools available to agents
 */
export function createTools(apiKey: string): ToolSet {
  return {
    ...knowledgeTools,
    save_to_context: saveToContextTool,
    web_search: createWebSearchTool(apiKey),
  };
}

/**
 * Static tools that don't require API key configuration.
 * Used for type inference and non-web-search scenarios.
 */
export const staticTools = {
  ...knowledgeTools,
  save_to_context: saveToContextTool,
} as const;

export { knowledgeTools, saveToContextTool, createWebSearchTool };

// =============================================================================
// TYPE EXPORTS
// =============================================================================

/**
 * Type representing all available tools.
 * Useful for type-safe tool handling in components.
 */
export type AvailableTools = ToolSet;
