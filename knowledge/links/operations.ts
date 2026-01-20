/**
 * Knowledge Graph Link Operations
 *
 * CRUD operations for managing relationships between knowledge base files.
 * These functions are called by Claude via tools.
 */

import { getKnowledgeDb, clearGraphLayoutCache } from "../idb";
import type {
  KnowledgeLink,
  RelationshipType,
  LinkQueryResult,
  CreateLinkOptions,
} from "./types";

/**
 * Generate a unique link ID from source, target, and relationship.
 */
function generateLinkId(
  source: string,
  target: string,
  relationship: RelationshipType
): string {
  return `${source}#${target}#${relationship}`;
}

/**
 * Normalize a path to ensure consistent format.
 */
function normalizePath(path: string): string {
  if (!path || path === "/") return "/";
  return "/" + path.split("/").filter(Boolean).join("/");
}

/**
 * Check if a file exists in the knowledge base.
 */
async function fileExists(path: string): Promise<boolean> {
  const db = await getKnowledgeDb();
  const node = await db.get("nodes", normalizePath(path));
  return node !== undefined && node.type === "file";
}

/**
 * Create a relationship between two files in the knowledge base.
 *
 * @param source - Source file path
 * @param target - Target file path
 * @param relationship - Type of relationship
 * @param options - Optional settings (bidirectional, notes)
 * @returns The created link
 * @throws Error if source or target file doesn't exist
 */
export async function createLink(
  source: string,
  target: string,
  relationship: RelationshipType,
  options: CreateLinkOptions = {}
): Promise<{ success: true; link: KnowledgeLink } | { success: false; error: string }> {
  const normalizedSource = normalizePath(source);
  const normalizedTarget = normalizePath(target);

  // Validate both files exist
  const sourceExists = await fileExists(normalizedSource);
  if (!sourceExists) {
    return { success: false, error: `Source file not found: ${normalizedSource}` };
  }

  const targetExists = await fileExists(normalizedTarget);
  if (!targetExists) {
    return { success: false, error: `Target file not found: ${normalizedTarget}` };
  }

  // Prevent self-links
  if (normalizedSource === normalizedTarget) {
    return { success: false, error: "Cannot create a link from a file to itself" };
  }

  const db = await getKnowledgeDb();
  const now = Date.now();

  const link: KnowledgeLink = {
    id: generateLinkId(normalizedSource, normalizedTarget, relationship),
    source: normalizedSource,
    target: normalizedTarget,
    relationship,
    bidirectional: options.bidirectional ?? false,
    notes: options.notes,
    createdAt: now,
    updatedAt: now,
  };

  // Check if link already exists
  const existing = await db.get("links", link.id);
  if (existing) {
    // Update existing link
    link.createdAt = existing.createdAt;
    await db.put("links", link);
    // Invalidate graph layout cache
    await clearGraphLayoutCache();
    return { success: true, link };
  }

  await db.put("links", link);
  // Invalidate graph layout cache
  await clearGraphLayoutCache();
  return { success: true, link };
}

/**
 * Delete a specific relationship between two files.
 *
 * @param source - Source file path
 * @param target - Target file path
 * @param relationship - Type of relationship to delete
 * @returns Success status
 */
export async function deleteLink(
  source: string,
  target: string,
  relationship: RelationshipType
): Promise<{ success: true; deleted: boolean } | { success: false; error: string }> {
  const normalizedSource = normalizePath(source);
  const normalizedTarget = normalizePath(target);
  const linkId = generateLinkId(normalizedSource, normalizedTarget, relationship);

  const db = await getKnowledgeDb();
  const existing = await db.get("links", linkId);

  if (!existing) {
    return { success: true, deleted: false };
  }

  await db.delete("links", linkId);
  // Invalidate graph layout cache
  await clearGraphLayoutCache();
  return { success: true, deleted: true };
}

/**
 * Get all links for a specific file (both incoming and outgoing).
 *
 * @param path - File path to query
 * @returns Array of links with direction information
 */
export async function getLinksForFile(path: string): Promise<{
  path: string;
  outgoing: KnowledgeLink[];
  incoming: KnowledgeLink[];
  total: number;
}> {
  const normalizedPath = normalizePath(path);
  const db = await getKnowledgeDb();

  // Get outgoing links (where this file is the source)
  const outgoing = await db.getAllFromIndex("links", "by-source", normalizedPath);

  // Get incoming links (where this file is the target)
  const incoming = await db.getAllFromIndex("links", "by-target", normalizedPath);

  return {
    path: normalizedPath,
    outgoing,
    incoming,
    total: outgoing.length + incoming.length,
  };
}

/**
 * Get all links in the knowledge base.
 *
 * @returns All links
 */
export async function getAllLinks(): Promise<KnowledgeLink[]> {
  const db = await getKnowledgeDb();
  return db.getAll("links");
}

/**
 * Get links filtered by relationship type.
 *
 * @param relationship - Relationship type to filter by
 * @returns Links of the specified type
 */
export async function getLinksByRelationship(
  relationship: RelationshipType
): Promise<KnowledgeLink[]> {
  const db = await getKnowledgeDb();
  return db.getAllFromIndex("links", "by-relationship", relationship);
}

/**
 * Delete all links associated with a file (called when file is deleted).
 *
 * @param path - Path of the deleted file
 * @returns Number of links deleted
 */
export async function deleteLinksForFile(path: string): Promise<number> {
  const normalizedPath = normalizePath(path);
  const db = await getKnowledgeDb();

  // Get all links where this file is source or target
  const outgoing = await db.getAllFromIndex("links", "by-source", normalizedPath);
  const incoming = await db.getAllFromIndex("links", "by-target", normalizedPath);

  // Delete all found links
  let deleted = 0;
  for (const link of outgoing) {
    await db.delete("links", link.id);
    deleted++;
  }
  for (const link of incoming) {
    await db.delete("links", link.id);
    deleted++;
  }

  // Invalidate graph layout cache if any links were deleted
  if (deleted > 0) {
    await clearGraphLayoutCache();
  }

  return deleted;
}

/**
 * Get statistics about the knowledge graph.
 */
export async function getLinkStats(): Promise<{
  totalLinks: number;
  byRelationship: Record<RelationshipType, number>;
  filesWithLinks: number;
}> {
  const allLinks = await getAllLinks();

  // Count by relationship type
  const byRelationship: Record<RelationshipType, number> = {
    extends: 0,
    references: 0,
    contradicts: 0,
    requires: 0,
    blocks: 0,
    "relates-to": 0,
  };

  const filesWithLinks = new Set<string>();

  for (const link of allLinks) {
    byRelationship[link.relationship]++;
    filesWithLinks.add(link.source);
    filesWithLinks.add(link.target);
  }

  return {
    totalLinks: allLinks.length,
    byRelationship,
    filesWithLinks: filesWithLinks.size,
  };
}
