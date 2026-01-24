/**
 * Knowledge Base Backup & Restore
 *
 * Export and import functionality to protect against IndexedDB data loss.
 * 
 * IMPORTANT: IndexedDB can be cleared by:
 * - User clearing browser data
 * - Browser storage eviction (low disk space)
 * - Switching browsers/devices
 * 
 * This module provides JSON export/import to backup and restore the KB.
 */

import { getKnowledgeDb, initRootIfNeeded } from "./idb";
import { getAllLinks, createLink } from "./links/operations";
import { embedFile } from "./embeddings/operations";
import type { KnowledgeNode } from "./types";
import type { KnowledgeLink, RelationshipType } from "./links/types";

/**
 * Exported file structure (preserves folder hierarchy)
 */
export interface ExportedFile {
  path: string;
  content: string;
  createdAt: number;
  updatedAt: number;
}

/**
 * Exported link structure (simplified for portability)
 */
export interface ExportedLink {
  source: string;
  target: string;
  relationship: RelationshipType;
  bidirectional: boolean;
  notes?: string;
}

/**
 * Complete KB backup format
 */
export interface KnowledgeBackup {
  version: 1;
  exportedAt: string;
  files: ExportedFile[];
  links: ExportedLink[];
  stats: {
    totalFiles: number;
    totalFolders: number;
    totalLinks: number;
  };
}

/**
 * Import result with details
 */
export interface ImportResult {
  success: boolean;
  filesImported: number;
  filesSkipped: number;
  linksImported: number;
  linksSkipped: number;
  errors: string[];
}

/**
 * Export the entire Knowledge Base to a JSON backup.
 * Includes all files, folders (implicitly via paths), and links.
 */
export async function exportKnowledgeBase(): Promise<KnowledgeBackup> {
  await initRootIfNeeded();
  const db = await getKnowledgeDb();

  // Get all nodes
  const allNodes = await db.getAll("nodes");
  
  // Filter to files only (folders are reconstructed from paths)
  const files: ExportedFile[] = [];
  let folderCount = 0;

  for (const node of allNodes) {
    if (node.path === "/") continue; // Skip root

    if (node.type === "file") {
      files.push({
        path: node.path,
        content: node.content ?? "",
        createdAt: node.createdAt,
        updatedAt: node.updatedAt,
      });
    } else {
      folderCount++;
    }
  }

  // Get all links
  const allLinks = await getAllLinks();
  const links: ExportedLink[] = allLinks.map((link) => ({
    source: link.source,
    target: link.target,
    relationship: link.relationship,
    bidirectional: link.bidirectional,
    notes: link.notes,
  }));

  return {
    version: 1,
    exportedAt: new Date().toISOString(),
    files,
    links,
    stats: {
      totalFiles: files.length,
      totalFolders: folderCount,
      totalLinks: links.length,
    },
  };
}

/**
 * Download the KB backup as a JSON file.
 * Triggers a browser download.
 */
