/**
 * Embedding Client
 *
 * Client-side service to call the server-side embedding API.
 * Abstracts the API calls for embedding texts and queries.
 */

/**
 * Embed multiple texts (for document chunks).
 * Returns an array of embedding vectors.
 */
export async function embedTexts(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return [];

  const res = await fetch("/api/embed", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ texts }),
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
 */
export async function embedQuery(query: string): Promise<number[]> {
  const res = await fetch("/api/embed", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ texts: [query], single: true }),
  });

  if (!res.ok) {
    const error = await res.json().catch(() => ({ error: "Unknown error" }));
    throw new Error(error.error || "Failed to embed query");
  }

  const { embedding } = await res.json();
  return embedding;
}
