/**
 * Removes the temporary files that a save or an upload of an earlier local
 * editor left behind when its process ended, for example in a crash. A file
 * of a process that still runs stays: it can be a second editor's save.
 */

import { rm } from "node:fs/promises";

import { within } from "@micacms/core/node";
import { listTemporaries, locateTree } from "@micacms/runtime";

/** The removed files and folders, from the content root. Outside Git, nothing is removed. */
export async function removeStaleTemporaries(contentRoot: string): Promise<string[]> {
  const tree = await locateTree(contentRoot);
  if ("reason" in tree) return [];
  const stale = (await listTemporaries(tree)).filter((temporary) => !isRunning(temporary.pid)).map((temporary) => temporary.path);
  for (const path of stale) await rm(within(contentRoot, path), { recursive: true, force: true });
  return stale;
}

/** Whether a process with this id runs. EPERM: it runs, as another user. */
function isRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}
