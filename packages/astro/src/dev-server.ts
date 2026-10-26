/**
 * Tells the local editor that `astro dev` runs for a content root, so that it
 * can offer "Preview": the dev server reads the saved drafts. A file in the
 * system's temp folder, never in the repository; the process deletes it when
 * it stops, also on Ctrl+C, and the editor ignores a file of a process that is
 * gone. Two dev servers of one content root share the file: when the other one
 * stops and deletes it, this one writes it again.
 */

import { mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

import { devServerMarkerPath, type DevServerMarker } from "@micacms/core/node";

/** The part of Astro's config that gives the dev server's address. */
export interface DevServerConfig {
  server?: { port?: number; host?: string | boolean };
  base?: string;
}

/**
 * The state of this process. The loader and `micaPreview()` can load as two
 * copies of this module, in Astro's two module graphs, so it is on `globalThis`.
 */
interface DevServerState {
  /** The port that the server listens on, once `astro:server:start` said it. */
  port?: number;
  /** The marker of each content root, with the config that gives its address. */
  markers: Map<string, DevServerConfig | undefined>;
  stopHooked: boolean;
  watching: boolean;
  /** Set when the process stops: its markers go, and nothing writes them again. */
  stopping: boolean;
}

/** How often a dev server looks whether its marker is still there. */
export const MARKER_CHECK_MS = 2000;

const STATE = Symbol.for("@micacms/astro/dev-server");

function state(): DevServerState {
  const holder = globalThis as { [STATE]?: DevServerState };
  return (holder[STATE] ??= { markers: new Map(), stopHooked: false, watching: false, stopping: false });
}

/**
 * The address from the config, or with the port that the server listens on.
 * Astro takes another port when the config's port is busy; only an
 * integration learns it, so without `micaPreview()` the config's port stays.
 */
export function devServerAddress(config: DevServerConfig | undefined, port = config?.server?.port ?? 4321): string {
  const base = (config?.base ?? "/").replace(/\/+$/, "");
  return `http://localhost:${port}${base}`;
}

function write(path: string, config: DevServerConfig | undefined, port: number | undefined): void {
  // Only `astro:server:start` knows the port that Astro took: before it, or without `micaPreview()`, the address is the config's.
  const marker: DevServerMarker = { pid: process.pid, address: devServerAddress(config, port), confirmed: port !== undefined };
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(marker)}\n`, "utf8");
}

/** Deletes the marker if it is still this process's: another dev server of the same content root can have written it since. */
function remove(path: string): void {
  try {
    if ((JSON.parse(readFileSync(path, "utf8")) as DevServerMarker).pid === process.pid) unlinkSync(path);
  } catch {
    // Gone already.
  }
}

/** Whether a process runs. `EPERM` means it runs, under another user. */
function runs(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

/** The marker's file names no dev server that runs: it is gone, cannot be read, or its process ended. */
function free(path: string): boolean {
  try {
    const marker = JSON.parse(readFileSync(path, "utf8")) as Partial<DevServerMarker>;
    return !Number.isInteger(marker.pid) || !runs(marker.pid!);
  } catch {
    return true;
  }
}

/**
 * Writes a marker again when it is free. A marker of another dev server that
 * runs stays: two dev servers never take it from each other in turns.
 */
function watch(current: DevServerState): void {
  if (current.watching) return;
  current.watching = true;
  setInterval(() => {
    if (current.stopping) return;
    current.markers.forEach((config, path) => {
      try {
        if (free(path)) write(path, config, current.port);
      } catch {
        // The temp folder can be away for a moment: the next check tries again.
      }
    });
  }, MARKER_CHECK_MS).unref();
}

/** Neither Astro nor Vite handles SIGINT, so Ctrl+C ends the process without its `exit` event. */
function hookStop(current: DevServerState): void {
  if (current.stopHooked) return;
  current.stopHooked = true;
  const removeAll = () => {
    current.stopping = true;
    current.markers.forEach((_, path) => remove(path));
  };
  process.once("exit", removeAll);
  for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"] as const) {
    // First and once: a listener after it, such as signal-exit in a terminal, then decides as if this one were not there.
    process.prependOnceListener(signal, () => {
      removeAll();
      // A listener stops the default exit; give it back when nobody else handles the signal.
      if (process.listenerCount(signal) === 0) process.kill(process.pid, signal);
    });
  }
}

/** Writes the marker of this process. Returns a function that deletes it. */
export function announceDevServer(contentRoot: string, config: DevServerConfig | undefined): () => void {
  const path = devServerMarkerPath(contentRoot);
  const current = state();
  write(path, config, current.port);
  current.markers.set(path, config);
  hookStop(current);
  watch(current);
  return () => {
    current.markers.delete(path);
    remove(path);
  };
}

/** From `astro:server:start`: writes the markers again with the port that the server listens on. */
export function devServerListening(port: number): void {
  const current = state();
  current.port = port;
  current.markers.forEach((config, path) => write(path, config, port));
}
