/**
 * Knowledge Graph Traversal Engine
 *
 * Algorithms for traversing and querying the knowledge graph.
 * Supports BFS traversal, path finding, and graph building for visualization.
 */

import { getKnowledgeDb } from "../idb";
import type {
  KnowledgeLink,
  RelationshipType,
  GraphNode,
  GraphTraversalResult,
  TraversalOptions,
  AdjacencyList,
} from "./types";

/**
 * Normalize a path to ensure consistent format.
 */
function normalizePath(path: string): string {
  if (!path || path === "/") return "/";
  return "/" + path.split("/").filter(Boolean).join("/");
}

/**
 * Traverse the knowledge graph from a starting point using BFS.
 *
 * @param startPath - Starting file path
 * @param options - Traversal options (depth, relationship filter, direction)
 * @returns Traversal result with all discovered nodes
 */
export async function traverseGraph(
  startPath: string,
  options: TraversalOptions = {}
): Promise<GraphTraversalResult> {
  const normalizedStart = normalizePath(startPath);
  const maxDepth = Math.min(Math.max(options.depth ?? 2, 1), 5); // Clamp between 1-5
  const direction = options.direction ?? "both";
  const relationshipFilter = options.relationship;

  const db = await getKnowledgeDb();

  // BFS state
  const visited = new Set<string>();
  const queue: Array<{ path: string; depth: number }> = [
    { path: normalizedStart, depth: 0 },
  ];
  const nodes: GraphNode[] = [];
  let totalLinks = 0;

  while (queue.length > 0) {
    const { path, depth } = queue.shift()!;

    if (visited.has(path)) continue;
    visited.add(path);

    // Get links for this node
    const outgoing =
      direction === "incoming"
        ? []
        : await db.getAllFromIndex("links", "by-source", path);
    const incoming =
      direction === "outgoing"
        ? []
        : await db.getAllFromIndex("links", "by-target", path);

    // Apply relationship filter
    const filteredOutgoing = relationshipFilter
      ? outgoing.filter((l) => l.relationship === relationshipFilter)
      : outgoing;
    const filteredIncoming = relationshipFilter
      ? incoming.filter((l) => l.relationship === relationshipFilter)
      : incoming;

    // Add to results
    nodes.push({
      path,
      links: {
        outgoing: filteredOutgoing,
        incoming: filteredIncoming,
      },
    });

    totalLinks += filteredOutgoing.length + filteredIncoming.length;

    // Add connected nodes to queue if we haven't reached max depth
    if (depth < maxDepth) {
      for (const link of filteredOutgoing) {
        if (!visited.has(link.target)) {
          queue.push({ path: link.target, depth: depth + 1 });
        }
        // For bidirectional links, also traverse the reverse
        if (link.bidirectional && !visited.has(link.source)) {
          queue.push({ path: link.source, depth: depth + 1 });
        }
      }
      for (const link of filteredIncoming) {
        if (!visited.has(link.source)) {
          queue.push({ path: link.source, depth: depth + 1 });
        }
        // For bidirectional links, also traverse the reverse
        if (link.bidirectional && !visited.has(link.target)) {
          queue.push({ path: link.target, depth: depth + 1 });
        }
      }
    }
  }

  return {
    rootPath: normalizedStart,
    depth: maxDepth,
    nodes,
    totalLinks,
  };
}

/**
 * Find a path between two files in the knowledge graph.
 *
 * @param source - Starting file path
 * @param target - Target file path
 * @returns Array of links forming the path, or null if no path exists
 */
