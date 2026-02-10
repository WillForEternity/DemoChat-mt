"use client";

/**
 * Text Viewer Component
 *
 * Renders text/markdown documents with selection support.
 * When text is selected, triggers callback to create a chat.
 *
 * Loads original file data from IndexedDB `files` store for faithful rendering.
 * Falls back to chunk reconstruction only if the original file is unavailable.
 */

import { useState, useEffect, useRef, useCallback } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Loader2 } from "lucide-react";
import { getLargeDocumentFile, loadDocumentContent } from "@/knowledge/large-documents";
import type { SelectionData } from "./index";

interface TextViewerProps {
  documentId: string;
  onSelection: (selection: SelectionData) => void;
}

export function TextViewer({ documentId, onSelection }: TextViewerProps) {
  const [content, setContent] = useState<string>("");
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Load document content - prefer original file, fall back to chunk reconstruction
  useEffect(() => {
    setIsLoading(true);
    setError(null);

    (async () => {
      try {
        // Try loading the original file first (faithful, no overlap duplication)
        const file = await getLargeDocumentFile(documentId);
        if (file) {
          const decoder = new TextDecoder("utf-8");
          const text = decoder.decode(file.data);
          if (text) {
            setContent(text);
            return;
          }
        }

        // Fall back to chunk reconstruction if original file not available
        // (e.g. document was indexed before files store was added)
        console.warn("[TextViewer] Original file not found, falling back to chunk reconstruction");
        const text = await loadDocumentContent(documentId);
        if (text) {
          setContent(text);
        } else {
          setError("Document content not found");
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load document");
      } finally {
        setIsLoading(false);
      }
    })();
  }, [documentId]);

  // Handle text selection on mouseup
  const handleMouseUp = useCallback(() => {
    const selection = window.getSelection();
    const text = selection?.toString().trim();
    if (text && text.length > 0) {
      onSelection({ text });
      selection?.removeAllRanges();
    }
  }, [onSelection]);

  // Attach mouseup listener
  useEffect(() => {
    const container = containerRef.current;
    container?.addEventListener("mouseup", handleMouseUp);
    return () => container?.removeEventListener("mouseup", handleMouseUp);
  }, [handleMouseUp]);

  if (isLoading) {
    return (
      <div className="h-full flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="text-center">
          <p className="text-muted-foreground">{error}</p>
        </div>
      </div>
    );
  }

  return (
    <div ref={containerRef} className="h-full overflow-auto p-8 bg-gray-100 dark:bg-neutral-900">
      <div className="max-w-3xl mx-auto prose dark:prose-invert prose-sm bg-white dark:bg-neutral-950 p-8 rounded-2xl shadow-[8px_8px_20px_rgba(0,0,0,0.08),-8px_-8px_20px_rgba(255,255,255,0.8)] dark:shadow-[8px_8px_20px_rgba(0,0,0,0.4),-8px_-8px_20px_rgba(255,255,255,0.02)]">
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
      </div>
    </div>
  );
}
