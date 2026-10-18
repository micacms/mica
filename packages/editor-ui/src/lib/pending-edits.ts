/**
 * Edits that a field holds back for a moment, such as rich text that it
 * converts only when the typing pauses. A form flushes them before it saves,
 * leaves the page or keeps its changes, so that it always uses the current text.
 */

import type { InjectionKey } from "vue";

export interface PendingEdits {
  /** Adds a field's flush. Returns the function that removes it. */
  add(flush: () => void): () => void;
  /** Gives the form every edit that a field holds back. */
  flush(): void;
}

export const PENDING_EDITS: InjectionKey<PendingEdits> = Symbol("pending edits");

export function createPendingEdits(): PendingEdits {
  const flushes = new Set<() => void>();
  return {
    add(flush) {
      flushes.add(flush);
      return () => flushes.delete(flush);
    },
    flush() {
      for (const flush of flushes) flush();
    },
  };
}
