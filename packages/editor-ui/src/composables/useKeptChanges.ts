/**
 * Unsaved form values, kept in this tab's `sessionStorage` while the form has
 * changes, so that a sign-in redirect (or a reload) does not lose them. The
 * revision goes with them: restoring onto a version that somebody saved since
 * gives the save conflict, not a silent overwrite. Storage can be missing or
 * full; then nothing is kept, and the form works as before. The write waits
 * for a pause in the typing, and happens at once when the page goes away.
 */

import { onMounted, onUnmounted, ref, toRaw, watch, type Ref } from "vue";

import type { UnsavedChanges } from "@/composables/useUnsavedChanges";
import { debounce } from "@/lib/debounce";
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
  unsaved: Pick<UnsavedChanges, "dirty" | "flush">,
) {
  const { dirty } = unsaved;
  /** Changes this tab kept from before, which differ from the form as loaded. */
  const offered = ref<Kept | null>(null);
  const session = useSession();

  // Nothing is removed here: this can run after a load and before `check`.
  function keepNow(): void {
    if (dirty.value) write(key(), { values: values.value, revision: revision.value, at: new Date().toISOString() });
  }
  const keepSoon = debounce(keepNow, 500);

  watch(
    [values, dirty],
    () => {
      if (!dirty.value) return;
      // Editing on without restoring is the editor's answer to the offer.
      offered.value = null;
      keepSoon();
    },
    { deep: true },
  );

  // A sign-in redirect, a reload or a closed tab: keep the current text now.
  function onPageHide(): void {
    unsaved.flush();
    keepSoon.cancel();
    keepNow();
  }
  onMounted(() => window.addEventListener("pagehide", onPageHide));

  /** A save that runs after the form closed: the tab keeps the changes until it succeeds (`forget`). */
  let keepForSave = false;

  // Leaving the page in the app (after "Leave without saving", or a delete) gives the
  // changes up. A sign-in redirect or a closed tab does not unmount, so they stay.
  onUnmounted(() => {
    window.removeEventListener("pagehide", onPageHide);
    if (session.leaving.value || keepForSave) {
      keepSoon.flush();
      return;
    }
    keepSoon.cancel();
    write(key(), null);
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
    /** Keeps the changes now, also after the form closes: an autosave on leaving is still on its way. */
    holdForSave(): void {
      keepForSave = true;
      keepSoon.cancel();
      keepNow();
    },
    /** After a save or a discard, or when the editor declines: nothing to keep. */
    forget(): void {
      offered.value = null;
      keepSoon.cancel();
      write(key(), null);
    },
  };
}
