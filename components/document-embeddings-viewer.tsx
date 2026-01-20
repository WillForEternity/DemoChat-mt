"use client";

/**
 * Document Embeddings Viewer Component
 *
 * Visualizes the embedding space of a selected large document using UMAP.
 * Shows a 2D scatter plot where chunks are colored in greyscale based on
 * their position in the document (light grey at start, black at end).
 *
 * This helps users understand the semantic structure of their documents
 * and how different sections relate to each other in embedding space.
 */

import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import {
  getLargeDocumentsDb,
  getDocumentUmapCache,
  saveDocumentUmapCache,
} from "@/knowledge/large-documents/idb";
import type { LargeDocumentMetadata, LargeDocumentChunk } from "@/knowledge/large-documents/types";
import { cn } from "@/lib/utils";
import { RefreshCw, ZoomIn, ZoomOut, Move, Loader2, FileText, ChevronDown, Check } from "lucide-react";
import { UMAP } from "umap-js";

// =============================================================================
// TYPES
// =============================================================================

interface Point2D {
  x: number;
  y: number;
  chunk: LargeDocumentChunk;
  /** Normalized position in document (0 = start, 1 = end) */
  position: number;
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

// =============================================================================
// HELPERS
// =============================================================================

/**
 * Get adaptive point size and opacity based on total chunk count.
 */
function getPointStyle(totalPoints: number): { radius: number; hoverRadius: number; opacity: number } {
  if (totalPoints < 50) {
    return { radius: 8, hoverRadius: 12, opacity: 1.0 };
  } else if (totalPoints < 100) {
    return { radius: 6, hoverRadius: 10, opacity: 0.9 };
  } else if (totalPoints < 300) {
    return { radius: 4, hoverRadius: 8, opacity: 0.8 };
  } else {
    return { radius: 3, hoverRadius: 6, opacity: 0.7 };
  }
}

/**
 * Get greyscale color based on position in document.
 * Position 0 (start) = light grey (#d0d0d0)
 * Position 1 (end) = black (#1a1a1a)
 */
function getPositionColor(position: number, isDarkMode: boolean): string {
  // Interpolate between light grey and black/white based on position
  if (isDarkMode) {
    // Dark mode: start with light color, end with darker
    const startColor = 220; // Light grey
    const endColor = 80;    // Dark grey (not pure black for visibility)
    const value = Math.round(startColor - (startColor - endColor) * position);
    return `rgb(${value}, ${value}, ${value})`;
  } else {
    // Light mode: start with light grey, end with black
    const startColor = 180; // Light grey
    const endColor = 26;    // Near black (#1a1a1a)
    const value = Math.round(startColor - (startColor - endColor) * position);
    return `rgb(${value}, ${value}, ${value})`;
  }
}

/**
 * Compute UMAP projection for document chunks.
 */
async function computeUmapProjection(chunks: LargeDocumentChunk[]): Promise<Point2D[]> {
  if (chunks.length < 2) {
    // Need at least 2 points for UMAP
    if (chunks.length === 1) {
      return [{
        x: 0,
        y: 0,
        chunk: chunks[0],
        position: 0,
      }];
    }
    return [];
  }

  // Extract embedding vectors
  const vectors = chunks.map((c) => c.embedding);

  // Configure UMAP for document visualization
  const nNeighbors = Math.min(15, Math.max(2, Math.floor(chunks.length / 3)));
  const minDist = 0.1;

  const umap = new UMAP({
    nComponents: 2,
    nNeighbors,
    minDist,
    spread: 1.0,
    random: Math.random, // Use random seed for variety
  });

  // Run UMAP
  const projection = umap.fit(vectors);

  // Normalize coordinates to [-1, 1] range
  let minX = Infinity, maxX = -Infinity;
  let minY = Infinity, maxY = -Infinity;

  for (const [x, y] of projection) {
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
    minY = Math.min(minY, y);
    maxY = Math.max(maxY, y);
  }

  const rangeX = maxX - minX || 1;
  const rangeY = maxY - minY || 1;

  // Create points with normalized position
  const totalChunks = chunks.length;
  return chunks.map((chunk, i) => ({
    x: ((projection[i][0] - minX) / rangeX) * 2 - 1,
    y: ((projection[i][1] - minY) / rangeY) * 2 - 1,
    chunk,
    position: totalChunks > 1 ? i / (totalChunks - 1) : 0,
  }));
}

// =============================================================================
// DOCUMENT SELECTOR COMPONENT
// =============================================================================

interface DocumentSelectorProps {
  documents: LargeDocumentMetadata[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  isLoading: boolean;
}

function DocumentSelector({ documents, selectedId, onSelect, isLoading }: DocumentSelectorProps) {
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const selectedDoc = documents.find((d) => d.id === selectedId);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  if (documents.length === 0) {
    return (
      <div className="px-3 py-2 text-sm text-gray-500 dark:text-neutral-400">
        No documents uploaded
      </div>
    );
  }

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        disabled={isLoading}
        className={cn(
          "w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm transition-all",
          "bg-white dark:bg-neutral-800 border border-gray-200 dark:border-neutral-700",
          "hover:bg-gray-50 dark:hover:bg-neutral-750",
          isLoading && "opacity-50 cursor-wait"
        )}
      >
        <FileText className="w-4 h-4 text-gray-400 dark:text-neutral-500 flex-shrink-0" />
        <span className="flex-1 text-left truncate text-gray-700 dark:text-neutral-300">
          {selectedDoc?.filename || "Select a document..."}
        </span>
        <ChevronDown className={cn(
          "w-4 h-4 text-gray-400 dark:text-neutral-500 transition-transform",
          isOpen && "rotate-180"
        )} />
      </button>

      {isOpen && (
        <div className="absolute z-20 top-full left-0 right-0 mt-1 bg-white dark:bg-neutral-800 border border-gray-200 dark:border-neutral-700 rounded-lg shadow-lg max-h-60 overflow-y-auto">
          {documents.map((doc) => (
            <button
              key={doc.id}
              onClick={() => {
                onSelect(doc.id);
                setIsOpen(false);
              }}
              className={cn(
                "w-full flex items-center gap-2 px-3 py-2 text-sm transition-colors",
                "hover:bg-gray-50 dark:hover:bg-neutral-700",
                doc.id === selectedId && "bg-gray-100 dark:bg-neutral-700"
              )}
            >
              <FileText className="w-4 h-4 text-gray-400 dark:text-neutral-500 flex-shrink-0" />
              <div className="flex-1 text-left min-w-0">
                <p className="truncate text-gray-700 dark:text-neutral-300">{doc.filename}</p>
                <p className="text-xs text-gray-400 dark:text-neutral-500">
                  {doc.chunkCount} chunks
                </p>
              </div>
              {doc.id === selectedId && (
                <Check className="w-4 h-4 text-emerald-500 flex-shrink-0" />
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// =============================================================================
// MAIN COMPONENT
// =============================================================================

export function DocumentEmbeddingsViewer({ className }: { className?: string }) {
  // State
  const [documents, setDocuments] = useState<LargeDocumentMetadata[]>([]);
  const [selectedDocumentId, setSelectedDocumentId] = useState<string | null>(null);
  const [chunks, setChunks] = useState<LargeDocumentChunk[]>([]);
  const [points, setPoints] = useState<Point2D[]>([]);
  const [isLoadingDocuments, setIsLoadingDocuments] = useState(true);
  const [isComputing, setIsComputing] = useState(false);
  const [isCached, setIsCached] = useState(false);
  const [hoveredPoint, setHoveredPoint] = useState<Point2D | null>(null);
  const [selectedPoint, setSelectedPoint] = useState<Point2D | null>(null);
  const [viewState, setViewState] = useState<ViewState>({
    offsetX: 0,
    offsetY: 0,
    scale: 1,
  });
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const [isDarkMode, setIsDarkMode] = useState(false);

  // Refs
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Adaptive point style based on total count
  const pointStyle = useMemo(() => getPointStyle(points.length), [points.length]);

  // Detect dark mode
  useEffect(() => {
    const checkDarkMode = () => {
      setIsDarkMode(document.documentElement.classList.contains("dark"));
    };
    checkDarkMode();

    const observer = new MutationObserver(checkDarkMode);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });

    return () => observer.disconnect();
  }, []);

  // Load available documents
  const loadDocuments = useCallback(async () => {
    setIsLoadingDocuments(true);
    try {
      const db = await getLargeDocumentsDb();
      const docs = await db.getAll("documents");
      // Only show ready documents
      const readyDocs = docs.filter((d) => d.status === "ready");
      setDocuments(readyDocs);
    } catch (error) {
      console.error("[DocumentEmbeddingsViewer] Failed to load documents:", error);
    } finally {
      setIsLoadingDocuments(false);
    }
  }, []);

  // Load chunks for selected document and compute UMAP (with caching)
  const loadDocumentChunks = useCallback(async (documentId: string, forceRecompute = false) => {
    setIsComputing(true);
    setPoints([]);
    setSelectedPoint(null);
    setIsCached(false);

    try {
      const db = await getLargeDocumentsDb();
      const docChunks = await db.getAllFromIndex("chunks", "by-document", documentId);

      // Sort by chunk index
      docChunks.sort((a, b) => a.chunkIndex - b.chunkIndex);

      setChunks(docChunks);

      if (docChunks.length > 0) {
        const totalChunks = docChunks.length;

        // Check cache first (unless forcing recompute)
        if (!forceRecompute) {
          const cached = await getDocumentUmapCache(documentId, totalChunks);
          if (cached) {
            // Build chunk map for fast lookup
            const chunkMap = new Map(docChunks.map((c) => [c.chunkIndex, c]));

            // Reconstruct points from cache
            const cachedPoints: Point2D[] = [];
            for (const point of cached.points) {
              const chunk = chunkMap.get(point.chunkIndex);
              if (chunk) {
                cachedPoints.push({
                  x: point.x,
                  y: point.y,
                  chunk,
                  position: totalChunks > 1 ? point.chunkIndex / (totalChunks - 1) : 0,
                });
              }
            }

            if (cachedPoints.length === totalChunks) {
              setPoints(cachedPoints);
              setViewState({ offsetX: 0, offsetY: 0, scale: 1 });
              setIsCached(true);
              console.log(`[DocumentEmbeddingsViewer] Loaded ${cachedPoints.length} points from cache`);
              return;
            }
          }
        }

        // Compute UMAP projection
        console.log(`[DocumentEmbeddingsViewer] Computing UMAP for ${totalChunks} chunks...`);
        const projectedPoints = await computeUmapProjection(docChunks);
        setPoints(projectedPoints);
        setViewState({ offsetX: 0, offsetY: 0, scale: 1 });
        setIsCached(false);

        // Save to cache
        const cachePoints = projectedPoints.map((p) => ({
          chunkIndex: p.chunk.chunkIndex,
          x: p.x,
          y: p.y,
        }));
        await saveDocumentUmapCache(documentId, cachePoints, totalChunks);
      }
    } catch (error) {
      console.error("[DocumentEmbeddingsViewer] Failed to load chunks:", error);
    } finally {
      setIsComputing(false);
    }
  }, []);

  // Initial load
  useEffect(() => {
    loadDocuments();
  }, [loadDocuments]);

  // Load chunks when document selection changes
  useEffect(() => {
    if (selectedDocumentId) {
      loadDocumentChunks(selectedDocumentId);
    } else {
      setChunks([]);
      setPoints([]);
    }
  }, [selectedDocumentId, loadDocumentChunks]);

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
    ctx.fillStyle = isDarkMode ? "#171717" : "#f9fafb";
    ctx.fillRect(0, 0, width, height);

    // Transform coordinates
    const toCanvasX = (x: number) =>
      centerX + x * baseScale * viewState.scale + viewState.offsetX;
    const toCanvasY = (y: number) =>
      centerY + y * baseScale * viewState.scale + viewState.offsetY;

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

    // Draw points - sorted by position so darker (later) points render on top
    const sortedPoints = [...points].sort((a, b) => a.position - b.position);

    for (const point of sortedPoints) {
      const x = toCanvasX(point.x);
      const y = toCanvasY(point.y);
      const isHovered = hoveredPoint === point;
      const isSelected = selectedPoint === point;

      // Get color based on position
      const dotColor = getPositionColor(point.position, isDarkMode);

      // Determine radius
      const radius = isHovered || isSelected ? pointStyle.hoverRadius : pointStyle.radius;

      // Shadow for hovered/selected
      if (isHovered || isSelected) {
        ctx.shadowColor = dotColor;
        ctx.shadowBlur = 12;
      }

      ctx.beginPath();
      ctx.arc(x, y, radius, 0, Math.PI * 2);
      ctx.globalAlpha = pointStyle.opacity;
      ctx.fillStyle = dotColor;
      ctx.fill();
      ctx.globalAlpha = 1;

      // Border for selected
      if (isSelected) {
        ctx.strokeStyle = isDarkMode ? "#1a1a1a" : "#fff";
        ctx.lineWidth = 2;
        ctx.stroke();
      }

      ctx.shadowColor = "transparent";
      ctx.shadowBlur = 0;
    }
  }, [points, viewState, hoveredPoint, selectedPoint, pointStyle, isDarkMode]);

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
        const px = centerX + point.x * baseScale * viewState.scale + viewState.offsetX;
        const py = centerY + point.y * baseScale * viewState.scale + viewState.offsetY;
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

  const resetView = () => setViewState({ offsetX: 0, offsetY: 0, scale: 1 });

  // =============================================================================
  // RENDER
  // =============================================================================

  if (isLoadingDocuments) {
    return (
      <div className={cn("flex flex-col items-center justify-center h-full", className)}>
        <Loader2 className="w-8 h-8 animate-spin text-emerald-500 mb-3" />
        <p className="text-sm text-gray-500 dark:text-neutral-400">Loading documents...</p>
      </div>
    );
  }

  if (documents.length === 0) {
    return (
      <div className={cn("flex flex-col items-center justify-center h-full px-6", className)}>
        <div className="w-16 h-16 rounded-2xl bg-emerald-50 dark:bg-emerald-900/30 flex items-center justify-center mb-4">
          <FileText className="w-8 h-8 text-emerald-500" />
        </div>
        <h3 className="text-sm font-medium text-gray-700 dark:text-neutral-300 mb-2">
          No Documents Yet
        </h3>
        <p className="text-xs text-gray-500 dark:text-neutral-400 text-center max-w-xs">
          Upload documents in the Large Documents tab to visualize their embedding space.
        </p>
      </div>
    );
  }

  return (
    <div className={cn("flex flex-col h-full", className)}>
      {/* Header with document selector */}
      <div className="px-3 py-2 border-b border-gray-200 dark:border-neutral-700 bg-gray-50/50 dark:bg-neutral-900/50 flex-shrink-0 space-y-2">
        {/* Document selector */}
        <DocumentSelector
          documents={documents}
          selectedId={selectedDocumentId}
          onSelect={setSelectedDocumentId}
          isLoading={isComputing}
        />

        {/* Controls */}
        {selectedDocumentId && (
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="text-xs text-gray-500 dark:text-neutral-400">
                {chunks.length} chunks
              </span>
              {isComputing ? (
                <span className="text-xs text-emerald-600 dark:text-emerald-400 flex items-center gap-1">
                  <Loader2 className="w-3 h-3 animate-spin" />
                  Computing...
                </span>
              ) : isCached && points.length > 0 ? (
                <span className="text-xs text-green-600 dark:text-green-400">(cached)</span>
              ) : null}
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
                onClick={() => selectedDocumentId && loadDocumentChunks(selectedDocumentId, true)}
                disabled={isComputing}
                className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-neutral-800 text-gray-500 dark:text-neutral-400 transition-colors disabled:opacity-50"
                title="Recompute projection (force)"
              >
                <RefreshCw className={cn("w-4 h-4", isComputing && "animate-spin")} />
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Canvas area */}
      {!selectedDocumentId ? (
        <div className="flex-1 flex items-center justify-center">
          <p className="text-sm text-gray-500 dark:text-neutral-400">
            Select a document to visualize
          </p>
        </div>
      ) : isComputing ? (
        <div className="flex-1 flex flex-col items-center justify-center">
          <Loader2 className="w-8 h-8 animate-spin text-emerald-500 mb-3" />
          <p className="text-sm text-gray-500 dark:text-neutral-400">Computing UMAP projection...</p>
        </div>
      ) : points.length === 0 ? (
        <div className="flex-1 flex items-center justify-center">
          <p className="text-sm text-gray-500 dark:text-neutral-400">
            No chunks to visualize
          </p>
        </div>
      ) : (
        <>
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
                  <div className="flex items-center gap-2 mb-1">
                    <div
                      className="w-3 h-3 rounded-full flex-shrink-0"
                      style={{ backgroundColor: getPositionColor(hoveredPoint.position, isDarkMode) }}
                    />
                    <p className="text-xs font-medium text-gray-700 dark:text-neutral-300">
                      Chunk {hoveredPoint.chunk.chunkIndex + 1}
                    </p>
                  </div>
                  {hoveredPoint.chunk.headingPath && (
                    <p className="text-xs text-gray-500 dark:text-neutral-400 truncate">
                      {hoveredPoint.chunk.headingPath}
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
                <div className="flex items-center gap-2">
                  <div
                    className="w-3 h-3 rounded-full flex-shrink-0"
                    style={{ backgroundColor: getPositionColor(selectedPoint.position, isDarkMode) }}
                  />
                  <p className="text-xs font-medium text-gray-700 dark:text-neutral-300">
                    Chunk {selectedPoint.chunk.chunkIndex + 1} of {chunks.length}
                  </p>
                </div>
                <button
                  onClick={() => setSelectedPoint(null)}
                  className="text-gray-400 hover:text-gray-600 dark:hover:text-neutral-300"
                >
                  ×
                </button>
              </div>
              {selectedPoint.chunk.headingPath && (
                <p className="text-xs text-emerald-500 mb-2 truncate">
                  {selectedPoint.chunk.headingPath}
                </p>
              )}
              <p className="text-xs text-gray-600 dark:text-neutral-400 whitespace-pre-wrap line-clamp-6">
                {selectedPoint.chunk.chunkText}
              </p>
            </div>
          )}

          {/* Gradient legend */}
          <div className="border-t border-gray-200 dark:border-neutral-700 px-3 py-2 bg-gray-50/50 dark:bg-neutral-900/50 flex-shrink-0">
            <div className="flex items-center gap-3">
              <span className="text-xs text-gray-500 dark:text-neutral-400">Position within document:</span>
              <div className="flex-1 flex items-center gap-2">
                <span className="text-xs text-gray-400 dark:text-neutral-500">Start</span>
                <div
                  className="flex-1 h-2 rounded-full"
                  style={{
                    background: isDarkMode
                      ? "linear-gradient(to right, rgb(220, 220, 220), rgb(80, 80, 80))"
                      : "linear-gradient(to right, rgb(180, 180, 180), rgb(26, 26, 26))",
                  }}
                />
                <span className="text-xs text-gray-400 dark:text-neutral-500">End</span>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

export default DocumentEmbeddingsViewer;
