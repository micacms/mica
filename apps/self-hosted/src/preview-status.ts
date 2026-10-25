/**
 * The state of the self-hosted preview, for the editor (ADR 38, 39, 40).
 * Mica's preview image reports its own state and its last lines on port 4380
 * inside the network. Without that answer, as with an image of one's own, Mica
 * sees only whether the preview answers: starting for some minutes, then
 * stopped. The texts are for editors: they name no dev server and no container.
 */

import type { PreviewStatus } from "@micacms/runtime";

/** Short enough that a preview that just started shows soon, long enough to not ask on each request. */
const CACHE_MS = 3000;

/** A first install can take some minutes; after that, a preview that does not answer is stopped. */
export const STOPPED_AFTER_MS = 5 * 60_000;

/** The port of the preview image's report, beside its dev server. */
export const STATUS_PORT = 4380;

const STEPS = ["waiting", "copying", "installing", "starting", "running", "failed"] as const;
type Step = (typeof STEPS)[number];

const STEP_DETAIL: Record<Exclude<Step, "running" | "failed">, string> = {
  waiting: "The preview waits for Mica's copy of the website.",
  copying: "The preview copies the website.",
  installing: "The preview installs the packages of the website. This can take some minutes.",
  starting: "The preview starts the website.",
};

const STARTING = "The preview is starting. It shows in a moment.";
const ASK = "Tell the person who runs Mica.";

interface Report {
  state: Step;
  reason: string | null;
  lines: string[];
}

const text = (value: unknown, max: number): string | null =>
  typeof value === "string" && value.trim() ? (value.length > max ? `${value.slice(0, max - 1)}…` : value) : null;

/** The preview's answer is untrusted text: the site's code runs beside the report. */
export function readReport(value: unknown): Report | null {
  if (value === null || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  if (!STEPS.includes(raw["state"] as Step)) return null;
  const lines = Array.isArray(raw["lines"]) ? raw["lines"].slice(-50).map((line) => text(line, 500) ?? "").filter(Boolean) : [];
  return { state: raw["state"] as Step, reason: text(raw["reason"], 300), lines };
}

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
  const statusUrl = new URL("/status", options.upstream);
  statusUrl.port = String(STATUS_PORT);
  /** Since when the preview has not answered: Mica's start, or the last answer. */
  let quietSince = now();
  let cached: { at: number; status: Promise<PreviewStatus> } | null = null;

  const answers = async (): Promise<boolean> => {
    try {
      // Any answer counts, also a refusal of the probe's host name.
      await fetcher(new URL("/", options.upstream), { method: "HEAD", redirect: "manual", signal: AbortSignal.timeout(800) });
      quietSince = now();
      return true;
    } catch {
      return false;
    }
  };

  const report = async (): Promise<Report | null> => {
    try {
      const response = await fetcher(statusUrl, { signal: AbortSignal.timeout(800) });
      return response.ok ? readReport(await response.json()) : null;
    } catch {
      return null;
    }
  };

  const look = async (): Promise<PreviewStatus> => {
    const [own, up] = await Promise.all([report(), answers()]);
    if (own) {
      const lines = own.lines;
      if (own.state === "running") return up ? { state: "live", address: options.address, detail: null, lines } : { state: "starting", address: null, detail: STEP_DETAIL.starting, lines };
      if (own.state === "failed") return { state: "stopped", address: null, detail: `${own.reason ?? "The preview failed."} ${ASK}`, lines };
      return { state: "starting", address: null, detail: own.reason ?? STEP_DETAIL[own.state], lines };
    }
    if (up) return { state: "live", address: options.address, detail: null };
    return now() - quietSince < STOPPED_AFTER_MS
      ? { state: "starting", address: null, detail: STARTING }
      : { state: "stopped", address: null, detail: `The preview does not answer. ${ASK}` };
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
