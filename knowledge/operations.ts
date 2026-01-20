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

export async function writeFile(path: string, content: string): Promise<void> {
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
}

export async function appendFile(path: string, content: string): Promise<void> {
  const existing = await readFile(path).catch(() => "");
  const separator = existing && !existing.endsWith("\n") ? "\n" : "";
  await writeFile(path, existing + separator + content);
  // writeFile already triggers embedFile
}

export async function mkdir(path: string): Promise<void> {
  await initRootIfNeeded();
  const db = await getKnowledgeDb();
  const normalizedPath = normalizePath(path);

  if (normalizedPath === "/") return;

  // Recursively ensure parent exists
  const parent = parentPath(normalizedPath);
  if (parent !== "/") {
    await mkdir(parent);
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
}

export async function deleteNode(path: string): Promise<void> {
  const db = await getKnowledgeDb();
  const normalizedPath = normalizePath(path);
  if (normalizedPath === "/") return;

  const node = await db.get("nodes", normalizedPath);
  if (!node) return;

  // Recursively delete children if folder
  if (node.type === "folder" && node.children) {
    for (const child of node.children) {
      await deleteNode(normalizedPath + "/" + child);
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
