/**
 * The pending change set, shared between the sidebar badge, the dashboard and
 * the Publish view.
 *
 * One module-level state, like the schema store: everybody who asks sees the
 * same answer, and a refresh after a save updates the badge without the shell
 * polling anything.
 */

import { computed, ref } from "vue";

import { api, messageOf, type StagingStatus } from "@/api";
import { toEdits } from "@/lib/edits";

const status = ref<StagingStatus | null>(null);
/** Why the last refresh failed, or null. */
const error = ref<string | null>(null);
const edits = computed(() => toEdits(status.value?.changes ?? []));
let inFlight: Promise<void> | null = null;
let queued: Promise<void> | null = null;

/**
 * Asks for the list again. A call while a request runs gets one more request
 * after it, so that a write that just finished is in the answer; further calls
 * meanwhile share that one.
 */
function refresh(): Promise<void> {
  if (inFlight) {
    queued ??= inFlight.then(() => {
      queued = null;
      return refresh();
    });
    return queued;
  }
  inFlight = api.staging
    .changes()
    .then((result) => {
      status.value = result;
      error.value = null;
    })
    .catch((failure: unknown) => {
      // The badge is a convenience. A failed refresh must not toast on
      // every navigation; the Publish view shows `error`.
      error.value = messageOf(failure, "Something went wrong.");
    })
    .finally(() => {
      inFlight = null;
    });
  return inFlight;
}

export function useStaging() {
  return {
    status: computed(() => status.value),
    error: computed(() => error.value),
    /** The pending set as an editor reads it: one edit per entry, singleton, order or media. */
    edits,
    editCount: computed(() => edits.value.length),

    /** Failures leave the last answer. */
    refresh,

    reset(): void {
      status.value = null;
      error.value = null;
      inFlight = null;
      queued = null;
    },
  };
}
