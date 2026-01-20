/**
 * Embedding Client
 *
 * Client-side service to call the server-side embedding API.
 * Abstracts the API calls for embedding texts and queries.
 *
 * BYOK (Bring Your Own Key):
 * --------------------------
 * Functions accept an optional openaiApiKey parameter for users who
 * provide their own API keys. Owner users don't need to provide a key.
 *
 * 2025 Best Practices:
 * - Default: text-embedding-3-small (1536 dims) - good quality, low cost
 * - Optional: text-embedding-3-large with dimension reduction for better accuracy
 */

import { getApiKeys } from "@/lib/api-keys";

/**
 * Available embedding models.
 */
export type EmbeddingModel = "text-embedding-3-small" | "text-embedding-3-large";

/**
 * Options for embedding operations.
 */
export interface EmbedOptions {
  /** OpenAI API key override */
  openaiApiKey?: string;
  /** Which model to use (default: text-embedding-3-small) */
  model?: EmbeddingModel;
  /** 
   * Dimension reduction (only for text-embedding-3-large).
   * Using 1024 dims with "large" often beats 1536 dims with "small".
   */
  dimensions?: number;
}

/**
 * Get the current OpenAI API key from localStorage (if any)
 */
function getOpenAIKey(): string | undefined {
  return getApiKeys().openaiApiKey;
}

/**
 * Embed multiple texts (for document chunks).
 * Returns an array of embedding vectors.
 * 
 * @param texts - Array of text strings to embed
 * @param optionsOrKey - EmbedOptions object or API key string (legacy support)
 */
export async function embedTexts(
  texts: string[],
  optionsOrKey?: EmbedOptions | string
): Promise<number[][]> {
  if (texts.length === 0) return [];

  // Support legacy signature (just API key string)
  const options: EmbedOptions =
    typeof optionsOrKey === "string"
      ? { openaiApiKey: optionsOrKey }
      : optionsOrKey ?? {};

  const { openaiApiKey, model, dimensions } = options;
  const key = openaiApiKey ?? getOpenAIKey();

  const res = await fetch("/api/embed", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      texts,
      openaiApiKey: key,
      model,
      dimensions,
    }),
  });

  if (!res.ok) {
    const error = await res.json().catch(() => ({ error: "Unknown error" }));
    throw new Error(error.error || "Failed to embed texts");
  }

  const { embeddings } = await res.json();
  return embeddings;
}

/**
 * Embed a single query string.
 * Returns a single embedding vector.
 * 
 * @param query - Query string to embed
 * @param optionsOrKey - EmbedOptions object or API key string (legacy support)
 */
export async function embedQuery(
  query: string,
  optionsOrKey?: EmbedOptions | string
): Promise<number[]> {
  // Support legacy signature (just API key string)
  const options: EmbedOptions =
    typeof optionsOrKey === "string"
      ? { openaiApiKey: optionsOrKey }
      : optionsOrKey ?? {};

  const { openaiApiKey, model, dimensions } = options;
  const key = openaiApiKey ?? getOpenAIKey();

  const res = await fetch("/api/embed", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      texts: [query],
      single: true,
      openaiApiKey: key,
      model,
      dimensions,
    }),
  });

  if (!res.ok) {
    const error = await res.json().catch(() => ({ error: "Unknown error" }));
    throw new Error(error.error || "Failed to embed query");
  }

  const { embedding } = await res.json();
  return embedding;
}

/**
 * Get embedding configuration recommendations based on use case.
 */
export function getRecommendedEmbedConfig(
  useCase: "default" | "high-precision" | "cost-optimized"
): EmbedOptions {
  switch (useCase) {
    case "high-precision":
      // Use large model with reduced dimensions for best accuracy/cost balance
      return {
        model: "text-embedding-3-large",
        dimensions: 1024, // Better than small@1536, smaller storage
      };
    case "cost-optimized":
      return {
        model: "text-embedding-3-small",
        // No dimension reduction, use default 1536
      };
    case "default":
    default:
      return {
        model: "text-embedding-3-small",
      };
  }
}
