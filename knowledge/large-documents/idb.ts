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
 * - v3: Added files store for original file data
 * - v4: Migrated UMAP cache from single-record blob to individual per-document
 *        records in a dedicated umap_projections store (LRU managed, max 10)
 */

import { openDB, type DBSchema, type IDBPDatabase } from "idb";
import type { LargeDocumentMetadata, LargeDocumentChunk, LargeDocumentFile } from "./types";

// =============================================================================
// UMAP CACHE TYPES
// =============================================================================

/** Maximum number of document UMAP projections to cache */
const MAX_CACHED_PROJECTIONS = 10;

/**
 * Cached UMAP projection for a single document's embedding visualization.
 * Each projection is stored as its own IndexedDB record keyed by documentId.
 */
export interface DocumentUmapProjection {
  /** Document ID this projection is for (also the record key) */
  documentId: string;
  /** 2D coordinates for each chunk */
  points: Array<{ chunkIndex: number; x: number; y: number }>;
  /** Timestamp of when this projection was computed */
  computedAt: number;
  /** Number of chunks when projection was computed (for invalidation) */
  chunkCount: number;
}

/**
 * @deprecated Retained for backward-compat during v4 migration.
 * The old single-record cache format from v2/v3.
 */
export interface DocumentUmapCache {
  id: "doc_umap_cache";
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
  files: {
    key: string;
    value: LargeDocumentFile;
  };
  umap_projections: {
    key: string;
    value: DocumentUmapProjection;
  };
}

let dbPromise: Promise<IDBPDatabase<LargeDocumentsDbSchema>> | null = null;

/**
 * Get the large documents database instance.
 */
export function getLargeDocumentsDb() {
  if (!dbPromise) {
    dbPromise = openDB<LargeDocumentsDbSchema>("large_documents_v1", 4, {
      upgrade(db, oldVersion, newVersion, transaction) {
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

        // Create metadata store for UMAP cache (v2) - kept for migration
        if (!db.objectStoreNames.contains("metadata")) {
          console.log("[LargeDocs DB] Creating metadata store for UMAP cache");
          db.createObjectStore("metadata", { keyPath: "id" });
        }

        // Create files store for original file data (v3)
        if (!db.objectStoreNames.contains("files")) {
          console.log("[LargeDocs DB] Creating files store for document viewing");
          db.createObjectStore("files", { keyPath: "documentId" });
        }

        // Create per-document UMAP projections store (v4)
        if (!db.objectStoreNames.contains("umap_projections")) {
          console.log("[LargeDocs DB] Creating umap_projections store (individual records)");
          db.createObjectStore("umap_projections", { keyPath: "documentId" });
        }

        // Migrate data from old single-blob metadata store → new umap_projections store (v3→v4)
        if (oldVersion >= 2 && oldVersion < 4) {
          console.log("[LargeDocs DB] Migrating UMAP cache from metadata → umap_projections");
          const metadataStore = transaction.objectStore("metadata");
          const umapStore = transaction.objectStore("umap_projections");
          const request = metadataStore.get("doc_umap_cache");
          request.onsuccess = () => {
            const oldCache = request.result as DocumentUmapCache | undefined;
            if (oldCache?.projections?.length) {
              for (const proj of oldCache.projections) {
                umapStore.put(proj);
              }
              metadataStore.delete("doc_umap_cache");
              console.log(`[LargeDocs DB] Migrated ${oldCache.projections.length} UMAP projections`);
            }
          };
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
  
  const storeNames: (keyof LargeDocumentsDbSchema)[] = ["documents", "chunks", "metadata", "files", "umap_projections"];
  const tx = db.transaction(storeNames, "readwrite");
  await Promise.all([
    tx.objectStore("documents").clear(),
    tx.objectStore("chunks").clear(),
    tx.objectStore("metadata").clear(),
    tx.objectStore("files").clear(),
    tx.objectStore("umap_projections").clear(),
    tx.done,
  ]);
}

// =============================================================================
// FILE STORAGE OPERATIONS
// =============================================================================

/**
 * Store original file data for viewing.
 */
export async function storeDocumentFile(
  documentId: string,
  data: ArrayBuffer,
  mimeType: string
): Promise<void> {
  const db = await getLargeDocumentsDb();
  await db.put("files", { documentId, data, mimeType });
}

/**
 * Get original file data for viewing.
 */
export async function getDocumentFile(
  documentId: string
): Promise<LargeDocumentFile | undefined> {
  const db = await getLargeDocumentsDb();
  return db.get("files", documentId);
}

/**
 * Delete original file data.
 */
export async function deleteDocumentFile(documentId: string): Promise<void> {
  const db = await getLargeDocumentsDb();
  await db.delete("files", documentId);
}

// =============================================================================
// UMAP CACHE OPERATIONS
// =============================================================================
// Each UMAP projection is stored as its own record in umap_projections,
// keyed by documentId. This avoids loading/writing all projections for every
// single read/write. LRU eviction maintains the max cache size.

/**
 * Get cached UMAP projection for a specific document.
 * Returns undefined if not cached or if chunk count has changed.
 * O(1) lookup — reads only the requested document's record.
 */
export async function getDocumentUmapCache(
  documentId: string,
  expectedChunkCount: number
): Promise<DocumentUmapProjection | undefined> {
  const db = await getLargeDocumentsDb();
  const projection = await db.get("umap_projections", documentId);
  
  if (!projection) return undefined;
  
  // Invalidate if chunk count changed
  if (projection.chunkCount !== expectedChunkCount) {
    return undefined;
  }
  
  return projection;
}

/**
 * Save UMAP projection for a document to cache.
 * Maintains LRU cache of up to MAX_CACHED_PROJECTIONS documents.
 * Evicts the oldest projection if the cache is full.
 */
export async function saveDocumentUmapCache(
  documentId: string,
  points: Array<{ chunkIndex: number; x: number; y: number }>,
  chunkCount: number
): Promise<void> {
  const db = await getLargeDocumentsDb();

  const newProjection: DocumentUmapProjection = {
    documentId,
    points,
    computedAt: Date.now(),
    chunkCount,
  };

  // Check cache size and evict oldest if needed
  const allProjections = await db.getAll("umap_projections");
  // Exclude the current document from count (we're replacing it)
  const othersCount = allProjections.filter((p) => p.documentId !== documentId).length;

  if (othersCount >= MAX_CACHED_PROJECTIONS) {
    // Evict the oldest projection (lowest computedAt) that isn't the current document
    const others = allProjections
      .filter((p) => p.documentId !== documentId)
      .sort((a, b) => a.computedAt - b.computedAt);
    
    if (others.length > 0) {
      await db.delete("umap_projections", others[0].documentId);
    }
  }

  await db.put("umap_projections", newProjection);
  console.log(`[LargeDocs] Cached UMAP projection for document ${documentId}`);
}

/**
 * Remove UMAP projection for a specific document from cache.
 * Called when a document is deleted. O(1) operation.
 */
export async function removeDocumentUmapCache(documentId: string): Promise<void> {
  const db = await getLargeDocumentsDb();
  await db.delete("umap_projections", documentId);
}

/**
 * Clear all UMAP projection caches.
 */
export async function clearDocumentUmapCache(): Promise<void> {
  const db = await getLargeDocumentsDb();
  const tx = db.transaction("umap_projections", "readwrite");
  await tx.store.clear();
  await tx.done;
}
