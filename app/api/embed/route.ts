/**
 * Embedding API Route
 *
 * Server-side embedding generation using OpenAI's embedding models.
 * This enables semantic search without exposing API keys to the client.
 *
 * AUTHENTICATION & BYOK:
 * ----------------------
 * - Owner emails (set in OWNER_EMAILS env var) get free access using env API keys
 * - Other users must provide their own API keys via the request body
 *
 * Endpoints:
 * - POST with { texts: string[], single?: boolean, openaiApiKey?: string, model?: string, dimensions?: number }
 *   - If single=true: Returns { embedding: number[] } for a query
 *   - Otherwise: Returns { embeddings: number[][] } for batch embedding
 *
 * Model Options (2025 Best Practices):
 * - "text-embedding-3-small" (default): 1536 dims, $0.02/1M tokens, good quality
 * - "text-embedding-3-large": 3072 dims (or reduced), $0.13/1M tokens, best quality
 *
 * Dimension Reduction:
 * - Using "text-embedding-3-large" with dimensions=1024 often yields better
 *   accuracy than "small" at 1536, while using less storage.
 */

import { createOpenAI } from "@ai-sdk/openai";
import { embedMany, embed } from "ai";
import { getAuthContext, resolveApiKey, createApiKeyRequiredResponse } from "@/lib/auth-helper";

export const maxDuration = 30;

/**
 * Available embedding models with their default dimensions.
 */
const EMBEDDING_MODELS = {
  "text-embedding-3-small": { maxDimensions: 1536, defaultDimensions: 1536 },
  "text-embedding-3-large": { maxDimensions: 3072, defaultDimensions: 3072 },
} as const;

type EmbeddingModel = keyof typeof EMBEDDING_MODELS;

export async function POST(req: Request) {
  try {
    const {
      texts,
      single,
      openaiApiKey: userKey,
      model: requestedModel,
      dimensions: requestedDimensions,
    } = await req.json();

    if (!texts || !Array.isArray(texts) || texts.length === 0) {
      return Response.json(
        { error: "texts array is required and must not be empty" },
        { status: 400 }
      );
    }

    // Validate and resolve model
    const model: EmbeddingModel =
      requestedModel && requestedModel in EMBEDDING_MODELS
        ? requestedModel
        : "text-embedding-3-small";

    // Validate dimensions
    const modelConfig = EMBEDDING_MODELS[model];
    const dimensions =
      requestedDimensions && requestedDimensions <= modelConfig.maxDimensions
        ? requestedDimensions
        : modelConfig.defaultDimensions;

    // Check authentication and owner status
    const { isOwner } = await getAuthContext();

    // Resolve which API key to use
    const apiKey = resolveApiKey(isOwner, userKey, process.env.OPENAI_API_KEY);

    if (!apiKey) {
      return createApiKeyRequiredResponse();
    }

    // Create OpenAI client with the resolved key
    const openai = createOpenAI({ apiKey });

    // Build the model specification with dimensions if reduced
    // Note: The AI SDK's embedding function doesn't directly support dimensions param,
    // so we need to handle this at the OpenAI level
    const embeddingModel = openai.embedding(model, {
      dimensions: dimensions !== modelConfig.defaultDimensions ? dimensions : undefined,
    });

    if (single) {
      // Single query embedding
      const { embedding } = await embed({
        model: embeddingModel,
        value: texts[0],
      });
      return Response.json({
        embedding,
        model,
        dimensions: embedding.length,
      });
    }

    // Batch embedding for document chunks
    const { embeddings } = await embedMany({
      model: embeddingModel,
      values: texts,
    });
    return Response.json({
      embeddings,
      model,
      dimensions: embeddings[0]?.length ?? dimensions,
    });
  } catch (error) {
    console.error("[Embed API] Error:", error);
    return Response.json(
      { error: error instanceof Error ? error.message : "Embedding failed" },
      { status: 500 }
    );
  }
}
