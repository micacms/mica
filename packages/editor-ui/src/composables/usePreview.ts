/**
 * The website's dev server, for "Preview", and its state for the menu: off,
 * starting, live or stopped. One module-level state, like the stores: the menu
 * shows it, and each form takes its address.
 *
 * Asked when the shell or a form opens and when the window gets the focus
 * again, so that a dev server started in the meantime shows up. While the
 * preview starts, it asks again every few seconds, and only then: an editor
 * that nobody uses sends no requests, so that an idle Mica can sleep (ADR 39).
 *
 * A preview on an origin of its own, as in the self-hosted Mica, gets a short
 * token first: the preview gives the browser a cookie of its origin for ten
 * minutes. A key or a click after five minutes renews it; an unattended tab
 * does not, so that the idle limit still ends its session.
 */

import { computed, onBeforeUnmount, onMounted, ref } from "vue";

import { api, type PreviewStatus } from "@/api";

/** Half of the preview cookie's ten minutes. */
const RENEW_MS = 5 * 60_000;
/** How often a preview that starts is asked again. */
const POLL_MS = 5_000;
const ACTIVITY = ["keydown", "pointerdown"] as const;

const status = ref<PreviewStatus>({ state: "off", address: null, detail: null });
const loaded = ref(false);

/** When the preview's cookie was last given, or 0 when the preview needs none. */
let handedAt = 0;
let inFlight: Promise<void> | null = null;
let poll: ReturnType<typeof setTimeout> | undefined;
let users = 0;

function schedule(): void {
  clearTimeout(poll);
  if (status.value.state === "starting" && document.visibilityState === "visible") poll = setTimeout(() => void load(), POLL_MS);
}

function load(): Promise<void> {
  inFlight ??= (async () => {
    try {
      const preview = await api.preview();
      if (preview.state === "live" && preview.address && preview.handover) {
        const answer = await fetch(`${preview.address}/__mica/session`, { method: "POST", credentials: "include", body: preview.handover });
        if (!answer.ok) throw new Error("The preview did not take the sign-in.");
        handedAt = Date.now();
      } else handedAt = 0;
      status.value = { state: preview.state, address: preview.state === "live" ? preview.address : null, detail: preview.detail };
    } catch {
      status.value = { state: "stopped", address: null, detail: "Mica could not reach the preview. Load the page again." };
    } finally {
      loaded.value = true;
      inFlight = null;
      schedule();
    }
  })();
  return inFlight;
}

const renew = () => {
  if (handedAt && Date.now() - handedAt > RENEW_MS) void load();
};
const onVisible = () => {
  if (document.visibilityState === "visible") void load();
};

export function usePreview() {
  onMounted(() => {
    void load();
    if (users++ > 0) return;
    window.addEventListener("focus", load);
    document.addEventListener("visibilitychange", onVisible);
    for (const name of ACTIVITY) window.addEventListener(name, renew, true);
  });
  onBeforeUnmount(() => {
    if (--users > 0) return;
    clearTimeout(poll);
    window.removeEventListener("focus", load);
    document.removeEventListener("visibilitychange", onVisible);
    for (const name of ACTIVITY) window.removeEventListener(name, renew, true);
  });

  return {
    status: computed(() => status.value),
    /** Known after the first answer, so that the menu does not show "off" for a moment. */
    loaded: computed(() => loaded.value),
    address: computed(() => status.value.address),
  };
}

/** For a part that only shows the state, outside a component's life. */
export const previewStatus = computed(() => status.value);
