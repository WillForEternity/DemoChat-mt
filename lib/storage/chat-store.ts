import { openDB, type DBSchema, type IDBPDatabase } from "idb";
import type { ChatConversation, ChatHistoryState } from "@/lib/chat-types";
import type { UIMessage } from "ai";
import { embedChatIfChanged, deleteChatEmbeddings } from "./chat-embeddings-ops";

const DB_NAME = "chat_history_v1";
const DB_VERSION = 1;
const STORE_CONVERSATIONS = "conversations";
const STORE_META = "meta";

const SUMMARY_STORAGE_KEY = "chat-history-summary-v1";
const LEGACY_STORAGE_KEY = "chat-history";

interface ChatDbSchema extends DBSchema {
  conversations: {
    key: string;
    value: ChatConversation;
  };
  meta: {
    key: string;
    value: string | number | null;
  };
}

let dbPromise: Promise<IDBPDatabase<ChatDbSchema>> | null = null;

function getDb() {
  if (!dbPromise) {
    dbPromise = openDB<ChatDbSchema>(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains(STORE_CONVERSATIONS)) {
          db.createObjectStore(STORE_CONVERSATIONS, { keyPath: "id" });
        }
        if (!db.objectStoreNames.contains(STORE_META)) {
          db.createObjectStore(STORE_META);
        }
      },
    });
  }
  return dbPromise;
}

function normalizeState(state: ChatHistoryState): ChatHistoryState {
  return {
    conversations: [...state.conversations].sort(
      (a, b) => b.updatedAt - a.updatedAt
    ),
    activeConversationId: state.activeConversationId ?? null,
  };
}

/**
 * Check if a value is a non-serializable object (File, Blob, ArrayBuffer, etc.)
 * These cannot be stored in IndexedDB and will cause errors.
 */
function isNonSerializable(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  if (typeof value !== "object") return false;
  
  // Check for common non-serializable types
  if (typeof File !== "undefined" && value instanceof File) return true;
  if (typeof Blob !== "undefined" && value instanceof Blob) return true;
  if (typeof ArrayBuffer !== "undefined" && value instanceof ArrayBuffer) return true;
  if (typeof Uint8Array !== "undefined" && value instanceof Uint8Array) return true;
  
  return false;
}

/**
 * Deep clone a value while removing non-serializable objects.
 * This ensures messages can be safely stored in IndexedDB.
 */
function sanitizeValue(value: unknown): unknown {
  if (value === null || value === undefined) return value;
  
  // Remove non-serializable objects entirely
  if (isNonSerializable(value)) {
    return undefined;
  }
  
  // Handle arrays
  if (Array.isArray(value)) {
    return value.map(sanitizeValue).filter((v) => v !== undefined);
  }
  
  // Handle plain objects
  if (typeof value === "object") {
    const result: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
      // Skip properties that hold File/Blob objects
      // Common patterns: 'file', 'blob', 'buffer', 'arrayBuffer'
      if (key === "file" && isNonSerializable(val)) {
        continue;
      }
      const sanitized = sanitizeValue(val);
      if (sanitized !== undefined) {
        result[key] = sanitized;
      }
    }
    return result;
  }
  
  // Primitives are safe
  return value;
}

/**
 * Sanitize a UIMessage to remove non-serializable data.
 * This is necessary because the AI SDK may include File/Blob objects
 * in message parts (e.g., for image uploads) that IndexedDB cannot store.
 */
function sanitizeMessage(message: UIMessage): UIMessage {
  return sanitizeValue(message) as UIMessage;
}

/**
 * Sanitize a conversation's messages to ensure they can be stored in IndexedDB.
 */
function sanitizeConversation(conversation: ChatConversation): ChatConversation {
  return {
    ...conversation,
    messages: conversation.messages.map(sanitizeMessage),
  };
}

function readLegacyState(): ChatHistoryState | null {
  if (typeof window === "undefined") return null;
  const stored = localStorage.getItem(LEGACY_STORAGE_KEY);
  if (!stored) return null;
  try {
    const parsed = JSON.parse(stored) as ChatHistoryState;
    if (!Array.isArray(parsed.conversations)) return null;
    return {
      conversations: parsed.conversations.map((conv) => ({
        ...conv,
        messages: conv.messages ?? [],
      })),
      activeConversationId: parsed.activeConversationId ?? null,
    };
  } catch {
    return null;
  }
}

