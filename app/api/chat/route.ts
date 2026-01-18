/**
 * Chat API Route
 *
 * AI SDK v6 API ROUTE PATTERN
 * ===========================
 *
 * This route handles chat requests using the ToolLoopAgent pattern.
 * The agent automatically handles tool execution loops, running tools
 * and feeding results back to the model until the task is complete.
 *
 * CONTEXT ENGINEERING:
 * -------------------
 * The client sends:
 * - `rootFolders` - List of top-level folders in the Knowledge Base
 * - `kbSummary` - Pre-generated summary of KB contents (hybrid preload strategy)
 *
 * These are included in Claude's system prompt with XML structure at the top
 * for improved retrieval accuracy (research shows up to 30% improvement).
 *
 * SETUP REQUIRED:
 * ---------------
 * Create a .env.local file in the project root with your Anthropic API key:
 *
 *   ANTHROPIC_API_KEY=sk-ant-api03-your-key-here
 *
 * Get your API key at: https://console.anthropic.com/settings/keys
 */

import { createAgentUIStreamResponse } from "ai";
import { createChatAgent } from "@/agents";

// Maximum duration for the API route (in seconds)
// Increase this if your agent performs long-running operations
export const maxDuration = 60;

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { messages, rootFolders, kbSummary } = body;

    // Get API key from environment variable
    const apiKey = process.env.ANTHROPIC_API_KEY;

    if (!apiKey) {
      return new Response(
        JSON.stringify({
          error:
            "ANTHROPIC_API_KEY is not set. Please create a .env.local file with your API key. See README.md for instructions.",
        }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    // Create the agent with the API key, Knowledge Base root folders, and KB summary
    // The kbSummary enables hybrid preload strategy (summary at prompt start, full retrieval on-demand)
    const agent = createChatAgent(apiKey, rootFolders ?? [], kbSummary ?? "");

    const uiMessages = Array.isArray(messages) ? messages : [];

    // Return a streaming response using the v6 agent pattern
    // This handles the full tool execution loop automatically
    return createAgentUIStreamResponse({
      agent,
      uiMessages,
    });
  } catch (error) {
    console.error("[Chat API] Error:", error);
    return new Response(
      JSON.stringify({
        error: error instanceof Error ? error.message : "Unknown error",
      }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
}
