"use client";

/**
 * Knowledge Graph Viewer Component
 *
 * Modern, interactive force-directed graph visualization of knowledge base relationships.
 * Features smooth animations, curved edges, and refined visual aesthetics.
 */

import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { 
  getAllLinks, 
  getLinkStats, 
  getGraphLayoutCache,
  saveGraphLayoutCache,
  type KnowledgeLink, 
  type RelationshipType,
} from "@/knowledge";
import { cn } from "@/lib/utils";
import { RefreshCw, ZoomIn, ZoomOut, Maximize2, Info, Loader2, Filter, X, Database } from "lucide-react";

// =============================================================================
// TYPES
// =============================================================================

interface GraphNodeData {
  id: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  category: string;
  connections: number; // Track connection count for sizing
}

interface GraphEdge {
  source: string;
  target: string;
  relationship: RelationshipType;
  bidirectional: boolean;
}

interface ViewState {
  offsetX: number;
  offsetY: number;
  scale: number;
}

// =============================================================================
// CONSTANTS
// =============================================================================

const MIN_SCALE = 0.2;
const MAX_SCALE = 4;
const NODE_PADDING_X = 12;
const NODE_PADDING_Y = 8;
const NODE_FONT_SIZE = 11;
const NODE_BORDER_RADIUS = 6;
const CATEGORY_ACCENT_WIDTH = 4;

// Color palette for folders/categories - same as embeddings-viewer for consistency
const FOLDER_COLORS = [
  "#e6194b", // red
  "#3cb44b", // green
  "#4363d8", // blue
  "#f58231", // orange
  "#911eb4", // purple
  "#42d4f4", // cyan
  "#f032e6", // magenta
  "#bfef45", // lime
  "#fabed4", // pink
  "#469990", // teal
  "#dcbeff", // lavender
  "#9a6324", // brown
  "#fffac8", // beige
  "#800000", // maroon
  "#aaffc3", // mint
  "#808000", // olive
  "#ffd8b1", // apricot
  "#000075", // navy
  "#a9a9a9", // grey
  "#ffe119", // yellow
];


// Relationship edge colors with better contrast
const RELATIONSHIP_COLORS: Record<RelationshipType, { color: string; label: string }> = {
  extends: { color: "#22c55e", label: "Extends" },
  references: { color: "#3b82f6", label: "References" },
  contradicts: { color: "#ef4444", label: "Contradicts" },
  requires: { color: "#f59e0b", label: "Requires" },
  blocks: { color: "#dc2626", label: "Blocks" },
  "relates-to": { color: "#8b5cf6", label: "Relates to" },
};

// =============================================================================
// HELPERS
// =============================================================================

/**
 * Extract the top-level folder from a path for category-based coloring.
 * "/projects/ai/notes.md" → "projects"
 * "/notes.md" → "root"
 */
function getCategory(path: string): string {
  const parts = path.split("/").filter(Boolean);
  return parts.length > 1 ? parts[0] : "root";
}

function getFileName(path: string): string {
  const name = path.split("/").pop() || path;
  // Remove extension for cleaner display
  return name.replace(/\.[^/.]+$/, "");
}

function truncateLabel(text: string, maxLen: number = 12): string {
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen - 1) + "…";
}

// Convert hex to rgba for transparency
function hexToRgba(hex: string, alpha: number): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

// =============================================================================
// FORCE SIMULATION (Enhanced)
// =============================================================================

class ForceSimulation {
  nodes: Map<string, GraphNodeData>;
  edges: GraphEdge[];
  private running: boolean;
  private onTick: () => void;
  private alpha: number; // Simulation "temperature"
  
  constructor(onTick: () => void) {
    this.nodes = new Map();
    this.edges = [];
    this.running = false;
    this.onTick = onTick;
    this.alpha = 1;
  }
  
  setData(links: KnowledgeLink[]) {
    // Count connections per node
    const connectionCount = new Map<string, number>();
    for (const link of links) {
      connectionCount.set(link.source, (connectionCount.get(link.source) || 0) + 1);
      connectionCount.set(link.target, (connectionCount.get(link.target) || 0) + 1);
    }
    
    // Extract unique nodes
    const nodeIds = new Set<string>();
    for (const link of links) {
      nodeIds.add(link.source);
      nodeIds.add(link.target);
    }
    
    // Initialize nodes with circular layout
    this.nodes = new Map();
    const nodeArray = Array.from(nodeIds);
    const angleStep = (Math.PI * 2) / nodeArray.length;
    
    nodeArray.forEach((id, i) => {
      // Add some randomness to initial positions for organic feel
      const angle = i * angleStep + (Math.random() - 0.5) * 0.3;
      const radius = 0.6 + Math.random() * 0.2;
      this.nodes.set(id, {
        id,
        x: Math.cos(angle) * radius,
        y: Math.sin(angle) * radius,
        vx: 0,
        vy: 0,
        category: getCategory(id),
        connections: connectionCount.get(id) || 1,
      });
    });
    
    // Store edges
    this.edges = links.map((l) => ({
      source: l.source,
      target: l.target,
      relationship: l.relationship,
      bidirectional: l.bidirectional,
    }));
    
    this.alpha = 1;
  }
  
  start() {
    if (this.running) return;
    this.running = true;
    this.alpha = 1;
    this.tick();
  }
  
  stop() {
    this.running = false;
  }
  
  reheat() {
    this.alpha = 0.5;
    this.start();
  }
  
