"use client";

/**
 * Knowledge Browser & Note Editor
 *
 * A beautiful, themed (neumorphic + fuchsia accents) workspace for the user's
 * Knowledge Base. The same files are read and written by the chat agent via
 * the kb_* tools, so this surface is a true two-way notebook:
 *
 *   - Browse a tree of folders and files
 *   - Create / rename / delete files and folders inline
 *   - Click a file to open it in a full editor with Edit / Preview toggle
 *   - Edits autosave (debounced) and stream straight into IndexedDB so the
 *     agent can read them on its next tool call
 *   - When the agent edits the file the user is viewing, we hot-reload the
 *     content (or, if the user has unsaved changes, surface a non-disruptive
 *     "Agent edited — reload" action so we never silently overwrite work)
 *   - Export, import, and reindex actions are preserved
 */

import {
  useState,
  useEffect,
  useCallback,
  useImperativeHandle,
  forwardRef,
  useRef,
} from "react";
import {
  ChevronRight,
  ChevronDown,
  FileText,
  Folder,
  FolderPlus,
  FilePlus,
  X,
  Trash2,
  RefreshCw,
  Download,
  Upload,
  Check,
  AlertCircle,
  Pencil,
  Eye,
  Save,
  Loader2,
  Sparkles,
} from "lucide-react";
import {
  getTree,
  readFile,
  writeFile,
  mkdir,
  deleteNode,
  renameNode,
  reindexAllFiles,
  getEmbeddingStats,
  migrateFromV2NameIfNeeded,
  downloadKnowledgeBackup,
  importFromFile,
  subscribeKnowledge,
  type KnowledgeTree,
  type ImportResult,
  type KnowledgeEvent,
} from "@/knowledge";
import { cn } from "@/lib/utils";
import { MarkdownContent } from "@/components/chat/markdown-content";

// =============================================================================
// CONSTANTS
// =============================================================================

const MIN_EDITOR_HEIGHT = 220;
const MAX_EDITOR_HEIGHT_PERCENT = 0.9;
const DEFAULT_EDITOR_HEIGHT = 460;
const AUTOSAVE_DEBOUNCE_MS = 600;

// =============================================================================
// PUBLIC TYPES
// =============================================================================

export interface KnowledgeBrowserRef {
  refresh: () => void;
}

interface KnowledgeBrowserProps {
  className?: string;
}

// =============================================================================
// HELPERS
// =============================================================================

function parentPath(p: string): string {
  const parts = p.split("/").filter(Boolean);
  if (parts.length <= 1) return "/";
  return "/" + parts.slice(0, -1).join("/");
}

function joinPath(parent: string, name: string): string {
  if (parent === "/" || parent === "") return "/" + name;
  return parent + "/" + name;
}

function uniqueName(base: string, existing: Set<string>, ext = ""): string {
  if (!existing.has(base + ext)) return base + ext;
  let i = 2;
  while (existing.has(`${base} ${i}${ext}`)) i++;
  return `${base} ${i}${ext}`;
}

function findNode(tree: KnowledgeTree[], path: string): KnowledgeTree | null {
  for (const n of tree) {
    if (n.path === path) return n;
    if (n.children) {
      const r = findNode(n.children, path);
      if (r) return r;
    }
  }
  return null;
}

function siblingNames(tree: KnowledgeTree[], parent: string): Set<string> {
  if (parent === "/" || parent === "") {
    return new Set(tree.map((n) => n.name));
  }
  const node = findNode(tree, parent);
  return new Set((node?.children ?? []).map((n) => n.name));
}

// =============================================================================
// EDITOR PANE
// =============================================================================

type EditorMode = "edit" | "preview";
type SaveStatus = "idle" | "saving" | "saved" | "error";

