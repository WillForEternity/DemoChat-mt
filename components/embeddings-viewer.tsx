"use client";

/**
 * Embeddings Viewer Component
 *
 * Visualizes the embedding space using UMAP for dimensionality reduction.
 * Shows a 2D scatter plot of all embedded chunks with interactive features.
 * 
 * UMAP projections are cached and only recomputed when embeddings are reindexed,
 * not every time this component loads.
 */

import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { getAllEmbeddings, getEmbeddingStats, getUmapCache, type EmbeddingRecord, type UmapCache } from "@/knowledge";
import { cn } from "@/lib/utils";
import { RefreshCw, ZoomIn, ZoomOut, Move, Info, Loader2 } from "lucide-react";

// =============================================================================
// TYPES
// =============================================================================

interface Point2D {
  x: number;
  y: number;
  embedding: EmbeddingRecord;
}

interface ViewState {
  offsetX: number;
  offsetY: number;
  scale: number;
}

// =============================================================================
// CONSTANTS
// =============================================================================

const MIN_SCALE = 0.1;
const MAX_SCALE = 5;

// Color palette for folders/categories - maximally distinct colors
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

/**
 * Get adaptive point size and opacity based on total chunk count.
 * More points = smaller radius and lower opacity to reduce overlap.
 */
function getPointStyle(totalPoints: number): { radius: number; hoverRadius: number; opacity: number } {
  if (totalPoints < 100) {
    return { radius: 6, hoverRadius: 10, opacity: 1.0 };
  } else if (totalPoints < 500) {
    return { radius: 4, hoverRadius: 8, opacity: 0.8 };
  } else if (totalPoints < 2000) {
    return { radius: 3, hoverRadius: 6, opacity: 0.6 };
  } else {
    return { radius: 2, hoverRadius: 5, opacity: 0.5 };
  }
}

// =============================================================================
// COMPONENT
// =============================================================================

