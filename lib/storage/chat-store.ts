import { openDB, type DBSchema, type IDBPDatabase } from "idb";
import type { ChatConversation, ChatHistoryState } from "@/lib/chat-types";

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

  const tx = db.transaction([STORE_CONVERSATIONS, STORE_META], "readwrite");
  const conversationStore = tx.objectStore(STORE_CONVERSATIONS);
  const existingKeys = await conversationStore.getAllKeys();
  const nextKeys = new Set(normalized.conversations.map((conv) => conv.id));

  normalized.conversations.forEach((conversation) => {
    conversationStore.put(conversation);
  });

  existingKeys.forEach((key) => {
    if (!nextKeys.has(String(key))) {
      conversationStore.delete(key);
    }
  });

  tx.objectStore(STORE_META).put(
    normalized.activeConversationId ?? null,
    "activeConversationId"
  );
  await tx.done;

  persistSummary(normalized);
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
