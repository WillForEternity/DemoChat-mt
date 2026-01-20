/**
 * Large Documents IndexedDB Store
 *
 * Separate IndexedDB database for large document storage.
 * Keeps large documents isolated from the main knowledge base
 * to avoid performance issues with the regular KB operations.
 *
 * Version history:
 * - v1: Initial documents and chunks stores
 * - v2: Added metadata store for UMAP projection cache
 */

import { openDB, type DBSchema, type IDBPDatabase } from "idb";
import type { LargeDocumentMetadata, LargeDocumentChunk } from "./types";

// =============================================================================
// UMAP CACHE TYPES
// =============================================================================

/** Maximum number of document UMAP projections to cache */
const MAX_CACHED_PROJECTIONS = 10;

/**
 * Cached UMAP projection for a single document's embedding visualization.
 */
export interface DocumentUmapProjection {
  /** Document ID this projection is for */
  documentId: string;
  /** 2D coordinates for each chunk */
  points: Array<{ chunkIndex: number; x: number; y: number }>;
  /** Timestamp of when this projection was computed */
  computedAt: number;
  /** Number of chunks when projection was computed (for invalidation) */
  chunkCount: number;
}

/**
 * Cache storing up to 10 most recently used document UMAP projections.
 */
export interface DocumentUmapCache {
  id: "doc_umap_cache";
  /** Array of cached projections, most recent first */
  projections: DocumentUmapProjection[];
}

// =============================================================================
// DATABASE SCHEMA
// =============================================================================

interface LargeDocumentsDbSchema extends DBSchema {
  documents: {
    key: string;
    value: LargeDocumentMetadata;
    indexes: {
      "by-filename": string;
      "by-status": string;
    };
  };
  chunks: {
    key: string;
    value: LargeDocumentChunk;
    indexes: {
      "by-document": string;
      "by-hash": string;
    };
  };
  metadata: {
    key: string;
    value: DocumentUmapCache;
  };
}

let dbPromise: Promise<IDBPDatabase<LargeDocumentsDbSchema>> | null = null;

/**
 * Get the large documents database instance.
 */
export function getLargeDocumentsDb() {
  if (!dbPromise) {
    dbPromise = openDB<LargeDocumentsDbSchema>("large_documents_v1", 2, {
      upgrade(db, oldVersion, newVersion) {
        console.log(`[LargeDocs DB] Upgrading from v${oldVersion} to v${newVersion}`);

        // Create documents store (v1)
        if (!db.objectStoreNames.contains("documents")) {
          console.log("[LargeDocs DB] Creating documents store");
          const docsStore = db.createObjectStore("documents", { keyPath: "id" });
          docsStore.createIndex("by-filename", "filename", { unique: false });
          docsStore.createIndex("by-status", "status", { unique: false });
        }

        // Create chunks store (v1)
        if (!db.objectStoreNames.contains("chunks")) {
          console.log("[LargeDocs DB] Creating chunks store");
          const chunksStore = db.createObjectStore("chunks", { keyPath: "id" });
          chunksStore.createIndex("by-document", "documentId", { unique: false });
          chunksStore.createIndex("by-hash", "contentHash", { unique: false });
        }

        // Create metadata store for UMAP cache (v2)
        if (!db.objectStoreNames.contains("metadata")) {
          console.log("[LargeDocs DB] Creating metadata store for UMAP cache");
          db.createObjectStore("metadata", { keyPath: "id" });
        }

        console.log("[LargeDocs DB] Upgrade complete");
      },
    });
  }
  return dbPromise;
}

/**
 * Clear all data from the large documents database.
 */
export async function clearLargeDocumentsDb(): Promise<void> {
  const db = await getLargeDocumentsDb();
  
  const tx = db.transaction(["documents", "chunks", "metadata"], "readwrite");
  await Promise.all([
    tx.objectStore("documents").clear(),
    tx.objectStore("chunks").clear(),
    tx.objectStore("metadata").clear(),
    tx.done,
  ]);
}

// =============================================================================
// UMAP CACHE OPERATIONS
// =============================================================================

/**
 * Get cached UMAP projection for a specific document.
 * Returns undefined if not cached or if chunk count has changed.
 */
export async function getDocumentUmapCache(
  documentId: string,
  expectedChunkCount: number
): Promise<DocumentUmapProjection | undefined> {
  const db = await getLargeDocumentsDb();
  const cache = await db.get("metadata", "doc_umap_cache");
  
  if (!cache) return undefined;
  
  const projection = cache.projections.find((p) => p.documentId === documentId);
  
  // Invalidate if chunk count changed
  if (projection && projection.chunkCount !== expectedChunkCount) {
    return undefined;
  }
  
  return projection;
}

/**
 * Save UMAP projection for a document to cache.
 * Maintains LRU cache of up to MAX_CACHED_PROJECTIONS documents.
 */
export async function saveDocumentUmapCache(
  documentId: string,
  points: Array<{ chunkIndex: number; x: number; y: number }>,
  chunkCount: number
): Promise<void> {
  const db = await getLargeDocumentsDb();
  
  // Get existing cache
  let cache = await db.get("metadata", "doc_umap_cache");
  
  if (!cache) {
    cache = {
      id: "doc_umap_cache",
      projections: [],
    };
  }
  
  // Remove existing projection for this document (if any)
  cache.projections = cache.projections.filter((p) => p.documentId !== documentId);
  
  // Add new projection at the front (most recent)
  cache.projections.unshift({
    documentId,
    points,
    computedAt: Date.now(),
    chunkCount,
  });
  
  // Trim to max size (keep most recent)
  if (cache.projections.length > MAX_CACHED_PROJECTIONS) {
    cache.projections = cache.projections.slice(0, MAX_CACHED_PROJECTIONS);
  }
  
  await db.put("metadata", cache);
  console.log(`[LargeDocs] Cached UMAP projection for document (${cache.projections.length} cached total)`);
}

/**
 * Remove UMAP projection for a specific document from cache.
 * Called when a document is deleted.
 */
export async function removeDocumentUmapCache(documentId: string): Promise<void> {
  const db = await getLargeDocumentsDb();
  const cache = await db.get("metadata", "doc_umap_cache");
  
  if (!cache) return;
  
  cache.projections = cache.projections.filter((p) => p.documentId !== documentId);
  await db.put("metadata", cache);
}

/**
 * Clear all UMAP projection caches.
 */
export async function clearDocumentUmapCache(): Promise<void> {
  const db = await getLargeDocumentsDb();
  await db.delete("metadata", "doc_umap_cache");
}