export function EmbeddingsViewer({ className }: { className?: string }) {
  // State
  const [embeddings, setEmbeddings] = useState<EmbeddingRecord[]>([]);
  const [points, setPoints] = useState<Point2D[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [cacheStatus, setCacheStatus] = useState<"loading" | "cached" | "missing">("loading");
  const [stats, setStats] = useState<{ totalChunks: number; totalFiles: number } | null>(null);
  const [hoveredPoint, setHoveredPoint] = useState<Point2D | null>(null);
  const [selectedPoint, setSelectedPoint] = useState<Point2D | null>(null);
  const [filterCategory, setFilterCategory] = useState<string | null>(null); // For click-to-filter
  const [viewState, setViewState] = useState<ViewState>({
    offsetX: 0,
    offsetY: 0,
    scale: 1,
  });
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });

  // Refs
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Folder/category color mapping (instead of per-file)
  const categoryColorMap = useMemo(() => {
    const categories = [...new Set(embeddings.map((e) => getCategory(e.filePath)))];
    const map = new Map<string, string>();
    categories.forEach((cat, i) => {
      map.set(cat, FOLDER_COLORS[i % FOLDER_COLORS.length]);
    });
    return map;
  }, [embeddings]);

  // Adaptive point style based on total count
  const pointStyle = useMemo(() => getPointStyle(points.length), [points.length]);

  // Load embeddings and cached UMAP projection
  const loadEmbeddingsAndProjection = useCallback(async () => {
    setIsLoading(true);
    setCacheStatus("loading");
    
    try {
      // Load embeddings, stats, and cached UMAP projection in parallel
      const [embs, statsData, umapCache] = await Promise.all([
        getAllEmbeddings(),
        getEmbeddingStats(),
        getUmapCache(),
      ]);
      
      setEmbeddings(embs);
      setStats(statsData);
      
      // Use cached UMAP projection if available
      if (umapCache && embs.length > 0) {
        // Build a map of embedding ID to embedding record for fast lookup
        const embeddingMap = new Map(embs.map(e => [e.id, e]));
        
        // Reconstruct points from cache
        const cachedPoints: Point2D[] = [];
        for (const point of umapCache.points) {
          const embedding = embeddingMap.get(point.embeddingId);
          if (embedding) {
            cachedPoints.push({
              x: point.x,
              y: point.y,
              embedding,
            });
          }
        }
        
        if (cachedPoints.length > 0) {
          setPoints(cachedPoints);
          setCacheStatus("cached");
          setViewState({ offsetX: 0, offsetY: 0, scale: 1 });
          console.log(`[EmbeddingsViewer] Loaded ${cachedPoints.length} points from cache`);
        } else {
          // Cache exists but no valid points (embeddings changed without reindex)
          setCacheStatus("missing");
          setPoints([]);
        }
      } else if (embs.length > 0) {
        // No cache available - need to reindex
        setCacheStatus("missing");
        setPoints([]);
      } else {
        // No embeddings at all
        setCacheStatus("missing");
        setPoints([]);
      }
    } catch (error) {
      console.error("[EmbeddingsViewer] Failed to load embeddings:", error);
      setCacheStatus("missing");
    } finally {
      setIsLoading(false);
    }
  }, []);

  // Initial load
  useEffect(() => {
    loadEmbeddingsAndProjection();
  }, [loadEmbeddingsAndProjection]);

  // Canvas rendering
  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container || points.length === 0) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // Set canvas size
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

    // Clear
    ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue("--background") || "#f9fafb";
    ctx.fillRect(0, 0, width, height);

    // Transform coordinates
    const toCanvasX = (x: number) =>
      centerX + (x * baseScale * viewState.scale) + viewState.offsetX;
    const toCanvasY = (y: number) =>
      centerY + (y * baseScale * viewState.scale) + viewState.offsetY;

    // Draw grid lines (subtle)
    ctx.strokeStyle = "rgba(128, 128, 128, 0.1)";
    ctx.lineWidth = 1;
    for (let i = -1; i <= 1; i += 0.5) {
      // Vertical
      ctx.beginPath();
      ctx.moveTo(toCanvasX(i), 0);
      ctx.lineTo(toCanvasX(i), height);
      ctx.stroke();
      // Horizontal
      ctx.beginPath();
      ctx.moveTo(0, toCanvasY(i));
      ctx.lineTo(width, toCanvasY(i));
      ctx.stroke();
    }

    // Draw points (dimmed points first, then highlighted)
    // This ensures filtered category is rendered on top
    const sortedPoints = filterCategory
      ? [...points].sort((a, b) => {
          const aCat = getCategory(a.embedding.filePath);
          const bCat = getCategory(b.embedding.filePath);
          // Filtered category comes last (drawn on top)
          if (aCat === filterCategory && bCat !== filterCategory) return 1;
          if (bCat === filterCategory && aCat !== filterCategory) return -1;
          return 0;
        })
      : points;

    for (const point of sortedPoints) {
      const x = toCanvasX(point.x);
      const y = toCanvasY(point.y);
      const category = getCategory(point.embedding.filePath);
      const baseColor = categoryColorMap.get(category) || "#6366f1";
      const isHovered = hoveredPoint === point;
      const isSelected = selectedPoint === point;
      const isFiltered = filterCategory && category !== filterCategory;
      
      // Determine radius
      const radius = isHovered || isSelected ? pointStyle.hoverRadius : pointStyle.radius;

      // Determine opacity (dimmed if filtering and not in filtered category)
      const opacity = isFiltered ? 0.15 : pointStyle.opacity;

      // Shadow for hovered/selected
      if ((isHovered || isSelected) && !isFiltered) {
        ctx.shadowColor = baseColor;
        ctx.shadowBlur = 12;
      }

      ctx.beginPath();
      ctx.arc(x, y, radius, 0, Math.PI * 2);
      ctx.globalAlpha = opacity;
      ctx.fillStyle = baseColor;
      ctx.fill();
      ctx.globalAlpha = 1;

      // Border for selected
      if (isSelected) {
        ctx.strokeStyle = "#fff";
        ctx.lineWidth = 2;
        ctx.stroke();
      }

      ctx.shadowColor = "transparent";
      ctx.shadowBlur = 0;
    }
  }, [points, viewState, hoveredPoint, selectedPoint, categoryColorMap, filterCategory, pointStyle]);

  // Mouse handlers
  const getPointAtPosition = useCallback(
    (clientX: number, clientY: number): Point2D | null => {
      const canvas = canvasRef.current;
      const container = containerRef.current;
      if (!canvas || !container) return null;

      const rect = container.getBoundingClientRect();
      const x = clientX - rect.left;
      const y = clientY - rect.top;

      const width = rect.width;
      const height = rect.height;
      const centerX = width / 2;
      const centerY = height / 2;
      const baseScale = Math.min(width, height) * 0.4;

      // Find closest point
      let closest: Point2D | null = null;
      let closestDist = Infinity;

      for (const point of points) {
        const px = centerX + (point.x * baseScale * viewState.scale) + viewState.offsetX;
        const py = centerY + (point.y * baseScale * viewState.scale) + viewState.offsetY;
        const dist = Math.sqrt((x - px) ** 2 + (y - py) ** 2);

        if (dist < pointStyle.hoverRadius * 1.5 && dist < closestDist) {
          closest = point;
          closestDist = dist;
        }
      }

      return closest;
    },
    [points, viewState, pointStyle.hoverRadius]
  );

  const handleMouseMove = useCallback(
    (e: React.MouseEvent) => {
      if (isDragging) {
        const dx = e.clientX - dragStart.x;
        const dy = e.clientY - dragStart.y;
        setViewState((prev) => ({
          ...prev,
          offsetX: prev.offsetX + dx,
          offsetY: prev.offsetY + dy,
        }));
        setDragStart({ x: e.clientX, y: e.clientY });
      } else {
        const point = getPointAtPosition(e.clientX, e.clientY);
        setHoveredPoint(point);
      }
    },
    [isDragging, dragStart, getPointAtPosition]
  );

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.button === 0) {
      setIsDragging(true);
      setDragStart({ x: e.clientX, y: e.clientY });
    }
  }, []);

  const handleMouseUp = useCallback(() => {
    setIsDragging(false);
  }, []);

  const handleClick = useCallback(
    (e: React.MouseEvent) => {
      const point = getPointAtPosition(e.clientX, e.clientY);
      setSelectedPoint(point === selectedPoint ? null : point);
    },
    [getPointAtPosition, selectedPoint]
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
  const zoomIn = () =>
    setViewState((prev) => ({
      ...prev,
      scale: Math.min(MAX_SCALE, prev.scale * 1.3),
    }));

  const zoomOut = () =>
    setViewState((prev) => ({
      ...prev,
      scale: Math.max(MIN_SCALE, prev.scale / 1.3),
    }));

  const resetView = () =>
    setViewState({ offsetX: 0, offsetY: 0, scale: 1 });

  // =============================================================================
  // RENDER
  // =============================================================================

  if (isLoading) {
    return (
      <div className={cn("flex flex-col items-center justify-center h-full", className)}>
        <Loader2 className="w-8 h-8 animate-spin text-indigo-500 mb-3" />
        <p className="text-sm text-gray-500 dark:text-neutral-400">Loading embeddings...</p>
      </div>
    );
  }

  if (embeddings.length === 0) {
    return (
      <div className={cn("flex flex-col items-center justify-center h-full px-6", className)}>
        <div className="w-16 h-16 rounded-2xl bg-indigo-50 dark:bg-indigo-900/30 flex items-center justify-center mb-4">
          <Info className="w-8 h-8 text-indigo-500" />
        </div>
        <h3 className="text-sm font-medium text-gray-700 dark:text-neutral-300 mb-2">
          No Embeddings Yet
        </h3>
        <p className="text-xs text-gray-500 dark:text-neutral-400 text-center max-w-xs">
          Add content to your Knowledge Base and click &quot;Reindex All&quot; in the KB tab to generate embeddings.
        </p>
      </div>
    );
  }

  // Show message if embeddings exist but no cached projection
  if (cacheStatus === "missing" && points.length === 0) {
    return (
      <div className={cn("flex flex-col items-center justify-center h-full px-6", className)}>
        <div className="w-16 h-16 rounded-2xl bg-amber-50 dark:bg-amber-900/30 flex items-center justify-center mb-4">
          <RefreshCw className="w-8 h-8 text-amber-500" />
        </div>
        <h3 className="text-sm font-medium text-gray-700 dark:text-neutral-300 mb-2">
          Visualization Not Computed
        </h3>
        <p className="text-xs text-gray-500 dark:text-neutral-400 text-center max-w-xs">
          Click &quot;Reindex All&quot; in the KB tab to compute the embedding visualization.
        </p>
      </div>
    );
  }

  return (
    <div className={cn("flex flex-col h-full", className)}>
      {/* Header */}
      <div className="px-3 py-2 border-b border-gray-200 dark:border-neutral-700 bg-gray-50/50 dark:bg-neutral-900/50 flex-shrink-0">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-xs text-gray-500 dark:text-neutral-400">
              {stats?.totalChunks || 0} points • {categoryColorMap.size} folders • {stats?.totalFiles || 0} files
            </span>
            {cacheStatus === "cached" && (
              <span className="text-xs text-green-600 dark:text-green-400">
                (cached)
              </span>
            )}
          </div>
          <div className="flex items-center gap-1">
            <button
              onClick={zoomOut}
              className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-neutral-800 text-gray-500 dark:text-neutral-400 transition-colors"
              title="Zoom out"
            >
              <ZoomOut className="w-4 h-4" />
            </button>
            <button
              onClick={zoomIn}
              className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-neutral-800 text-gray-500 dark:text-neutral-400 transition-colors"
              title="Zoom in"
            >
              <ZoomIn className="w-4 h-4" />
            </button>
            <button
              onClick={resetView}
              className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-neutral-800 text-gray-500 dark:text-neutral-400 transition-colors"
              title="Reset view"
            >
              <Move className="w-4 h-4" />
            </button>
            <button
              onClick={loadEmbeddingsAndProjection}
              className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-neutral-800 text-gray-500 dark:text-neutral-400 transition-colors"
              title="Refresh from cache"
            >
              <RefreshCw className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>

      {/* Canvas */}
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
          className="absolute inset-0 bg-gray-50 dark:bg-neutral-900"
        />

        {/* Tooltip for hovered point */}
        {hoveredPoint && !isDragging && (
          <div
            className="absolute z-10 pointer-events-none"
            style={{
              left: "50%",
              top: 8,
              transform: "translateX(-50%)",
            }}
          >
            <div className="bg-white dark:bg-neutral-800 rounded-lg shadow-lg border border-gray-200 dark:border-neutral-700 px-3 py-2 max-w-xs">
              <p className="text-xs font-medium text-gray-700 dark:text-neutral-300 truncate">
                {hoveredPoint.embedding.filePath}
              </p>
              {hoveredPoint.embedding.headingPath && (
                <p className="text-xs text-gray-500 dark:text-neutral-400 truncate">
                  {hoveredPoint.embedding.headingPath}
                </p>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Selected point details */}
      {selectedPoint && (
        <div className="border-t border-gray-200 dark:border-neutral-700 p-3 bg-white dark:bg-neutral-800 max-h-48 overflow-y-auto">
          <div className="flex items-center justify-between mb-2">
            <p className="text-xs font-medium text-gray-700 dark:text-neutral-300 truncate">
              {selectedPoint.embedding.filePath}
            </p>
            <button
              onClick={() => setSelectedPoint(null)}
              className="text-gray-400 hover:text-gray-600 dark:hover:text-neutral-300"
            >
              ×
            </button>
          </div>
          {selectedPoint.embedding.headingPath && (
            <p className="text-xs text-indigo-500 mb-2 truncate">
              {selectedPoint.embedding.headingPath}
            </p>
          )}
          <p className="text-xs text-gray-600 dark:text-neutral-400 whitespace-pre-wrap line-clamp-6">
            {selectedPoint.embedding.chunkText}
          </p>
        </div>
      )}

      {/* Legend - click to filter by folder */}
      <div className="border-t border-gray-200 dark:border-neutral-700 px-3 py-2 bg-gray-50/50 dark:bg-neutral-900/50 flex-shrink-0">
        <div className="flex flex-wrap gap-1.5">
          {[...categoryColorMap.entries()].map(([category, color]) => {
            const isActive = filterCategory === category;
            const isDimmed = filterCategory && !isActive;
            return (
              <button
                key={category}
                onClick={() => setFilterCategory(isActive ? null : category)}
                className={cn(
                  "flex items-center gap-1.5 px-2 py-1 rounded-md transition-all text-xs",
                  isActive
                    ? "bg-gray-200 dark:bg-neutral-700 ring-1 ring-gray-300 dark:ring-neutral-600"
                    : "hover:bg-gray-100 dark:hover:bg-neutral-800",
                  isDimmed && "opacity-40"
                )}
                title={isActive ? "Click to show all" : `Filter to ${category}`}
              >
                <div
                  className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                  style={{ backgroundColor: color }}
                />
                <span className="text-gray-600 dark:text-neutral-300 truncate max-w-24">
                  {category === "root" ? "(root)" : category}
                </span>
              </button>
            );
          })}
          {filterCategory && (
            <button
              onClick={() => setFilterCategory(null)}
              className="text-xs text-indigo-500 hover:text-indigo-600 dark:hover:text-indigo-400 px-2 py-1"
            >
              Clear filter
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

export default EmbeddingsViewer;
