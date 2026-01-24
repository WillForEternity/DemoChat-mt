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
 * AUTHENTICATION & BYOK:
 * ----------------------
 * - Owner emails (set in OWNER_EMAILS env var) get free access using env API keys
 * - Other users must provide their own API keys via the request body
 */

import { createAgentUIStreamResponse, smoothStream } from "ai";
import { createChatAgent } from "@/agents";
import { getAuthContext, resolveApiKey, createApiKeyRequiredResponse } from "@/lib/auth-helper";

// Maximum duration for the API route (in seconds)
// Increase this if your agent performs long-running operations
export const maxDuration = 60;

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { messages, rootFolders, kbSummary, modelTier, anthropicApiKey: userKey, useFreeTrial } = body;
    
    console.log("[Chat API] Received modelTier:", modelTier, "useFreeTrial:", useFreeTrial);

    // Check authentication and owner status
    const { isOwner } = await getAuthContext();

    // Resolve which API key to use
    // Free trial users (useFreeTrial=true) get to use the environment key
    const apiKey = resolveApiKey(isOwner, userKey, process.env.ANTHROPIC_API_KEY, useFreeTrial === true);

    if (!apiKey) {
      return createApiKeyRequiredResponse();
    }

    // Create the agent with the API key, Knowledge Base root folders, KB summary, and model tier
    // The kbSummary enables hybrid preload strategy (summary at prompt start, full retrieval on-demand)
    // The modelTier allows switching between Sonnet (master) and Opus (grandmaster)
    const agent = createChatAgent(apiKey, rootFolders ?? [], kbSummary ?? "", modelTier ?? "sonnet");

    const uiMessages = Array.isArray(messages) ? messages : [];

    // Return a streaming response using the v6 agent pattern
    // This handles the full tool execution loop automatically
    // Using smoothStream with line-based chunking for better readability
    return createAgentUIStreamResponse({
      agent,
      uiMessages,
      experimental_transform: smoothStream({ chunking: "line" }),
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
