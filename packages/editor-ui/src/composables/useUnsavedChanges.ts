/**
 * Guards an editor against losing work — on navigation and on tab close.
 *
 * Dirtiness is *derived* by comparing the form against the last saved snapshot
 * rather than tracked with a flag a deep watcher sets. A watcher gets this
 * wrong twice over: it flushes on the next tick, so it fires after the load has
 * already cleared the flag (a freshly opened entry looked edited), and it fires
 * for writes that change nothing, since every keystroke path rebuilds the
 * object it passes up.
 *
 * A field can hold an edit back for a moment (`PENDING_EDITS`, provided here
 * for the form's fields). The checks flush it first, so they see the current text.
 *
 * With autosave, leaving asks nothing when `saveOnLeave` saves the changes.
 */

import { computed, onMounted, onUnmounted, provide, ref, type ComputedRef, type Ref } from "vue";
import { onBeforeRouteLeave, onBeforeRouteUpdate } from "vue-router";

import { onlyOverlayChanged } from "@/lib/overlay-address";
import { createPendingEdits, PENDING_EDITS } from "@/lib/pending-edits";
import { useSession } from "@/stores/session";

export const PROMPT = "You have unsaved changes. Leave without saving?";

export interface UnsavedChanges {
  dirty: ComputedRef<boolean>;
  /** Take the current values, or the values that a save wrote, as the reference point. */
  markClean: (saved?: Record<string, unknown>) => void;
  /** Whether `data` is what is saved. */
  isSaved: (data: Record<string, unknown>) => boolean;
  /** Stop guarding for good, e.g. once the record has been deleted. */
  release: () => void;
  /** Gives the form the edits that its fields hold back. Call it before a save reads the values. */
  flush: () => void;
}

export function useUnsavedChanges(
  values: Ref<Record<string, unknown>>,
  /** Starts the save of the changes on leaving; false when it cannot save them, and the editor must be asked. */
  saveOnLeave?: () => boolean,
): UnsavedChanges {
  const baseline = ref(snapshot(values.value));
  const guarded = ref(true);
  const pending = createPendingEdits();
  provide(PENDING_EDITS, pending);

  const dirty = computed(() => guarded.value && snapshot(values.value) !== baseline.value);

  function markClean(saved: Record<string, unknown> = values.value): void {
    baseline.value = snapshot(saved);
  }

  const isSaved = (data: Record<string, unknown>): boolean => snapshot(data) === baseline.value;

  function release(): void {
    guarded.value = false;
  }

  // The browser's own prompt is the only thing that can stop a tab close. A sign-in
  // redirect needs none: the form kept its changes in this tab (`useKeptChanges`).
  const session = useSession();
  function beforeUnload(event: BeforeUnloadEvent): void {
    pending.flush();
    if (dirty.value && !session.leaving.value) event.preventDefault();
  }

  onMounted(() => window.addEventListener("beforeunload", beforeUnload));
  onUnmounted(() => window.removeEventListener("beforeunload", beforeUnload));

  // Leaving covers a different route; updating covers another record on this
  // same route, which reuses the component and so never counts as leaving.
  const confirmLeave = (): boolean => {
    pending.flush();
    return !dirty.value || !!saveOnLeave?.() || window.confirm(PROMPT);
  };
  onBeforeRouteLeave(confirmLeave);
  // The overlay form opens over the form, which stays: nothing is left.
  onBeforeRouteUpdate((to, from) => onlyOverlayChanged(to, from) || confirmLeave());

  return { dirty, markClean, isSaved, release, flush: pending.flush };
}

/**
 * Canonical JSON: keys sorted so a rebuilt object compares equal, and holes
 * left as holes so an absent value and an explicit `undefined` do too.
 */
function snapshot(values: unknown): string {
  return JSON.stringify(values, (_key, value: unknown) => {
    if (value === null || typeof value !== "object" || Array.isArray(value)) return value;

    const entries = value as Record<string, unknown>;
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(entries).sort()) sorted[key] = entries[key];
    return sorted;
  });
}
