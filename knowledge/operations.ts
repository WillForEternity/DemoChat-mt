/**
 * Knowledge Filesystem Operations
 *
 * High-level operations for the knowledge filesystem.
 * These functions are called by Claude via tools.
 */

import { getKnowledgeDb, initRootIfNeeded } from "./idb";
import type { KnowledgeNode, KnowledgeTree } from "./types";
import { embedFile, deleteFileEmbeddings } from "./embeddings/operations";
import { deleteLinksForFile } from "./links/operations";
import { emitKnowledgeEvent } from "./events";

function parentPath(path: string): string {
  const parts = path.split("/").filter(Boolean);
  return parts.length <= 1 ? "/" : "/" + parts.slice(0, -1).join("/");
}

function nodeName(path: string): string {
  return path.split("/").filter(Boolean).pop() || "";
}

function normalizePath(path: string): string {
  if (!path || path === "/") return "/";
  return "/" + path.split("/").filter(Boolean).join("/");
}

export async function listFolder(path: string): Promise<string[]> {
  await initRootIfNeeded();
  const db = await getKnowledgeDb();
  const node = await db.get("nodes", normalizePath(path));
  if (!node || node.type !== "folder") return [];
  return node.children ?? [];
}

export async function readFile(path: string): Promise<string> {
  const db = await getKnowledgeDb();
  const node = await db.get("nodes", normalizePath(path));
  if (!node) throw new Error(`Not found: ${path}`);
  if (node.type !== "folder") return node.content ?? "";
  throw new Error(`Is a folder: ${path}`);
}

export async function writeFile(
  path: string,
  content: string,
  options: { source?: "user" | "agent" | "system"; silent?: boolean } = {}
): Promise<void> {
  await initRootIfNeeded();
  const db = await getKnowledgeDb();
  const normalizedPath = normalizePath(path);
  const parent = parentPath(normalizedPath);
  const name = nodeName(normalizedPath);

  // Ensure parent exists
  await mkdir(parent);

  // Add to parent's children if not already there
  const parentNode = await db.get("nodes", parent);
  if (parentNode && !parentNode.children?.includes(name)) {
    parentNode.children = [...(parentNode.children ?? []), name];
    parentNode.updatedAt = Date.now();
    await db.put("nodes", parentNode);
  }

  // Write the file
  const existing = await db.get("nodes", normalizedPath);
  await db.put("nodes", {
    path: normalizedPath,
    type: "file",
    content,
    createdAt: existing?.createdAt ?? Date.now(),
    updatedAt: Date.now(),
  });

  // Trigger background embedding (non-blocking)
  // Uses hash-based caching so unchanged content won't re-embed
  embedFile(normalizedPath, content).catch((error) => {
    console.error("[Knowledge] Failed to embed file:", error);
  });

  if (!options.silent) {
    emitKnowledgeEvent({ type: "write", path: normalizedPath, source: options.source });
  }
}

export async function appendFile(
  path: string,
  content: string,
  options: { source?: "user" | "agent" | "system" } = {}
): Promise<void> {
  const existing = await readFile(path).catch(() => "");
  const separator = existing && !existing.endsWith("\n") ? "\n" : "";
  // Use silent writeFile so we can emit a more specific "append" event below.
  await writeFile(path, existing + separator + content, {
    source: options.source,
    silent: true,
  });
  emitKnowledgeEvent({
    type: "append",
    path: normalizePath(path),
    source: options.source,
  });
}

export async function mkdir(
  path: string,
  options: { source?: "user" | "agent" | "system" } = {}
): Promise<void> {
  await initRootIfNeeded();
  const db = await getKnowledgeDb();
  const normalizedPath = normalizePath(path);

  if (normalizedPath === "/") return;

  // Recursively ensure parent exists
  const parent = parentPath(normalizedPath);
  if (parent !== "/") {
    await mkdir(parent, options);
  }

  // Check if already exists
  const existing = await db.get("nodes", normalizedPath);
  if (existing) return;

  // Add to parent's children
  const parentNode = await db.get("nodes", parent);
  const name = nodeName(normalizedPath);
  if (parentNode && !parentNode.children?.includes(name)) {
    parentNode.children = [...(parentNode.children ?? []), name];
    parentNode.updatedAt = Date.now();
    await db.put("nodes", parentNode);
  }

  // Create the folder
  await db.put("nodes", {
    path: normalizedPath,
    type: "folder",
    children: [],
    createdAt: Date.now(),
    updatedAt: Date.now(),
  });

  emitKnowledgeEvent({ type: "mkdir", path: normalizedPath, source: options.source });
}

