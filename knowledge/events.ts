/**
 * Knowledge Base change events.
 *
 * A tiny in-process pub-sub used so UI panels can react instantly to
 * Knowledge Base mutations regardless of who made them: the user editing
 * a note in the sidebar, or the chat agent calling kb_write / kb_append /
 * kb_delete / kb_rename via tools.
 *
 * Both run in the same browser tab, so a simple emitter is enough.
 */

export type KnowledgeEventType =
  | "write"
  | "append"
  | "mkdir"
  | "delete"
  | "rename";

export interface KnowledgeEvent {
  type: KnowledgeEventType;
  /** Affected path (the new path for renames). */
  path: string;
  /** Previous path, only set for renames. */
  previousPath?: string;
  /** Source that triggered the change ("user" | "agent" | "system"). */
  source?: "user" | "agent" | "system";
  timestamp: number;
}

type Listener = (event: KnowledgeEvent) => void;

const listeners = new Set<Listener>();

export function subscribeKnowledge(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function emitKnowledgeEvent(event: Omit<KnowledgeEvent, "timestamp">): void {
  const full: KnowledgeEvent = { ...event, timestamp: Date.now() };
  for (const l of listeners) {
    try {
      l(full);
    } catch (err) {
      console.error("[knowledge/events] listener threw:", err);
    }
  }
}
