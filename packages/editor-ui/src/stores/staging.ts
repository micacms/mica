/**
 * The pending change set, shared between the sidebar badge, the dashboard and
 * the Publish view.
 *
 * One module-level state, like the schema store: everybody who asks sees the
 * same answer, and a refresh after a save updates the badge without the shell
 * polling anything.
 */

import { computed, ref } from "vue";

import { api, type StagingStatus } from "@/api";
import { toEdits } from "@/lib/edits";

const status = ref<StagingStatus | null>(null);
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
    })
    .catch(() => {
      // The badge is a convenience. A failed refresh must not toast on
      // every navigation; the Publish view reports its own errors.
    })
    .finally(() => {
      inFlight = null;
    });
  return inFlight;
}

export function useStaging() {
  return {
    status: computed(() => status.value),
    /** The pending set as an editor reads it: one edit per entry, singleton, order or media. */
    edits,
    editCount: computed(() => edits.value.length),
    /**
     * Whether "no pending edit" means "on the website": the list is loaded, there
     * is a repository, and no publication waits to be sent.
     */
    knowsPublished: computed(
      () => status.value !== null && status.value.head !== null && (status.value.unpushed?.mica ?? 0) === 0,
    ),

    /** Failures leave the last answer. */
    refresh,

    reset(): void {
      status.value = null;
      inFlight = null;
      queued = null;
    },
  };
}
