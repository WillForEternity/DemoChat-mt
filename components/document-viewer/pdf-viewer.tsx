"use client";

/**
 * PDF Viewer Component
 *
 * Renders PDFs using react-pdf with screenshot-based selection support.
 * Drag to select a region, press Enter to capture and send to chat.
 * Optimized for fast first-page rendering and progressive page loading.
 * 
 * Session-level caching: PDF files loaded from IndexedDB are cached in memory
 * for the duration of the page session, so re-opening the same document is instant.
 */

import { useState, useEffect, useLayoutEffect, useRef, useCallback, useMemo } from "react";
import { Document, Page, pdfjs } from "react-pdf";
import "react-pdf/dist/esm/Page/TextLayer.css";
import "react-pdf/dist/esm/Page/AnnotationLayer.css";
import { ChevronLeft, ChevronRight, Minus, Plus, Loader2, ChevronsUp, ChevronsDown, Camera, X, SunMoon } from "lucide-react";
import html2canvas from "html2canvas";
import { getLargeDocumentFile } from "@/knowledge/large-documents";
import { cn } from "@/lib/utils";
import type { SelectionData } from "./index";

// Configure PDF.js worker - use a CDN with the exact version from react-pdf
// react-pdf 9.2.1 uses pdfjs-dist 4.8.69 internally
// Using cdnjs which is more reliable than unpkg for ESM workers
pdfjs.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjs.version}/pdf.worker.min.mjs`;

// =============================================================================
// SESSION-LEVEL PDF CACHE
// =============================================================================
// Cache PDF file data in memory for the page session. This avoids re-fetching
// from IndexedDB and re-parsing when the user closes and re-opens a document.
//
// IMPORTANT: We store as Uint8Array because ArrayBuffer can be "detached" when
// transferred to web workers (like PDF.js does). Uint8Array maintains a copy.

interface CachedPDF {
  /** Stored as Uint8Array to prevent ArrayBuffer detachment issues */
  data: Uint8Array;
  cachedAt: number;
}

// Module-level cache - persists for the page session (until page reload)
const pdfCache = new Map<string, CachedPDF>();

// Maximum cache size (in number of documents) to prevent memory issues
const MAX_CACHE_SIZE = 10;

/**
 * Get PDF from cache or load from IndexedDB.
 * Returns a fresh copy of the data each time to avoid detachment issues.
 */
async function getCachedPDF(documentId: string): Promise<Uint8Array | null> {
  // Check cache first
  const cached = pdfCache.get(documentId);
  if (cached) {
    // Return a copy to avoid detachment if PDF.js transfers the buffer
    return new Uint8Array(cached.data);
  }

  // Load from IndexedDB
  const file = await getLargeDocumentFile(documentId);
  if (!file) {
    return null;
  }

  // Convert to Uint8Array for safe storage
  const uint8Data = new Uint8Array(file.data);

  // Cache the result
  // If cache is full, remove the oldest entry
  if (pdfCache.size >= MAX_CACHE_SIZE) {
    let oldestKey: string | null = null;
    let oldestTime = Infinity;
    for (const [key, value] of pdfCache.entries()) {
      if (value.cachedAt < oldestTime) {
        oldestTime = value.cachedAt;
        oldestKey = key;
      }
    }
    if (oldestKey) {
      pdfCache.delete(oldestKey);
    }
  }

  pdfCache.set(documentId, {
    data: uint8Data,
    cachedAt: Date.now(),
  });

  // Return a copy for use
  return new Uint8Array(uint8Data);
}

interface PDFViewerProps {
  /** Document ID for loading from IndexedDB (used when directFileData is not provided) */
  documentId?: string;
  /** Direct file data for immediate rendering without IDB lookup */
  directFileData?: ArrayBuffer;
  /** Callback to send selection to a NEW chat tab */
  onSelection: (selection: SelectionData) => void;
  /** Callback to send selection to the ACTIVE (current) chat tab */
  onSelectionToActiveChat?: (selection: SelectionData) => void;
  /** Whether there is an active chat to send to */
  hasActiveChat?: boolean;
  /** Callback when selection state changes (for coordinating Escape key handling) */
  onSelectionStateChange?: (hasSelection: boolean) => void;
  /** Optional 1-based page to scroll to once the PDF finishes loading. */
  initialPage?: number;
}

// =============================================================================
// SLIDING WINDOW CONFIGURATION
// =============================================================================
// Only a small window of pages is ever rendered at once.
// This keeps memory usage bounded regardless of document size.
// The window slides as the user scrolls, with a debounce to avoid thrashing.

// Pages rendered around the visible page (total window ≈ 2 * BUFFER + 1)
const PAGE_BUFFER = 3;

// Debounce delay (ms) for visiblePage updates from IntersectionObserver.
// Prevents rapid state churn during fast scrolling.
const SCROLL_DEBOUNCE_MS = 150;

/**
 * Calculate the set of pages that should be rendered given a center page.
 * Returns a Set containing at most (2 * PAGE_BUFFER + 1) page numbers.
 */
function getWindowPages(centerPage: number, numPages: number): Set<number> {
  const pages = new Set<number>();
  const start = Math.max(1, centerPage - PAGE_BUFFER);
  const end = Math.min(numPages, centerPage + PAGE_BUFFER);
  for (let i = start; i <= end; i++) {
    pages.add(i);
  }
  return pages;
}

// Selection rectangle state
interface SelectionRect {
  startX: number;
  startY: number;
  endX: number;
  endY: number;
  page: number;
}

/**
 * Copy a `Uint8Array | ArrayBuffer` into a freshly allocated `Uint8Array`
 * whose `ArrayBuffer` is owned exclusively by this component. We need this
 * because callers (`directFileData`, `pdfCache`, `getCachedPDF`) often hand
 * us a view that shares its buffer with state owned elsewhere — if anything
 * in the app (including pdf.js's worker `postMessage`) transfers that
 * shared buffer, every view over it becomes detached and any subsequent
 * read throws `Underlying ArrayBuffer has been detached from the view`.
 */
function ownBytes(src: Uint8Array | ArrayBuffer): Uint8Array {
  const view = src instanceof Uint8Array ? src : new Uint8Array(src);
  const out = new Uint8Array(view.byteLength);
  out.set(view);
  return out;
}

function isDetached(arr: Uint8Array): boolean {
  // A detached typed array reports byteLength === 0 even when it was
  // previously non-empty. Touching the underlying buffer also throws.
  try {
    return arr.byteLength === 0 && arr.buffer.byteLength === 0;
  } catch {
    return true;
  }
}

export function PDFViewer({ documentId, directFileData, onSelection, onSelectionToActiveChat, hasActiveChat, onSelectionStateChange, initialPage }: PDFViewerProps) {
  // Store file data as a Uint8Array we own outright (private ArrayBuffer) so
  // detachments by external code paths don't surface here.
  const [fileData, setFileData] = useState<Uint8Array | null>(() =>
    directFileData ? ownBytes(directFileData) : null,
  );
  const [isLoading, setIsLoading] = useState(!directFileData);
  const [error, setError] = useState<string | null>(null);
  const [numPages, setNumPages] = useState(0);
  const [visiblePage, setVisiblePage] = useState(1);
  const visiblePageRef = useRef(1); // Ref mirror to avoid observer dependency on visiblePage
  const [scale, setScale] = useState(1.0);
  const [loadedPages, setLoadedPages] = useState<Set<number>>(new Set([1]));
  const containerRef = useRef<HTMLDivElement>(null);
  const pageRefs = useRef<Map<number, HTMLDivElement>>(new Map());
  const observerRef = useRef<IntersectionObserver | null>(null);
  
  // Track measured page dimensions (width x height at scale=1) for accurate placeholders
  const pageDimensionsRef = useRef<Map<number, { width: number; height: number }>>(new Map());
  
  // Selection state
  const [isSelecting, setIsSelecting] = useState(false);
  const [selectionRect, setSelectionRect] = useState<SelectionRect | null>(null);
  const [pendingSelection, setPendingSelection] = useState<SelectionRect | null>(null);
  const [isCapturing, setIsCapturing] = useState(false);

  // Color inversion state
  const [isInverted, setIsInverted] = useState(false);

  // Page input state for direct "go to page" navigation
  const [pageInputValue, setPageInputValue] = useState("");
  const [isPageInputFocused, setIsPageInputFocused] = useState(false);
  const pageInputRef = useRef<HTMLInputElement>(null);

  // Selection hint banner dismissed state
  const [hintDismissed, setHintDismissed] = useState(false);

  // Flag to suppress observer-driven page changes during zoom or container resize
  const isZoomingRef = useRef(false);
  const isResizingRef = useRef(false);
  const resizeDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Suppress observer during programmatic scrolls (scrollToPage smooth animation,
  // anchor restoration). Without this, the observer fires for transit pages and
  // commits a setVisiblePage after the debounce, which slides the window mid-animation
  // and dumps the user on a different page than they navigated to.
  const isProgrammaticScrollRef = useRef(false);
  const programmaticScrollTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Anchor used to keep the user's visual position stable when the sliding
  // window mounts/unmounts pages around the viewport. Captured before the
  // renderedPages state change commits; consumed by a layout effect afterwards
  // to compensate scrollTop for any height delta.
  const anchorRef = useRef<{ page: number; offset: number } | null>(null);

  // Notify parent about selection state changes
  useEffect(() => {
    const hasSelection = isSelecting || pendingSelection !== null;
    onSelectionStateChange?.(hasSelection);
  }, [isSelecting, pendingSelection, onSelectionStateChange]);

  // Track which document ID we've loaded to avoid redundant loads
  const loadedDocumentIdRef = useRef<string | null>(null);

  // If directFileData changes (e.g., new file dropped), update immediately
  useEffect(() => {
    if (directFileData) {
      loadedDocumentIdRef.current = null; // Clear ref since we're using direct data
      setFileData(ownBytes(directFileData));
      setIsLoading(false);
      setError(null);
      setLoadedPages(new Set([1]));
      setRenderedPages(getWindowPages(1, 1)); // Reset rendered pages for new document
      setHintDismissed(false); // Show hint for new document
    }
  }, [directFileData]);

  // Load PDF from cache or IndexedDB (only if no directFileData is provided)
  useEffect(() => {
    // Skip loading if we have direct file data or no document ID
    if (directFileData || !documentId) return;

    // Skip if we've already loaded this document (prevents redundant setFileData calls)
    if (loadedDocumentIdRef.current === documentId && fileData) return;

    let cancelled = false;
    
    // Check if we might have it cached (instant check)
    const cached = pdfCache.get(documentId);
    if (cached) {
      // Instant load from cache - own the bytes locally to avoid detachment
      loadedDocumentIdRef.current = documentId;
      setFileData(ownBytes(cached.data));
      setIsLoading(false);
      setError(null);
      return;
    }

    // Not cached, need to fetch from IndexedDB
    setIsLoading(true);
    setError(null);
    setLoadedPages(new Set([1])); // Reset to first page
    setRenderedPages(getWindowPages(1, 1)); // Reset rendered pages
    setHintDismissed(false); // Show hint for new document

    getCachedPDF(documentId)
      .then((data) => {
        if (cancelled) return;
        if (data) {
          loadedDocumentIdRef.current = documentId;
          setFileData(ownBytes(data));
        } else {
          setError("PDF file not found in storage. The document may still be uploading.");
        }
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Failed to load PDF");
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });

    return () => { cancelled = true; };
  }, [documentId, directFileData, fileData]);

  // Track which pages should be rendered — always a small sliding window.
  const [renderedPages, setRenderedPages] = useState<Set<number>>(() => getWindowPages(1, 1));
  
  // =============================================================================
  // SLIDING WINDOW — the only effect that manages renderedPages
  // =============================================================================
  // When visiblePage or numPages change, recompute the window.
  // The functional updater compares old vs new to avoid unnecessary re-renders.
  
  useEffect(() => {
    if (numPages === 0) return;

    const target = getWindowPages(visiblePage, numPages);

    // Capture the visible page's screen offset BEFORE we commit the new window.
    // The DOM still reflects the previous renderedPages at this point, so this
    // measures where the user is currently looking. The layout effect below
    // restores this offset after the new pages mount/unmount.
    const container = containerRef.current;
    const visibleEl = pageRefs.current.get(visiblePage);
    if (container && visibleEl) {
      const cRect = container.getBoundingClientRect();
      const pRect = visibleEl.getBoundingClientRect();
      anchorRef.current = { page: visiblePage, offset: pRect.top - cRect.top };
    }

    setRenderedPages(prev => {
      // Quick equality check: same size and all target pages already present
      if (target.size === prev.size) {
        let same = true;
        for (const p of target) {
          if (!prev.has(p)) { same = false; break; }
        }
        if (same) {
          anchorRef.current = null; // No DOM change → no anchor to restore
          return prev;
        }
      }
      return target;
    });
  }, [visiblePage, numPages]);

  // Restore the captured anchor immediately after the sliding window commits,
  // BEFORE the browser paints. This eliminates the scroll-jump that otherwise
  // throws the user hundreds of pages away when placeholder vs. actual page
  // heights differ.
  useLayoutEffect(() => {
    const anchor = anchorRef.current;
    if (!anchor) return;
    anchorRef.current = null;

    const container = containerRef.current;
    const el = pageRefs.current.get(anchor.page);
    if (!container || !el) return;

    const cRect = container.getBoundingClientRect();
    const pRect = el.getBoundingClientRect();
    const newOffset = pRect.top - cRect.top;
    const delta = newOffset - anchor.offset;

    if (Math.abs(delta) > 0.5) {
      // Suppress observer briefly so the corrective scroll doesn't trigger
      // another visiblePage update and feedback loop.
      isProgrammaticScrollRef.current = true;
      container.scrollTop += delta;
      if (programmaticScrollTimeoutRef.current) {
        clearTimeout(programmaticScrollTimeoutRef.current);
      }
      programmaticScrollTimeoutRef.current = setTimeout(() => {
        isProgrammaticScrollRef.current = false;
      }, 100);
    }
  }, [renderedPages]);
  
  // Convert to sorted array for rendering (used in JSX map)
  const pagesToRender = useMemo(() => {
    return Array.from(renderedPages).sort((a, b) => a - b);
  }, [renderedPages]);

  // Keep visiblePageRef in sync with visiblePage state
  useEffect(() => {
    visiblePageRef.current = visiblePage;
  }, [visiblePage]);

  // Debounce timer ref for scroll-based visiblePage updates
  const scrollDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Setup IntersectionObserver to detect which page is visible.
  // IMPORTANT: Do NOT include visiblePage in deps — the observer must persist.
  // We debounce state updates to prevent cascading re-renders during fast scroll.
  useEffect(() => {
    if (!containerRef.current || numPages === 0) return;

    observerRef.current = new IntersectionObserver(
      (entries) => {
        // Skip observer updates while a zoom or container resize is in progress.
        // During zoom, the handler restores the correct scroll position.
        // During resize (e.g. panel drag), intersection ratios are transient
        // and can trigger a feedback loop of page mount/unmount → scroll shift → observer fire.
        if (isZoomingRef.current || isResizingRef.current || isProgrammaticScrollRef.current) return;

        // Find the most visible page
        let maxRatio = 0;
        let mostVisiblePage = visiblePageRef.current;

        entries.forEach((entry) => {
          if (entry.isIntersecting && entry.intersectionRatio > maxRatio) {
            const pageNum = parseInt(entry.target.getAttribute("data-page") || "1");
            maxRatio = entry.intersectionRatio;
            mostVisiblePage = pageNum;
          }
        });

        if (mostVisiblePage !== visiblePageRef.current) {
          // Update the ref immediately (cheap, no re-render)
          visiblePageRef.current = mostVisiblePage;
          
          // Debounce the state update to avoid re-render storms during fast scroll
          if (scrollDebounceRef.current) clearTimeout(scrollDebounceRef.current);
          scrollDebounceRef.current = setTimeout(() => {
            setVisiblePage(visiblePageRef.current);
          }, SCROLL_DEBOUNCE_MS);
        }
      },
      {
        root: containerRef.current,
        threshold: [0.25, 0.75],
      }
    );

    // Re-observe all existing page elements (they may already be in the DOM)
    for (const [, element] of pageRefs.current.entries()) {
      observerRef.current.observe(element);
    }

    return () => {
      observerRef.current?.disconnect();
      if (scrollDebounceRef.current) clearTimeout(scrollDebounceRef.current);
      if (programmaticScrollTimeoutRef.current) clearTimeout(programmaticScrollTimeoutRef.current);
    };
  }, [numPages]); // Only recreate when numPages changes (new document loaded)

  // Suppress IntersectionObserver during container resizes (e.g. panel drag).
  // When the container width/height changes, the observer fires with stale
  // intersection ratios which can detect a different "most visible page",
  // triggering a sliding-window shift that mounts/unmounts pages, changing
  // scroll height, causing more scroll events — an infinite feedback loop.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const ro = new ResizeObserver(() => {
      // Mark as resizing — the IntersectionObserver callback will skip updates
      isResizingRef.current = true;

      // Clear any previous debounce
      if (resizeDebounceRef.current) clearTimeout(resizeDebounceRef.current);

      // After resize settles, re-enable observer updates
      resizeDebounceRef.current = setTimeout(() => {
        isResizingRef.current = false;
      }, 300);
    });

    ro.observe(container);

    return () => {
      ro.disconnect();
      if (resizeDebounceRef.current) clearTimeout(resizeDebounceRef.current);
    };
  }, []);

  // Register page elements with the observer
  const registerPageRef = useCallback((pageNum: number, element: HTMLDivElement | null) => {
    if (element) {
      pageRefs.current.set(pageNum, element);
      observerRef.current?.observe(element);
    } else {
      const existing = pageRefs.current.get(pageNum);
      if (existing) {
        observerRef.current?.unobserve(existing);
        pageRefs.current.delete(pageNum);
      }
    }
  }, []);

  // Find which page element contains a point
  const findPageAtPoint = useCallback((clientX: number, clientY: number): number | null => {
    for (const [pageNum, element] of pageRefs.current.entries()) {
      const rect = element.getBoundingClientRect();
      if (clientX >= rect.left && clientX <= rect.right && clientY >= rect.top && clientY <= rect.bottom) {
        return pageNum;
      }
    }
    return null;
  }, []);

  // Handle mouse down - start selection
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    // Only left click, not on controls
    if (e.button !== 0) return;
    
    const target = e.target as HTMLElement;
    // Don't start selection on navigation controls
    if (target.closest('button') || target.closest('.navigation-bar')) return;

    const page = findPageAtPoint(e.clientX, e.clientY);
    if (page === null) return;

    const pageElement = pageRefs.current.get(page);
    if (!pageElement) return;

    const pageRect = pageElement.getBoundingClientRect();
    const x = e.clientX - pageRect.left;
    const y = e.clientY - pageRect.top;

    setIsSelecting(true);
    setPendingSelection(null);
    setSelectionRect({
      startX: x,
      startY: y,
      endX: x,
      endY: y,
      page,
    });

    // Prevent text selection
    e.preventDefault();
  }, [findPageAtPoint]);

  // Handle mouse move - update selection rectangle
  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (!isSelecting || !selectionRect) return;

    const pageElement = pageRefs.current.get(selectionRect.page);
    if (!pageElement) return;

    const pageRect = pageElement.getBoundingClientRect();
    const x = Math.max(0, Math.min(e.clientX - pageRect.left, pageRect.width));
    const y = Math.max(0, Math.min(e.clientY - pageRect.top, pageRect.height));

    setSelectionRect((prev) => prev ? { ...prev, endX: x, endY: y } : null);
  }, [isSelecting, selectionRect]);

  // Handle mouse up - finalize selection
  const handleMouseUp = useCallback(() => {
    if (!isSelecting || !selectionRect) return;

    const width = Math.abs(selectionRect.endX - selectionRect.startX);
    const height = Math.abs(selectionRect.endY - selectionRect.startY);

    // Only keep selection if it's large enough (at least 20x20 pixels)
    if (width >= 20 && height >= 20) {
      setPendingSelection(selectionRect);
    } else {
      setSelectionRect(null);
    }

    setIsSelecting(false);
  }, [isSelecting, selectionRect]);

  // Cancel selection
  const cancelSelection = useCallback(() => {
    setSelectionRect(null);
    setPendingSelection(null);
    setIsSelecting(false);
  }, []);

  // Capture screenshot of selection
  // target: "new" sends to a new chat tab, "active" sends to the current active chat
  const captureSelection = useCallback(async (target: "new" | "active" = "new") => {
    if (!pendingSelection) return;

    const pageElement = pageRefs.current.get(pendingSelection.page);
    if (!pageElement) return;

    setIsCapturing(true);

    try {
      // Calculate the actual rectangle coordinates
      const left = Math.min(pendingSelection.startX, pendingSelection.endX);
      const top = Math.min(pendingSelection.startY, pendingSelection.endY);
      const width = Math.abs(pendingSelection.endX - pendingSelection.startX);
      const height = Math.abs(pendingSelection.endY - pendingSelection.startY);

      // Try to find the canvas element rendered by react-pdf for this page
      // This avoids html2canvas which has issues with oklch() CSS colors
      const pdfCanvas = pageElement.querySelector("canvas");
      
      let screenshot: string;
      
      if (pdfCanvas) {
        // Use the native PDF canvas directly - much faster and no CSS parsing issues
        const tempCanvas = document.createElement("canvas");
        const ctx = tempCanvas.getContext("2d");
        if (!ctx) throw new Error("Could not get canvas context");
        
        // Calculate scale based on the canvas vs element size ratio
        const scaleX = pdfCanvas.width / pdfCanvas.offsetWidth;
        const scaleY = pdfCanvas.height / pdfCanvas.offsetHeight;
        
        // Calculate base dimensions at PDF resolution
        const baseWidth = width * scaleX;
        const baseHeight = height * scaleY;
        
        // Limit maximum dimensions to prevent huge images that could hang the API
        // Max 1500px on longest side for API compatibility while maintaining readability
        const MAX_DIMENSION = 1500;
        let finalScale = 1;
        
        if (baseWidth > MAX_DIMENSION || baseHeight > MAX_DIMENSION) {
          // Scale down to fit within max dimension
          finalScale = MAX_DIMENSION / Math.max(baseWidth, baseHeight);
        } else if (baseWidth < 800 && baseHeight < 800) {
          // Small selection - scale up to 1.5x for better readability (but not 2x)
          finalScale = 1.5;
        }
        
        // Set up the temp canvas with the selection dimensions
        tempCanvas.width = Math.round(baseWidth * finalScale);
        tempCanvas.height = Math.round(baseHeight * finalScale);
        
        // Draw the selected portion of the PDF canvas
        ctx.drawImage(
          pdfCanvas,
          left * scaleX,
          top * scaleY,
          baseWidth,
          baseHeight,
          0,
          0,
          tempCanvas.width,
          tempCanvas.height
        );
        
        // Use JPEG for larger images (better compression), PNG for smaller ones (better quality)
        const useJpeg = tempCanvas.width * tempCanvas.height > 500000; // > ~700x700
        screenshot = useJpeg 
          ? tempCanvas.toDataURL("image/jpeg", 0.85)
          : tempCanvas.toDataURL("image/png");
        
        // Log size for debugging
        const sizeKB = Math.round(screenshot.length / 1024);
        console.log(`[PDFViewer] Screenshot: ${tempCanvas.width}x${tempCanvas.height}, ${sizeKB}KB, format=${useJpeg ? 'jpeg' : 'png'}`);
      } else {
        // Fallback to html2canvas if no canvas found (shouldn't happen for PDFs)
        const canvas = await html2canvas(pageElement, {
          x: left,
          y: top,
          width,
          height,
          scale: 1.5, // Reduced from 2x
          useCORS: true,
          logging: false,
          backgroundColor: "#ffffff",
        });
        screenshot = canvas.toDataURL("image/jpeg", 0.85);
      }

      const selectionData: SelectionData = {
        screenshot,
        page: pendingSelection.page,
      };

      // Send to appropriate target
      if (target === "active" && onSelectionToActiveChat) {
        onSelectionToActiveChat(selectionData);
      } else {
        onSelection(selectionData);
      }

      // Clear selection
      cancelSelection();
    } catch (err) {
      console.error("[PDFViewer] Screenshot capture failed:", err);
    } finally {
      setIsCapturing(false);
    }
  }, [pendingSelection, onSelection, onSelectionToActiveChat, cancelSelection]);

  // Handle Enter/Shift+Enter to confirm selection
  // Enter = send to active chat (or new chat if none active)
  // Shift+Enter = always send to a new chat
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Enter" && pendingSelection && !isCapturing) {
        e.preventDefault();
        if (e.shiftKey) {
          // Shift+Enter: always create a new chat
          captureSelection("new");
        } else {
          // Enter: send to active chat if one exists, otherwise new chat
          captureSelection(hasActiveChat && onSelectionToActiveChat ? "active" : "new");
        }
      } else if (e.key === "Escape" && (pendingSelection || isSelecting)) {
        e.preventDefault();
        e.stopPropagation(); // Don't close the viewer
        cancelSelection();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [pendingSelection, isSelecting, isCapturing, captureSelection, cancelSelection, hasActiveChat, onSelectionToActiveChat]);

  // Handle document load success
  const handleLoadSuccess = useCallback(({ numPages: pages }: { numPages: number }) => {
    setNumPages(pages);
    // Mark first page as loaded
    setLoadedPages(new Set([1]));
  }, []);

  // Handle page load success - track which pages are loaded and measure dimensions
  const handlePageLoadSuccess = useCallback((pageNum: number, page: any) => {
    setLoadedPages((prev) => new Set([...prev, pageNum]));
    // Store the original page dimensions (at scale 1.0) for accurate placeholders
    if (page && page.originalWidth && page.originalHeight) {
      pageDimensionsRef.current.set(pageNum, {
        width: page.originalWidth,
        height: page.originalHeight,
      });
    }
  }, []);

  // Handle document load error
  const handleLoadError = useCallback((err: Error) => {
    console.error("[PDFViewer] Load error:", err);
    setError("Failed to load PDF");
  }, []);

  // Scroll to specific page — recenters the sliding window and scrolls.
  // We use INSTANT scroll (not smooth) and aggressively suppress the observer.
  // Smooth scroll across hundreds of pages caused two bugs:
  //   1. The IntersectionObserver fired for transit pages mid-animation,
  //      committing a setVisiblePage that slid the window and changed page
  //      heights underneath the animation, dumping the user on a wrong page.
  //   2. The previous retry loop could fire a *second* scrollIntoView while
  //      the first was still animating, producing a "runaway scroll" feel.
  const scrollToPage = useCallback((pageNum: number) => {
    const targetPage = Math.max(1, Math.min(numPages || pageNum, pageNum));

    // Suppress observer-driven updates while we navigate. We hold this for
    // long enough to cover scroll commit + a few observer fires after.
    isProgrammaticScrollRef.current = true;
    if (programmaticScrollTimeoutRef.current) {
      clearTimeout(programmaticScrollTimeoutRef.current);
    }

    // Cancel any pending debounce so it doesn't overwrite our explicit navigation
    if (scrollDebounceRef.current) {
      clearTimeout(scrollDebounceRef.current);
      scrollDebounceRef.current = null;
    }

    // Recenter the window on the target page (this also evicts distant pages).
    // Skip the anchor capture/restore for this transition — we're navigating
    // explicitly, so we don't want to anchor to the *previous* visible page.
    anchorRef.current = null;
    setRenderedPages(getWindowPages(targetPage, numPages || targetPage));

    visiblePageRef.current = targetPage;
    setVisiblePage(targetPage);

    // Try to scroll to the element; the page may not be in the DOM yet on the
    // first frame (window state was just queued). Use rAF only — no timeout
    // chain — and bail as soon as we find it.
    let attempts = 0;
    const tryScroll = () => {
      attempts++;
      const pageElement = pageRefs.current.get(targetPage);
      if (pageElement) {
        // Instant scroll: predictable, non-animated, won't fight the observer.
        pageElement.scrollIntoView({ behavior: "auto", block: "start" });
        // Re-enable observer once the scroll has settled.
        programmaticScrollTimeoutRef.current = setTimeout(() => {
          isProgrammaticScrollRef.current = false;
        }, 200);
      } else if (attempts < 20) {
        requestAnimationFrame(tryScroll);
      } else {
        // Give up gracefully — re-enable observer so the UI isn't stuck.
        isProgrammaticScrollRef.current = false;
      }
    };
    requestAnimationFrame(tryScroll);
  }, [numPages]);

  // Intercept internal PDF link clicks (annotation layer)
  // react-pdf renders annotation links that may point to other pages via hash fragments
  // like "#page=5" or data attributes. We intercept these to use our scrollToPage which
  // ensures the target page is rendered before scrolling.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const handleLinkClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      const anchor = target.closest("a");
      if (!anchor) return;

      const href = anchor.getAttribute("href") || "";
      
      // Match internal page links: #page=N, #N, or [data-page-number] patterns
      // react-pdf annotation layer uses various formats
      const pageMatch = href.match(/^#(?:page=|nameddest=)?(\d+)$/i);
      if (pageMatch) {
        e.preventDefault();
        e.stopPropagation();
        const targetPage = parseInt(pageMatch[1], 10);
        if (targetPage >= 1 && targetPage <= (numPages || Infinity)) {
          scrollToPage(targetPage);
        }
        return;
      }
      
      // Also intercept react-pdf internal link annotations that use data attributes
      const pageNumAttr = anchor.getAttribute("data-page-number");
      if (pageNumAttr) {
        e.preventDefault();
        e.stopPropagation();
        const targetPage = parseInt(pageNumAttr, 10);
        if (targetPage >= 1 && targetPage <= (numPages || Infinity)) {
          scrollToPage(targetPage);
        }
        return;
      }

      // For react-pdf's internal destination links, check for the dest attribute
      const dest = anchor.getAttribute("data-dest");
      if (dest && href.startsWith("#")) {
        // Prevent default navigation which would fail
        e.preventDefault();
        e.stopPropagation();
        // The destination might resolve to a page - let react-pdf handle the resolution
        // but we at least prevent the error by not letting the browser try to navigate
        return;
      }
    };

    container.addEventListener("click", handleLinkClick, true); // Use capture phase
    return () => container.removeEventListener("click", handleLinkClick, true);
  }, [numPages, scrollToPage]);

  // Jump to first/last page
  const scrollToFirst = useCallback(() => scrollToPage(1), [scrollToPage]);
  const scrollToLast = useCallback(() => scrollToPage(numPages), [scrollToPage, numPages]);

  // External `initialPage` prop — scroll once the PDF is loaded.
  // Re-fires only when the prop changes (clicking a different result).
  const lastInitialPageRef = useRef<number | null>(null);
  useEffect(() => {
    if (!initialPage || !numPages) return;
    if (lastInitialPageRef.current === initialPage) return;
    lastInitialPageRef.current = initialPage;
    scrollToPage(initialPage);
  }, [initialPage, numPages, scrollToPage]);

  // Zoom handler that preserves the current page position.
  // When scale changes, page elements resize and the scroll offset shifts,
  // which can cause the viewport to land on a different page. We counteract
  // this by recording the visible page before zooming and scrolling back to
  // it after React re-renders at the new scale.
  const handleZoom = useCallback((direction: "in" | "out") => {
    const container = containerRef.current;
    if (!container) {
      setScale((s) => direction === "in" ? Math.min(2.5, s + 0.1) : Math.max(0.5, s - 0.1));
      return;
    }

    // Remember the page we're on and how far through it we've scrolled
    const currentPage = visiblePageRef.current;
    const pageElement = pageRefs.current.get(currentPage);

    // Compute the fractional scroll position within the current page.
    // This lets us restore the exact same relative position after zoom.
    let scrollFraction = 0;
    if (pageElement) {
      const pageRect = pageElement.getBoundingClientRect();
      const containerRect = container.getBoundingClientRect();
      // How far the top of the page is above the top of the container viewport
      const pageOffset = containerRect.top - pageRect.top;
      scrollFraction = pageRect.height > 0 ? pageOffset / pageRect.height : 0;
    }

    // Suppress observer updates during the zoom transition
    isZoomingRef.current = true;

    setScale((s) => direction === "in" ? Math.min(2.5, s + 0.1) : Math.max(0.5, s - 0.1));

    // After React re-renders with the new scale, restore scroll position
    requestAnimationFrame(() => {
      const el = pageRefs.current.get(currentPage);
      if (el && container) {
        const newPageRect = el.getBoundingClientRect();
        const containerRect = container.getBoundingClientRect();
        // Calculate where the page top currently is relative to the container's scroll
        const currentPageTopInContainer = containerRect.top - newPageRect.top;
        const desiredOffset = scrollFraction * newPageRect.height;
        const scrollAdjustment = desiredOffset - currentPageTopInContainer;
        container.scrollTop += scrollAdjustment;
      }

      // Re-enable observer after a short delay to let scroll settle
      setTimeout(() => {
        isZoomingRef.current = false;
      }, 200);
    });
  }, []);

  // Memoize the file prop to prevent unnecessary reloads.
  // CRITICAL: pdf.js's worker `transfers` the underlying ArrayBuffer when the
  // main thread postMessages it across — after the first load the source
  // buffer is detached. If react-pdf ever attempts to re-load (StrictMode
  // double-invoke, prop reference change, HMR) it would re-postMessage the
  // detached buffer and throw `DataCloneError: The object can not be cloned.`
  //
  // We hand pdf.js a *private copy* of the bytes so:
  //   - The source `fileData` (and any shared parent buffer like
  //     `directFileData`) stays intact across the worker transfer.
  //   - Each new `fileData` produces a fresh copy that is safe to detach.
  //   - When `fileData` is unchanged, the memo result is stable so react-pdf
  //     won't re-load and won't re-transfer.
  const fileSource = useMemo(() => {
    if (!fileData) return null;
    if (isDetached(fileData)) {
      // Defensive: the source was detached out from under us. Don't crash
      // the render — just signal "no file" until a fresh load lands.
      console.warn(
        "[PDFViewer] fileData buffer was detached; skipping render until reload",
      );
      return null;
    }
    try {
      const copy = new Uint8Array(fileData.byteLength);
      copy.set(fileData);
      return { data: copy };
    } catch (err) {
      console.warn("[PDFViewer] Failed to copy fileData:", err);
      return null;
    }
  }, [fileData]);

  // Calculate selection rectangle display coordinates
  const getSelectionStyle = useCallback((rect: SelectionRect) => {
    const left = Math.min(rect.startX, rect.endX);
    const top = Math.min(rect.startY, rect.endY);
    const width = Math.abs(rect.endX - rect.startX);
    const height = Math.abs(rect.endY - rect.startY);
    return { left, top, width, height };
  }, []);

  if (isLoading) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="text-center">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground mx-auto mb-2" />
          <p className="text-sm text-muted-foreground">Loading PDF...</p>
        </div>
      </div>
    );
  }

  if (error || !fileSource) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="text-center max-w-md px-4">
          <p className="text-muted-foreground">{error || "PDF not available"}</p>
          <p className="text-xs text-muted-foreground/70 mt-2">
            If the document is still being processed, please wait a moment and try again.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col">
      {/* Selection Hint Banner */}
      {!pendingSelection && !hintDismissed && (
        <div className="flex-shrink-0 flex items-center justify-between px-4 py-1.5 bg-gray-50/50 dark:bg-neutral-900/50 border-b border-gray-200 dark:border-neutral-700 text-xs text-gray-500 dark:text-neutral-500">
          <div className="flex-1" /> {/* Spacer for centering */}
          <div className="flex items-center gap-2">
            <Camera className="h-3.5 w-3.5" />
            <span>Drag to select an area, then press Enter to capture and chat</span>
          </div>
          <div className="flex-1 flex justify-end">
            <button
              onClick={() => setHintDismissed(true)}
              className="p-0.5 rounded hover:bg-gray-200 dark:hover:bg-neutral-700 transition-colors"
              title="Dismiss"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      )}

      {/* Pending Selection Confirmation Banner */}
      {pendingSelection && (
        <div className="flex-shrink-0 flex items-center justify-center gap-3 px-4 py-2 bg-fuchsia-50 dark:bg-[#ff00ff]/10 border-b border-fuchsia-200 dark:border-[#ff00ff]/30 flex-wrap">
          <span className="text-sm text-fuchsia-600 dark:text-[#ff00ff] font-medium">
            Selection ready on page {pendingSelection.page}
          </span>
          <div className="flex items-center gap-2">
            {/* Send to current chat (Enter) */}
            <button
              onClick={() => captureSelection(hasActiveChat && onSelectionToActiveChat ? "active" : "new")}
              disabled={isCapturing}
              className={cn(
                "flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-sm font-medium transition-all duration-200 disabled:opacity-50",
                "bg-fuchsia-500 dark:bg-[#ff00ff] text-white",
                "shadow-[3px_3px_6px_rgba(0,0,0,0.15),-3px_-3px_6px_rgba(255,255,255,0.3)]",
                "hover:shadow-[4px_4px_8px_rgba(0,0,0,0.2),-4px_-4px_8px_rgba(255,255,255,0.4)]",
                "active:shadow-[inset_3px_3px_6px_rgba(0,0,0,0.2),inset_-3px_-3px_6px_rgba(255,255,255,0.1)]"
              )}
            >
              {isCapturing ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  <span>Capturing...</span>
                </>
              ) : (
                <>
                  <Camera className="h-3.5 w-3.5" />
                  <span>{hasActiveChat ? "Send to Chat" : "New Chat"} <kbd className="ml-1 px-1 py-0.5 rounded bg-white/20 text-[10px]">Enter</kbd></span>
                </>
              )}
            </button>
            {/* Send to new chat (Shift+Enter) - only show when there's already an active chat */}
            {hasActiveChat && (
              <button
                onClick={() => captureSelection("new")}
                disabled={isCapturing}
                className={cn(
                  "flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-sm font-medium transition-all duration-200 disabled:opacity-50",
                  "bg-white dark:bg-neutral-900 text-fuchsia-600 dark:text-[#ff00ff]",
                  "border border-fuchsia-300 dark:border-[#ff00ff]/40",
                  "hover:bg-fuchsia-50 dark:hover:bg-[#ff00ff]/10",
                  "active:bg-fuchsia-100 dark:active:bg-[#ff00ff]/20"
                )}
              >
                <span>New Chat <kbd className="ml-1 px-1 py-0.5 rounded bg-fuchsia-100 dark:bg-[#ff00ff]/20 text-[10px]">Shift+Enter</kbd></span>
              </button>
            )}
          </div>
          <button
            onClick={cancelSelection}
            className={cn(
              "flex items-center gap-1 px-2 py-1.5 rounded-xl text-sm transition-all duration-200",
              "text-gray-500 dark:text-neutral-500 hover:text-gray-700 dark:hover:text-neutral-300",
              "hover:bg-gray-100 dark:hover:bg-neutral-800"
            )}
          >
            <X className="h-3.5 w-3.5" />
            <span>Cancel (Esc)</span>
          </button>
        </div>
      )}

      {/* PDF Content - Scrollable, renders visible pages + buffer */}
      <div
        ref={containerRef}
        className="flex-1 overflow-auto bg-gray-100 dark:bg-black flex flex-col items-center py-4 gap-4 select-none"
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        style={{ cursor: isSelecting ? "crosshair" : "default" }}
      >
        <Document
          file={fileSource}
          onLoadSuccess={handleLoadSuccess}
          onLoadError={handleLoadError}
          onItemClick={({ pageNumber }) => {
            if (pageNumber && pageNumber >= 1) {
              scrollToPage(pageNumber);
            }
          }}
          className="flex flex-col items-center gap-4"
          loading={
            <div className="flex items-center justify-center py-20">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          }
        >
          {/* Render pages progressively - visible pages + buffer */}
          {Array.from({ length: numPages }, (_, i) => i + 1).map((pageNum) => {
            const shouldRender = pagesToRender.includes(pageNum);
            const activeSelection = (selectionRect?.page === pageNum) ? selectionRect : 
                                    (pendingSelection?.page === pageNum) ? pendingSelection : null;
            
            // Calculate placeholder dimensions using measured page size, or a sensible default.
            // This ensures scroll positions stay accurate even for unrendered pages.
            const measured = pageDimensionsRef.current.get(pageNum);
            // Fall back to page 1's dimensions (most common case), then to a default
            const fallbackMeasured = pageDimensionsRef.current.get(1);
            const placeholderHeight = measured
              ? measured.height * scale
              : fallbackMeasured
                ? fallbackMeasured.height * scale
                : 800;
            const placeholderWidth = measured
              ? measured.width * scale
              : fallbackMeasured
                ? fallbackMeasured.width * scale
                : undefined;
            
            return (
              <div
                key={pageNum}
                ref={(el) => registerPageRef(pageNum, el)}
                data-page={pageNum}
                className="relative"
                style={{ 
                  minHeight: shouldRender ? undefined : placeholderHeight,
                  width: shouldRender ? undefined : placeholderWidth,
                  filter: isInverted ? "invert(1) hue-rotate(180deg)" : undefined,
                }}
              >
                {shouldRender ? (
                  <Page
                    pageNumber={pageNum}
                    scale={scale}
                    renderTextLayer={false}
                    renderAnnotationLayer={true}
                    className="bg-white"
                    onLoadSuccess={(page: any) => handlePageLoadSuccess(pageNum, page)}
                    loading={
                      <div 
                        className="flex items-center justify-center bg-white"
                        style={{ minHeight: placeholderHeight, width: placeholderWidth }}
                      >
                        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                      </div>
                    }
                    canvasBackground={isInverted ? undefined : "white"}
                  />
                ) : (
                  // Placeholder for unrendered pages - uses measured dimensions for accuracy
                  <div 
                    className="flex items-center justify-center bg-muted/50 rounded"
                    style={{ minHeight: placeholderHeight, width: placeholderWidth }}
                  >
                    <span className="text-sm text-muted-foreground">Page {pageNum}</span>
                  </div>
                )}

                {/* Selection Rectangle Overlay */}
                {activeSelection && (
                  <div
                    className="absolute border-2 border-highlight bg-highlight/20 pointer-events-none"
                    style={getSelectionStyle(activeSelection)}
                  />
                )}

                {/* Page number indicator */}
                <div className="absolute bottom-2 right-2 px-2 py-1 bg-black/50 text-white text-xs rounded">
                  {pageNum}
                </div>
              </div>
            );
          })}
        </Document>
      </div>

      {/* Navigation Bar - Sticky Bottom */}
      <div className="navigation-bar sticky bottom-0 flex items-center justify-center gap-4 p-3 bg-white/95 dark:bg-neutral-950/95 backdrop-blur border-t border-gray-200 dark:border-neutral-700 neu-context-white">
        {/* Jump to start */}
        <button
          onClick={scrollToFirst}
          disabled={visiblePage <= 1}
          className={cn(
            "p-2 rounded-xl transition-all duration-200 disabled:opacity-30",
            "bg-white dark:bg-neutral-950",
            "shadow-[3px_3px_6px_rgba(0,0,0,0.08),-3px_-3px_6px_rgba(255,255,255,0.8)]",
            "dark:shadow-[3px_3px_6px_rgba(0,0,0,0.4),-3px_-3px_6px_rgba(255,255,255,0.03)]",
            "hover:shadow-[4px_4px_8px_rgba(0,0,0,0.1),-4px_-4px_8px_rgba(255,255,255,0.9)]",
            "dark:hover:shadow-[4px_4px_8px_rgba(0,0,0,0.5),-4px_-4px_8px_rgba(255,255,255,0.04)]",
            "active:shadow-[inset_3px_3px_6px_rgba(0,0,0,0.1),inset_-3px_-3px_6px_rgba(255,255,255,0.9)]",
            "dark:active:shadow-[inset_3px_3px_6px_rgba(0,0,0,0.5),inset_-3px_-3px_6px_rgba(255,255,255,0.04)]"
          )}
          title="Go to first page"
        >
          <ChevronsUp className="h-4 w-4 text-gray-600 dark:text-neutral-400" />
        </button>

        {/* Page Navigation */}
        <div className="flex items-center gap-2">
          <button
            onClick={() => scrollToPage(Math.max(1, visiblePage - 1))}
            disabled={visiblePage <= 1}
            className={cn(
              "p-2 rounded-xl transition-all duration-200 disabled:opacity-30",
              "bg-white dark:bg-neutral-950",
              "shadow-[3px_3px_6px_rgba(0,0,0,0.08),-3px_-3px_6px_rgba(255,255,255,0.8)]",
              "dark:shadow-[3px_3px_6px_rgba(0,0,0,0.4),-3px_-3px_6px_rgba(255,255,255,0.03)]",
              "hover:shadow-[4px_4px_8px_rgba(0,0,0,0.1),-4px_-4px_8px_rgba(255,255,255,0.9)]",
              "dark:hover:shadow-[4px_4px_8px_rgba(0,0,0,0.5),-4px_-4px_8px_rgba(255,255,255,0.04)]",
              "active:shadow-[inset_3px_3px_6px_rgba(0,0,0,0.1),inset_-3px_-3px_6px_rgba(255,255,255,0.9)]",
              "dark:active:shadow-[inset_3px_3px_6px_rgba(0,0,0,0.5),inset_-3px_-3px_6px_rgba(255,255,255,0.04)]"
            )}
            title="Previous page"
          >
            <ChevronLeft className="h-4 w-4 text-gray-600 dark:text-neutral-400" />
          </button>
          <div className="flex items-center gap-1 text-sm text-gray-700 dark:text-neutral-300">
            <span>Page</span>
            <input
              ref={pageInputRef}
              type="text"
              inputMode="numeric"
              pattern="[0-9]*"
              value={isPageInputFocused ? pageInputValue : String(visiblePage)}
              onChange={(e) => {
                // Only allow digits
                const val = e.target.value.replace(/\D/g, "");
                setPageInputValue(val);
              }}
              onFocus={() => {
                setIsPageInputFocused(true);
                setPageInputValue(String(visiblePage));
                // Select all text on focus for easy overwrite
                requestAnimationFrame(() => pageInputRef.current?.select());
              }}
              onBlur={() => {
                setIsPageInputFocused(false);
                setPageInputValue("");
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  const page = parseInt(pageInputValue, 10);
                  if (!isNaN(page) && page >= 1 && page <= numPages) {
                    scrollToPage(page);
                  }
                  pageInputRef.current?.blur();
                } else if (e.key === "Escape") {
                  e.preventDefault();
                  e.stopPropagation();
                  setPageInputValue("");
                  pageInputRef.current?.blur();
                }
              }}
              style={{ width: `${Math.max(3, String(numPages || 1).length + 1)}ch` }}
              className={cn(
                "text-center text-sm font-medium rounded-md px-1 py-0.5 transition-all duration-200",
                "bg-transparent hover:bg-gray-100 dark:hover:bg-neutral-800",
                "focus:bg-white dark:focus:bg-neutral-900 focus:outline-none focus:ring-2 focus:ring-fuchsia-500/50 dark:focus:ring-[#ff00ff]/50",
                "border border-transparent focus:border-gray-300 dark:focus:border-neutral-600",
                "text-gray-700 dark:text-neutral-300"
              )}
              title="Type a page number and press Enter to navigate"
            />
            <span>of {numPages || "..."}</span>
          </div>
          <button
            onClick={() => scrollToPage(Math.min(numPages, visiblePage + 1))}
            disabled={visiblePage >= numPages}
            className={cn(
              "p-2 rounded-xl transition-all duration-200 disabled:opacity-30",
              "bg-white dark:bg-neutral-950",
              "shadow-[3px_3px_6px_rgba(0,0,0,0.08),-3px_-3px_6px_rgba(255,255,255,0.8)]",
              "dark:shadow-[3px_3px_6px_rgba(0,0,0,0.4),-3px_-3px_6px_rgba(255,255,255,0.03)]",
              "hover:shadow-[4px_4px_8px_rgba(0,0,0,0.1),-4px_-4px_8px_rgba(255,255,255,0.9)]",
              "dark:hover:shadow-[4px_4px_8px_rgba(0,0,0,0.5),-4px_-4px_8px_rgba(255,255,255,0.04)]",
              "active:shadow-[inset_3px_3px_6px_rgba(0,0,0,0.1),inset_-3px_-3px_6px_rgba(255,255,255,0.9)]",
              "dark:active:shadow-[inset_3px_3px_6px_rgba(0,0,0,0.5),inset_-3px_-3px_6px_rgba(255,255,255,0.04)]"
            )}
            title="Next page"
          >
            <ChevronRight className="h-4 w-4 text-gray-600 dark:text-neutral-400" />
          </button>
        </div>

        {/* Jump to end */}
        <button
          onClick={scrollToLast}
          disabled={visiblePage >= numPages}
          className={cn(
            "p-2 rounded-xl transition-all duration-200 disabled:opacity-30",
            "bg-white dark:bg-neutral-950",
            "shadow-[3px_3px_6px_rgba(0,0,0,0.08),-3px_-3px_6px_rgba(255,255,255,0.8)]",
            "dark:shadow-[3px_3px_6px_rgba(0,0,0,0.4),-3px_-3px_6px_rgba(255,255,255,0.03)]",
            "hover:shadow-[4px_4px_8px_rgba(0,0,0,0.1),-4px_-4px_8px_rgba(255,255,255,0.9)]",
            "dark:hover:shadow-[4px_4px_8px_rgba(0,0,0,0.5),-4px_-4px_8px_rgba(255,255,255,0.04)]",
            "active:shadow-[inset_3px_3px_6px_rgba(0,0,0,0.1),inset_-3px_-3px_6px_rgba(255,255,255,0.9)]",
            "dark:active:shadow-[inset_3px_3px_6px_rgba(0,0,0,0.5),inset_-3px_-3px_6px_rgba(255,255,255,0.04)]"
          )}
          title="Go to last page"
        >
          <ChevronsDown className="h-4 w-4 text-gray-600 dark:text-neutral-400" />
        </button>

        {/* Zoom Controls */}
        <div className="flex items-center gap-2 border-l border-gray-200 dark:border-neutral-700 pl-4">
          <button
            onClick={() => handleZoom("out")}
            className={cn(
              "p-2 rounded-xl transition-all duration-200",
              "bg-white dark:bg-neutral-950",
              "shadow-[3px_3px_6px_rgba(0,0,0,0.08),-3px_-3px_6px_rgba(255,255,255,0.8)]",
              "dark:shadow-[3px_3px_6px_rgba(0,0,0,0.4),-3px_-3px_6px_rgba(255,255,255,0.03)]",
              "hover:shadow-[4px_4px_8px_rgba(0,0,0,0.1),-4px_-4px_8px_rgba(255,255,255,0.9)]",
              "dark:hover:shadow-[4px_4px_8px_rgba(0,0,0,0.5),-4px_-4px_8px_rgba(255,255,255,0.04)]",
              "active:shadow-[inset_3px_3px_6px_rgba(0,0,0,0.1),inset_-3px_-3px_6px_rgba(255,255,255,0.9)]",
              "dark:active:shadow-[inset_3px_3px_6px_rgba(0,0,0,0.5),inset_-3px_-3px_6px_rgba(255,255,255,0.04)]"
            )}
            title="Zoom out"
          >
            <Minus className="h-4 w-4 text-gray-600 dark:text-neutral-400" />
          </button>
          <span className="text-sm min-w-[50px] text-center text-gray-700 dark:text-neutral-300">
            {Math.round(scale * 100)}%
          </span>
          <button
            onClick={() => handleZoom("in")}
            className={cn(
              "p-2 rounded-xl transition-all duration-200",
              "bg-white dark:bg-neutral-950",
              "shadow-[3px_3px_6px_rgba(0,0,0,0.08),-3px_-3px_6px_rgba(255,255,255,0.8)]",
              "dark:shadow-[3px_3px_6px_rgba(0,0,0,0.4),-3px_-3px_6px_rgba(255,255,255,0.03)]",
              "hover:shadow-[4px_4px_8px_rgba(0,0,0,0.1),-4px_-4px_8px_rgba(255,255,255,0.9)]",
              "dark:hover:shadow-[4px_4px_8px_rgba(0,0,0,0.5),-4px_-4px_8px_rgba(255,255,255,0.04)]",
              "active:shadow-[inset_3px_3px_6px_rgba(0,0,0,0.1),inset_-3px_-3px_6px_rgba(255,255,255,0.9)]",
              "dark:active:shadow-[inset_3px_3px_6px_rgba(0,0,0,0.5),inset_-3px_-3px_6px_rgba(255,255,255,0.04)]"
            )}
            title="Zoom in"
          >
            <Plus className="h-4 w-4 text-gray-600 dark:text-neutral-400" />
          </button>
        </div>

        {/* Invert Colors Toggle */}
        <div className="flex items-center gap-2 border-l border-gray-200 dark:border-neutral-700 pl-4">
          <button
            onClick={() => setIsInverted((prev) => !prev)}
            className={cn(
              "p-2 rounded-xl transition-all duration-200",
              isInverted
                ? cn(
                    "bg-fuchsia-500 dark:bg-[#ff00ff] text-white",
                    "shadow-[inset_3px_3px_6px_rgba(0,0,0,0.2),inset_-3px_-3px_6px_rgba(255,255,255,0.1)]"
                  )
                : cn(
                    "bg-white dark:bg-neutral-950",
                    "shadow-[3px_3px_6px_rgba(0,0,0,0.08),-3px_-3px_6px_rgba(255,255,255,0.8)]",
                    "dark:shadow-[3px_3px_6px_rgba(0,0,0,0.4),-3px_-3px_6px_rgba(255,255,255,0.03)]",
                    "hover:shadow-[4px_4px_8px_rgba(0,0,0,0.1),-4px_-4px_8px_rgba(255,255,255,0.9)]",
                    "dark:hover:shadow-[4px_4px_8px_rgba(0,0,0,0.5),-4px_-4px_8px_rgba(255,255,255,0.04)]"
                  )
            )}
            title={isInverted ? "Restore original colors" : "Invert colors"}
          >
            <SunMoon className={cn("h-4 w-4", isInverted ? "text-white" : "text-gray-600 dark:text-neutral-400")} />
          </button>
        </div>
      </div>
    </div>
  );
}
