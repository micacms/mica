/**
 * One Mica per data volume (#229). Two processes on one clone would each take
 * Git's lock files and fast-forward over the other's drafts. A lease file in the
 * data directory names the process that uses the clone, with a heartbeat. A
 * start waits for a lease that is still fresh, for example while an old
 * container stops, and refuses after that. Deploy with the strategy
 * "recreate", so that two containers never overlap.
 */

import { randomUUID } from "node:crypto";
import { mkdir, readFile, rm } from "node:fs/promises";
import { hostname } from "node:os";
import { join } from "node:path";

import type { Logger } from "@micacms/runtime";

import { CloneRefusal, writeMarker } from "./clone.js";

interface LeaseFile {
  id: string;
  host: string;
  pid: number;
  /** The last heartbeat, in milliseconds since the epoch. */
  at: number;
  /** When this process ended its first sync: the preview waits for it after a start (ADR 39). */
  syncedAt?: number;
}

export interface LeaseTimings {
  /** A lease without a heartbeat for this long has no owner left. */
  expiresMs: number;
  heartbeatMs: number;
  /** How long a start waits for a fresh lease to expire. */
  waitMs: number;
  pollMs: number;
}

const TIMINGS: LeaseTimings = { expiresMs: 30_000, heartbeatMs: 10_000, waitMs: 45_000, pollMs: 2_000 };

export interface Lease {
  /** Writes that this process ended its first sync. */
  synced(): Promise<void>;
  /** Stops the heartbeat and deletes the lease, if it is still this process's. */
  release(): Promise<void>;
}

/**
 * Takes the lease of `dataDir`, waiting for a fresh one to expire. `onLost` runs
 * when another process took it over, which happens only when this process
 * missed its heartbeats for longer than the lease lasts.
 */
export async function takeLease(
  dataDir: string,
  logger: Logger,
  onLost: (holder: string) => void,
  timings: LeaseTimings = TIMINGS,
): Promise<Lease> {
  const file = join(dataDir, "lease.json");
  const mine: LeaseFile = { id: randomUUID(), host: hostname(), pid: process.pid, at: Date.now() };
  const deadline = Date.now() + timings.waitMs;
  let waiting = false;
  await mkdir(dataDir, { recursive: true });

  for (;;) {
    const current = await read(file);
    if (!current || current.id === mine.id || Date.now() - current.at > timings.expiresMs) {
      await writeMarker(file, { ...mine, at: Date.now() });
      // Two starts can both see an expired lease: the one whose write stays wins.
      if ((await read(file))?.id === mine.id) break;
    } else if (Date.now() > deadline) {
      throw new CloneRefusal(
        `Another Mica uses this data volume: ${describe(current)}.\n` +
          "  Stop it first. Deploy with the strategy \"recreate\", so that two containers never share the volume.",
      );
    } else if (!waiting) {
      waiting = true;
      logger.warn("Waiting for the other Mica on this data volume to stop", { holder: describe(current) });
    }
    await sleep(timings.pollMs);
  }
  if (waiting) logger.info("Took over the data volume");

  let released = false;
  /** The heartbeat that runs now: the release waits for it, so that no write follows the delete. */
  let beat: Promise<void> = Promise.resolve();
  const timer = setInterval(() => {
    beat = (async () => {
      const current = await read(file);
      if (released) return;
      if (current && current.id !== mine.id) {
        clearInterval(timer);
        onLost(describe(current));
        return;
      }
      await writeMarker(file, { ...mine, at: Date.now() });
    })().catch((error: unknown) => logger.error("The lease heartbeat failed", { error: String(error) }));
  }, timings.heartbeatMs);
  timer.unref();

  return {
    synced() {
      mine.syncedAt = Date.now();
      beat = beat
        .then(async () => {
          if (!released && (await read(file))?.id === mine.id) await writeMarker(file, { ...mine, at: Date.now() });
        })
        .catch((error: unknown) => logger.error("The lease could not record the first sync", { error: String(error) }));
      return beat;
    },
    async release() {
      released = true;
      clearInterval(timer);
      await beat;
      if ((await read(file))?.id === mine.id) await rm(file, { force: true });
    },
  };
}

async function read(file: string): Promise<LeaseFile | null> {
  try {
    const value = JSON.parse(await readFile(file, "utf8")) as Partial<LeaseFile>;
    return typeof value.id === "string" && typeof value.at === "number" ? (value as LeaseFile) : null;
  } catch {
    return null;
  }
}

function describe(lease: LeaseFile): string {
  return `${lease.host}, process ${lease.pid}, last seen ${new Date(lease.at).toISOString()}`;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
