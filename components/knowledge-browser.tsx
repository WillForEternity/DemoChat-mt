"use client";

/**
 * Knowledge Browser Component
 *
 * Displays the user's Knowledge Base as a tree view.
 * Users can browse folders and view file contents (read-only).
 * Claude manages the content via tools.
 */

import { useState, useEffect, useCallback, useImperativeHandle, forwardRef, useRef } from "react";
import { ChevronRight, ChevronDown, FileText, Folder, X, Trash2, RefreshCw, Download, Upload, Check, AlertCircle } from "lucide-react";
import { getTree, readFile, deleteNode, reindexAllFiles, getEmbeddingStats, migrateFromV2NameIfNeeded, downloadKnowledgeBackup, importFromFile, type KnowledgeTree, type ImportResult } from "@/knowledge";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import "katex/dist/katex.min.css";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { gruvboxDark } from "react-syntax-highlighter/dist/esm/styles/prism";

const MIN_PREVIEW_HEIGHT = 120; // Minimum height for file preview
const MAX_PREVIEW_HEIGHT = 600; // Maximum height for file preview
const DEFAULT_PREVIEW_HEIGHT = 192; // 48 * 4px = max-h-48

const REMARK_PLUGINS = [remarkGfm, remarkMath];
const REHYPE_PLUGINS = [rehypeKatex];

/**
 * Preprocess markdown text to convert ```math code blocks to ```mathblock
 */
