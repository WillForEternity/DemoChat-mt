/**
 * Knowledge IndexedDB Store
 *
 * Low-level IndexedDB operations for the knowledge filesystem.
 * Uses the 'idb' library for a promise-based API.
 *
 * Version history:
 * - v1: Initial nodes store
 * - v2: Added embeddings store for RAG semantic search
 * - v3: Added metadata store for UMAP projection cache
 * 
 * IMPORTANT: We keep the database name as "knowledge_v1" but upgrade the
 * schema version. This preserves existing data while adding new features.
 */

import { openDB, type DBSchema, type IDBPDatabase } from "idb";
import type { KnowledgeNode } from "./types";
import type { EmbeddingRecord } from "./embeddings/types";

/**
 * Cached UMAP projection for embedding visualization.
 * Only recomputed when embeddings are reindexed.
 */
export interface UmapCache {
  id: "umap_projection";
  /** 2D coordinates for each embedding, indexed by embedding ID */
  points: Array<{ embeddingId: string; x: number; y: number }>;
  /** Timestamp of when this projection was computed */
  computedAt: number;
  /** Number of embeddings when projection was computed (for invalidation check) */
  embeddingCount: number;
}

interface KnowledgeDbSchema extends DBSchema {
  nodes: {
    key: string;
    value: KnowledgeNode;
  };
  embeddings: {
    key: string;
    value: EmbeddingRecord;
    indexes: {
      "by-file": string; // for deleting all embeddings when file deleted
      "by-hash": string; // for checking if chunk already embedded
    };
  };
  metadata: {
    key: string;
    value: UmapCache;
  };
}

let dbPromise: Promise<IDBPDatabase<KnowledgeDbSchema>> | null = null;

export function getKnowledgeDb() {
  if (!dbPromise) {
    // Use the SAME database name "knowledge_v1" but upgrade schema version
    // This preserves all existing data while adding new features
    dbPromise = openDB<KnowledgeDbSchema>("knowledge_v1", 3, {
      upgrade(db, oldVersion, newVersion) {
        console.log(`[Knowledge DB] Upgrading from v${oldVersion} to v${newVersion}`);
        
        // Create nodes store if it doesn't exist (fresh install)
        if (!db.objectStoreNames.contains("nodes")) {
          console.log("[Knowledge DB] Creating nodes store");
          db.createObjectStore("nodes", { keyPath: "path" });
        }

        // Create embeddings store (new in schema v2)
        if (!db.objectStoreNames.contains("embeddings")) {
          console.log("[Knowledge DB] Creating embeddings store");
          const embeddingsStore = db.createObjectStore("embeddings", {
            keyPath: "id",
          });
          embeddingsStore.createIndex("by-file", "filePath", { unique: false });
          embeddingsStore.createIndex("by-hash", "contentHash", {
            unique: false,
          });
        }

        // Create metadata store for UMAP cache (new in schema v3)
        if (!db.objectStoreNames.contains("metadata")) {
          console.log("[Knowledge DB] Creating metadata store");
          db.createObjectStore("metadata", { keyPath: "id" });
        }

        console.log("[Knowledge DB] Upgrade complete");
      },
    });
  }
  return dbPromise;
}

export async function initRootIfNeeded() {
  const db = await getKnowledgeDb();
  const root = await db.get("nodes", "/");
  if (!root) {
    await db.put("nodes", {
      path: "/",
      type: "folder",
      children: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
  }
}

/**
 * Migrate data from the incorrectly-named "knowledge_v2" database back to v1.
 * This fixes the issue where data was accidentally split across databases.
 * Call this once on app startup.
 */
export async function migrateFromV2NameIfNeeded(): Promise<void> {
  // Check if the incorrectly-named v2 database exists
  const databases = await indexedDB.databases();
  const v2NameExists = databases.some((db) => db.name === "knowledge_v2");

  if (!v2NameExists) {
    return; // No incorrectly-named database to migrate from
  }

  console.log("[Knowledge DB] Found incorrectly-named knowledge_v2 database, migrating...");

  try {
    // Open the incorrectly-named database
    const v2NameDb = await openDB("knowledge_v2", 2);
    const v2Nodes = await v2NameDb.getAll("nodes");

    if (v2Nodes.length > 0) {
      const mainDb = await getKnowledgeDb();

      // Copy all nodes to the correct database
      let migrated = 0;
      for (const node of v2Nodes) {
        // Only migrate if not already exists (prefer existing data)
        const existing = await mainDb.get("nodes", node.path);
        if (!existing) {
          await mainDb.put("nodes", node);
          migrated++;
        }
      }

      console.log(`[Knowledge DB] Migrated ${migrated} nodes from knowledge_v2 to knowledge_v1`);
    }

    // Also migrate any embeddings
    try {
      const v2Embeddings = await v2NameDb.getAll("embeddings");
      if (v2Embeddings.length > 0) {
        const mainDb = await getKnowledgeDb();
        for (const emb of v2Embeddings) {
          const existing = await mainDb.get("embeddings", emb.id);
          if (!existing) {
            await mainDb.put("embeddings", emb);
          }
        }
        console.log(`[Knowledge DB] Migrated ${v2Embeddings.length} embeddings from knowledge_v2`);
      }
    } catch {
      // Embeddings store might not exist in v2, that's fine
    }

    // Delete the incorrectly-named database
    v2NameDb.close();
    await indexedDB.deleteDatabase("knowledge_v2");
    console.log("[Knowledge DB] Deleted incorrectly-named knowledge_v2 database");
  } catch (error) {
    console.error("[Knowledge DB] Migration from v2 name failed:", error);
  }
}
