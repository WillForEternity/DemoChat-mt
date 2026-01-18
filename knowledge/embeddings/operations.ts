/**
 * Embedding Operations
 *
 * Core operations for embedding files and semantic search.
 * Uses hash-based caching to avoid re-embedding unchanged content.
 */

import { chunkMarkdown } from "./chunker";
import { embedTexts, embedQuery } from "./embed-client";
import { getKnowledgeDb, type UmapCache } from "../idb";
import type { EmbeddingRecord, SearchResult } from "./types";
import { UMAP } from "umap-js";

/**
 * Compute SHA-256 hash for content change detection.
 */
async function sha256(text: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(text);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Cosine similarity between two vectors.
 */
function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0,
    normA = 0,
    normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denominator = Math.sqrt(normA) * Math.sqrt(normB);
  return denominator === 0 ? 0 : dot / denominator;
}

/**
 * Embed a file's content, using hash-based caching to avoid re-embedding.
 * Inspired by Cursor's Merkle tree approach for efficient updates.
 */
export async function embedFile(path: string, content: string): Promise<void> {
  const db = await getKnowledgeDb();
  const chunks = chunkMarkdown(content);

  // If no chunks (empty file), just clean up any existing embeddings
  if (chunks.length === 0) {
    await deleteFileEmbeddings(path);
    return;
  }

  // Get existing embeddings for this file
  const existingByHash = new Map<string, EmbeddingRecord>();
  const existing = await db.getAllFromIndex("embeddings", "by-file", path);
  existing.forEach((e) => existingByHash.set(e.contentHash, e));

  // Determine which chunks need embedding (hash changed or new)
  const toEmbed: { chunk: (typeof chunks)[0]; hash: string }[] = [];
  const toKeep: EmbeddingRecord[] = [];

  for (const chunk of chunks) {
    const hash = await sha256(chunk.text);
    const existingRecord = existingByHash.get(hash);
    if (existingRecord) {
      // Reuse existing embedding (may need to update id/index)
      toKeep.push({
        ...existingRecord,
        id: `${path}#${chunk.index}`,
        chunkIndex: chunk.index,
        headingPath: chunk.headingPath,
      });
    } else {
      toEmbed.push({ chunk, hash });
    }
  }

  // Batch embed only new/changed chunks
  if (toEmbed.length > 0) {
    try {
      const embeddings = await embedTexts(toEmbed.map((c) => c.chunk.text));

      for (let i = 0; i < toEmbed.length; i++) {
        const { chunk, hash } = toEmbed[i];
        await db.put("embeddings", {
          id: `${path}#${chunk.index}`,
          filePath: path,
          chunkIndex: chunk.index,
          chunkText: chunk.text,
          contentHash: hash,
          headingPath: chunk.headingPath,
          embedding: embeddings[i],
          updatedAt: Date.now(),
        });
      }
    } catch (error) {
      // Log but don't throw - embedding failure shouldn't block file writes
      console.error("[Embedding] Failed to embed chunks:", error);
      return;
    }
  }

  // Update kept embeddings with new indices
  for (const record of toKeep) {
    await db.put("embeddings", {
      ...record,
      updatedAt: Date.now(),
    });
  }

  // Delete stale embeddings (chunks that no longer exist)
  const currentIds = new Set(chunks.map((_, i) => `${path}#${i}`));
  for (const e of existing) {
    if (!currentIds.has(e.id)) {
      await db.delete("embeddings", e.id);
    }
  }
}

/**
 * Delete all embeddings for a file.
 */
export async function deleteFileEmbeddings(path: string): Promise<void> {
  const db = await getKnowledgeDb();
  const embeddings = await db.getAllFromIndex("embeddings", "by-file", path);
  for (const e of embeddings) {
    await db.delete("embeddings", e.id);
  }
}

/**
 * Semantic search across all embeddings using cosine similarity.
 */
export async function searchEmbeddings(
  query: string,
  topK: number = 5,
  threshold: number = 0.3
): Promise<SearchResult[]> {
  const db = await getKnowledgeDb();

  // Embed the query
  let queryEmbedding: number[];
  try {
    queryEmbedding = await embedQuery(query);
  } catch (error) {
    console.error("[Embedding] Failed to embed query:", error);
    throw new Error("Failed to embed search query. Check that OPENAI_API_KEY is set.");
  }

  // Load all embeddings (fine for <10K chunks)
  const allEmbeddings = await db.getAll("embeddings");

  if (allEmbeddings.length === 0) {
    return [];
  }

  // Compute cosine similarity for each
  const scored = allEmbeddings.map((e) => ({
    ...e,
    score: cosineSimilarity(queryEmbedding, e.embedding),
  }));

  // Filter by threshold and sort by score
  return scored
    .filter((e) => e.score >= threshold)
    .sort((a, b) => b.score - a.score)
    .slice(0, topK)
    .map((e) => ({
      filePath: e.filePath,
      chunkText: e.chunkText,
      headingPath: e.headingPath,
      score: Math.round(e.score * 100) / 100, // Round to 2 decimals
      chunkIndex: e.chunkIndex,
    }));
}

/**
 * Get embedding statistics for debugging/monitoring.
 */
export async function getEmbeddingStats(): Promise<{
  totalChunks: number;
  totalFiles: number;
  averageChunksPerFile: number;
}> {
  const db = await getKnowledgeDb();
  const allEmbeddings = await db.getAll("embeddings");

  const files = new Set(allEmbeddings.map((e) => e.filePath));

  return {
    totalChunks: allEmbeddings.length,
    totalFiles: files.size,
    averageChunksPerFile:
      files.size > 0 ? Math.round(allEmbeddings.length / files.size) : 0,
  };
}

