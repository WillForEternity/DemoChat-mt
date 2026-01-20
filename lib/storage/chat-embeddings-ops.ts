/**
 * Chat Embedding Operations
 *
 * Core operations for embedding chat conversations and semantic search.
 * Uses hash-based caching to avoid re-embedding unchanged content.
 * Mirrors the KB embedding operations but for chat history.
 */

import { UMAP } from "umap-js";
import { embedTexts } from "@/knowledge/embeddings/embed-client";
import type { ChatConversation } from "@/lib/chat-types";
import { chunkChatMessages, computeConversationContentHash } from "./chat-chunker";
import {
  getChatEmbeddingsDb,
  saveChatUmapCache,
  clearChatUmapCache,
  type ChatEmbeddingRecord,
  type ChatSearchResult,
} from "./chat-embeddings-idb";

// =============================================================================
// HELPERS
// =============================================================================

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

// =============================================================================
// CORE OPERATIONS
// =============================================================================

/**
 * Embed a conversation's messages, using hash-based caching to avoid re-embedding.
 * Only embeds chunks whose content has changed.
 */
export async function embedChat(conversation: ChatConversation): Promise<void> {
  const db = await getChatEmbeddingsDb();
  const { id: conversationId, title: conversationTitle, messages } = conversation;

  // Chunk the messages
  const chunks = chunkChatMessages(messages);

  // If no chunks (empty or all tool calls), clean up any existing embeddings
  if (chunks.length === 0) {
    await deleteChatEmbeddings(conversationId);
    return;
  }

  // Get existing embeddings for this conversation
  const existingByHash = new Map<string, ChatEmbeddingRecord>();
  const existing = await db.getAllFromIndex("embeddings", "by-chat", conversationId);
  existing.forEach((e) => existingByHash.set(e.contentHash, e));

  // Determine which chunks need embedding (hash changed or new)
  const toEmbed: { chunk: (typeof chunks)[0]; hash: string }[] = [];
  const toKeep: ChatEmbeddingRecord[] = [];

  for (const chunk of chunks) {
    const hash = await sha256(chunk.text);
    const existingRecord = existingByHash.get(hash);
    if (existingRecord) {
      // Reuse existing embedding (may need to update id/index/title)
      toKeep.push({
        ...existingRecord,
        id: `chat:${conversationId}#${chunk.index}`,
        chunkIndex: chunk.index,
        conversationTitle, // Update title in case it changed
        messageRole: chunk.messageRole,
        messageIndex: chunk.messageIndex,
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
          id: `chat:${conversationId}#${chunk.index}`,
          conversationId,
          conversationTitle,
          chunkIndex: chunk.index,
          chunkText: chunk.text,
          contentHash: hash,
          messageRole: chunk.messageRole,
          messageIndex: chunk.messageIndex,
          embedding: embeddings[i],
          updatedAt: Date.now(),
          source: "chat",
        });
      }

      console.log(`[ChatEmbedding] Embedded ${toEmbed.length} new chunks for "${conversationTitle}"`);
    } catch (error) {
      // Log but don't throw - embedding failure shouldn't block chat saves
      console.error("[ChatEmbedding] Failed to embed chunks:", error);
      return;
    }
  }

  // Update kept embeddings with new indices/title
  for (const record of toKeep) {
    await db.put("embeddings", {
      ...record,
      updatedAt: Date.now(),
    });
  }

  // Delete stale embeddings (chunks that no longer exist)
  const currentIds = new Set(chunks.map((_, i) => `chat:${conversationId}#${i}`));
  for (const e of existing) {
    if (!currentIds.has(e.id)) {
      await db.delete("embeddings", e.id);
    }
  }
}

/**
 * Delete all embeddings for a conversation.
 */
export async function deleteChatEmbeddings(conversationId: string): Promise<void> {
  const db = await getChatEmbeddingsDb();
  const embeddings = await db.getAllFromIndex("embeddings", "by-chat", conversationId);
  for (const e of embeddings) {
    await db.delete("embeddings", e.id);
  }
  console.log(`[ChatEmbedding] Deleted embeddings for conversation ${conversationId}`);
}

/**
 * Hybrid search across all chat embeddings using lexical + semantic + RRF fusion.
 * Supports optional reranking for improved accuracy.
 */