  private tick() {
    if (!this.running) return;
    
    const nodes = Array.from(this.nodes.values());
    const damping = 0.88;
    const repulsion = 0.025;
    const attraction = 0.035;
    const centerForce = 0.002;
    
    // Apply forces
    for (const node of nodes) {
      // Repulsion from other nodes (scaled by alpha)
      for (const other of nodes) {
        if (node.id === other.id) continue;
        const dx = node.x - other.x;
        const dy = node.y - other.y;
        const dist = Math.sqrt(dx * dx + dy * dy) || 0.01;
        // Higher repulsion for nodes with more connections
        const connectionFactor = Math.sqrt(node.connections * other.connections) * 0.5;
        const force = (repulsion * this.alpha * (1 + connectionFactor)) / (dist * dist);
        node.vx += (dx / dist) * force;
        node.vy += (dy / dist) * force;
      }
      
      // Center gravity (stronger for isolated nodes)
      const isolationFactor = node.connections < 2 ? 2 : 1;
      node.vx -= node.x * centerForce * this.alpha * isolationFactor;
      node.vy -= node.y * centerForce * this.alpha * isolationFactor;
    }
    
    // Spring forces along edges
    for (const edge of this.edges) {
      const source = this.nodes.get(edge.source);
      const target = this.nodes.get(edge.target);
      if (!source || !target) continue;
      
      const dx = target.x - source.x;
      const dy = target.y - source.y;
      const dist = Math.sqrt(dx * dx + dy * dy) || 0.01;
      // Dynamic ideal distance based on node sizes
      const idealDist = 0.35 + (source.connections + target.connections) * 0.02;
      const force = (dist - idealDist) * attraction * this.alpha;
      
      const fx = (dx / dist) * force;
      const fy = (dy / dist) * force;
      
      source.vx += fx;
      source.vy += fy;
      target.vx -= fx;
      target.vy -= fy;
    }
    
    // Apply velocity and damping
    let totalVelocity = 0;
    for (const node of nodes) {
      node.vx *= damping;
      node.vy *= damping;
      node.x += node.vx;
      node.y += node.vy;
      totalVelocity += Math.abs(node.vx) + Math.abs(node.vy);
    }
    
    // Cool down
    this.alpha *= 0.995;
    
    this.onTick();
    
    // Continue if still moving and alpha is significant
    if (totalVelocity > 0.0005 && this.alpha > 0.001 && this.running) {
      requestAnimationFrame(() => this.tick());
    } else {
      this.running = false;
    }
  }
  
  moveNode(id: string, x: number, y: number) {
    const node = this.nodes.get(id);
    if (node) {
      node.x = x;
      node.y = y;
      node.vx = 0;
      node.vy = 0;
    }
  }

  /**
   * Load node positions from cache.
   * Returns true if cache was successfully applied.
   */
  loadFromCache(cachedNodes: Array<{ id: string; x: number; y: number }>): boolean {
    if (cachedNodes.length === 0) return false;
    
    const cachedMap = new Map(cachedNodes.map(n => [n.id, { x: n.x, y: n.y }]));
    let applied = 0;
    
    for (const node of this.nodes.values()) {
      const cached = cachedMap.get(node.id);
      if (cached) {
        node.x = cached.x;
        node.y = cached.y;
        node.vx = 0;
        node.vy = 0;
        applied++;
      }
    }
    
    // Consider successful if we applied to at least 80% of nodes
    return applied >= this.nodes.size * 0.8;
  }

  /**
   * Export current node positions for caching.
   */
  exportPositions(): Array<{ id: string; x: number; y: number }> {
    return Array.from(this.nodes.values()).map(node => ({
      id: node.id,
      x: node.x,
      y: node.y,
    }));
  }

  /**
   * Check if simulation has settled (low velocity).
   */
  isSettled(): boolean {
    const nodes = Array.from(this.nodes.values());
    const totalVelocity = nodes.reduce((sum, n) => sum + Math.abs(n.vx) + Math.abs(n.vy), 0);
    return totalVelocity < 0.01;
  }
}

// =============================================================================
// COMPONENT
// =============================================================================

