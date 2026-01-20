/**
 * API Keys Management
 *
 * Client-side utilities for storing and retrieving user API keys.
 * Keys are stored in localStorage and sent with each API request.
 *
 * SECURITY NOTE:
 * - Keys are stored only in the browser's localStorage
 * - Keys are sent to your own API routes, not directly to third parties
 * - Keys are never persisted on your server
 * - When a userId is provided, keys are stored per-user for isolation on shared devices
 */

const STORAGE_KEY_BASE = "chatnoir-api-keys";

/**
 * Get the storage key for API keys, optionally scoped to a user
 */
function getStorageKey(userId?: string): string {
  if (userId) {
    return `${STORAGE_KEY_BASE}-${userId}`;
  }
  return STORAGE_KEY_BASE;
}

export interface StoredApiKeys {
  anthropicApiKey?: string;
  openaiApiKey?: string;
  /** Cohere API key for reranking (optional, improves RAG accuracy by 20-40%) */
  cohereApiKey?: string;
}

/**
 * Get stored API keys from localStorage
 * @param userId - Optional user ID to scope keys to a specific user
 */
export function getApiKeys(userId?: string): StoredApiKeys {
  if (typeof window === "undefined") {
    return {};
  }

  try {
    const storageKey = getStorageKey(userId);
    const stored = localStorage.getItem(storageKey);
    if (!stored) {
      // If no user-specific keys and userId provided, fall back to anonymous keys
      if (userId) {
        const anonymousKeys = localStorage.getItem(STORAGE_KEY_BASE);
        if (anonymousKeys) {
          return JSON.parse(anonymousKeys) as StoredApiKeys;
        }
      }
      return {};
    }
    return JSON.parse(stored) as StoredApiKeys;
  } catch {
    return {};
  }
}

/**
 * Save API keys to localStorage
 * @param keys - The API keys to save
 * @param userId - Optional user ID to scope keys to a specific user
 */
export function saveApiKeys(keys: StoredApiKeys, userId?: string): void {
  if (typeof window === "undefined") {
    return;
  }

  try {
    const storageKey = getStorageKey(userId);
    // Merge with existing keys (don't overwrite keys not provided)
    const existing = getApiKeys(userId);
    const merged = { ...existing, ...keys };

    // Remove empty strings
    if (!merged.anthropicApiKey) delete merged.anthropicApiKey;
    if (!merged.openaiApiKey) delete merged.openaiApiKey;
    if (!merged.cohereApiKey) delete merged.cohereApiKey;

    localStorage.setItem(storageKey, JSON.stringify(merged));
  } catch (error) {
    console.error("[API Keys] Failed to save keys:", error);
  }
}

/**
 * Clear all stored API keys
 * @param userId - Optional user ID to clear keys for a specific user
 */
export function clearApiKeys(userId?: string): void {
  if (typeof window === "undefined") {
    return;
  }

  try {
    const storageKey = getStorageKey(userId);
    localStorage.removeItem(storageKey);
  } catch (error) {
    console.error("[API Keys] Failed to clear keys:", error);
  }
}

/**
 * Check if user has configured their API keys
 * @param userId - Optional user ID to check keys for a specific user
 */
export function hasApiKeys(userId?: string): boolean {
  const keys = getApiKeys(userId);
  return Boolean(keys.anthropicApiKey || keys.openaiApiKey);
}

/**
 * Check if user has a specific API key
 * @param userId - Optional user ID to check keys for a specific user
 */
export function hasAnthropicKey(userId?: string): boolean {
  return Boolean(getApiKeys(userId).anthropicApiKey);
}

export function hasOpenAIKey(userId?: string): boolean {
  return Boolean(getApiKeys(userId).openaiApiKey);
}

export function hasCohereKey(userId?: string): boolean {
  return Boolean(getApiKeys(userId).cohereApiKey);
}

/**
 * Migrate anonymous keys to user-specific storage when user logs in
 * This allows keys entered before login to persist after login
 * @param userId - The user ID to migrate keys to
 */
export function migrateAnonymousKeys(userId: string): void {
  if (typeof window === "undefined") {
    return;
  }

  try {
    const anonymousKeys = localStorage.getItem(STORAGE_KEY_BASE);
    const userStorageKey = getStorageKey(userId);
    const userKeys = localStorage.getItem(userStorageKey);

    // Only migrate if there are anonymous keys and no user-specific keys
    if (anonymousKeys && !userKeys) {
      localStorage.setItem(userStorageKey, anonymousKeys);
      // Optionally clear anonymous keys after migration
      // localStorage.removeItem(STORAGE_KEY_BASE);
    }
  } catch (error) {
    console.error("[API Keys] Failed to migrate keys:", error);
  }
}