function NoteEditor({
  filePath,
  onClose,
  onRequestRename,
}: {
  filePath: string;
  onClose: () => void;
  onRequestRename: () => void;
}) {
  const [content, setContent] = useState<string>("");
  const [originalContent, setOriginalContent] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [mode, setMode] = useState<EditorMode>("edit");
  const [status, setStatus] = useState<SaveStatus>("idle");
  const [agentUpdatePending, setAgentUpdatePending] = useState(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isSavingRef = useRef(false);

  const fileName = filePath.split("/").pop() || filePath;
  const isDirty = content !== originalContent;

  // Single source of truth for persisting the buffer.
  const persist = useCallback(
    async (text: string) => {
      isSavingRef.current = true;
      setStatus("saving");
      try {
        await writeFile(filePath, text, { source: "user" });
        setOriginalContent(text);
        setStatus("saved");
        setTimeout(() => {
          setStatus((s) => (s === "saved" ? "idle" : s));
        }, 1200);
      } catch (err) {
        console.error("[NoteEditor] save failed:", err);
        setStatus("error");
      } finally {
        isSavingRef.current = false;
      }
    },
    [filePath]
  );

  // Load file content (whenever the open file changes).
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setAgentUpdatePending(false);
    readFile(filePath)
      .then((c) => {
        if (cancelled) return;
        setContent(c);
        setOriginalContent(c);
        setStatus("idle");
        setMode(c.trim() ? "preview" : "edit");
      })
      .catch((err) => {
        if (cancelled) return;
        setContent(`Error reading file: ${err instanceof Error ? err.message : String(err)}`);
        setOriginalContent("");
        setStatus("error");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [filePath]);

  // Subscribe to KB events: react when the agent edits THIS file.
  useEffect(() => {
    const unsub = subscribeKnowledge((e: KnowledgeEvent) => {
      if (e.path !== filePath) return;
      if (e.source === "user") return;
      // We just wrote it ourselves -> ignore.
      if (isSavingRef.current) return;
      // Foreign update (agent or system).
      if (isDirty) {
        setAgentUpdatePending(true);
      } else {
        // Hot-reload silently if the user has nothing in flight.
        readFile(filePath)
          .then((c) => {
            setContent(c);
            setOriginalContent(c);
          })
          .catch(() => {});
      }
    });
    return unsub;
  }, [filePath, isDirty]);

  // Debounced autosave.
  useEffect(() => {
    if (loading) return;
    if (content === originalContent) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    setStatus("saving");
    saveTimer.current = setTimeout(() => persist(content), AUTOSAVE_DEBOUNCE_MS);
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
  }, [content, originalContent, loading, persist]);

  // Cmd/Ctrl + S forces an immediate flush.
  const flush = useCallback(async () => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    if (content === originalContent) return;
    await persist(content);
  }, [content, originalContent, persist]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        flush();
      } else if (e.key === "Tab") {
        // Insert two spaces instead of leaving the textarea.
        e.preventDefault();
        const ta = e.currentTarget;
        const start = ta.selectionStart;
        const end = ta.selectionEnd;
        const next = content.slice(0, start) + "  " + content.slice(end);
        setContent(next);
        requestAnimationFrame(() => {
          ta.selectionStart = ta.selectionEnd = start + 2;
        });
      }
    },
    [content, flush]
  );

  const handleAgentReload = useCallback(async () => {
    try {
      const c = await readFile(filePath);
      setContent(c);
      setOriginalContent(c);
      setAgentUpdatePending(false);
    } catch {
      /* noop */
    }
  }, [filePath]);

  return (
    <div className="flex flex-col h-full bg-white dark:bg-neutral-950">
      {/* Editor header */}
      <div className="px-3 py-2 flex items-center justify-between gap-2 border-b border-gray-200 dark:border-neutral-800 bg-gray-50/80 dark:bg-neutral-900/60 backdrop-blur-sm flex-shrink-0">
        <div className="flex items-center gap-2 min-w-0 flex-1">
          <FileText className="w-3.5 h-3.5 text-fuchsia-500 dark:text-[#ff00ff] flex-shrink-0" />
          <button
            onClick={onRequestRename}
            className="truncate text-xs font-medium text-gray-700 dark:text-neutral-200 hover:text-fuchsia-600 dark:hover:text-[#ff00ff] transition-colors text-left"
            title="Rename"
          >
            {fileName}
          </button>
          <span className="text-[10px] font-mono text-gray-400 dark:text-neutral-600 truncate">
            {filePath}
          </span>
        </div>

        <div className="flex items-center gap-1.5 flex-shrink-0">
          {/* Save status pill */}
          <SaveStatusPill status={status} dirty={isDirty} />

          {/* Mode toggle */}
          <div className="flex items-center bg-gray-100 dark:bg-neutral-800 rounded-md p-0.5">
            <button
              onClick={() => setMode("edit")}
              className={cn(
                "flex items-center gap-1 px-2 py-1 text-[11px] rounded transition-all",
                mode === "edit"
                  ? "bg-white dark:bg-neutral-700 text-gray-900 dark:text-neutral-100 shadow-sm"
                  : "text-gray-500 dark:text-neutral-400 hover:text-gray-700 dark:hover:text-neutral-200"
              )}
              title="Edit mode"
            >
              <Pencil className="w-3 h-3" />
              Edit
            </button>
            <button
              onClick={() => setMode("preview")}
              className={cn(
                "flex items-center gap-1 px-2 py-1 text-[11px] rounded transition-all",
                mode === "preview"
                  ? "bg-white dark:bg-neutral-700 text-gray-900 dark:text-neutral-100 shadow-sm"
                  : "text-gray-500 dark:text-neutral-400 hover:text-gray-700 dark:hover:text-neutral-200"
              )}
              title="Preview mode"
            >
              <Eye className="w-3 h-3" />
              Preview
            </button>
          </div>

          <button
            onClick={async () => {
              await flush();
              onClose();
            }}
            className="p-1 rounded hover:bg-gray-200 dark:hover:bg-neutral-700 text-gray-400 hover:text-gray-600 dark:hover:text-neutral-200 transition-colors"
            title="Close editor"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Agent-update banner */}
      {agentUpdatePending && (
        <button
          onClick={handleAgentReload}
          className="flex items-center gap-2 px-3 py-1.5 text-[11px] bg-gradient-to-r from-fuchsia-50 to-purple-50 dark:from-fuchsia-900/20 dark:to-purple-900/20 border-b border-fuchsia-200/60 dark:border-[#ff00ff]/20 text-fuchsia-700 dark:text-[#ff00ff] hover:bg-fuchsia-100/60 dark:hover:bg-fuchsia-900/30 transition-colors"
        >
          <Sparkles className="w-3 h-3" />
          <span className="font-medium">Le Chat edited this file.</span>
          <span className="opacity-80">Click to reload (your unsaved changes will be lost).</span>
        </button>
      )}

      {/* Body */}
      <div
        className="flex-1 overflow-hidden relative"
        onMouseDown={(e) => {
          // Suppress the browser's default word-select on a double-click in
          // preview mode so flipping to edit doesn't leave a highlight behind.
          if (e.detail >= 2 && mode === "preview") e.preventDefault();
        }}
        onDoubleClick={() => {
          window.getSelection()?.removeAllRanges();
          setMode((m) => (m === "edit" ? "preview" : "edit"));
        }}
      >
        {loading ? (
          <div className="absolute inset-0 flex items-center justify-center">
            <Loader2 className="w-5 h-5 animate-spin text-fuchsia-500 dark:text-[#ff00ff]" />
          </div>
        ) : mode === "edit" ? (
          <textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            onKeyDown={handleKeyDown}
            onBlur={flush}
            spellCheck
            placeholder="Start writing... Markdown is supported. Cmd/Ctrl+S to save now."
            className={cn(
              "w-full h-full resize-none outline-none p-4 bg-transparent",
              "text-sm leading-6 font-mono",
              "text-gray-900 dark:text-neutral-100",
              "placeholder:text-gray-400 dark:placeholder:text-neutral-600",
              "selection:bg-fuchsia-200 dark:selection:bg-fuchsia-500/40",
              "caret-fuchsia-500 dark:caret-[#ff00ff]"
            )}
          />
        ) : (
          <div className="h-full overflow-auto px-4 py-3">
            {content.trim() ? (
              <MarkdownContent text={content} />
            ) : (
              <p className="text-sm text-gray-400 dark:text-neutral-600 italic">(empty note)</p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function ToolbarIconButton({
  onClick,
  disabled,
  active,
  tone,
  title,
  icon,
  label,
}: {
  onClick: () => void;
  disabled?: boolean;
  active?: boolean;
  tone: "neutral" | "fuchsia";
  title: string;
  icon: React.ReactNode;
  label?: string;
}) {
  const base =
    "flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-all";
  const styles =
    tone === "fuchsia"
      ? active
        ? "bg-fuchsia-100 dark:bg-fuchsia-900/30 text-fuchsia-600 dark:text-[#ff00ff] cursor-wait"
        : "bg-fuchsia-50 dark:bg-fuchsia-900/20 text-fuchsia-600 dark:text-[#ff00ff] hover:bg-fuchsia-100 dark:hover:bg-fuchsia-900/40"
      : active
      ? "bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 cursor-wait"
      : "bg-gray-100 dark:bg-neutral-800 text-gray-600 dark:text-neutral-400 hover:bg-gray-200 dark:hover:bg-neutral-700";
  return (
    <button onClick={onClick} disabled={disabled} className={cn(base, styles)} title={title}>
      {icon}
      {label && <span>{label}</span>}
    </button>
  );
}

function ProgressRow({
  label,
  current,
  total,
  tone,
}: {
  label: string;
  current: number;
  total: number;
  tone: "fuchsia" | "green";
}) {
  const pct = total > 0 ? (current / total) * 100 : 0;
  const barClass =
    tone === "fuchsia"
      ? "bg-fuchsia-500 dark:bg-[#ff00ff]"
      : "bg-green-500 dark:bg-green-400";
  return (
    <div className="mt-2">
      <div className="flex items-center justify-between text-xs text-gray-500 dark:text-neutral-400 mb-1">
        <span className="truncate max-w-[70%]">{label}</span>
        <span>
          {current}/{total}
        </span>
      </div>
      <div className="h-1.5 bg-gray-200 dark:bg-neutral-700 rounded-full overflow-hidden">
        <div
          className={cn("h-full transition-all duration-300 ease-out", barClass)}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

function SaveStatusPill({ status, dirty }: { status: SaveStatus; dirty: boolean }) {
  if (status === "saving") {
    return (
      <span className="flex items-center gap-1 text-[10px] text-gray-500 dark:text-neutral-400">
        <Loader2 className="w-3 h-3 animate-spin" /> Saving…
      </span>
    );
  }
  if (status === "saved") {
    return (
      <span className="flex items-center gap-1 text-[10px] text-emerald-600 dark:text-emerald-400">
        <Check className="w-3 h-3" /> Saved
      </span>
    );
  }
  if (status === "error") {
    return (
      <span className="flex items-center gap-1 text-[10px] text-red-500">
        <AlertCircle className="w-3 h-3" /> Save failed
      </span>
    );
  }
  if (dirty) {
    return (
      <span className="flex items-center gap-1 text-[10px] text-amber-500">
        <Save className="w-3 h-3" /> Unsaved
      </span>
    );
  }
  return null;
}

// =============================================================================
// MAIN COMPONENT
// =============================================================================

export const KnowledgeBrowser = forwardRef<KnowledgeBrowserRef, KnowledgeBrowserProps>(
  function KnowledgeBrowser({ className }, ref) {
    const [tree, setTree] = useState<KnowledgeTree[]>([]);
    const [expanded, setExpanded] = useState<Set<string>>(new Set(["/"]));
    const [selectedFile, setSelectedFile] = useState<string | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
    const [renamingPath, setRenamingPath] = useState<string | null>(null);
    const [renameDraft, setRenameDraft] = useState("");

    const [editorHeight, setEditorHeight] = useState(DEFAULT_EDITOR_HEIGHT);
    const [isResizingEditor, setIsResizingEditor] = useState(false);

    // Reindex/embedding state
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
    const containerRef = useRef<HTMLDivElement>(null);

    const loadTree = useCallback(async () => {
      try {
        const t = await getTree();
        setTree(t);
      } catch (err) {
        console.error("[KnowledgeBrowser] load tree failed:", err);
      } finally {
        setIsLoading(false);
      }
    }, []);

    useEffect(() => {
      migrateFromV2NameIfNeeded()
        .then(() => {
          loadTree();
          getEmbeddingStats().then(setEmbeddingStats).catch(console.error);
        })
        .catch(console.error);
    }, [loadTree]);

    // Two-way sync: refresh tree on any KB mutation (regardless of source).
    useEffect(() => {
      const unsub = subscribeKnowledge((e) => {
        // Tree changes for write/append are no-op structurally if file exists,
        // but mkdir/delete/rename and brand-new files all need a refresh.
        loadTree();
        // If currently selected file was renamed, follow it.
        if (e.type === "rename" && e.previousPath === selectedFile && e.path) {
          setSelectedFile(e.path);
        }
        // If the selected file was deleted, close the editor.
        if (e.type === "delete" && selectedFile && (selectedFile === e.path || selectedFile.startsWith(e.path + "/"))) {
          setSelectedFile(null);
        }
      });
      return unsub;
    }, [loadTree, selectedFile]);

    // Expose refresh to parent.
    useImperativeHandle(ref, () => ({ refresh: loadTree }));

    // ---------------- Tree interactions ----------------

    const toggle = useCallback((path: string) => {
      setExpanded((prev) => {
        const next = new Set(prev);
        next.has(path) ? next.delete(path) : next.add(path);
        return next;
      });
    }, []);

    const handleNewFile = useCallback(
      async (parent: string) => {
        const existing = siblingNames(tree, parent);
        const name = uniqueName("Untitled", existing, ".md");
        const newPath = joinPath(parent, name);
        await writeFile(newPath, "", { source: "user" });
        setExpanded((prev) => new Set(prev).add(parent));
        setSelectedFile(newPath);
        setRenamingPath(newPath);
        setRenameDraft(name);
      },
      [tree]
    );

    const handleNewFolder = useCallback(
      async (parent: string) => {
        const existing = siblingNames(tree, parent);
        const name = uniqueName("New Folder", existing);
        const newPath = joinPath(parent, name);
        await mkdir(newPath, { source: "user" });
        setExpanded((prev) => {
          const next = new Set(prev).add(parent);
          next.add(newPath);
          return next;
        });
        setRenamingPath(newPath);
        setRenameDraft(name);
      },
      [tree]
    );

    const handleDelete = useCallback(
      async (path: string) => {
        await deleteNode(path, { source: "user" });
        setDeleteConfirm(null);
        if (selectedFile === path || selectedFile?.startsWith(path + "/")) {
          setSelectedFile(null);
        }
      },
      [selectedFile]
    );

    const startRename = useCallback((node: KnowledgeTree) => {
      setRenamingPath(node.path);
      setRenameDraft(node.name);
    }, []);

    const commitRename = useCallback(async () => {
      if (!renamingPath) return;
      const name = renameDraft.trim();
      const node = findNode(tree, renamingPath);
      if (!node) {
        setRenamingPath(null);
        return;
      }
      if (!name || name === node.name) {
        setRenamingPath(null);
        return;
      }
      try {
        const newPath = await renameNode(renamingPath, name, { source: "user" });
        if (selectedFile === renamingPath) {
          setSelectedFile(newPath);
        }
      } catch (err) {
        console.error("[KnowledgeBrowser] rename failed:", err);
        alert(err instanceof Error ? err.message : String(err));
      } finally {
        setRenamingPath(null);
      }
    }, [renamingPath, renameDraft, tree, selectedFile]);

    const cancelRename = useCallback(() => setRenamingPath(null), []);

    // ---------------- Reindex / Export / Import (preserved) ----------------

    const handleReindex = useCallback(async () => {
      setIsReindexing(true);
      setReindexProgress({ current: 0, total: 0, currentFile: "Starting..." });
      try {
        await reindexAllFiles((progress) => {
          setReindexProgress({
            current: progress.current,
            total: progress.total,
            currentFile: progress.currentFile,
          });
        });
        const stats = await getEmbeddingStats();
        setEmbeddingStats(stats);
      } catch (error) {
        console.error("[Reindex] Failed:", error);
      } finally {
        setIsReindexing(false);
        setReindexProgress(null);
      }
    }, []);

    const handleExport = useCallback(async () => {
      setIsExporting(true);
      try {
        await downloadKnowledgeBackup();
      } catch (error) {
        console.error("[Export] Failed:", error);
      } finally {
        setIsExporting(false);
      }
    }, []);

    const handleImport = useCallback(async (file: File) => {
      setIsImporting(true);
      setImportResult(null);
      setImportProgress({ current: 0, total: 0, currentItem: "Starting..." });
      try {
        const result = await importFromFile(file, {
          overwrite: false,
          reindex: true,
          onProgress: (current, total, currentItem) => {
            setImportProgress({ current, total, currentItem });
          },
        });
        setImportResult(result);
        await loadTree();
        const stats = await getEmbeddingStats();
        setEmbeddingStats(stats);
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

    const handleFileInputChange = useCallback(
      (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (file) handleImport(file);
        e.target.value = "";
      },
      [handleImport]
    );

    // ---------------- Editor resize ----------------

    const handleEditorMouseDown = useCallback((e: React.MouseEvent) => {
      e.preventDefault();
      setIsResizingEditor(true);
    }, []);

    useEffect(() => {
      if (!isResizingEditor) return;
      const handleMove = (e: MouseEvent) => {
        if (!containerRef.current) return;
        const rect = containerRef.current.getBoundingClientRect();
        const next = rect.bottom - e.clientY;
        const max = rect.height * MAX_EDITOR_HEIGHT_PERCENT;
        if (next >= MIN_EDITOR_HEIGHT && next <= max) {
          setEditorHeight(next);
        }
      };
      const handleUp = () => setIsResizingEditor(false);
      document.addEventListener("mousemove", handleMove);
      document.addEventListener("mouseup", handleUp);
      document.body.style.userSelect = "none";
      document.body.style.cursor = "ns-resize";
      return () => {
        document.removeEventListener("mousemove", handleMove);
        document.removeEventListener("mouseup", handleUp);
        document.body.style.userSelect = "";
        document.body.style.cursor = "";
      };
    }, [isResizingEditor]);

    // ---------------- Tree rendering ----------------

    const renderNode = (node: KnowledgeTree, depth = 0) => {
      const isExpanded = expanded.has(node.path);
      const isFolder = node.type === "folder";
      const isSelected = selectedFile === node.path;
      const showDeleteConfirm = deleteConfirm === node.path;
      const isRenaming = renamingPath === node.path;

      return (
        <div key={node.path}>
          <div
            className={cn(
              "group flex items-center gap-1 px-2 py-1 text-sm rounded-lg transition-colors cursor-pointer",
              isSelected
                ? "bg-fuchsia-50 dark:bg-[#ff00ff]/10 text-fuchsia-700 dark:text-[#ff00ff]"
                : "hover:bg-gray-100 dark:hover:bg-neutral-800/70 text-gray-700 dark:text-neutral-300"
            )}
            style={{ paddingLeft: depth * 12 + 6 }}
            onDoubleClick={() => startRename(node)}
          >
            <button
              onClick={() => (isFolder ? toggle(node.path) : setSelectedFile(node.path))}
              className="flex-1 flex items-center gap-1.5 min-w-0"
              title={node.path}
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
                  <FileText className="w-4 h-4 flex-shrink-0 text-gray-400 dark:text-neutral-500" />
                </>
              )}

              {isRenaming ? (
                <input
                  autoFocus
                  value={renameDraft}
                  onChange={(e) => setRenameDraft(e.target.value)}
                  onClick={(e) => e.stopPropagation()}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      commitRename();
                    } else if (e.key === "Escape") {
                      e.preventDefault();
                      cancelRename();
                    }
                  }}
                  onBlur={commitRename}
                  className="flex-1 min-w-0 bg-white dark:bg-neutral-900 border border-fuchsia-400 dark:border-[#ff00ff]/60 rounded px-1.5 py-0.5 text-sm text-gray-900 dark:text-neutral-100 outline-none focus:ring-1 focus:ring-fuchsia-400 dark:focus:ring-[#ff00ff]/40"
                />
              ) : (
                <span className="truncate">{node.name}</span>
              )}
            </button>

            {/* Per-row actions */}
            {!isRenaming && (
              <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                {isFolder && (
                  <>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleNewFile(node.path);
                      }}
                      className="p-1 rounded hover:bg-gray-200 dark:hover:bg-neutral-700 text-gray-400 hover:text-fuchsia-500 dark:hover:text-[#ff00ff]"
                      title="New file in this folder"
                    >
                      <FilePlus className="w-3.5 h-3.5" />
                    </button>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleNewFolder(node.path);
                      }}
                      className="p-1 rounded hover:bg-gray-200 dark:hover:bg-neutral-700 text-gray-400 hover:text-fuchsia-500 dark:hover:text-[#ff00ff]"
                      title="New folder"
                    >
                      <FolderPlus className="w-3.5 h-3.5" />
                    </button>
                  </>
                )}
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    startRename(node);
                  }}
                  className="p-1 rounded hover:bg-gray-200 dark:hover:bg-neutral-700 text-gray-400 hover:text-gray-600 dark:hover:text-neutral-200"
                  title="Rename"
                >
                  <Pencil className="w-3 h-3" />
                </button>
                {showDeleteConfirm ? (
                  <div className="flex items-center gap-1 ml-1">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDelete(node.path);
                      }}
                      className="px-2 py-0.5 text-[10px] bg-red-500 text-white rounded hover:bg-red-600 transition-colors"
                    >
                      Delete
                    </button>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setDeleteConfirm(null);
                      }}
                      className="px-2 py-0.5 text-[10px] bg-gray-200 dark:bg-neutral-700 text-gray-700 dark:text-neutral-300 rounded hover:bg-gray-300 dark:hover:bg-neutral-600 transition-colors"
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
                    className="p-1 rounded hover:bg-red-100 dark:hover:bg-red-900/30 text-gray-400 hover:text-red-500 transition-all"
                    title="Delete"
                  >
                    <Trash2 className="w-3 h-3" />
                  </button>
                )}
              </div>
            )}
          </div>
          {isFolder && isExpanded && node.children?.map((c) => renderNode(c, depth + 1))}
        </div>
      );
    };

    const editorOpen = Boolean(selectedFile);

    return (
      <div ref={containerRef} className={cn("flex flex-col h-full relative", className)}>
        <input
          ref={fileInputRef}
          type="file"
          accept=".json"
          onChange={handleFileInputChange}
          className="hidden"
        />

        {/* Toolbar */}
        <div className="px-3 py-2 border-b border-gray-200 dark:border-neutral-800 bg-gray-50/60 dark:bg-neutral-900/60 backdrop-blur-sm flex-shrink-0">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-1.5">
              <button
                onClick={() => handleNewFile("/")}
                className="flex items-center gap-1 px-2 py-1.5 rounded-lg text-xs font-medium bg-fuchsia-50 dark:bg-[#ff00ff]/10 text-fuchsia-600 dark:text-[#ff00ff] hover:bg-fuchsia-100 dark:hover:bg-[#ff00ff]/20 transition-colors"
                title="New note at root"
              >
                <FilePlus className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">New note</span>
              </button>
              <button
                onClick={() => handleNewFolder("/")}
                className="flex items-center gap-1 px-2 py-1.5 rounded-lg text-xs font-medium bg-gray-100 dark:bg-neutral-800 text-gray-600 dark:text-neutral-300 hover:bg-gray-200 dark:hover:bg-neutral-700 transition-colors"
                title="New folder at root"
              >
                <FolderPlus className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">Folder</span>
              </button>
            </div>

            <div className="flex items-center gap-1.5">
              <ToolbarIconButton
                onClick={handleExport}
                disabled={isExporting || isImporting}
                active={isExporting}
                tone="neutral"
                title="Export knowledge base as JSON backup"
                icon={<Download className={cn("w-3.5 h-3.5", isExporting && "animate-pulse")} />}
              />
              <ToolbarIconButton
                onClick={() => fileInputRef.current?.click()}
                disabled={isImporting || isExporting}
                active={isImporting}
                tone="neutral"
                title="Import knowledge base from JSON backup"
                icon={<Upload className={cn("w-3.5 h-3.5", isImporting && "animate-pulse")} />}
              />
              <ToolbarIconButton
                onClick={handleReindex}
                disabled={isReindexing || isImporting}
                active={isReindexing}
                tone="fuchsia"
                title="Reindex all files for semantic search"
                icon={<RefreshCw className={cn("w-3.5 h-3.5", isReindexing && "animate-spin")} />}
                label={isReindexing ? "Indexing…" : "Reindex"}
              />
            </div>
          </div>

          {embeddingStats && (
            <div className="mt-1.5 text-[10px] text-gray-400 dark:text-neutral-500">
              {embeddingStats.totalChunks} chunks · {embeddingStats.totalFiles} files indexed
            </div>
          )}

          {isReindexing && reindexProgress && (
            <ProgressRow
              label={reindexProgress.currentFile}
              current={reindexProgress.current}
              total={reindexProgress.total}
              tone="fuchsia"
            />
          )}

          {isImporting && importProgress && (
            <ProgressRow
              label={importProgress.currentItem}
              current={importProgress.current}
              total={importProgress.total}
              tone="green"
            />
          )}

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
                  : `Import failed: ${importResult.errors[0]}`}
                {importResult.filesSkipped > 0 && ` (${importResult.filesSkipped} skipped)`}
              </span>
            </div>
          )}
        </div>

        {/* Tree view */}
        <div className="flex-1 overflow-y-auto p-2 min-h-0">
          {isLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="w-5 h-5 animate-spin text-fuchsia-500 dark:text-[#ff00ff]" />
            </div>
          ) : tree.length === 0 ? (
            <div className="text-center py-10 px-4">
              <Folder className="w-10 h-10 mx-auto text-gray-300 dark:text-neutral-700 mb-3" />
              <p className="text-gray-500 dark:text-neutral-400 text-sm font-medium">
                Your notebook is empty
              </p>
              <p className="text-gray-400 dark:text-neutral-500 text-xs mt-1 mb-4">
                Create your first note, or chat with Le Chat — it can write notes for you.
              </p>
              <button
                onClick={() => handleNewFile("/")}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-fuchsia-500 dark:bg-[#ff00ff] text-white hover:bg-fuchsia-600 dark:hover:bg-[#ff00ff]/90 transition-colors shadow-md shadow-fuchsia-500/20 dark:shadow-[#ff00ff]/20"
              >
                <FilePlus className="w-3.5 h-3.5" />
                New note
              </button>
            </div>
          ) : (
            tree.map((node) => renderNode(node))
          )}
        </div>

        {/* Editor pane */}
        {editorOpen && selectedFile && (
          <div
            className="border-t border-gray-200 dark:border-neutral-800 flex flex-col relative flex-shrink-0"
            style={{ height: editorHeight }}
          >
            <div
              onMouseDown={handleEditorMouseDown}
              className={cn(
                "absolute top-0 left-0 right-0 h-1 cursor-ns-resize z-20 transition-colors",
                isResizingEditor
                  ? "bg-fuchsia-500 dark:bg-[#ff00ff]"
                  : "bg-transparent hover:bg-fuchsia-300/60 dark:hover:bg-[#ff00ff]/30"
              )}
            />
            <NoteEditor
              key={selectedFile}
              filePath={selectedFile}
              onClose={() => setSelectedFile(null)}
              onRequestRename={() => {
                const node = findNode(tree, selectedFile);
                if (node) startRename(node);
              }}
            />
          </div>
        )}
      </div>
    );
  }
);
