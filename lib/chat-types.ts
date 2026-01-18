import type { UIMessage } from "ai";

export interface ChatConversation {
  id: string;
  title: string;
  /** Whether the user has manually renamed this conversation (prevents AI title updates) */
  userRenamed?: boolean;
  messages: UIMessage[];
  createdAt: number;
  updatedAt: number;
}

export interface ChatHistoryState {
  conversations: ChatConversation[];
  activeConversationId: string | null;
}