export function KnowledgeGraphViewer({ className }: { className?: string }) {
  const [links, setLinks] = useState<KnowledgeLink[]>([]);
  const [stats, setStats] = useState<{ totalLinks: number; filesWithLinks: number } | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [cacheStatus, setCacheStatus] = useState<"loading" | "cached" | "computing" | "fresh">("loading");
  const [hoveredNode, setHoveredNode] = useState<GraphNodeData | null>(null);
  const [selectedNode, setSelectedNode] = useState<GraphNodeData | null>(null);
  const [filterRelationship, setFilterRelationship] = useState<RelationshipType | null>(null);
  const [viewState, setViewState] = useState<ViewState>({ offsetX: 0, offsetY: 0, scale: 1 });
  const [isDragging, setIsDragging] = useState(false);
  const [draggedNode, setDraggedNode] = useState<string | null>(null);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const [, forceRender] = useState(0);
  const [showLegend, setShowLegend] = useState(false);
  const [layoutSaved, setLayoutSaved] = useState(false);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const simulationRef = useRef<ForceSimulation | null>(null);
  const saveTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Category color mapping for folder identification
  const categoryColorMap = useMemo(() => {
    const categories = new Set<string>();
    for (const link of links) {
      categories.add(getCategory(link.source));
      categories.add(getCategory(link.target));
    }
    const map = new Map<string, string>();
    const sortedCategories = Array.from(categories).sort();
    sortedCategories.forEach((cat, i) => {
      map.set(cat, FOLDER_COLORS[i % FOLDER_COLORS.length]);
    });
    return map;
  }, [links]);

  // Save layout to cache (debounced)
  const saveLayoutToCache = useCallback(async () => {
    const simulation = simulationRef.current;
    if (!simulation || !simulation.isSettled()) return;
    
    const positions = simulation.exportPositions();
    const linkIds = Array.from(simulation.edges.map(e => `${e.source}#${e.target}#${e.relationship}`));
    
    await saveGraphLayoutCache(positions, simulation.edges.length, linkIds);
    setLayoutSaved(true);
    setCacheStatus("cached");
    console.log("[GraphViewer] Layout saved to cache");
  }, []);

  // Schedule cache save when simulation settles
  const scheduleCacheSave = useCallback(() => {
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
    }
    saveTimeoutRef.current = setTimeout(() => {
      saveLayoutToCache();
    }, 500); // Wait 500ms after simulation settles
  }, [saveLayoutToCache]);

  // Track if we need to save (using ref to avoid dependency issues)
  const needsSaveRef = useRef(false);

  // Load data
  const loadData = useCallback(async (forceRecompute = false) => {
    setIsLoading(true);
    setCacheStatus("loading");
    setLayoutSaved(false);
    needsSaveRef.current = true;
    
    try {
      // Load links, stats, and cached layout in parallel
      const [allLinks, linkStats, cachedLayout] = await Promise.all([
        getAllLinks(),
        getLinkStats(),
        forceRecompute ? Promise.resolve(null) : getGraphLayoutCache(),
      ]);
      
      setLinks(allLinks);
      setStats({ totalLinks: linkStats.totalLinks, filesWithLinks: linkStats.filesWithLinks });
      
      // Initialize simulation
      if (!simulationRef.current) {
        simulationRef.current = new ForceSimulation(() => {
          forceRender((n) => n + 1);
          // Check if we should save cache
          if (simulationRef.current?.isSettled() && needsSaveRef.current) {
            needsSaveRef.current = false;
            scheduleCacheSave();
          }
        });
      }
      simulationRef.current.setData(allLinks);
      
      // Try to apply cached layout
      if (cachedLayout && cachedLayout.linkCount === allLinks.length) {
        // Verify cache is valid by checking link hash
        const currentLinkIds = allLinks.map(l => l.id).sort();
        const cachedHash = cachedLayout.linkHash;
        
        // Simple validation: count and hash should match
        let hash = 0;
        const str = currentLinkIds.join("|");
        for (let i = 0; i < str.length; i++) {
          const char = str.charCodeAt(i);
          hash = ((hash << 5) - hash) + char;
          hash = hash & hash;
        }
        const currentHash = hash.toString(36);
        
        if (cachedHash === currentHash) {
          const applied = simulationRef.current.loadFromCache(cachedLayout.nodes);
          if (applied) {
            setCacheStatus("cached");
            setLayoutSaved(true);
            needsSaveRef.current = false;
            console.log("[GraphViewer] Loaded layout from cache");
            // Don't run simulation - positions are static from cache
            forceRender((n) => n + 1); // Trigger render
            return;
          }
        }
      }
      
      // No valid cache - run simulation
      setCacheStatus("computing");
      simulationRef.current.start();
      
    } finally {
      setIsLoading(false);
    }
  }, [scheduleCacheSave]);

  useEffect(() => {
    loadData();
    return () => {
      simulationRef.current?.stop();
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
      }
    };
  }, [loadData]);

  // Calculate node dimensions for hit testing
  const getNodeDimensions = useCallback((node: GraphNodeData, scale: number) => {
    // Approximate text width (we can't use canvas context here easily)
    const label = getFileName(node.id);
    const fontSize = NODE_FONT_SIZE * Math.min(1.1, scale);
    // Approximate character width
    const charWidth = fontSize * 0.6;
    const width = label.length * charWidth + NODE_PADDING_X * 2;
    const height = fontSize + NODE_PADDING_Y * 2;
    return { width, height };
  }, []);

  // Canvas rendering
  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    const simulation = simulationRef.current;
    if (!canvas || !container || !simulation) return;

    const ctx = canvas.getContext("2d", { alpha: false });
    if (!ctx) return;

    const rect = container.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    canvas.style.width = `${rect.width}px`;
    canvas.style.height = `${rect.height}px`;
    ctx.scale(dpr, dpr);

    const width = rect.width;
    const height = rect.height;
    const centerX = width / 2;
    const centerY = height / 2;
    const baseScale = Math.min(width, height) * 0.4;

    // Detect dark mode
    const isDark = document.documentElement.classList.contains("dark");
    const bgColor = isDark ? "#171717" : "#fafafa";
    const textColor = isDark ? "#e5e5e5" : "#374151";
    const subtleColor = isDark ? "#404040" : "#e5e7eb";

    // Clear with background
    ctx.fillStyle = bgColor;
    ctx.fillRect(0, 0, width, height);

    // Draw subtle grid pattern
    ctx.strokeStyle = subtleColor;
    ctx.lineWidth = 0.5;
    ctx.globalAlpha = 0.3;
    const gridSize = 40 * viewState.scale;
    const offsetXMod = viewState.offsetX % gridSize;
    const offsetYMod = viewState.offsetY % gridSize;
    for (let x = offsetXMod; x < width; x += gridSize) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, height);
      ctx.stroke();
    }
    for (let y = offsetYMod; y < height; y += gridSize) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(width, y);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;

    // Transform functions
    const toCanvasX = (x: number) => centerX + (x * baseScale * viewState.scale) + viewState.offsetX;
    const toCanvasY = (y: number) => centerY + (y * baseScale * viewState.scale) + viewState.offsetY;

    // Helper to get approximate node dimensions for edge calculation
    const getApproxNodeSize = (node: GraphNodeData) => {
      const label = getFileName(node.id);
      const fontSize = NODE_FONT_SIZE * Math.min(1.1, viewState.scale);
      const charWidth = fontSize * 0.6;
      const w = label.length * charWidth + NODE_PADDING_X * 2;
      const h = fontSize + NODE_PADDING_Y * 2;
      return { w, h };
    };

    // Helper to find edge intersection point with rectangle
    const getEdgePoint = (
      cx: number, cy: number, // center of rect
      w: number, h: number,  // width/height of rect
      tx: number, ty: number // target point
    ) => {
      const dx = tx - cx;
      const dy = ty - cy;
      const hw = w / 2;
      const hh = h / 2;
      
      if (dx === 0 && dy === 0) return { x: cx, y: cy };
      
      // Find intersection with rectangle edge
      const scaleX = hw / Math.abs(dx || 0.001);
      const scaleY = hh / Math.abs(dy || 0.001);
      const scale = Math.min(scaleX, scaleY);
      
      return {
        x: cx + dx * scale,
        y: cy + dy * scale
      };
    };

    // Draw edges with curved bezier lines
    for (const edge of simulation.edges) {
      if (filterRelationship && edge.relationship !== filterRelationship) continue;
      
      const source = simulation.nodes.get(edge.source);
      const target = simulation.nodes.get(edge.target);
      if (!source || !target) continue;

      const sourceCx = toCanvasX(source.x);
      const sourceCy = toCanvasY(source.y);
      const targetCx = toCanvasX(target.x);
      const targetCy = toCanvasY(target.y);
      
      // Get node sizes
      const sourceSize = getApproxNodeSize(source);
      const targetSize = getApproxNodeSize(target);
      
      // Calculate edge points on rectangle boundaries
      const sourcePoint = getEdgePoint(sourceCx, sourceCy, sourceSize.w, sourceSize.h, targetCx, targetCy);
      const targetPoint = getEdgePoint(targetCx, targetCy, targetSize.w, targetSize.h, sourceCx, sourceCy);
      
      const x1 = sourcePoint.x;
      const y1 = sourcePoint.y;
      const x2 = targetPoint.x;
      const y2 = targetPoint.y;

      const isConnectedToSelected = selectedNode && 
        (selectedNode.id === edge.source || selectedNode.id === edge.target);
      const isConnectedToHovered = hoveredNode && 
        (hoveredNode.id === edge.source || hoveredNode.id === edge.target);
      const isHighlighted = isConnectedToSelected || isConnectedToHovered;

      // Calculate curve control point (perpendicular offset)
      const midX = (x1 + x2) / 2;
      const midY = (y1 + y2) / 2;
      const dx = x2 - x1;
      const dy = y2 - y1;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const curvature = Math.min(25, dist * 0.12); // Subtle curve
      const perpX = dist > 0 ? -dy / dist * curvature : 0;
      const perpY = dist > 0 ? dx / dist * curvature : 0;
      const cpX = midX + perpX;
      const cpY = midY + perpY;

      // Draw edge
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.quadraticCurveTo(cpX, cpY, x2, y2);
      
      const edgeColor = RELATIONSHIP_COLORS[edge.relationship].color;
      ctx.strokeStyle = edgeColor;
      ctx.lineWidth = isHighlighted ? 2.5 : 1.5;
      ctx.globalAlpha = isHighlighted ? 0.9 : (selectedNode || hoveredNode ? 0.2 : 0.5);
      ctx.stroke();
      ctx.globalAlpha = 1;

      // Draw arrow at 70% along the curve (closer to target)
      if (isHighlighted || (!selectedNode && !hoveredNode)) {
        const t = 0.7;
        const arrowX = (1-t)*(1-t)*x1 + 2*(1-t)*t*cpX + t*t*x2;
        const arrowY = (1-t)*(1-t)*y1 + 2*(1-t)*t*cpY + t*t*y2;
        // Tangent at point t
        const tangentX = 2*(1-t)*(cpX-x1) + 2*t*(x2-cpX);
        const tangentY = 2*(1-t)*(cpY-y1) + 2*t*(y2-cpY);
        const angle = Math.atan2(tangentY, tangentX);
        const arrowLen = isHighlighted ? 8 : 6;
        
        ctx.beginPath();
        ctx.moveTo(arrowX, arrowY);
        ctx.lineTo(
          arrowX - arrowLen * Math.cos(angle - Math.PI / 7),
          arrowY - arrowLen * Math.sin(angle - Math.PI / 7)
        );
        ctx.lineTo(
          arrowX - arrowLen * Math.cos(angle + Math.PI / 7),
          arrowY - arrowLen * Math.sin(angle + Math.PI / 7)
        );
        ctx.closePath();
        ctx.fillStyle = edgeColor;
        ctx.globalAlpha = isHighlighted ? 0.9 : 0.5;
        ctx.fill();
        ctx.globalAlpha = 1;

        // Reverse arrow for bidirectional
        if (edge.bidirectional) {
          const t2 = 0.3;
          const arrow2X = (1-t2)*(1-t2)*x1 + 2*(1-t2)*t2*cpX + t2*t2*x2;
          const arrow2Y = (1-t2)*(1-t2)*y1 + 2*(1-t2)*t2*cpY + t2*t2*y2;
          const tangent2X = 2*(1-t2)*(cpX-x1) + 2*t2*(x2-cpX);
          const tangent2Y = 2*(1-t2)*(cpY-y1) + 2*t2*(y2-cpY);
          const angle2 = Math.atan2(tangent2Y, tangent2X) + Math.PI;
          
          ctx.beginPath();
          ctx.moveTo(arrow2X, arrow2Y);
          ctx.lineTo(
            arrow2X - arrowLen * Math.cos(angle2 - Math.PI / 7),
            arrow2Y - arrowLen * Math.sin(angle2 - Math.PI / 7)
          );
          ctx.lineTo(
            arrow2X - arrowLen * Math.cos(angle2 + Math.PI / 7),
            arrow2Y - arrowLen * Math.sin(angle2 + Math.PI / 7)
          );
          ctx.closePath();
          ctx.globalAlpha = isHighlighted ? 0.9 : 0.5;
          ctx.fill();
          ctx.globalAlpha = 1;
        }
      }
    }

    // Draw nodes - use stable iteration order, two passes for z-ordering
    const nodes = Array.from(simulation.nodes.values());
    
    // Pre-compute which nodes are connected to selection
    const connectedToSelection = new Set<string>();
    if (selectedNode) {
      for (const edge of simulation.edges) {
        if (edge.source === selectedNode.id) connectedToSelection.add(edge.target);
        if (edge.target === selectedNode.id) connectedToSelection.add(edge.source);
      }
    }

    // Neumorphic colors - matching the button style from knowledge-tool-view
    // Light mode: bg-gradient-to-br from-gray-50 to-gray-100
    // Dark mode: from-neutral-800 to-neutral-900
    const neumorphBgLight = isDark ? "#262626" : "#fafafa"; // gray-50
    const neumorphBgDark = isDark ? "#171717" : "#f5f5f5";  // gray-100
    // Shadows: 6px_6px_12px for dark, -6px_-6px_12px for light
    const neumorphLightShadow = isDark ? "rgba(255, 255, 255, 0.05)" : "rgba(255, 255, 255, 0.8)";
    const neumorphDarkShadow = isDark ? "rgba(0, 0, 0, 0.3)" : "rgba(0, 0, 0, 0.08)";

    // Helper to get node dimensions
    const getNodeDimensions = (node: GraphNodeData) => {
      const label = getFileName(node.id);
      const fontSize = NODE_FONT_SIZE * Math.min(1.1, viewState.scale);
      ctx.font = `500 ${fontSize}px system-ui, -apple-system, sans-serif`;
      const metrics = ctx.measureText(label);
      const width = metrics.width + NODE_PADDING_X * 2;
      const height = fontSize + NODE_PADDING_Y * 2;
      return { width, height, label, fontSize };
    };

    // Helper to draw a neumorphic node
    const drawNode = (node: GraphNodeData, isHighlightPass: boolean) => {
      const x = toCanvasX(node.x);
      const y = toCanvasY(node.y);
      const isHovered = hoveredNode?.id === node.id;
      const isSelected = selectedNode?.id === node.id;
      const isHighlighted = isHovered || isSelected;
      const isConnected = connectedToSelection.has(node.id);
      
      // Skip based on pass
      if (isHighlightPass && !isHighlighted) return;
      if (!isHighlightPass && isHighlighted) return;
      
      const { width, height, label, fontSize } = getNodeDimensions(node);
      const categoryColor = categoryColorMap.get(node.category) || FOLDER_COLORS[0];
      
      // Dim non-connected nodes when something is selected/hovered
      const shouldDim = (selectedNode || hoveredNode) && !isHovered && !isSelected && !isConnected;
      
      // Calculate rect position (centered on x, y)
      const rectX = x - width / 2;
      const rectY = y - height / 2;

      ctx.globalAlpha = shouldDim ? 0.35 : 1;

      // Neumorphic shadow layers (matching button style)
      if (!shouldDim) {
        // Dark shadow (bottom-right) - 6px offset, 12px blur
        ctx.shadowColor = neumorphDarkShadow;
        ctx.shadowBlur = 12;
        ctx.shadowOffsetX = 6;
        ctx.shadowOffsetY = 6;
        
        // Draw with gradient background
        const bgGradient = ctx.createLinearGradient(rectX, rectY, rectX + width, rectY + height);
        bgGradient.addColorStop(0, neumorphBgLight);
        bgGradient.addColorStop(1, neumorphBgDark);
        ctx.fillStyle = bgGradient;
        ctx.beginPath();
        ctx.roundRect(rectX, rectY, width, height, NODE_BORDER_RADIUS);
        ctx.fill();
        
        // Light shadow (top-left) - -6px offset, 12px blur
        ctx.shadowColor = neumorphLightShadow;
        ctx.shadowOffsetX = -6;
        ctx.shadowOffsetY = -6;
        ctx.shadowBlur = 12;
        
        ctx.beginPath();
        ctx.roundRect(rectX, rectY, width, height, NODE_BORDER_RADIUS);
        ctx.fill();
      } else {
        // Dimmed nodes - simple fill without shadows
        const bgGradient = ctx.createLinearGradient(rectX, rectY, rectX + width, rectY + height);
        bgGradient.addColorStop(0, neumorphBgLight);
        bgGradient.addColorStop(1, neumorphBgDark);
        ctx.fillStyle = bgGradient;
        ctx.beginPath();
        ctx.roundRect(rectX, rectY, width, height, NODE_BORDER_RADIUS);
        ctx.fill();
      }

      // Reset shadow
      ctx.shadowColor = "transparent";
      ctx.shadowBlur = 0;
      ctx.shadowOffsetX = 0;
      ctx.shadowOffsetY = 0;

      // Category color accent bar (left edge)
      ctx.fillStyle = shouldDim ? hexToRgba(categoryColor, 0.4) : categoryColor;
      ctx.beginPath();
      ctx.roundRect(rectX, rectY, CATEGORY_ACCENT_WIDTH, height, [NODE_BORDER_RADIUS, 0, 0, NODE_BORDER_RADIUS]);
      ctx.fill();

      // Border for selected/hovered - subtle gray
      if (isSelected) {
        ctx.strokeStyle = isDark ? "#525252" : "#9ca3af"; // neutral-600 / gray-400
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.roundRect(rectX, rectY, width, height, NODE_BORDER_RADIUS);
        ctx.stroke();
      } else if (isHovered) {
        ctx.strokeStyle = isDark ? "#404040" : "#d1d5db"; // neutral-700 / gray-300
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.roundRect(rectX, rectY, width, height, NODE_BORDER_RADIUS);
        ctx.stroke();
      }

      // Text label (offset slightly to account for accent bar)
      ctx.font = `500 ${fontSize}px system-ui, -apple-system, sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillStyle = shouldDim 
        ? (isDark ? "#525252" : "#9ca3af")  // neutral-600 / gray-400
        : (isDark ? "#d4d4d4" : "#374151"); // neutral-300 / gray-700
      ctx.fillText(label, x + CATEGORY_ACCENT_WIDTH / 2, y);

      ctx.globalAlpha = 1;
    };

    // Pass 1: Draw all non-highlighted nodes
    for (const node of nodes) {
      drawNode(node, false);
    }
    
    // Pass 2: Draw highlighted nodes on top
    for (const node of nodes) {
      drawNode(node, true);
    }
  }, [links, viewState, hoveredNode, selectedNode, filterRelationship]);

  // Mouse handlers
  const getNodeAtPosition = useCallback(
    (clientX: number, clientY: number): GraphNodeData | null => {
      const container = containerRef.current;
      const simulation = simulationRef.current;
      if (!container || !simulation) return null;

      const rect = container.getBoundingClientRect();
      const mouseX = clientX - rect.left;
      const mouseY = clientY - rect.top;

      const width = rect.width;
      const height = rect.height;
      const centerX = width / 2;
      const centerY = height / 2;
      const baseScale = Math.min(width, height) * 0.4;

      // Check each node rectangle
      for (const node of simulation.nodes.values()) {
        const nx = centerX + (node.x * baseScale * viewState.scale) + viewState.offsetX;
        const ny = centerY + (node.y * baseScale * viewState.scale) + viewState.offsetY;
        
        // Get node dimensions
        const { width: nodeWidth, height: nodeHeight } = getNodeDimensions(node, viewState.scale);
        
        // Check if mouse is inside rectangle (centered on nx, ny)
        const rectX = nx - nodeWidth / 2;
        const rectY = ny - nodeHeight / 2;
        
        if (
          mouseX >= rectX &&
          mouseX <= rectX + nodeWidth &&
          mouseY >= rectY &&
          mouseY <= rectY + nodeHeight
        ) {
          return node;
        }
      }

      return null;
    },
    [viewState, getNodeDimensions]
  );

  const handleMouseMove = useCallback(
    (e: React.MouseEvent) => {
      if (draggedNode && simulationRef.current) {
        const container = containerRef.current;
        if (!container) return;

        const rect = container.getBoundingClientRect();
        const width = rect.width;
        const height = rect.height;
        const centerX = width / 2;
        const centerY = height / 2;
        const baseScale = Math.min(width, height) * 0.4;

        const canvasX = e.clientX - rect.left;
        const canvasY = e.clientY - rect.top;
        const x = (canvasX - centerX - viewState.offsetX) / (baseScale * viewState.scale);
        const y = (canvasY - centerY - viewState.offsetY) / (baseScale * viewState.scale);

        simulationRef.current.moveNode(draggedNode, x, y);
        forceRender((n) => n + 1);
      } else if (isDragging) {
        const dx = e.clientX - dragStart.x;
        const dy = e.clientY - dragStart.y;
        setViewState((prev) => ({
          ...prev,
          offsetX: prev.offsetX + dx,
          offsetY: prev.offsetY + dy,
        }));
        setDragStart({ x: e.clientX, y: e.clientY });
      } else {
        const node = getNodeAtPosition(e.clientX, e.clientY);
        setHoveredNode(node);
      }
    },
    [isDragging, dragStart, draggedNode, getNodeAtPosition, viewState]
  );

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      const node = getNodeAtPosition(e.clientX, e.clientY);
      if (node) {
        setDraggedNode(node.id);
        simulationRef.current?.stop();
      } else if (e.button === 0) {
        setIsDragging(true);
        setDragStart({ x: e.clientX, y: e.clientY });
      }
    },
    [getNodeAtPosition]
  );

  const handleMouseUp = useCallback(() => {
    if (draggedNode) {
      setDraggedNode(null);
      // Only restart simulation if we're not using cached layout
      // When cached, nodes should stay where user placed them
      if (cacheStatus !== "cached") {
        simulationRef.current?.start();
      } else {
        // If user moved a node while cached, we need to save the new positions
        needsSaveRef.current = true;
        scheduleCacheSave();
      }
    }
    setIsDragging(false);
  }, [draggedNode, cacheStatus, scheduleCacheSave]);

  const handleClick = useCallback(
    (e: React.MouseEvent) => {
      if (!draggedNode) {
        const node = getNodeAtPosition(e.clientX, e.clientY);
        setSelectedNode(node === selectedNode ? null : node);
      }
    },
    [getNodeAtPosition, selectedNode, draggedNode]
  );

  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    const delta = e.deltaY > 0 ? 0.9 : 1.1;
    setViewState((prev) => ({
      ...prev,
      scale: Math.max(MIN_SCALE, Math.min(MAX_SCALE, prev.scale * delta)),
    }));
  }, []);

  // Zoom controls
  const zoomIn = () => setViewState((prev) => ({ ...prev, scale: Math.min(MAX_SCALE, prev.scale * 1.3) }));
  const zoomOut = () => setViewState((prev) => ({ ...prev, scale: Math.max(MIN_SCALE, prev.scale / 1.3) }));
  const resetView = () => {
    setViewState({ offsetX: 0, offsetY: 0, scale: 1 });
  };
  const recomputeLayout = () => {
    setLayoutSaved(false);
    setCacheStatus("computing");
    simulationRef.current?.reheat();
  };

  // Get selected node connections
  const selectedNodeConnections = useMemo(() => {
    if (!selectedNode || !simulationRef.current) return { outgoing: [], incoming: [] };
    const outgoing: GraphEdge[] = [];
    const incoming: GraphEdge[] = [];
    for (const edge of simulationRef.current.edges) {
      if (edge.source === selectedNode.id) outgoing.push(edge);
      if (edge.target === selectedNode.id) incoming.push(edge);
    }
    return { outgoing, incoming };
  }, [selectedNode]);

  // Control button component
  const ControlButton = ({ onClick, title, children, active = false }: { 
    onClick: () => void; 
    title: string; 
    children: React.ReactNode;
    active?: boolean;
  }) => (
    <button
      onClick={onClick}
      className={cn(
        "p-2 rounded-lg transition-all duration-200",
        "hover:bg-white/80 dark:hover:bg-neutral-700/80",
        "text-gray-500 dark:text-neutral-400 hover:text-gray-700 dark:hover:text-neutral-200",
        "backdrop-blur-sm",
        active && "bg-white dark:bg-neutral-700 text-gray-700 dark:text-neutral-200 shadow-sm"
      )}
      title={title}
    >
      {children}
    </button>
  );

  // =============================================================================
  // RENDER
  // =============================================================================

  if (isLoading) {
    return (
      <div className={cn("flex flex-col items-center justify-center h-full bg-gray-50 dark:bg-neutral-900", className)}>
        <div className="relative">
          <div className="absolute inset-0 rounded-full bg-purple-500/20 animate-ping" />
          <Loader2 className="w-8 h-8 animate-spin text-purple-500 relative" />
        </div>
        <p className="text-sm text-gray-500 dark:text-neutral-400 mt-4">Loading knowledge graph...</p>
      </div>
    );
  }

  if (links.length === 0) {
    return (
      <div className={cn("flex flex-col items-center justify-center h-full px-6 bg-gray-50 dark:bg-neutral-900", className)}>
        <div className="w-20 h-20 rounded-2xl bg-gradient-to-br from-purple-100 to-violet-100 dark:from-purple-900/40 dark:to-violet-900/40 flex items-center justify-center mb-5 shadow-lg">
          <Info className="w-10 h-10 text-purple-500" />
        </div>
        <h3 className="text-base font-semibold text-gray-800 dark:text-neutral-200 mb-2">No Links Yet</h3>
        <p className="text-sm text-gray-500 dark:text-neutral-400 text-center max-w-sm leading-relaxed">
          Create relationships between files in your knowledge base using the <code className="px-1.5 py-0.5 bg-gray-100 dark:bg-neutral-800 rounded text-purple-600 dark:text-purple-400 text-xs">kb_link</code> tool to visualize connections here.
        </p>
      </div>
    );
  }

  return (
    <div className={cn("flex flex-col h-full bg-gray-50 dark:bg-neutral-900 overflow-hidden", className)}>
      {/* Canvas container */}
      <div
        ref={containerRef}
        className="flex-1 relative overflow-hidden cursor-grab active:cursor-grabbing"
        onMouseMove={handleMouseMove}
        onMouseDown={handleMouseDown}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        onClick={handleClick}
        onWheel={handleWheel}
      >
        <canvas
          ref={canvasRef}
          className="absolute inset-0"
        />

        {/* Floating stats badge with cache status */}
        <div className="absolute top-3 left-3 flex items-center gap-2">
          <div className="px-3 py-1.5 rounded-full bg-white/90 dark:bg-neutral-800/90 backdrop-blur-sm shadow-sm border border-gray-200/50 dark:border-neutral-700/50 flex items-center gap-2">
            <span className="text-xs font-medium text-gray-600 dark:text-neutral-300">
              {stats?.filesWithLinks || 0} nodes
            </span>
            <span className="text-gray-300 dark:text-neutral-600">•</span>
            <span className="text-xs font-medium text-gray-600 dark:text-neutral-300">
              {stats?.totalLinks || 0} links
            </span>
            {cacheStatus === "cached" && (
              <>
                <span className="text-gray-300 dark:text-neutral-600">•</span>
                <span className="flex items-center gap-1 text-xs text-emerald-600 dark:text-emerald-400">
                  <Database className="w-3 h-3" />
                  cached
                </span>
              </>
            )}
            {cacheStatus === "computing" && (
              <>
                <span className="text-gray-300 dark:text-neutral-600">•</span>
                <span className="flex items-center gap-1 text-xs text-amber-600 dark:text-amber-400">
                  <Loader2 className="w-3 h-3 animate-spin" />
                  computing
                </span>
              </>
            )}
          </div>
        </div>

        {/* Floating controls - top right */}
        <div className="absolute top-3 right-3 flex items-center gap-1 p-1 rounded-xl bg-white/90 dark:bg-neutral-800/90 backdrop-blur-sm shadow-sm border border-gray-200/50 dark:border-neutral-700/50">
          <ControlButton onClick={zoomOut} title="Zoom out">
            <ZoomOut className="w-4 h-4" />
          </ControlButton>
          <div className="w-px h-5 bg-gray-200 dark:bg-neutral-700" />
          <ControlButton onClick={zoomIn} title="Zoom in">
            <ZoomIn className="w-4 h-4" />
          </ControlButton>
          <div className="w-px h-5 bg-gray-200 dark:bg-neutral-700" />
          <ControlButton onClick={resetView} title="Center view">
            <Maximize2 className="w-4 h-4" />
          </ControlButton>
          <div className="w-px h-5 bg-gray-200 dark:bg-neutral-700" />
          <ControlButton onClick={recomputeLayout} title="Re-compute layout (ignores cache)">
            <RefreshCw className={cn("w-4 h-4", cacheStatus === "computing" && "animate-spin")} />
          </ControlButton>
        </div>

        {/* Toggle buttons - bottom left */}
        <div className="absolute bottom-3 left-3">
          <ControlButton 
            onClick={() => setShowLegend(!showLegend)} 
            title={showLegend ? "Hide legend" : "Show legend"}
            active={showLegend}
          >
            <Filter className="w-4 h-4" />
          </ControlButton>
        </div>

        {/* Legend panel - bottom right */}
        {showLegend && (
          <div className="absolute bottom-3 right-3 w-52 p-3 rounded-xl bg-white/95 dark:bg-neutral-800/95 backdrop-blur-sm shadow-lg border border-gray-200/50 dark:border-neutral-700/50">
            <div className="flex items-center justify-between mb-3">
              <span className="text-xs font-semibold text-gray-700 dark:text-neutral-300">Legend</span>
              <button
                onClick={() => setShowLegend(false)}
                className="p-0.5 rounded hover:bg-gray-100 dark:hover:bg-neutral-700 text-gray-400"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
            
            {/* Relationship types */}
            <div className="mb-3">
              <p className="text-[10px] uppercase tracking-wide text-gray-500 dark:text-neutral-500 mb-2">Relationships</p>
              <div className="grid grid-cols-2 gap-1">
                {(Object.entries(RELATIONSHIP_COLORS) as [RelationshipType, { color: string; label: string }][]).map(([rel, { color, label }]) => {
                  const isActive = filterRelationship === rel;
                  return (
                    <button
                      key={rel}
                      onClick={() => setFilterRelationship(isActive ? null : rel)}
                      className={cn(
                        "flex items-center gap-1.5 px-2 py-1 rounded-md transition-all text-[10px]",
                        isActive
                          ? "ring-1 ring-offset-1 ring-offset-white dark:ring-offset-neutral-800"
                          : "hover:bg-gray-50 dark:hover:bg-neutral-700/50",
                        filterRelationship && !isActive && "opacity-40"
                      )}
                      style={{ 
                        backgroundColor: isActive ? hexToRgba(color, 0.15) : undefined,
                        ringColor: isActive ? color : undefined 
                      }}
                    >
                      <div
                        className="w-2 h-2 rounded-full flex-shrink-0"
                        style={{ backgroundColor: color }}
                      />
                      <span className="text-gray-600 dark:text-neutral-300 truncate">{label}</span>
                    </button>
                  );
                })}
              </div>
              {filterRelationship && (
                <button
                  onClick={() => setFilterRelationship(null)}
                  className="w-full text-[10px] text-gray-500 hover:text-gray-700 dark:text-neutral-400 dark:hover:text-neutral-200 mt-2 py-1"
                >
                  Clear filter
                </button>
              )}
            </div>
          </div>
        )}

        {/* Hover tooltip */}
        {hoveredNode && !isDragging && !draggedNode && (
          <div
            className="absolute z-20 pointer-events-none transition-opacity duration-150"
            style={{ left: "50%", top: 12, transform: "translateX(-50%)" }}
          >
            <div className="px-4 py-2.5 rounded-xl bg-white/95 dark:bg-neutral-800/95 backdrop-blur-sm shadow-lg border border-gray-200/50 dark:border-neutral-700/50">
              <p className="text-sm font-medium text-gray-800 dark:text-neutral-200">
                {getFileName(hoveredNode.id)}
              </p>
              <p className="text-[11px] text-gray-500 dark:text-neutral-400 mt-0.5">
                {hoveredNode.id}
              </p>
              <div className="flex items-center gap-3 mt-2 pt-2 border-t border-gray-100 dark:border-neutral-700">
                <span className="text-[10px] text-gray-500 dark:text-neutral-500">
                  <span className="font-medium text-gray-600 dark:text-neutral-400">{hoveredNode.connections}</span> connection{hoveredNode.connections !== 1 ? "s" : ""}
                </span>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Selected node details panel */}
      {selectedNode && (
        <div className="border-t border-gray-200 dark:border-neutral-700 bg-white dark:bg-neutral-800 max-h-44 overflow-y-auto flex-shrink-0">
          <div className="p-3">
            <div className="flex items-start justify-between gap-3 mb-3">
              <div className="min-w-0">
                <p className="text-sm font-semibold text-gray-800 dark:text-neutral-200 truncate">
                  {getFileName(selectedNode.id)}
                </p>
                <p className="text-[10px] text-gray-500 dark:text-neutral-400 truncate">
                  {selectedNode.id}
                </p>
              </div>
              <button
                onClick={() => setSelectedNode(null)}
                className="p-1 rounded-lg hover:bg-gray-100 dark:hover:bg-neutral-700 text-gray-400 hover:text-gray-600 dark:hover:text-neutral-300 transition-colors flex-shrink-0"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            
            <div className="grid grid-cols-2 gap-3">
              {/* Outgoing connections */}
              <div>
                <p className="text-[10px] uppercase tracking-wide text-gray-500 dark:text-neutral-500 mb-1.5 flex items-center gap-1">
                  <span className="inline-block w-3 h-px bg-gray-300 dark:bg-neutral-600" />
                  <span>Outgoing ({selectedNodeConnections.outgoing.length})</span>
                </p>
                {selectedNodeConnections.outgoing.length > 0 ? (
                  <div className="space-y-1">
                    {selectedNodeConnections.outgoing.map((edge, i) => (
                      <div
                        key={i}
                        className="flex items-center gap-1.5 text-[11px] px-2 py-1 rounded-lg bg-gray-50 dark:bg-neutral-700/50"
                      >
                        <div
                          className="w-1.5 h-1.5 rounded-full flex-shrink-0"
                          style={{ backgroundColor: RELATIONSHIP_COLORS[edge.relationship].color }}
                        />
                        <span className="text-gray-500 dark:text-neutral-400">{RELATIONSHIP_COLORS[edge.relationship].label}</span>
                        <span className="text-gray-300 dark:text-neutral-600">→</span>
                        <span className="text-gray-700 dark:text-neutral-300 truncate font-medium">{getFileName(edge.target)}</span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-[10px] text-gray-400 dark:text-neutral-500 italic">None</p>
                )}
              </div>
              
              {/* Incoming connections */}
              <div>
                <p className="text-[10px] uppercase tracking-wide text-gray-500 dark:text-neutral-500 mb-1.5 flex items-center gap-1">
                  <span>Incoming ({selectedNodeConnections.incoming.length})</span>
                  <span className="inline-block w-3 h-px bg-gray-300 dark:bg-neutral-600" />
                </p>
                {selectedNodeConnections.incoming.length > 0 ? (
                  <div className="space-y-1">
                    {selectedNodeConnections.incoming.map((edge, i) => (
                      <div
                        key={i}
                        className="flex items-center gap-1.5 text-[11px] px-2 py-1 rounded-lg bg-gray-50 dark:bg-neutral-700/50"
                      >
                        <span className="text-gray-700 dark:text-neutral-300 truncate font-medium">{getFileName(edge.source)}</span>
                        <span className="text-gray-300 dark:text-neutral-600">→</span>
                        <div
                          className="w-1.5 h-1.5 rounded-full flex-shrink-0"
                          style={{ backgroundColor: RELATIONSHIP_COLORS[edge.relationship].color }}
                        />
                        <span className="text-gray-500 dark:text-neutral-400">{RELATIONSHIP_COLORS[edge.relationship].label}</span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-[10px] text-gray-400 dark:text-neutral-500 italic">None</p>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default KnowledgeGraphViewer;
