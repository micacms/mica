/**
 * Whether the server answers. An open tab sends no request by itself, so it
 * asks from time to time: a stopped Mica then shows as stopped, not as a form
 * that cannot save. A hidden tab does not ask, and asks again when it shows.
 */

import { computed, ref } from "vue";

import { api } from "@/api";

/** How often a visible tab asks while the server answers. */
const CHECK_MS = 10_000;
/** How often it asks while the server does not answer. */
const RETRY_MS = 3_000;

const reachable = ref(true);
let timer: number | undefined;
let checking: Promise<void> | null = null;
let started = false;

function schedule(): void {
  window.clearTimeout(timer);
  if (document.visibilityState === "hidden") return;
  timer = window.setTimeout(() => void check(), reachable.value ? CHECK_MS : RETRY_MS);
}

/** Asks the server now. Calls at the same time share one request. */
function check(): Promise<void> {
  checking ??= api
    .health()
    .then((answers) => {
      reachable.value = answers;
    })
    .finally(() => {
      checking = null;
      schedule();
    });
  return checking;
}

function onVisible(): void {
  if (document.visibilityState === "visible") void check();
}

export function useConnection() {
  return {
    reachable: computed(() => reachable.value),
    check,

    /** Starts the checks, once for the tab. */
    start(): void {
      if (started) return;
      started = true;
      document.addEventListener("visibilitychange", onVisible);
      window.addEventListener("focus", onVisible);
      schedule();
    },
  };
}
