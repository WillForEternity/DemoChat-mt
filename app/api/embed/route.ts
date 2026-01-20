/**
 * Embedding API Route
 *
 * Server-side embedding generation using OpenAI's text-embedding-3-small model.
 * This enables semantic search without exposing API keys to the client.
 *
 * AUTHENTICATION & BYOK:
 * ----------------------
 * - Owner emails (set in OWNER_EMAILS env var) get free access using env API keys
 * - Other users must provide their own API keys via the request body
 *
 * Endpoints:
 * - POST with { texts: string[], single?: boolean, openaiApiKey?: string }
 *   - If single=true: Returns { embedding: number[] } for a query
 *   - Otherwise: Returns { embeddings: number[][] } for batch embedding
 */

import { createOpenAI } from "@ai-sdk/openai";
import { embedMany, embed } from "ai";
import { getAuthContext, resolveApiKey, createApiKeyRequiredResponse } from "@/lib/auth-helper";

export const maxDuration = 30;

export async function POST(req: Request) {
  try {
    const { texts, single, openaiApiKey: userKey } = await req.json();

    if (!texts || !Array.isArray(texts) || texts.length === 0) {
      return Response.json(
        { error: "texts array is required and must not be empty" },
        { status: 400 }
      );
    }

    // Check authentication and owner status
    const { isOwner } = await getAuthContext();

    // Resolve which API key to use
    const apiKey = resolveApiKey(isOwner, userKey, process.env.OPENAI_API_KEY);

    if (!apiKey) {
      return createApiKeyRequiredResponse();
    }

    // Create OpenAI client with the resolved key
    const openai = createOpenAI({ apiKey });

    if (single) {
      // Single query embedding
      const { embedding } = await embed({
        model: openai.embedding("text-embedding-3-small"),
        value: texts[0],
      });
      return Response.json({ embedding });
    }

    // Batch embedding for document chunks
    const { embeddings } = await embedMany({
      model: openai.embedding("text-embedding-3-small"),
      values: texts,
    });
    return Response.json({ embeddings });
  } catch (error) {
    console.error("[Embed API] Error:", error);
    return Response.json(
      { error: error instanceof Error ? error.message : "Embedding failed" },
      { status: 500 }
    );
  }
}