function preprocessMathCodeBlocks(text: string): string {
  return text.replace(/^([ \t]*)```math\s*$/gm, "$1```mathblock");
}

/**
 * Simple markdown components for file preview
 */
const markdownComponents = {
  code: ({ className, children, ...props }: any) => {
    const match = /language-(\w+)/.exec(className || "");
    const isInline = !match && !className;
    
    if (isInline) {
      return (
        <code className="px-1.5 py-0.5 bg-gray-100 dark:bg-neutral-700 rounded text-sm font-mono text-gray-800 dark:text-neutral-200">
          {children}
        </code>
      );
    }
    
    return (
      <SyntaxHighlighter
        language={match?.[1] || "text"}
        style={gruvboxDark}
        customStyle={{
          margin: "1rem 0",
          borderRadius: "0.5rem",
          fontSize: "0.75rem",
        }}
        {...props}
      >
        {String(children).replace(/\n$/, "")}
      </SyntaxHighlighter>
    );
  },
  pre: ({ children }: any) => <>{children}</>,
  p: ({ children }: any) => <p className="my-2 leading-6 text-sm">{children}</p>,
  h1: ({ children }: any) => <h1 className="text-lg font-bold mt-4 mb-2 text-gray-900 dark:text-neutral-100">{children}</h1>,
  h2: ({ children }: any) => <h2 className="text-base font-semibold mt-3 mb-2 text-gray-900 dark:text-neutral-100">{children}</h2>,
  h3: ({ children }: any) => <h3 className="text-sm font-semibold mt-2 mb-1 text-gray-900 dark:text-neutral-100">{children}</h3>,
  ul: ({ children }: any) => <ul className="my-2 ml-4 list-disc space-y-1 text-sm">{children}</ul>,
  ol: ({ children }: any) => <ol className="my-2 ml-4 list-decimal space-y-1 text-sm">{children}</ol>,
  li: ({ children }: any) => <li className="leading-6">{children}</li>,
  blockquote: ({ children }: any) => (
    <blockquote className="my-2 border-l-2 border-purple-500 dark:border-neutral-500 pl-3 py-1 bg-purple-50 dark:bg-neutral-800/50 rounded-r italic text-sm">
      {children}
    </blockquote>
  ),
  a: ({ href, children }: any) => (
    <a href={href} target="_blank" rel="noopener noreferrer" className="text-blue-600 dark:text-blue-400 hover:underline">
      {children}
    </a>
  ),
};

export interface KnowledgeBrowserRef {
  refresh: () => void;
}

interface KnowledgeBrowserProps {
  className?: string;
}

export const KnowledgeBrowser = forwardRef<KnowledgeBrowserRef, KnowledgeBrowserProps>(
  function KnowledgeBrowser({ className }, ref) {
    const [tree, setTree] = useState<KnowledgeTree[]>([]);
    const [expanded, setExpanded] = useState<Set<string>>(new Set());
    const [selectedFile, setSelectedFile] = useState<string | null>(null);
    const [fileContent, setFileContent] = useState("");
    const [isLoading, setIsLoading] = useState(true);
    const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
    const [previewHeight, setPreviewHeight] = useState(DEFAULT_PREVIEW_HEIGHT);
    const [isResizingPreview, setIsResizingPreview] = useState(false);
    const previewRef = useRef<HTMLDivElement>(null);
    
    // Reindexing state
    const [isReindexing, setIsReindexing] = useState(false);
    const [reindexProgress, setReindexProgress] = useState<{
      current: number;
      total: number;
      currentFile: string;
    } | null>(null);
    const [embeddingStats, setEmbeddingStats] = useState<{
      totalChunks: number;
      totalFiles: number;
    } | null>(null);

    // Import/Export state
    const [isExporting, setIsExporting] = useState(false);
    const [isImporting, setIsImporting] = useState(false);
    const [importProgress, setImportProgress] = useState<{
      current: number;
      total: number;
      currentItem: string;
    } | null>(null);
    const [importResult, setImportResult] = useState<ImportResult | null>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);

    const loadTree = useCallback(async () => {
      setIsLoading(true);
      try {
        const t = await getTree();
        setTree(t);
      } finally {
        setIsLoading(false);
      }
    }, []);

    useEffect(() => {
      // Run migration first (fixes database naming issue), then load tree
      migrateFromV2NameIfNeeded()
        .then(() => {
          loadTree();
          // Load initial embedding stats
          getEmbeddingStats().then(setEmbeddingStats).catch(console.error);
        })
        .catch(console.error);
    }, [loadTree]);

    const handleReindex = useCallback(async () => {
      setIsReindexing(true);
      setReindexProgress({ current: 0, total: 0, currentFile: "Starting..." });

      try {
        const result = await reindexAllFiles((progress) => {
          setReindexProgress({
            current: progress.current,
            total: progress.total,
            currentFile: progress.currentFile,
          });
        });

        // Refresh stats after reindexing
        const stats = await getEmbeddingStats();
        setEmbeddingStats(stats);

        console.log("[Reindex] Complete:", result);
      } catch (error) {
        console.error("[Reindex] Failed:", error);
      } finally {
        setIsReindexing(false);
        setReindexProgress(null);
      }
    }, []);

    // Handle KB export
    const handleExport = useCallback(async () => {
      setIsExporting(true);
      try {
        await downloadKnowledgeBackup();
        console.log("[Export] Complete");
      } catch (error) {
        console.error("[Export] Failed:", error);
      } finally {
        setIsExporting(false);
      }
    }, []);

    // Handle KB import
    const handleImport = useCallback(async (file: File) => {
      setIsImporting(true);
      setImportResult(null);
      setImportProgress({ current: 0, total: 0, currentItem: "Starting..." });

      try {
        const result = await importFromFile(file, {
          overwrite: false, // Don't overwrite existing files
          reindex: true,    // Re-embed imported files
          onProgress: (current, total, currentItem) => {
            setImportProgress({ current, total, currentItem });
          },
        });

        setImportResult(result);
        console.log("[Import] Complete:", result);

        // Refresh the tree and stats
        await loadTree();
        const stats = await getEmbeddingStats();
        setEmbeddingStats(stats);

        // Clear result after 5 seconds
        setTimeout(() => setImportResult(null), 5000);
      } catch (error) {
        console.error("[Import] Failed:", error);
        setImportResult({
          success: false,
          filesImported: 0,
          filesSkipped: 0,
          linksImported: 0,
          linksSkipped: 0,
          errors: [error instanceof Error ? error.message : String(error)],
        });
      } finally {
        setIsImporting(false);
        setImportProgress(null);
      }
    }, [loadTree]);

    // Handle file input change
    const handleFileInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) {
        handleImport(file);
      }
      // Reset input so same file can be selected again
      e.target.value = "";
    }, [handleImport]);

    // Expose refresh method to parent
    useImperativeHandle(ref, () => ({
      refresh: loadTree,
    }));

    const toggle = (path: string) => {
      setExpanded((prev) => {
        const next = new Set(prev);
        next.has(path) ? next.delete(path) : next.add(path);
        return next;
      });
    };

    const selectFile = async (path: string) => {
      setSelectedFile(path);
      try {
        const content = await readFile(path);
        setFileContent(content);
      } catch (error) {
        setFileContent(`Error reading file: ${error instanceof Error ? error.message : String(error)}`);
      }
    };

    const handleDelete = async (path: string) => {
      await deleteNode(path);
      setDeleteConfirm(null);
      if (selectedFile === path || selectedFile?.startsWith(path + "/")) {
        setSelectedFile(null);
        setFileContent("");
      }
      loadTree();
    };

    // Handle preview resize
    const handlePreviewMouseDown = useCallback((e: React.MouseEvent) => {
      e.preventDefault();
      setIsResizingPreview(true);
    }, []);

    // Handle mouse move during preview resize
    useEffect(() => {
      const handleMouseMove = (e: MouseEvent) => {
        if (!isResizingPreview || !previewRef.current) return;
        
        const container = previewRef.current.parentElement;
        if (!container) return;
        
        const containerRect = container.getBoundingClientRect();
        const newHeight = containerRect.bottom - e.clientY;
        
        if (newHeight >= MIN_PREVIEW_HEIGHT && newHeight <= MAX_PREVIEW_HEIGHT) {
          setPreviewHeight(newHeight);
        }
      };

      const handleMouseUp = () => {
        setIsResizingPreview(false);
      };

      if (isResizingPreview) {
        document.addEventListener("mousemove", handleMouseMove);
        document.addEventListener("mouseup", handleMouseUp);
        document.body.style.userSelect = "none";
        document.body.style.cursor = "ns-resize";
      }

      return () => {
        document.removeEventListener("mousemove", handleMouseMove);
        document.removeEventListener("mouseup", handleMouseUp);
        document.body.style.userSelect = "";
        document.body.style.cursor = "";
      };
    }, [isResizingPreview]);

    const renderNode = (node: KnowledgeTree, depth = 0) => {
      const isExpanded = expanded.has(node.path);
      const isFolder = node.type === "folder";
      const isSelected = selectedFile === node.path;
      const showDeleteConfirm = deleteConfirm === node.path;

      return (
        <div key={node.path}>
          <div
            className={cn(
              "group flex items-center gap-1 px-2 py-1.5 text-sm rounded-lg cursor-pointer transition-colors",
              isSelected
                ? "bg-purple-50 dark:bg-neutral-800/50 text-purple-700 dark:text-neutral-300"
                : "hover:bg-gray-100 dark:hover:bg-neutral-800 text-gray-700 dark:text-neutral-300"
            )}
            style={{ paddingLeft: depth * 12 + 8 }}
          >
            <button
              onClick={() => (isFolder ? toggle(node.path) : selectFile(node.path))}
              className="flex-1 flex items-center gap-1.5 min-w-0"
            >
              {isFolder ? (
                <>
                  {isExpanded ? (
                    <ChevronDown className="w-3.5 h-3.5 flex-shrink-0 text-gray-400" />
                  ) : (
                    <ChevronRight className="w-3.5 h-3.5 flex-shrink-0 text-gray-400" />
                  )}
                  <Folder className="w-4 h-4 flex-shrink-0 text-fuchsia-500 dark:text-[#ff00ff]" />
                </>
              ) : (
                <>
                  <span className="w-3.5 flex-shrink-0" />
                  <FileText className="w-4 h-4 flex-shrink-0 text-purple-500" />
                </>
              )}
              <span className="truncate">{node.name}</span>
            </button>
            
            {/* Delete button */}
            {showDeleteConfirm ? (
              <div className="flex items-center gap-1">
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    handleDelete(node.path);
                  }}
                  className="px-2 py-0.5 text-xs bg-red-500 text-white rounded hover:bg-red-600 transition-colors"
                >
                  Delete
                </button>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    setDeleteConfirm(null);
                  }}
                  className="px-2 py-0.5 text-xs bg-gray-200 dark:bg-neutral-700 text-gray-700 dark:text-neutral-300 rounded hover:bg-gray-300 dark:hover:bg-neutral-600 transition-colors"
                >
                  Cancel
                </button>
              </div>
            ) : (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setDeleteConfirm(node.path);
                }}
                className="p-1 rounded opacity-0 group-hover:opacity-100 hover:bg-red-100 dark:hover:bg-red-900/30 text-gray-400 hover:text-red-500 transition-all"
                title="Delete"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
          {isFolder && isExpanded && node.children?.map((c) => renderNode(c, depth + 1))}
        </div>
      );
    };

    return (
      <div className={cn("flex flex-col h-full", className)}>
        {/* Hidden file input for import */}
        <input
          ref={fileInputRef}
          type="file"
          accept=".json"
          onChange={handleFileInputChange}
          className="hidden"
        />

        {/* Toolbar bar */}
        <div className="px-3 py-2 border-b border-gray-200 dark:border-neutral-700 bg-gray-50/50 dark:bg-neutral-900/50">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              {embeddingStats && (
                <span className="text-xs text-gray-500 dark:text-neutral-400">
                  {embeddingStats.totalChunks} chunks • {embeddingStats.totalFiles} files indexed
                </span>
              )}
            </div>
            <div className="flex items-center gap-1.5">
              {/* Export button */}
              <button
                onClick={handleExport}
                disabled={isExporting || isImporting}
                className={cn(
                  "flex items-center gap-1 px-2 py-1.5 rounded-lg text-xs font-medium transition-all",
                  isExporting
                    ? "bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 cursor-wait"
                    : "bg-gray-100 dark:bg-neutral-800 text-gray-600 dark:text-neutral-400 hover:bg-gray-200 dark:hover:bg-neutral-700"
                )}
                title="Export knowledge base as JSON backup"
              >
                <Download className={cn("w-3.5 h-3.5", isExporting && "animate-pulse")} />
                <span className="hidden sm:inline">Export</span>
              </button>

              {/* Import button */}
              <button
                onClick={() => fileInputRef.current?.click()}
                disabled={isImporting || isExporting}
                className={cn(
                  "flex items-center gap-1 px-2 py-1.5 rounded-lg text-xs font-medium transition-all",
                  isImporting
                    ? "bg-green-100 dark:bg-green-900/30 text-green-600 dark:text-green-400 cursor-wait"
                    : "bg-gray-100 dark:bg-neutral-800 text-gray-600 dark:text-neutral-400 hover:bg-gray-200 dark:hover:bg-neutral-700"
                )}
                title="Import knowledge base from JSON backup"
              >
                <Upload className={cn("w-3.5 h-3.5", isImporting && "animate-pulse")} />
                <span className="hidden sm:inline">Import</span>
              </button>

              {/* Reindex button */}
              <button
                onClick={handleReindex}
                disabled={isReindexing || isImporting}
                className={cn(
                  "flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-all",
                  isReindexing
                    ? "bg-fuchsia-100 dark:bg-fuchsia-900/30 text-fuchsia-600 dark:text-[#ff00ff] cursor-wait"
                    : "bg-fuchsia-50 dark:bg-fuchsia-900/20 text-fuchsia-600 dark:text-[#ff00ff] hover:bg-fuchsia-100 dark:hover:bg-fuchsia-900/40"
                )}
                title="Reindex all files for semantic search"
              >
                <RefreshCw className={cn("w-3.5 h-3.5", isReindexing && "animate-spin")} />
                {isReindexing ? "Indexing..." : "Reindex"}
              </button>
            </div>
          </div>
          
          {/* Reindex progress bar */}
          {isReindexing && reindexProgress && (
            <div className="mt-2">
              <div className="flex items-center justify-between text-xs text-gray-500 dark:text-neutral-400 mb-1">
                <span className="truncate max-w-[70%]">{reindexProgress.currentFile}</span>
                <span>{reindexProgress.current}/{reindexProgress.total}</span>
              </div>
              <div className="h-1.5 bg-gray-200 dark:bg-neutral-700 rounded-full overflow-hidden">
                <div
                  className="h-full bg-fuchsia-500 dark:bg-[#ff00ff] transition-all duration-300 ease-out"
                  style={{
                    width: reindexProgress.total > 0
                      ? `${(reindexProgress.current / reindexProgress.total) * 100}%`
                      : "0%",
                  }}
                />
              </div>
            </div>
          )}

          {/* Import progress bar */}
          {isImporting && importProgress && (
            <div className="mt-2">
              <div className="flex items-center justify-between text-xs text-gray-500 dark:text-neutral-400 mb-1">
                <span className="truncate max-w-[70%]">{importProgress.currentItem}</span>
                <span>{importProgress.current}/{importProgress.total}</span>
              </div>
              <div className="h-1.5 bg-gray-200 dark:bg-neutral-700 rounded-full overflow-hidden">
                <div
                  className="h-full bg-green-500 dark:bg-green-400 transition-all duration-300 ease-out"
                  style={{
                    width: importProgress.total > 0
                      ? `${(importProgress.current / importProgress.total) * 100}%`
                      : "0%",
                  }}
                />
              </div>
            </div>
          )}

          {/* Import result notification */}
          {importResult && (
            <div className={cn(
              "mt-2 flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-xs",
              importResult.success
                ? "bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-400"
                : "bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400"
            )}>
              {importResult.success ? (
                <Check className="w-3.5 h-3.5 flex-shrink-0" />
              ) : (
                <AlertCircle className="w-3.5 h-3.5 flex-shrink-0" />
              )}
              <span>
                {importResult.success
                  ? `Imported ${importResult.filesImported} files, ${importResult.linksImported} links`
                  : `Import failed: ${importResult.errors[0]}`
                }
                {importResult.filesSkipped > 0 && ` (${importResult.filesSkipped} skipped)`}
              </span>
            </div>
          )}
        </div>

        {/* Tree view */}
        <div className="flex-1 overflow-y-auto p-2">
          {isLoading ? (
            <div className="flex items-center justify-center py-8">
              <div className="w-5 h-5 border-2 border-gray-300 border-t-gray-600 rounded-full animate-spin" />
            </div>
          ) : tree.length === 0 ? (
            <div className="text-center py-8 px-4">
              <Folder className="w-10 h-10 mx-auto text-gray-300 dark:text-neutral-600 mb-3" />
              <p className="text-gray-500 dark:text-neutral-400 text-sm font-medium">
                No knowledge yet
              </p>
              <p className="text-gray-400 dark:text-neutral-500 text-xs mt-1">
                Claude will create files as you chat. Share information you want remembered!
              </p>
            </div>
          ) : (
            tree.map((node) => renderNode(node))
          )}
        </div>

        {/* File preview panel */}
        {selectedFile && (
          <div 
            ref={previewRef}
            className="border-t border-gray-200 dark:border-neutral-700 flex flex-col relative"
            style={{ height: previewHeight }}
          >
            {/* Resize Handle */}
            <div
              onMouseDown={handlePreviewMouseDown}
              className={cn(
                "absolute top-0 left-0 right-0 h-1 cursor-ns-resize z-10 transition-colors",
                isResizingPreview 
                  ? "bg-purple-500" 
                  : "bg-transparent hover:bg-gray-300 dark:hover:bg-neutral-600"
              )}
            />
            
            <div className="px-3 py-2 bg-gray-50 dark:bg-neutral-800 flex items-center justify-between flex-shrink-0">
              <span className="text-xs font-medium text-gray-600 dark:text-neutral-400 truncate">
                {selectedFile}
              </span>
              <button
                onClick={() => {
                  setSelectedFile(null);
                  setFileContent("");
                }}
                className="p-0.5 rounded hover:bg-gray-200 dark:hover:bg-neutral-700 text-gray-400 hover:text-gray-600 dark:hover:text-neutral-300 transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="overflow-auto flex-1 p-3">
              {fileContent ? (
                <div className="text-xs text-gray-700 dark:text-neutral-300">
                  <ReactMarkdown
                    remarkPlugins={REMARK_PLUGINS}
                    rehypePlugins={REHYPE_PLUGINS}
                    components={markdownComponents}
                  >
                    {preprocessMathCodeBlocks(fileContent)}
                  </ReactMarkdown>
                </div>
              ) : (
                <p className="text-xs text-gray-500 dark:text-neutral-400 italic">(empty file)</p>
              )}
            </div>
          </div>
        )}
      </div>
    );
  }
);
