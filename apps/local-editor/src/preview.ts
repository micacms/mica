/**
 * The local editor's "Preview": the dev server that `astro dev` announced for
 * this content root. Only when its process still runs and its address answers;
 * a file that a stopped dev server left behind gives no preview.
 */

import { readFile } from "node:fs/promises";

import { devServerMarkerPath, type DevServerMarker } from "@micacms/core/node";

/** Short enough that a dev server that just started shows soon, long enough to not ask on each request. */
const CACHE_MS = 3000;

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

export function devServerPreview(contentRoot: string, fetcher: typeof fetch = fetch): () => Promise<string | null> {
  const path = devServerMarkerPath(contentRoot);
  let cached: { at: number; address: Promise<string | null> } | null = null;

  const look = async (): Promise<string | null> => {
    const text = await readFile(path, "utf8").catch(() => null);
    if (!text) return null;
    let marker: DevServerMarker;
    try {
      marker = JSON.parse(text) as DevServerMarker;
    } catch {
      return null;
    }
    if (!Number.isInteger(marker.pid) || typeof marker.address !== "string" || !/^http:\/\/localhost:\d+/.test(marker.address)) return null;
    if (!runs(marker.pid)) return null;
    return (await answers(marker.address, fetcher)) ? marker.address : null;
  };

  return () => {
    if (!cached || Date.now() - cached.at > CACHE_MS) cached = { at: Date.now(), address: look() };
    return cached.address;
  };
}
