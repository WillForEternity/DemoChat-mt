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
 */

import { getApiKeys } from "@/lib/api-keys";

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
 * @param openaiApiKey - Optional API key override (defaults to localStorage key)
 */
export async function embedTexts(texts: string[], openaiApiKey?: string): Promise<number[][]> {
  if (texts.length === 0) return [];

  const key = openaiApiKey ?? getOpenAIKey();

  const res = await fetch("/api/embed", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ 
      texts,
      // BYOK: Include user's API key if they have one
      openaiApiKey: key,
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
 * @param openaiApiKey - Optional API key override (defaults to localStorage key)
 */
export async function embedQuery(query: string, openaiApiKey?: string): Promise<number[]> {
  const key = openaiApiKey ?? getOpenAIKey();

  const res = await fetch("/api/embed", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ 
      texts: [query], 
      single: true,
      // BYOK: Include user's API key if they have one
      openaiApiKey: key,
    }),
  });

  if (!res.ok) {
    const error = await res.json().catch(() => ({ error: "Unknown error" }));
    throw new Error(error.error || "Failed to embed query");
  }

  const { embedding } = await res.json();
  return embedding;
}
