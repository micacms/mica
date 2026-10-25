/**
 * After a start of Mica and the preview together, Mica fetches the branch
 * first. The preview waits for that sync, so that it copies the newest website
 * once and not an old one that it must copy again (ADR 39). Mica writes
 * `syncedAt` into its lease on the volume when its first sync ended.
 */

/** A lease without a heartbeat for this long has no Mica behind it, as for Mica itself. */
export const LEASE_FRESH_MS = 30_000;

/** The longest wait: after it, the preview starts with the clone as it is. */
export const FIRST_SYNC_WAIT_MS = 30_000;

/** Whether a Mica runs on the volume and ended its first sync, from the text of its `lease.json`. */
export function micaSynced(leaseText: string | null, now = Date.now()): boolean {
  if (!leaseText) return false;
  try {
    const lease = JSON.parse(leaseText) as { at?: unknown; syncedAt?: unknown };
    return typeof lease.at === "number" && now - lease.at <= LEASE_FRESH_MS && typeof lease.syncedAt === "number";
  } catch {
    return false;
  }
}
