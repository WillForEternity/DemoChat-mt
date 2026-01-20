/**
 * Generate Title API Route
 *
 * AI SDK v6 - Generates a concise title for a chat conversation
 * Uses Claude Sonnet for intelligent summarization
 *
 * This endpoint is called at the end of each chat response to update
 * the conversation title based on the full content of the chat.
 *
 * AUTHENTICATION & BYOK:
 * ----------------------
 * - Owner emails (set in OWNER_EMAILS env var) get free access using env API keys
 * - Other users must provide their own API keys via the request body
 */

import { generateText } from "ai";
import { createAnthropic } from "@ai-sdk/anthropic";
import { getAuthContext, resolveApiKey, createApiKeyRequiredResponse } from "@/lib/auth-helper";

// Maximum duration for the API route (in seconds)
export const maxDuration = 30;

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { messages, anthropicApiKey: userKey } = body;

    // Check authentication and owner status
    const { isOwner } = await getAuthContext();

    // Resolve which API key to use
    const apiKey = resolveApiKey(isOwner, userKey, process.env.ANTHROPIC_API_KEY);

    if (!apiKey) {
      return createApiKeyRequiredResponse();
    }

    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      return new Response(
        JSON.stringify({
          error: "No messages provided.",
        }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    const anthropic = createAnthropic({ apiKey });

    // Extract text content from messages for summarization
    const conversationSummary = messages
      .slice(0, 10) // Limit to first 10 messages to keep prompt concise
      .map((msg: { role: string; parts?: Array<{ type: string; text?: string }> }) => {
        const role = msg.role === "user" ? "User" : "Assistant";
        const textParts = msg.parts
          ?.filter((p) => p.type === "text")
          .map((p) => p.text)
          .join(" ") ?? "";
        // Truncate long messages
        const truncated = textParts.length > 500 ? textParts.slice(0, 500) + "..." : textParts;
        return `${role}: ${truncated}`;
      })
      .join("\n\n");

    // Use generateText for a simple, non-streaming response
    const result = await generateText({
      model: anthropic("claude-sonnet-4-20250514"),
      system: `You are a title generator for chat conversations. Generate a concise, descriptive title (3-7 words) that captures the main topic or purpose of the conversation. 

Rules:
- Output ONLY the title, nothing else
- No quotes, no punctuation at the end
- No prefixes like "Title:" or "Chat:"
- Be specific and informative
- Use Title Case
- If the conversation is about code/programming, mention the language or technology
- If it's a question, capture the core topic being asked about`,
      prompt: `Generate a title for this conversation:\n\n${conversationSummary}`,
      maxTokens: 30,
    });

    const title = result.text.trim();

    return new Response(
      JSON.stringify({ title }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("[Generate Title API] Error:", error);
    return new Response(
      JSON.stringify({
        error: error instanceof Error ? error.message : "Unknown error",
      }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
}
