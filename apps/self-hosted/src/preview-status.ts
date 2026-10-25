/**
 * The state of the self-hosted preview, for the editor (ADR 38, 39). Mica sees
 * only whether the preview container answers: it cannot write to Mica's volume.
 * So a preview that does not answer is starting for some minutes, as after a
 * start of both or while it installs, and after that it is stopped. The texts
 * are for editors: they name no dev server and no container.
 */

import type { PreviewStatus } from "@micacms/runtime";

/** Short enough that a preview that just started shows soon, long enough to not ask on each request. */
const CACHE_MS = 3000;

/** A first install can take some minutes; after that, a preview that does not answer is stopped. */
export const STOPPED_AFTER_MS = 5 * 60_000;

export interface UpstreamPreviewOptions {
  /** `MICA_PREVIEW_UPSTREAM`: the dev server in the network. */
  upstream: string;
  /** The preview's origin, which the editor shows. */
  address: string;
  fetcher?: typeof fetch;
  now?: () => number;
}

export function upstreamPreview(options: UpstreamPreviewOptions): () => Promise<PreviewStatus> {
  const fetcher = options.fetcher ?? fetch;
  const now = options.now ?? Date.now;
  /** Since when the preview has not answered: Mica's start, or the last answer. */
  let quietSince = now();
  let cached: { at: number; status: Promise<PreviewStatus> } | null = null;

  const look = async (): Promise<PreviewStatus> => {
    try {
      // Any answer counts, also a refusal of the probe's host name.
      await fetcher(new URL("/", options.upstream), { method: "HEAD", redirect: "manual", signal: AbortSignal.timeout(800) });
      quietSince = now();
      return { state: "live", address: options.address, detail: null };
    } catch {
      return now() - quietSince < STOPPED_AFTER_MS
        ? { state: "starting", address: null, detail: "The preview is starting. It shows in a moment." }
        : { state: "stopped", address: null, detail: "The preview does not answer. Tell the person who runs Mica." };
    }
  };

  return () => {
    if (!cached || now() - cached.at > CACHE_MS) cached = { at: now(), status: look() };
    return cached.status;
  };
}

/** Without MICA_PREVIEW_UPSTREAM. */
export const previewOff = async (): Promise<PreviewStatus> => ({
  state: "off",
  address: null,
  detail: "This Mica has no preview. The person who runs Mica can add it.",
});
