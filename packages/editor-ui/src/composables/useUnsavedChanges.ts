/**
 * Guards an editor against losing work — on navigation and on tab close.
 *
 * Dirtiness is *derived* by comparing the form against the last saved snapshot
 * rather than tracked with a flag a deep watcher sets. A watcher gets this
 * wrong twice over: it flushes on the next tick, so it fires after the load has
 * already cleared the flag (a freshly opened entry looked edited), and it fires
 * for writes that change nothing, since every keystroke path rebuilds the
 * object it passes up.
 */

import { computed, onMounted, onUnmounted, ref, type ComputedRef, type Ref } from "vue";
import { onBeforeRouteLeave, onBeforeRouteUpdate } from "vue-router";

import { useSession } from "@/stores/session";

const PROMPT = "You have unsaved changes. Leave without saving?";

export interface UnsavedChanges {
  dirty: ComputedRef<boolean>;
  /** Take the current values as the reference point — nothing to warn about. */
  markClean: () => void;
  /** Stop guarding for good, e.g. once the record has been deleted. */
  release: () => void;
}

export function useUnsavedChanges(values: Ref<Record<string, unknown>>): UnsavedChanges {
  const baseline = ref(snapshot(values.value));
  const guarded = ref(true);

  const dirty = computed(() => guarded.value && snapshot(values.value) !== baseline.value);

  function markClean(): void {
    baseline.value = snapshot(values.value);
  }

  function release(): void {
    guarded.value = false;
  }

  // The browser's own prompt is the only thing that can stop a tab close. A sign-in
  // redirect needs none: the form kept its changes in this tab (`useKeptChanges`).
  const session = useSession();
  function beforeUnload(event: BeforeUnloadEvent): void {
    if (dirty.value && !session.leaving.value) event.preventDefault();
  }

  onMounted(() => window.addEventListener("beforeunload", beforeUnload));
  onUnmounted(() => window.removeEventListener("beforeunload", beforeUnload));

  // Leaving covers a different route; updating covers another record on this
  // same route, which reuses the component and so never counts as leaving.
  const confirmLeave = (): boolean => !dirty.value || window.confirm(PROMPT);
  onBeforeRouteLeave(confirmLeave);
  onBeforeRouteUpdate(confirmLeave);

  return { dirty, markClean, release };
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
