/**
 * Unsaved form values, kept in this tab's `sessionStorage` while the form has
 * changes, so that a sign-in redirect (or a reload) does not lose them. The
 * revision goes with them: restoring onto a version that somebody saved since
 * gives the save conflict, not a silent overwrite. Storage can be missing or
 * full; then nothing is kept, and the form works as before.
 */

import { onUnmounted, ref, toRaw, watch, type ComputedRef, type Ref } from "vue";

import { useSession } from "@/stores/session";

interface Kept {
  values: Record<string, unknown>;
  revision: string | null;
  at: string;
}

const PREFIX = "mica:kept:";

function read(key: string): Kept | null {
  try {
    const raw = window.sessionStorage.getItem(PREFIX + key);
    return raw ? (JSON.parse(raw) as Kept) : null;
  } catch {
    return null;
  }
}

function write(key: string, kept: Kept | null): void {
  try {
    if (kept) window.sessionStorage.setItem(PREFIX + key, JSON.stringify(kept));
    else window.sessionStorage.removeItem(PREFIX + key);
  } catch {
    // Private mode or a full storage: the changes stay in the form only.
  }
}

export function useKeptChanges(
  key: () => string,
  values: Ref<Record<string, unknown>>,
  revision: Ref<string | null>,
  dirty: ComputedRef<boolean>,
) {
  /** Changes this tab kept from before, which differ from the form as loaded. */
  const offered = ref<Kept | null>(null);
  const session = useSession();

  watch(
    [values, dirty],
    () => {
      // Nothing is removed here: the watcher can run after a load and before `check`.
      // Editing on without restoring is the editor's answer to the offer.
      if (!dirty.value) return;
      offered.value = null;
      write(key(), { values: values.value, revision: revision.value, at: new Date().toISOString() });
    },
    { deep: true },
  );

  // Leaving the page in the app (after "Leave without saving", or a delete) gives the
  // changes up. A sign-in redirect or a closed tab does not unmount, so they stay.
  onUnmounted(() => {
    if (!session.leaving.value) write(key(), null);
  });

  return {
    offered,
    /** After the form has loaded: offer what was kept, if it is not what the form shows now. */
    check(): void {
      const kept = read(key());
      offered.value = kept && JSON.stringify(kept.values) !== JSON.stringify(values.value) ? kept : null;
      if (!offered.value) write(key(), null);
    },
    /** Puts the kept values back, with the revision they were based on. */
    restore(): void {
      if (!offered.value) return;
      // The ref holds a reactive proxy, which `structuredClone` cannot copy.
      const kept = toRaw(offered.value);
      values.value = structuredClone(kept.values);
      revision.value = kept.revision;
      offered.value = null;
    },
    /** After a save or a discard, or when the editor declines: nothing to keep. */
    forget(): void {
      offered.value = null;
      write(key(), null);
    },
  };
}