/**
 * Get all embeddings with their metadata for visualization.
 */
export async function getAllEmbeddings(): Promise<EmbeddingRecord[]> {
  const db = await getKnowledgeDb();
  return db.getAll("embeddings");
}

/**
 * Progress callback for reindex operation.
 */
export type ReindexProgressCallback = (progress: {
  current: number;
  total: number;
  currentFile: string;
  status: "indexing" | "computing_umap" | "complete" | "error";
  error?: string;
}) => void;

/**
 * Reindex all files in the knowledge base.
 * This reads every file and embeds it, using hash-based caching
 * to skip unchanged content.
 */
export async function reindexAllFiles(
  onProgress?: ReindexProgressCallback
): Promise<{ indexed: number; skipped: number; errors: string[] }> {
  const db = await getKnowledgeDb();

  // Get all file nodes from the knowledge base
  const allNodes = await db.getAll("nodes");
  const fileNodes = allNodes.filter((node) => node.type === "file");

  console.log(`[Reindex] Found ${allNodes.length} total nodes, ${fileNodes.length} files`);

  const result = {
    indexed: 0,
    skipped: 0,
    errors: [] as string[],
  };

  const total = fileNodes.length;

  if (total === 0) {
    console.log("[Reindex] No files to index. Knowledge base may be empty.");
    onProgress?.({
      current: 0,
      total: 0,
      currentFile: "No files found",
      status: "complete",
    });
    return result;
  }

  for (let i = 0; i < fileNodes.length; i++) {
    const node = fileNodes[i];
    const path = node.path;
    const content = node.content || "";

    onProgress?.({
      current: i + 1,
      total,
      currentFile: path,
      status: "indexing",
    });

    try {
      // Skip empty files
      if (!content.trim()) {
        result.skipped++;
        continue;
      }

      // embedFile uses hash-based caching internally
      await embedFile(path, content);
      result.indexed++;
    } catch (error) {
      const errorMsg = `${path}: ${error instanceof Error ? error.message : String(error)}`;
      result.errors.push(errorMsg);
      console.error("[Reindex] Error:", errorMsg);
    }
  }

  // Compute UMAP projection after all embeddings are done
  onProgress?.({
    current: total,
    total,
    currentFile: "Computing visualization...",
    status: "computing_umap",
  });
  
  await computeAndCacheUmapProjection();

  onProgress?.({
    current: total,
    total,
    currentFile: "",
    status: result.errors.length > 0 ? "error" : "complete",
  });

  return result;
}

/**
 * Clear all embeddings from the database.
 */
export async function clearAllEmbeddings(): Promise<void> {
  const db = await getKnowledgeDb();
  const tx = db.transaction("embeddings", "readwrite");
  await tx.store.clear();
  await tx.done;
  
  // Also clear UMAP cache when embeddings are cleared
  await clearUmapCache();
}

// =============================================================================
// UMAP PROJECTION CACHE
// =============================================================================

/**
 * Get cached UMAP projection for embedding visualization.
 * Returns null if no cache exists or cache is invalid.
 */
export async function getUmapCache(): Promise<UmapCache | null> {
  const db = await getKnowledgeDb();
  const cache = await db.get("metadata", "umap_projection");
  return cache ?? null;
}

/**
 * Save UMAP projection to cache.
 */
export async function saveUmapCache(
  points: Array<{ embeddingId: string; x: number; y: number }>,
  embeddingCount: number
): Promise<void> {
  const db = await getKnowledgeDb();
  await db.put("metadata", {
    id: "umap_projection",
    points,
    computedAt: Date.now(),
    embeddingCount,
  });
}

/**
 * Clear UMAP cache.
 */
export async function clearUmapCache(): Promise<void> {
  const db = await getKnowledgeDb();
  await db.delete("metadata", "umap_projection");
}

/**
 * Compute and cache UMAP projection for all embeddings.
 * Called after reindexing to update the visualization cache.
 */
export async function computeAndCacheUmapProjection(): Promise<void> {
  const db = await getKnowledgeDb();
  const allEmbeddings = await db.getAll("embeddings");
  
  if (allEmbeddings.length < 2) {
    // Clear cache if not enough embeddings
    await clearUmapCache();
    return;
  }
  
  console.log(`[UMAP] Computing projection for ${allEmbeddings.length} embeddings...`);
  
  try {
    // Extract embedding vectors
    const vectors = allEmbeddings.map((e) => e.embedding);
    
    // Configure UMAP for visualization
    const umap = new UMAP({
      nComponents: 2,
      nNeighbors: Math.min(15, allEmbeddings.length - 1),
      minDist: 0.1,
      spread: 1.0,
    });
    
    // Fit and transform
    const projection = await umap.fitAsync(vectors);
    
    // Normalize to [-1, 1] range for easier rendering
    let minX = Infinity, maxX = -Infinity;
    let minY = Infinity, maxY = -Infinity;
    
    for (const [x, y] of projection) {
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
    }
    
    const rangeX = maxX - minX || 1;
    const rangeY = maxY - minY || 1;
    
    const normalizedPoints = projection.map(([x, y], i) => ({
      embeddingId: allEmbeddings[i].id,
      x: ((x - minX) / rangeX) * 2 - 1,
      y: ((y - minY) / rangeY) * 2 - 1,
    }));
    
    // Save to cache
    await saveUmapCache(normalizedPoints, allEmbeddings.length);
    
    console.log(`[UMAP] Projection computed and cached`);
  } catch (error) {
    console.error("[UMAP] Failed to compute projection:", error);
    await clearUmapCache();
  }
}