export async function deleteNode(
  path: string,
  options: { source?: "user" | "agent" | "system"; silent?: boolean } = {}
): Promise<void> {
  const db = await getKnowledgeDb();
  const normalizedPath = normalizePath(path);
  if (normalizedPath === "/") return;

  const node = await db.get("nodes", normalizedPath);
  if (!node) return;

  // Recursively delete children if folder
  if (node.type === "folder" && node.children) {
    for (const child of node.children) {
      await deleteNode(normalizedPath + "/" + child, { ...options, silent: true });
    }
  }

  // Remove from parent
  const parent = parentPath(normalizedPath);
  const parentNode = await db.get("nodes", parent);
  const name = nodeName(normalizedPath);
  if (parentNode?.children) {
    parentNode.children = parentNode.children.filter((c) => c !== name);
    parentNode.updatedAt = Date.now();
    await db.put("nodes", parentNode);
  }

  await db.delete("nodes", normalizedPath);

  // Also delete associated embeddings and links (for files)
  if (node.type === "file") {
    deleteFileEmbeddings(normalizedPath).catch((error) => {
      console.error("[Knowledge] Failed to delete embeddings:", error);
    });

    // Cascade delete all links where this file is source or target
    deleteLinksForFile(normalizedPath).catch((error) => {
      console.error("[Knowledge] Failed to delete links:", error);
    });
  }

  if (!options.silent) {
    emitKnowledgeEvent({ type: "delete", path: normalizedPath, source: options.source });
  }
}

/**
 * Rename a file or folder within the same parent.
 * For files, embeddings are migrated (deleted at the old path and re-embedded at the new one).
 * For folders, child paths are recursively rewritten.
 */
export async function renameNode(
  path: string,
  newName: string,
  options: { source?: "user" | "agent" | "system" } = {}
): Promise<string> {
  const trimmed = newName.trim();
  if (!trimmed || trimmed.includes("/")) {
    throw new Error(`Invalid name: ${newName}`);
  }
  const db = await getKnowledgeDb();
  const oldPath = normalizePath(path);
  if (oldPath === "/") throw new Error("Cannot rename root");

  const node = await db.get("nodes", oldPath);
  if (!node) throw new Error(`Not found: ${path}`);

  const parent = parentPath(oldPath);
  const newPath = (parent === "/" ? "" : parent) + "/" + trimmed;

  if (newPath === oldPath) return oldPath;

  const collision = await db.get("nodes", newPath);
  if (collision) {
    throw new Error(`A ${collision.type} already exists at ${newPath}`);
  }

  // Update parent's children list (preserve ordering)
  const parentNode = await db.get("nodes", parent);
  if (parentNode?.children) {
    const oldName = nodeName(oldPath);
    parentNode.children = parentNode.children.map((c) => (c === oldName ? trimmed : c));
    parentNode.updatedAt = Date.now();
    await db.put("nodes", parentNode);
  }

  if (node.type === "file") {
    await db.delete("nodes", oldPath);
    await db.put("nodes", {
      ...node,
      path: newPath,
      updatedAt: Date.now(),
    });

    // Migrate embeddings: drop old, embed new (silent on hash if unchanged).
    deleteFileEmbeddings(oldPath).catch((err) =>
      console.error("[Knowledge] Failed to delete old embeddings:", err)
    );
    embedFile(newPath, node.content ?? "").catch((err) =>
      console.error("[Knowledge] Failed to embed renamed file:", err)
    );
  } else {
    // Folder: recursively rewrite descendant paths.
    async function rewrite(currentOld: string, currentNew: string) {
      const n = await db.get("nodes", currentOld);
      if (!n) return;
      await db.delete("nodes", currentOld);
      await db.put("nodes", { ...n, path: currentNew, updatedAt: Date.now() });
      if (n.type === "folder" && n.children) {
        for (const child of n.children) {
          await rewrite(
            currentOld === "/" ? "/" + child : currentOld + "/" + child,
            currentNew + "/" + child
          );
        }
      } else if (n.type === "file") {
        deleteFileEmbeddings(currentOld).catch((err) =>
          console.error("[Knowledge] Failed to delete old embeddings:", err)
        );
        embedFile(currentNew, n.content ?? "").catch((err) =>
          console.error("[Knowledge] Failed to embed renamed file:", err)
        );
      }
    }
    await rewrite(oldPath, newPath);
  }

  emitKnowledgeEvent({
    type: "rename",
    path: newPath,
    previousPath: oldPath,
    source: options.source,
  });

  return newPath;
}

export async function getTree(): Promise<KnowledgeTree[]> {
  await initRootIfNeeded();
  const db = await getKnowledgeDb();

  async function buildTree(path: string, name: string): Promise<KnowledgeTree> {
    const node = await db.get("nodes", path);
    if (!node || node.type === "file") {
      return { name, path, type: "file" };
    }
    const children = await Promise.all(
      (node.children ?? []).map((child) =>
        buildTree(path === "/" ? "/" + child : path + "/" + child, child)
      )
    );
    return { name, path, type: "folder", children };
  }

  const root = await db.get("nodes", "/");
  if (!root?.children?.length) return [];

  return Promise.all(
    root.children.map((name) => buildTree("/" + name, name))
  );
}

export async function getRootFolders(): Promise<string[]> {
  await initRootIfNeeded();
  const db = await getKnowledgeDb();
  const root = await db.get("nodes", "/");
  return root?.children ?? [];
}
