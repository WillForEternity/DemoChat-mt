/**
 * Context Saver API Route
 *
 * This endpoint runs the Context Saver in the background using streamText.
 * It receives information to save and streams the model's response including
 * tool calls back to the client.
 *
 * AI SDK v6 ARCHITECTURE:
 * -----------------------
 * We use streamText instead of ToolLoopAgent because the kb_* tools need to
 * execute client-side (IndexedDB). streamText with maxSteps:1 makes a single
 * pass, streaming tool calls to the client which executes them.
 *
 * The model is instructed to save in a single step (no read-before-write)
 * to avoid the need for multi-step tool loops that require bidirectional
 * communication.
 */

import { streamText } from "ai";
import { getContextSaverConfig } from "@/agents/context-saver-agent";

// Maximum duration for the API route (in seconds)
export const maxDuration = 30;

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { information, context, rootFolders, taskId } = body;

    if (!information) {
      return new Response(
        JSON.stringify({ error: "Missing 'information' field" }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    // Get API key from environment variable
    const apiKey = process.env.ANTHROPIC_API_KEY;

    if (!apiKey) {
      return new Response(
        JSON.stringify({
          error: "ANTHROPIC_API_KEY is not set",
        }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    // Get the model configuration
    const { model, system, tools } = getContextSaverConfig(apiKey, rootFolders ?? []);

    // Build the user message
    const contextSection = context ? `\n\nContext: ${context}` : "";
    const userMessage = `Save this information to the knowledge base:\n\n${information}${contextSection}`;

    // Use streamText for a single-pass response with tool calls
    // The client will receive the tool calls and execute them
    const result = streamText({
      model,
      system,
      tools,
      messages: [{ role: "user", content: userMessage }],
      // Single step - model should save directly without read-first patterns
      maxSteps: 1,
    });

    // Return the stream as a Response with custom headers
    // Use toUIMessageStreamResponse to include tool call events
    return result.toUIMessageStreamResponse({
      headers: {
        "X-Task-Id": taskId || "",
      },
    });
  } catch (error) {
    console.error("[Context Saver API] Error:", error);
    return new Response(
      JSON.stringify({
        error: error instanceof Error ? error.message : "Unknown error",
      }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
}
