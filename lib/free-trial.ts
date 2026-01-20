/**
 * Free Trial Management
 *
 * Tracks the number of free chats users can have before needing to
 * provide their own API key or log in.
 *
 * The free trial uses the owner's API key for the first 5 chats,
 * then requires users to either:
 * 1. Log in with an owner account (unlimited free access)
 * 2. Provide their own API key
 */

const STORAGE_KEY = "chatnoir-free-trial";
const FREE_CHAT_LIMIT = 5;

interface FreeTrialState {
  chatCount: number;
  lastUpdated: number;
}

/**
 * Get the current free trial state from localStorage
 */
function getTrialState(): FreeTrialState {
  if (typeof window === "undefined") {
    return { chatCount: 0, lastUpdated: Date.now() };
  }

  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (!stored) {
      return { chatCount: 0, lastUpdated: Date.now() };
    }
    return JSON.parse(stored) as FreeTrialState;
  } catch {
    return { chatCount: 0, lastUpdated: Date.now() };
  }
}

/**
 * Save the free trial state to localStorage
 */
function saveTrialState(state: FreeTrialState): void {
  if (typeof window === "undefined") {
    return;
  }

  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (error) {
    console.error("[Free Trial] Failed to save state:", error);
  }
}

/**
 * Get the number of free chats used
 */
export function getFreeChatCount(): number {
  return getTrialState().chatCount;
}

/**
 * Get the maximum number of free chats allowed
 */
export function getFreeChatLimit(): number {
  return FREE_CHAT_LIMIT;
}

/**
 * Get the number of free chats remaining
 */
export function getFreeChatsRemaining(): number {
  const used = getFreeChatCount();
  return Math.max(0, FREE_CHAT_LIMIT - used);
}

/**
 * Check if user has free chats remaining
 */
export function hasFreeChatRemaining(): boolean {
  return getFreeChatsRemaining() > 0;
}

/**
 * Increment the free chat count and return the new count
 */
export function incrementFreeChatCount(): number {
  const state = getTrialState();
  const newState: FreeTrialState = {
    chatCount: state.chatCount + 1,
    lastUpdated: Date.now(),
  };
  saveTrialState(newState);
  return newState.chatCount;
}

/**
 * Reset the free chat count (e.g., for testing or admin purposes)
 */
export function resetFreeChatCount(): void {
  if (typeof window === "undefined") {
    return;
  }

  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch (error) {
    console.error("[Free Trial] Failed to reset count:", error);
  }
}

/**
 * Check if the user needs to provide an API key
 * Returns true if free trial is exhausted and user hasn't provided keys
 * @param hasUserApiKey - Whether the user has provided their own API key
 * @param isOwner - Whether the user is an owner with free access
 */
export function needsApiKey(hasUserApiKey: boolean, isOwner: boolean): boolean {
  // Owners always have access
  if (isOwner) {
    return false;
  }

  // Users with their own API key have access
  if (hasUserApiKey) {
    return false;
  }

  // Check if free trial is exhausted
  return !hasFreeChatRemaining();
}
