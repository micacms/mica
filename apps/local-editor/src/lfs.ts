/**
 * A content root that uses Git LFS needs Git LFS on this machine. Without it,
 * a commit holds the whole file where LFS should hold a pointer, so the start
 * stops instead.
 */

import { lfsUnderRootInTree, locateTree } from "@micacms/runtime";

/** Why the LFS of the content root cannot work on this machine, or null. */
export async function lfsSetupProblem(contentRoot: string): Promise<string | null> {
  const tree = await locateTree(contentRoot);
  if ("reason" in tree) return null;
  const repositoryDir = await tree.git.run(["rev-parse", "--show-toplevel"]);
  const file = await lfsUnderRootInTree(tree.git, repositoryDir, tree.prefix);
  if (!file) return null;

  const uses = `${file} stores files under the content root with Git LFS`;
  if ((await tree.git.tryRun(["lfs", "version"])) === null) {
    return `${uses}, but Git LFS is not installed.\n  Install Git LFS (https://git-lfs.com), run \`git lfs install\` once, and start Mica again.`;
  }
  const filter =
    (await tree.git.tryRun(["config", "--get", "filter.lfs.process"])) ??
    (await tree.git.tryRun(["config", "--get", "filter.lfs.clean"]));
  if (filter === null) {
    return `${uses}, but Git LFS is not set up in Git.\n  Run \`git lfs install\` once, and start Mica again.`;
  }
  return null;
}
