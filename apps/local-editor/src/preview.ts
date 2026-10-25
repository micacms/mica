/**
 * The local editor's "Preview": the dev server that `astro dev` announced for
 * this content root. Live only while its process runs and its address answers;
 * a file that a stopped dev server left behind gives no preview. The texts are
 * for a developer: only a developer runs the local editor.
 */

import { readFile } from "node:fs/promises";

import { devServerMarkerPath, type DevServerMarker } from "@micacms/core/node";
import type { PreviewStatus } from "@micacms/runtime";

import type { StartedDevServer } from "./astro-dev.js";

/** Short enough that a dev server that just started shows soon, long enough to not ask on each request. */
const CACHE_MS = 3000;

const HOW_TO_START = "Start the editor with mica start --preview, or run astro dev beside it.";

/** Whether a process runs. `EPERM` means it runs, under another user. */
function runs(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

async function answers(address: string, fetcher: typeof fetch): Promise<boolean> {
  try {
    await fetcher(`${address}/`, { method: "HEAD", redirect: "manual", signal: AbortSignal.timeout(800) });
    return true;
  } catch {
    return false;
  }
}

const status = (state: PreviewStatus["state"], detail: string | null, address: string | null = null): PreviewStatus => ({ state, address, detail });

export interface DevServerPreviewOptions {
  fetcher?: typeof fetch;
  /** The dev server that `mica start --preview` started, if any. */
  started?: () => StartedDevServer | null;
}

export function devServerPreview(contentRoot: string, options: DevServerPreviewOptions = {}): () => Promise<PreviewStatus> {
  const path = devServerMarkerPath(contentRoot);
  const fetcher = options.fetcher ?? fetch;
  let cached: { at: number; status: Promise<PreviewStatus> } | null = null;

  const marker = async (): Promise<DevServerMarker | null> => {
    const text = await readFile(path, "utf8").catch(() => null);
    if (!text) return null;
    try {
      const value = JSON.parse(text) as DevServerMarker;
      return Number.isInteger(value.pid) && typeof value.address === "string" && /^http:\/\/localhost:\d+/.test(value.address) ? value : null;
    } catch {
      return null;
    }
  };

  const look = async (): Promise<PreviewStatus> => {
    const found = await marker();
    if (found && runs(found.pid)) {
      return (await answers(found.address, fetcher))
        ? status("live", null, found.address)
        : status("starting", "The website's dev server is starting.");
    }
    const run = options.started?.() ?? null;
    if (run?.running) return status("starting", "The website's dev server is starting.");
    if (run || found) {
      const how = run?.exit !== null && run?.exit !== undefined ? ` It ended with ${typeof run.exit === "number" ? `exit code ${run.exit}` : run.exit}.` : "";
      return status("stopped", `The website's dev server stopped.${how} ${HOW_TO_START}`);
    }
    return status("off", `No dev server runs for this content. ${HOW_TO_START}`);
  };

  return () => {
    if (!cached || Date.now() - cached.at > CACHE_MS) cached = { at: Date.now(), status: look() };
    return cached.status;
  };
}
