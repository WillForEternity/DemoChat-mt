/**
 * Knowledge Graph Link Types
 *
 * TypeScript types for the knowledge graph relationship system.
 * Links connect knowledge base files to create a semantic graph.
 */

/**
 * Predefined relationship types for consistency and meaningful traversal.
 */
export type RelationshipType =
  | "extends"      // Target builds upon source concept
  | "references"   // Target cites or mentions source
  | "contradicts"  // Target conflicts with source (evolution tracking)
  | "requires"     // Target is prerequisite for source
  | "blocks"       // Source blocks progress on target
  | "relates-to";  // General thematic connection

/**
 * A link record stored in IndexedDB representing a relationship
 * between two knowledge base files.
 */
export interface KnowledgeLink {
  /** Unique ID: "{source}#{target}#{relationship}" */
  id: string;
  /** Source file path (must exist in KB) */
  source: string;
  /** Target file path (must exist in KB) */
  target: string;
  /** Type of relationship */
  relationship: RelationshipType;
  /** If true, relationship is symmetric (A->B implies B->A) */
  bidirectional: boolean;
  /** Optional context or notes about this relationship */
  notes?: string;
  /** Timestamp when link was created */
  createdAt: number;
  /** Timestamp when link was last updated */
  updatedAt: number;
}

/**
 * Result from querying links for a specific file.
 */
export interface LinkQueryResult {
  /** The link record */
  link: KnowledgeLink;
  /** Direction relative to the queried file */
  direction: "outgoing" | "incoming";
}

/**
 * A node in the knowledge graph with its connections.
 */
export interface GraphNode {
  /** File path this node represents */
  path: string;
  /** Connected links grouped by direction */
  links: {
    outgoing: KnowledgeLink[];
    incoming: KnowledgeLink[];
  };
}

/**
 * Result from traversing the knowledge graph.
 */
export interface GraphTraversalResult {
  /** Starting point of the traversal */
  rootPath: string;
  /** Maximum depth traversed */
  depth: number;
  /** All nodes discovered during traversal */
  nodes: GraphNode[];
  /** Total number of links in the traversal */
  totalLinks: number;
}

/**
 * Options for creating a link.
 */
export interface CreateLinkOptions {
  /** If true, relationship is symmetric */
  bidirectional?: boolean;
  /** Optional context about the relationship */
  notes?: string;
}

/**
 * Options for graph traversal.
 */
export interface TraversalOptions {
  /** Maximum depth to traverse (1-5, default: 2) */
  depth?: number;
  /** Filter to specific relationship type */
  relationship?: RelationshipType;
  /** Direction to traverse */
  direction?: "outgoing" | "incoming" | "both";
}

/**
 * Adjacency list representation for graph visualization.
 */
export interface AdjacencyList {
  /** Map of file path to connected paths with relationship info */
  nodes: Map<string, Set<string>>;
  /** All links indexed by their ID */
  links: Map<string, KnowledgeLink>;
}
