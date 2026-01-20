/**
 * Large Documents IndexedDB Store
 *
 * Separate IndexedDB database for large document storage.
 * Keeps large documents isolated from the main knowledge base
 * to avoid performance issues with the regular KB operations.
 */

import { openDB, type DBSchema, type IDBPDatabase } from "idb";
import type { LargeDocumentMetadata, LargeDocumentChunk } from "./types";

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
}

let dbPromise: Promise<IDBPDatabase<LargeDocumentsDbSchema>> | null = null;

/**
 * Get the large documents database instance.
 */
export function getLargeDocumentsDb() {
  if (!dbPromise) {
    dbPromise = openDB<LargeDocumentsDbSchema>("large_documents_v1", 1, {
      upgrade(db, oldVersion, newVersion) {
        console.log(`[LargeDocs DB] Upgrading from v${oldVersion} to v${newVersion}`);

        // Create documents store
        if (!db.objectStoreNames.contains("documents")) {
          console.log("[LargeDocs DB] Creating documents store");
          const docsStore = db.createObjectStore("documents", { keyPath: "id" });
          docsStore.createIndex("by-filename", "filename", { unique: false });
          docsStore.createIndex("by-status", "status", { unique: false });
        }

        // Create chunks store
        if (!db.objectStoreNames.contains("chunks")) {
          console.log("[LargeDocs DB] Creating chunks store");
          const chunksStore = db.createObjectStore("chunks", { keyPath: "id" });
          chunksStore.createIndex("by-document", "documentId", { unique: false });
          chunksStore.createIndex("by-hash", "contentHash", { unique: false });
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
  
  const tx = db.transaction(["documents", "chunks"], "readwrite");
  await Promise.all([
    tx.objectStore("documents").clear(),
    tx.objectStore("chunks").clear(),
    tx.done,
  ]);
}
