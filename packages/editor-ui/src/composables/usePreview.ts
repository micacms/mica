/**
 * The website's dev server, for "Preview". Asked when a form opens and when
 * the window gets the focus again, so that a dev server started in the
 * meantime shows up. A preview on an origin of its own, as in the self-hosted
 * Mica, gets a short token first: the preview gives the browser a cookie of its
 * origin for ten minutes. A key or a click after five minutes renews it; an
 * unattended tab does not, so that the idle limit still ends its session.
 */

import { onBeforeUnmount, onMounted, ref } from "vue";

import { api } from "@/api";

/** Half of the preview cookie's ten minutes. */
const RENEW_MS = 5 * 60_000;
const ACTIVITY = ["keydown", "pointerdown"] as const;

export function usePreview() {
  const address = ref<string | null>(null);

  /** When the preview's cookie was last given, or 0 when the preview needs none. */
  let handedAt = 0;

  const load = async () => {
    try {
      const preview = await api.preview();
      if (preview.address && preview.handover) {
        const answer = await fetch(`${preview.address}/__mica/session`, { method: "POST", credentials: "include", body: preview.handover });
        if (!answer.ok) throw new Error("The preview did not take the sign-in.");
        handedAt = Date.now();
      } else handedAt = 0;
      address.value = preview.address;
    } catch {
      address.value = null;
    }
  };
  const renew = () => {
    if (handedAt && Date.now() - handedAt > RENEW_MS) void load();
  };

  onMounted(() => {
    void load();
    window.addEventListener("focus", load);
    for (const name of ACTIVITY) window.addEventListener(name, renew, true);
  });
  onBeforeUnmount(() => {
    window.removeEventListener("focus", load);
    for (const name of ACTIVITY) window.removeEventListener(name, renew, true);
  });

  return { address };
}
