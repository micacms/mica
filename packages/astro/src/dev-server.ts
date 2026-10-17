/**
 * Tells the local editor that `astro dev` runs for a content root, so that it
 * can offer "Preview": the dev server reads the saved drafts. A file in the
 * system's temp folder, never in the repository; the process deletes it when
 * it stops, and the editor ignores a file of a process that is gone.
 */

import { mkdirSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

import { devServerMarkerPath, type DevServerMarker } from "@micacms/core/node";

/** The part of Astro's config that gives the dev server's address. */
export interface DevServerConfig {
  server?: { port?: number; host?: string | boolean };
  base?: string;
}

/**
 * The address from the config. If Astro must take another port because this
 * one is busy, the editor's check of the address finds the wrong server or
 * none; `server.port` then makes it exact.
 */
export function devServerAddress(config: DevServerConfig | undefined): string {
  const base = (config?.base ?? "/").replace(/\/+$/, "");
  return `http://localhost:${config?.server?.port ?? 4321}${base}`;
}

/** Writes the marker of this process. Returns a function that deletes it. */
export function announceDevServer(contentRoot: string, config: DevServerConfig | undefined): () => void {
  const path = devServerMarkerPath(contentRoot);
  const marker: DevServerMarker = { pid: process.pid, address: devServerAddress(config) };
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(marker)}\n`, "utf8");
  const remove = () => {
    try {
      unlinkSync(path);
    } catch {
      // Gone already, or another dev server wrote it since.
    }
  };
  process.once("exit", remove);
  return remove;
}