export async function searchChatEmbeddings(
  query: string,
  topK: number = 5,
  threshold: number = 0.3
): Promise<ChatSearchResult[]> {
  // Use the new hybrid search with reranking
  const { chatHybridSearch } = await import("./chat-hybrid-search");
  
  const results = await chatHybridSearch(query, {
    topK,
    threshold,
    rerank: true, // Auto-detect backend availability
  });

  // Map to existing ChatSearchResult format for backward compatibility
  return results.map((r) => ({
    conversationId: r.conversationId,
    conversationTitle: r.conversationTitle,
    chunkText: r.chunkText,
    messageRole: r.messageRole,
    score: r.score,
    chunkIndex: r.chunkIndex,
  }));
}

// =============================================================================
// CHANGE DETECTION
// =============================================================================

// In-memory cache of conversation content hashes for change detection
const conversationHashCache = new Map<string, string>();

/**
 * Embed a conversation only if its content has changed.
 * Uses a simple content hash to detect changes.
 */
export async function embedChatIfChanged(conversation: ChatConversation): Promise<boolean> {
  const { id, messages } = conversation;

  // Compute current content hash
  const currentHash = computeConversationContentHash(messages);

  // Check if we've seen this exact content before
  const cachedHash = conversationHashCache.get(id);
  if (cachedHash === currentHash) {
    // Content unchanged, skip embedding
    return false;
  }

  // Content changed or new - embed it
  await embedChat(conversation);

  // Update cache
  conversationHashCache.set(id, currentHash);

  return true;
}

/**
 * Clear the hash cache (useful for forcing re-embedding).
 */
export function clearConversationHashCache(): void {
  conversationHashCache.clear();
}

// =============================================================================
// REINDEX
// =============================================================================

/**
 * Progress callback for chat reindex operation.
 */
export type ChatReindexProgressCallback = (progress: {
  current: number;
  total: number;
  currentChat: string;
  status: "indexing" | "computing_umap" | "complete" | "error";
  error?: string;
}) => void;

/**
 * Reindex all conversations.
 * This embeds every conversation, using hash-based caching
 * to skip unchanged content.
 */
export async function reindexAllChats(
  conversations: ChatConversation[],
  onProgress?: ChatReindexProgressCallback
): Promise<{ indexed: number; skipped: number; errors: string[] }> {
  const result = {
    indexed: 0,
    skipped: 0,
    errors: [] as string[],
  };

  const total = conversations.length;

  if (total === 0) {
    console.log("[ChatReindex] No conversations to index.");
    onProgress?.({
      current: 0,
      total: 0,
      currentChat: "No conversations found",
      status: "complete",
    });
    return result;
  }

  console.log(`[ChatReindex] Indexing ${total} conversations...`);

  for (let i = 0; i < conversations.length; i++) {
    const conversation = conversations[i];

    onProgress?.({
      current: i + 1,
      total,
      currentChat: conversation.title || "Untitled",
      status: "indexing",
    });

    try {
      // Skip empty conversations
      if (!conversation.messages || conversation.messages.length === 0) {
        result.skipped++;
        continue;
      }

      // embedChat uses hash-based caching internally
      await embedChat(conversation);
      result.indexed++;
    } catch (error) {
      const errorMsg = `${conversation.title}: ${error instanceof Error ? error.message : String(error)}`;
      result.errors.push(errorMsg);
      console.error("[ChatReindex] Error:", errorMsg);
    }
  }

  // Compute UMAP projection after all embeddings are done
  onProgress?.({
    current: total,
    total,
    currentChat: "Computing visualization...",
    status: "computing_umap",
  });

  await computeAndCacheChatUmapProjection();

  onProgress?.({
    current: total,
    total,
    currentChat: "",
    status: result.errors.length > 0 ? "error" : "complete",
  });

  return result;
}

// =============================================================================
// UMAP PROJECTION
// =============================================================================

/**
 * Compute and cache UMAP projection for all chat embeddings.
 * Called after reindexing to update the visualization cache.
 */
export async function computeAndCacheChatUmapProjection(): Promise<void> {
  const db = await getChatEmbeddingsDb();
  const allEmbeddings = await db.getAll("embeddings");

  if (allEmbeddings.length < 2) {
    // Clear cache if not enough embeddings
    await clearChatUmapCache();
    return;
  }

  console.log(`[ChatUMAP] Computing projection for ${allEmbeddings.length} embeddings...`);

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
    let minX = Infinity,
      maxX = -Infinity;
    let minY = Infinity,
      maxY = -Infinity;

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
    await saveChatUmapCache(normalizedPoints, allEmbeddings.length);

    console.log(`[ChatUMAP] Projection computed and cached`);
  } catch (error) {
    console.error("[ChatUMAP] Failed to compute projection:", error);
    await clearChatUmapCache();
  }
}
