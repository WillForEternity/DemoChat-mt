/**
 * Large Documents IndexedDB Store (v2)
 *
 * Separate IndexedDB database for large document storage. Keeps large
 * documents isolated from the main knowledge base to avoid performance
 * issues with the regular KB operations.
 *
 * Version history:
 * - v1 DB (`large_documents_v1`):
 *     v1: documents + chunks
 *     v2: + metadata (UMAP cache as a single blob — deprecated)
 *     v3: + files store for original PDF data
 *     v4: UMAP cache moved to per-document `umap_projections` records (LRU max 10)
 * - v2 DB (`large_documents_v2`, version 1):
 *     One-shot rename. Final v2 schema lands here:
 *     - `documents` with the new status enum (stored | extracting | embedding | ready | error)
 *     - `chunks` with REQUIRED pageStart / pageEnd
 *     - `files` for original file data
 *     - `umap_projections` for per-document UMAP cache
 *     - `extractionCache` keyed by [documentId, pageIndex, source] (Phase 7)
 *   Existing v1 data is intentionally orphaned: the upgrade path was
 *   replaced with a fresh DB to keep migration code out of the repo.
 */

import { openDB, type DBSchema, type IDBPDatabase } from "idb";
import type {
  LargeDocumentMetadata,
  LargeDocumentChunk,
  LargeDocumentFile,
  ExtractionCacheEntry,
} from "./types";

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

// =============================================================================
// DATABASE SCHEMA (v2)
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
  files: {
    key: string;
    value: LargeDocumentFile;
  };
  umap_projections: {
    key: string;
    value: DocumentUmapProjection;
  };
  extractionCache: {
    key: [string, number, string];
    value: ExtractionCacheEntry;
    indexes: {
      "by-document": string;
    };
  };
}

const DB_NAME = "large_documents_v2";
const LEGACY_DB_NAME = "large_documents_v1";

let dbPromise: Promise<IDBPDatabase<LargeDocumentsDbSchema>> | null = null;
let legacyDeleted = false;

/**
 * Best-effort one-shot deletion of the v1 database.
 * Runs once per page session; failures are logged and ignored.
 */
function deleteLegacyDb(): void {
  if (legacyDeleted) return;
  legacyDeleted = true;
  if (typeof indexedDB === "undefined") return;
  try {
    const req = indexedDB.deleteDatabase(LEGACY_DB_NAME);
    req.onsuccess = () => console.log(`[LargeDocs DB] Deleted legacy database ${LEGACY_DB_NAME}`);
    req.onblocked = () => console.warn(`[LargeDocs DB] Legacy DB delete blocked by another connection`);
    req.onerror = () => console.warn(`[LargeDocs DB] Legacy DB delete error:`, req.error);
  } catch (err) {
    console.warn(`[LargeDocs DB] Legacy DB delete threw:`, err);
  }
}

/**
 * Get the large documents database instance.
 */
