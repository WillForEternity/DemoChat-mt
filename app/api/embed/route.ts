/**
 * Embedding API Route
 *
 * Server-side embedding generation using OpenAI's text-embedding-3-small model.
 * This enables semantic search without exposing API keys to the client.
 *
 * Endpoints:
 * - POST with { texts: string[], single?: boolean }
 *   - If single=true: Returns { embedding: number[] } for a query
 *   - Otherwise: Returns { embeddings: number[][] } for batch embedding
 */

import { openai } from "@ai-sdk/openai";
import { embedMany, embed } from "ai";

export const maxDuration = 30;

export async function POST(req: Request) {
  try {
    const { texts, single } = await req.json();

    if (!texts || !Array.isArray(texts) || texts.length === 0) {
      return Response.json(
        { error: "texts array is required and must not be empty" },
        { status: 400 }
      );
    }

    // Check for OpenAI API key
    if (!process.env.OPENAI_API_KEY) {
      return Response.json(
        {
          error:
            "OPENAI_API_KEY is not set. Please add it to your .env.local file for embeddings.",
        },
        { status: 400 }
      );
    }

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
