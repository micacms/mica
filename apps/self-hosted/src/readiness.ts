/** What `/ready` says about the managed clone. */

import type { SyncState } from "./workspace/managed.js";

/**
 * Editing works as long as the clone is there; these are reasons to look. A
 * conflict is the editors' work, so it alone does not make the state degraded.
 */
export function readiness(state: SyncState): { degraded: boolean; reasons: string[]; lastSyncAt: string | null } {
  const reasons: string[] = [];
  if (state.error) reasons.push(state.error.code === "auth" ? "auth_failed" : state.error.code === "unknown" ? "sync_failing" : state.error.code);
  if (state.pendingPush) reasons.push("pending_push");
  if (state.restartRequired) reasons.push("restart_required");
  if (state.readOnly) reasons.push("read_only");
  const degraded = reasons.length > 0;
  if (state.conflicts.length > 0) reasons.push("conflict");
  return { degraded, reasons, lastSyncAt: state.lastSyncAt };
}
