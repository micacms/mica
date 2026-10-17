/**
 * Git LFS in the clone. The filter driver and the endpoint are in the
 * environment (`isolation.ts`); this adds what depends on the content root.
 * The objects of files outside the content root stay on the host: Mica does
 * not read those files, so their pointers are enough.
 */

import type { GitRunner } from "@micacms/runtime";

/** Limits LFS downloads to the content root. Run it before a checkout. */
export async function limitLfsToRoot(git: GitRunner, root: string): Promise<void> {
  if (root === "") await git.tryRun(["config", "--unset", "lfs.fetchinclude"]);
  else await git.run(["config", "lfs.fetchinclude", `${root}/**`]);
}

/**
 * Downloads the LFS objects that a checkout of `ref` needs and the clone does
 * not have, so the checkout itself does not use the network.
 */
export function fetchLfsObjects(git: GitRunner, ref: string, timeoutMs: number): Promise<string> {
  return git.run(["lfs", "fetch", "origin", ref], { timeoutMs });
}
