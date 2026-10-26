/**
 * A write refused with a 409: somebody saved this entry or these settings
 * since the form opened. The states:
 *
 * - `none`: no conflict, or it is resolved.
 * - `loading`: their saved version is on its way.
 * - `loaded`: both versions are shown. "Keep mine" saves over theirs, at
 *   their revision; "Use theirs" opens their version.
 * - `missing`: their version is gone, deleted or moved to another ID.
 *
 * Nothing is merged: which version stays is the editor's decision.
 */

import { ref, shallowRef } from "vue";

import { ApiError } from "@/api";

export type ConflictState = "none" | "loading" | "loaded" | "missing";

/** A saved version of a document, as the API reads it. */
export interface SavedVersion {
  data: Record<string, unknown>;
  revision: string | null;
}

/** What a save sends: the revision it is based on, and whether it overwrites a newer version on purpose. */
export interface SaveBasis {
  revision: string | null;
  keepMine: boolean;
}

/**
 * How a write ended. `conflict`: their version is shown, or it is missing.
 * `refused`: a 409, but this document is as the form opened it, so the
 * conflict is elsewhere, such as in an entry whose links were to follow.
 */
export type WriteOutcome<Result> = { kind: "done"; result: Result } | { kind: "conflict" } | { kind: "refused"; message: string };

export function useSaveConflict<Version extends SavedVersion>(read: () => Promise<Version>) {
  const state = ref<ConflictState>("none");
  const theirs = shallowRef<Version | null>(null);
  // Only the last request may change the state: an earlier one can answer later.
  let attempt = 0;

  /** Back to `none`, after a save, a load or a choice. */
  function clear(): void {
    attempt++;
    state.value = "none";
    theirs.value = null;
  }

  /** Loads their version. `opened`: the revision the form was opened at. False when theirs is still that one. */
  async function show(opened: string | null): Promise<boolean> {
    const current = ++attempt;
    state.value = "loading";
    theirs.value = null;
    try {
      const found = await read();
      if (current !== attempt) return true;
      if (found.revision === opened) {
        clear();
        return false;
      }
      theirs.value = found;
      state.value = "loaded";
    } catch {
      if (current === attempt) state.value = "missing";
    }
    return true;
  }

  /** The basis of a save. "Keep mine" goes at their revision, and only while their version is shown. */
  function basis(opened: string | null, keepMine = false): SaveBasis {
    return keepMine && state.value === "loaded" && theirs.value
      ? { revision: theirs.value.revision, keepMine: true }
      : { revision: opened, keepMine: false };
  }

  /** Runs a write. A 409 shows their version; any other failure is thrown. */
  async function run<Result>(opened: string | null, send: () => Promise<Result>): Promise<WriteOutcome<Result>> {
    try {
      const result = await send();
      clear();
      return { kind: "done", result };
    } catch (error) {
      if (!(error instanceof ApiError && error.code === "conflict")) throw error;
      return (await show(opened)) ? { kind: "conflict" } : { kind: "refused", message: error.message };
    }
  }

  return { state, theirs, clear, show, basis, run };
}