export async function findPath(
  source: string,
  target: string
): Promise<KnowledgeLink[] | null> {
  const normalizedSource = normalizePath(source);
  const normalizedTarget = normalizePath(target);

  if (normalizedSource === normalizedTarget) {
    return []; // Same file, path is empty
  }

  const db = await getKnowledgeDb();

  // BFS to find shortest path
  const visited = new Set<string>();
  const queue: Array<{ path: string; chain: KnowledgeLink[] }> = [
    { path: normalizedSource, chain: [] },
  ];

  while (queue.length > 0) {
    const { path, chain } = queue.shift()!;

    if (visited.has(path)) continue;
    visited.add(path);

    // Get all connected links
    const outgoing = await db.getAllFromIndex("links", "by-source", path);
    const incoming = await db.getAllFromIndex("links", "by-target", path);

    // Check outgoing links
    for (const link of outgoing) {
      if (link.target === normalizedTarget) {
        return [...chain, link]; // Found the target!
      }
      if (!visited.has(link.target)) {
        queue.push({ path: link.target, chain: [...chain, link] });
      }
    }

    // Check incoming links (traverse bidirectional or reverse)
    for (const link of incoming) {
      if (link.source === normalizedTarget) {
        return [...chain, link]; // Found the target!
      }
      if (!visited.has(link.source)) {
        queue.push({ path: link.source, chain: [...chain, link] });
      }
    }
  }

  return null; // No path found
}

/**
 * Find all contradicting relationships in the knowledge base.
 *
 * @param path - Optional: only find contradictions involving this file
 * @returns Array of links with "contradicts" relationship
 */
export async function findContradictions(
  path?: string
): Promise<KnowledgeLink[]> {
  const db = await getKnowledgeDb();
  const allContradictions = await db.getAllFromIndex(
    "links",
    "by-relationship",
    "contradicts"
  );

  if (!path) {
    return allContradictions;
  }

  const normalizedPath = normalizePath(path);
  return allContradictions.filter(
    (link) => link.source === normalizedPath || link.target === normalizedPath
  );
}

/**
 * Build an adjacency list representation of the entire knowledge graph.
 * Useful for visualization components.
 *
 * @returns Adjacency list with nodes and links maps
 */
export async function buildAdjacencyList(): Promise<AdjacencyList> {
  const db = await getKnowledgeDb();
  const allLinks = await db.getAll("links");

  const nodes = new Map<string, Set<string>>();
  const links = new Map<string, KnowledgeLink>();

  for (const link of allLinks) {
    links.set(link.id, link);

    // Add source node
    if (!nodes.has(link.source)) {
      nodes.set(link.source, new Set());
    }
    nodes.get(link.source)!.add(link.target);

    // Add target node
    if (!nodes.has(link.target)) {
      nodes.set(link.target, new Set());
    }

    // For bidirectional links, add reverse connection
    if (link.bidirectional) {
      nodes.get(link.target)!.add(link.source);
    }
  }

  return { nodes, links };
}

/**
 * Get the prerequisite chain for a file (following "requires" relationships).
 *
 * @param path - File to get prerequisites for
 * @returns Ordered array of prerequisite files (deepest first)
 */
export async function getPrerequisiteChain(
  path: string
): Promise<string[]> {
  const normalizedPath = normalizePath(path);
  const result = await traverseGraph(normalizedPath, {
    depth: 5,
    relationship: "requires",
    direction: "outgoing",
  });

  // Extract just the paths, excluding the starting file
  return result.nodes
    .map((n) => n.path)
    .filter((p) => p !== normalizedPath);
}

/**
 * Get files that depend on a given file (reverse "requires" relationships).
 *
 * @param path - File to check dependents for
 * @returns Array of files that require this file
 */
export async function getDependents(path: string): Promise<string[]> {
  const normalizedPath = normalizePath(path);
  const result = await traverseGraph(normalizedPath, {
    depth: 5,
    relationship: "requires",
    direction: "incoming",
  });

  return result.nodes
    .map((n) => n.path)
    .filter((p) => p !== normalizedPath);
}

/**
 * Relationship colors for visualization.
 */
export const RELATIONSHIP_COLORS: Record<RelationshipType, string> = {
  extends: "#22c55e",      // Green - building upon
  references: "#3b82f6",   // Blue - citing
  contradicts: "#ef4444",  // Red - conflict
  requires: "#f59e0b",     // Amber - dependency
  blocks: "#dc2626",       // Dark red - blocking
  "relates-to": "#8b5cf6", // Purple - general connection
};

/**
 * Human-readable labels for relationship types.
 */
export const RELATIONSHIP_LABELS: Record<RelationshipType, string> = {
  extends: "extends",
  references: "references",
  contradicts: "contradicts",
  requires: "requires",
  blocks: "blocks",
  "relates-to": "relates to",
};