export async function downloadKnowledgeBackup(filename?: string): Promise<void> {
  const backup = await exportKnowledgeBase();
  const json = JSON.stringify(backup, null, 2);
  const blob = new Blob([json], { type: "application/json" });
  const url = URL.createObjectURL(blob);

  const date = new Date().toISOString().split("T")[0];
  const defaultFilename = `chatnoir-kb-backup-${date}.json`;

  const a = document.createElement("a");
  a.href = url;
  a.download = filename ?? defaultFilename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/**
 * Import a KB backup from JSON.
 * 
 * @param backup - The parsed backup object
 * @param options - Import options
 * @returns Import result with statistics
 */
export async function importKnowledgeBase(
  backup: KnowledgeBackup,
  options: {
    /** If true, overwrite existing files. If false, skip them. */
    overwrite?: boolean;
    /** If true, trigger re-embedding after import. */
    reindex?: boolean;
    /** Progress callback */
    onProgress?: (current: number, total: number, currentFile: string) => void;
  } = {}
): Promise<ImportResult> {
  const { overwrite = false, reindex = true, onProgress } = options;

  await initRootIfNeeded();
  const db = await getKnowledgeDb();

  const result: ImportResult = {
    success: true,
    filesImported: 0,
    filesSkipped: 0,
    linksImported: 0,
    linksSkipped: 0,
    errors: [],
  };

  const totalItems = backup.files.length + backup.links.length;
  let processed = 0;

  // Helper to normalize and create parent folders
  const ensureParentFolders = async (filePath: string) => {
    const parts = filePath.split("/").filter(Boolean);
    let currentPath = "";

    for (let i = 0; i < parts.length - 1; i++) {
      currentPath += "/" + parts[i];
      const existing = await db.get("nodes", currentPath);
      
      if (!existing) {
        // Create folder
        await db.put("nodes", {
          path: currentPath,
          type: "folder",
          children: [],
          createdAt: Date.now(),
          updatedAt: Date.now(),
        });
      }

      // Add to parent's children
      const parentPath = i === 0 ? "/" : "/" + parts.slice(0, i).join("/");
      const parent = await db.get("nodes", parentPath);
      const folderName = parts[i];
      
      if (parent && !parent.children?.includes(folderName)) {
        parent.children = [...(parent.children ?? []), folderName];
        parent.updatedAt = Date.now();
        await db.put("nodes", parent);
      }
    }
  };

  // Import files
  for (const file of backup.files) {
    try {
      onProgress?.(processed, totalItems, file.path);
      
      const normalizedPath = "/" + file.path.split("/").filter(Boolean).join("/");
      const existing = await db.get("nodes", normalizedPath);

      if (existing && !overwrite) {
        result.filesSkipped++;
        processed++;
        continue;
      }

      // Ensure parent folders exist
      await ensureParentFolders(normalizedPath);

      // Add file to parent's children
      const parts = normalizedPath.split("/").filter(Boolean);
      const fileName = parts[parts.length - 1];
      const parentPath = parts.length === 1 ? "/" : "/" + parts.slice(0, -1).join("/");
      const parent = await db.get("nodes", parentPath);
      
      if (parent && !parent.children?.includes(fileName)) {
        parent.children = [...(parent.children ?? []), fileName];
        parent.updatedAt = Date.now();
        await db.put("nodes", parent);
      }

      // Write the file
      await db.put("nodes", {
        path: normalizedPath,
        type: "file",
        content: file.content,
        createdAt: file.createdAt,
        updatedAt: file.updatedAt,
      });

      // Trigger embedding if enabled
      if (reindex) {
        embedFile(normalizedPath, file.content).catch((err) => {
          console.error(`[Import] Failed to embed ${normalizedPath}:`, err);
        });
      }

      result.filesImported++;
    } catch (error) {
      result.errors.push(`Failed to import ${file.path}: ${error}`);
    }
    processed++;
  }

  // Import links
  for (const link of backup.links) {
    try {
      onProgress?.(processed, totalItems, `Link: ${link.source} → ${link.target}`);

      const createResult = await createLink(
        link.source,
        link.target,
        link.relationship,
        {
          bidirectional: link.bidirectional,
          notes: link.notes,
        }
      );

      if (createResult.success) {
        result.linksImported++;
      } else {
        result.linksSkipped++;
      }
    } catch (error) {
      result.errors.push(`Failed to import link ${link.source} → ${link.target}: ${error}`);
    }
    processed++;
  }

  result.success = result.errors.length === 0;
  return result;
}

/**
 * Parse and validate a backup file.
 * Returns the backup object if valid, or throws an error.
 */
export function parseBackupFile(jsonString: string): KnowledgeBackup {
  let parsed: unknown;
  
  try {
    parsed = JSON.parse(jsonString);
  } catch {
    throw new Error("Invalid JSON format");
  }

  // Validate structure
  if (typeof parsed !== "object" || parsed === null) {
    throw new Error("Backup must be an object");
  }

  const backup = parsed as Record<string, unknown>;

  if (backup.version !== 1) {
    throw new Error(`Unsupported backup version: ${backup.version}`);
  }

  if (!Array.isArray(backup.files)) {
    throw new Error("Backup must contain a 'files' array");
  }

  if (!Array.isArray(backup.links)) {
    throw new Error("Backup must contain a 'links' array");
  }

  // Validate files
  for (const file of backup.files) {
    if (typeof file.path !== "string" || typeof file.content !== "string") {
      throw new Error("Each file must have 'path' and 'content' strings");
    }
  }

  // Validate links
  const validRelationships = ["extends", "references", "contradicts", "requires", "blocks", "relates-to"];
  for (const link of backup.links) {
    if (typeof link.source !== "string" || typeof link.target !== "string") {
      throw new Error("Each link must have 'source' and 'target' strings");
    }
    if (!validRelationships.includes(link.relationship)) {
      throw new Error(`Invalid relationship type: ${link.relationship}`);
    }
  }

  return backup as unknown as KnowledgeBackup;
}

/**
 * Import from a File object (from file input).
 */
export async function importFromFile(
  file: File,
  options?: Parameters<typeof importKnowledgeBase>[1]
): Promise<ImportResult> {
  const text = await file.text();
  const backup = parseBackupFile(text);
  return importKnowledgeBase(backup, options);
}