function persistSummary(state: ChatHistoryState) {
  if (typeof window === "undefined") return;
  const summary = {
    conversations: state.conversations.map((conv) => ({
      id: conv.id,
      title: conv.title,
      createdAt: conv.createdAt,
      updatedAt: conv.updatedAt,
      messages: [],
    })),
    activeConversationId: state.activeConversationId ?? null,
  } satisfies ChatHistoryState;
  localStorage.setItem(SUMMARY_STORAGE_KEY, JSON.stringify(summary));
}

export function readSummaryFromStorage(): ChatHistoryState {
  if (typeof window === "undefined") {
    return { conversations: [], activeConversationId: null };
  }
  try {
    const stored = localStorage.getItem(SUMMARY_STORAGE_KEY);
    if (!stored) {
      return { conversations: [], activeConversationId: null };
    }
    const parsed = JSON.parse(stored) as ChatHistoryState;
    if (!Array.isArray(parsed.conversations)) {
      return { conversations: [], activeConversationId: null };
    }
    return {
      conversations: parsed.conversations.map((conv) => ({
        ...conv,
        messages: conv.messages ?? [],
      })),
      activeConversationId: parsed.activeConversationId ?? null,
    };
  } catch {
    return { conversations: [], activeConversationId: null };
  }
}

export async function migrateLegacyStorageIfNeeded(): Promise<void> {
  if (typeof window === "undefined") return;
  const legacy = readLegacyState();
  if (!legacy) return;

  const db = await getDb();
  const existing = await db.count(STORE_CONVERSATIONS);
  if (existing > 0) return;

  const normalized = normalizeState(legacy);
  const tx = db.transaction([STORE_CONVERSATIONS, STORE_META], "readwrite");
  const conversationStore = tx.objectStore(STORE_CONVERSATIONS);
  normalized.conversations.forEach((conversation) => {
    conversationStore.put(conversation);
  });
  tx.objectStore(STORE_META).put(
    normalized.activeConversationId ?? null,
    "activeConversationId"
  );
  await tx.done;

  persistSummary(normalized);
  localStorage.removeItem(LEGACY_STORAGE_KEY);
}

export async function loadChatState(): Promise<ChatHistoryState> {
  if (typeof window === "undefined") {
    return { conversations: [], activeConversationId: null };
  }

  await migrateLegacyStorageIfNeeded();

  const db = await getDb();
  const conversations = await db.getAll(STORE_CONVERSATIONS);
  const activeConversationId =
    (await db.get(STORE_META, "activeConversationId")) ?? null;
  return normalizeState({
    conversations,
    activeConversationId: activeConversationId as string | null,
  });
}

export async function saveChatState(state: ChatHistoryState): Promise<void> {
  if (typeof window === "undefined") return;
  const db = await getDb();
  const normalized = normalizeState(state);

  // Sanitize all conversations to remove non-serializable data (File, Blob, etc.)
  // This prevents IndexedDB errors when storing messages with image uploads
  const sanitizedConversations = normalized.conversations.map(sanitizeConversation);

  const tx = db.transaction([STORE_CONVERSATIONS, STORE_META], "readwrite");
  const conversationStore = tx.objectStore(STORE_CONVERSATIONS);
  const existingKeys = await conversationStore.getAllKeys();
  const nextKeys = new Set(sanitizedConversations.map((conv) => conv.id));

  sanitizedConversations.forEach((conversation) => {
    conversationStore.put(conversation);
  });

  // Track deleted conversations for embedding cleanup
  const deletedKeys: string[] = [];
  existingKeys.forEach((key) => {
    if (!nextKeys.has(String(key))) {
      conversationStore.delete(key);
      deletedKeys.push(String(key));
    }
  });

  tx.objectStore(STORE_META).put(
    normalized.activeConversationId ?? null,
    "activeConversationId"
  );
  await tx.done;

  persistSummary(normalized);

  // Auto-embed conversations in background (non-blocking)
  // Uses hash-based caching so unchanged content won't re-embed
  for (const conversation of sanitizedConversations) {
    embedChatIfChanged(conversation).catch((error) => {
      console.error("[ChatStore] Failed to embed conversation:", error);
    });
  }

  // Clean up embeddings for deleted conversations
  for (const deletedId of deletedKeys) {
    deleteChatEmbeddings(deletedId).catch((error) => {
      console.error("[ChatStore] Failed to delete embeddings:", error);
    });
  }
}

export async function clearChatState(): Promise<void> {
  if (typeof window === "undefined") return;
  const db = await getDb();
  const tx = db.transaction([STORE_CONVERSATIONS, STORE_META], "readwrite");
  await tx.objectStore(STORE_CONVERSATIONS).clear();
  await tx.objectStore(STORE_META).clear();
  await tx.done;
  persistSummary({ conversations: [], activeConversationId: null });
}