export function getLargeDocumentsDb() {
  if (!dbPromise) {
    deleteLegacyDb();
    dbPromise = openDB<LargeDocumentsDbSchema>(DB_NAME, 1, {
      upgrade(db) {
        console.log(`[LargeDocs DB] Creating ${DB_NAME} schema (v2)`);

        const docsStore = db.createObjectStore("documents", { keyPath: "id" });
        docsStore.createIndex("by-filename", "filename", { unique: false });
        docsStore.createIndex("by-status", "status", { unique: false });

        const chunksStore = db.createObjectStore("chunks", { keyPath: "id" });
        chunksStore.createIndex("by-document", "documentId", { unique: false });
        chunksStore.createIndex("by-hash", "contentHash", { unique: false });

        db.createObjectStore("files", { keyPath: "documentId" });

        db.createObjectStore("umap_projections", { keyPath: "documentId" });

        const cacheStore = db.createObjectStore("extractionCache", {
          keyPath: ["documentId", "pageIndex", "source"],
        });
        cacheStore.createIndex("by-document", "documentId", { unique: false });
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
  const storeNames = [
    "documents",
    "chunks",
    "files",
    "umap_projections",
    "extractionCache",
  ] as const;
  const tx = db.transaction(storeNames, "readwrite");
  await Promise.all([
    tx.objectStore("documents").clear(),
    tx.objectStore("chunks").clear(),
    tx.objectStore("files").clear(),
    tx.objectStore("umap_projections").clear(),
    tx.objectStore("extractionCache").clear(),
    tx.done,
  ]);
}

// =============================================================================
// FILE STORAGE OPERATIONS
// =============================================================================

export async function storeDocumentFile(
  documentId: string,
  data: ArrayBuffer,
  mimeType: string,
): Promise<void> {
  const db = await getLargeDocumentsDb();
  await db.put("files", { documentId, data, mimeType });
}

export async function getDocumentFile(
  documentId: string,
): Promise<LargeDocumentFile | undefined> {
  const db = await getLargeDocumentsDb();
  return db.get("files", documentId);
}

export async function deleteDocumentFile(documentId: string): Promise<void> {
  const db = await getLargeDocumentsDb();
  await db.delete("files", documentId);
}

// =============================================================================
// EXTRACTION CACHE OPERATIONS (Phase 7)
// =============================================================================

export async function getCachedPageExtraction(
  documentId: string,
  pageIndex: number,
  source: "pdfjs" | "ai",
  fileHash: string,
): Promise<ExtractionCacheEntry | undefined> {
  const db = await getLargeDocumentsDb();
  const entry = await db.get("extractionCache", [documentId, pageIndex, source]);
  if (!entry) return undefined;
  // Invalidate if the source PDF's content has changed.
  if (entry.fileHash !== fileHash) return undefined;
  return entry;
}

export async function setCachedPageExtraction(
  entry: ExtractionCacheEntry,
): Promise<void> {
  const db = await getLargeDocumentsDb();
  await db.put("extractionCache", entry);
}

export async function deleteCachedExtractionsForDocument(
  documentId: string,
): Promise<void> {
  const db = await getLargeDocumentsDb();
  const tx = db.transaction("extractionCache", "readwrite");
  const keys = await tx.store.index("by-document").getAllKeys(documentId);
  for (const k of keys) {
    await tx.store.delete(k);
  }
  await tx.done;
}

// =============================================================================
// UMAP CACHE OPERATIONS
// =============================================================================

export async function getDocumentUmapCache(
  documentId: string,
  expectedChunkCount: number,
): Promise<DocumentUmapProjection | undefined> {
  const db = await getLargeDocumentsDb();
  const projection = await db.get("umap_projections", documentId);
  if (!projection) return undefined;
  if (projection.chunkCount !== expectedChunkCount) return undefined;
  return projection;
}

export async function saveDocumentUmapCache(
  documentId: string,
  points: Array<{ chunkIndex: number; x: number; y: number }>,
  chunkCount: number,
): Promise<void> {
  const db = await getLargeDocumentsDb();

  const newProjection: DocumentUmapProjection = {
    documentId,
    points,
    computedAt: Date.now(),
    chunkCount,
  };

  const allProjections = await db.getAll("umap_projections");
  const othersCount = allProjections.filter((p) => p.documentId !== documentId).length;

  if (othersCount >= MAX_CACHED_PROJECTIONS) {
    const others = allProjections
      .filter((p) => p.documentId !== documentId)
      .sort((a, b) => a.computedAt - b.computedAt);
    if (others.length > 0) {
      await db.delete("umap_projections", others[0].documentId);
    }
  }

  await db.put("umap_projections", newProjection);
}

export async function removeDocumentUmapCache(documentId: string): Promise<void> {
  const db = await getLargeDocumentsDb();
  await db.delete("umap_projections", documentId);
}

export async function clearDocumentUmapCache(): Promise<void> {
  const db = await getLargeDocumentsDb();
  const tx = db.transaction("umap_projections", "readwrite");
  await tx.store.clear();
  await tx.done;
}
