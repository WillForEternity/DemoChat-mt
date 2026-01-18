/**
 * Knowledge Filesystem Types
 *
 * Types for the client-side knowledge base that Claude controls via tools.
 * Data is stored in IndexedDB for fast, persistent access without API calls.
 */

export interface KnowledgeNode {
  path: string;
  type: "file" | "folder";
  content?: string;
  children?: string[];
  createdAt: number;
  updatedAt: number;
}

export interface KnowledgeTree {
  name: string;
  path: string;
  type: "file" | "folder";
  children?: KnowledgeTree[];
}
