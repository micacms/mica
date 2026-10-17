/**
 * The policy for the developer's own checkout. Mica never fetches, merges or
 * resets here. Publish pushes with the developer's `git`, credentials and
 * upstream; a new branch without one is pushed to `origin` and tracks it. The
 * LFS objects go first (`git lfs push`). A failed push keeps the commit. A push sends only Mica's own commits: other
 * commits that no remote has make Publish refuse. On a detached HEAD, as in a submodule, Publish refuses before it
 * commits.
 */

import type { PublishResult } from "@micacms/core/internal";

import { ApiError } from "../lib/errors.js";
import type { Logger } from "../lib/logger.js";
import { lfsUnderRoot, pushLfsObjects } from "./lfs.js";
import type { OwnerPolicy, PublishAvailability } from "./policy.js";
import { currentBranch, detachedHead, unpushedCommits, type DetachedHead, type GitTree } from "./tree.js";

export interface DeveloperPolicyOptions {
  /** `MICA_LOCAL_PUBLISH`. */
  publishEnabled: boolean;
  logger: Logger;
}

export function developerPolicy(options: DeveloperPolicyOptions): OwnerPolicy {
  return {
    owner: "developer",

    publishAvailability(): PublishAvailability {
      return options.publishEnabled
        ? { enabled: true }
        : { enabled: false, reason: "Publishing from local mode is disabled (MICA_LOCAL_PUBLISH=false)." };
    },

    async prepare(tree: GitTree) {
      await refuseDetachedHead(tree);
      await refuseOtherCommits(tree);
    },

    // The commit keeps the developer's own Git identity.
    commitAuthor: () => undefined,

    async push(tree: GitTree, revision: string): Promise<PublishResult> {
      try {
        // A retry can find a commit that is on no branch.
        await refuseDetachedHead(tree);
        // Checked again: a commit made in a terminal since `prepare` would go along.
        await refuseOtherCommits(tree);
        // Publishing is the request to push, so a new branch gets its upstream here.
        const upstream = await tree.git.tryRun(["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{upstream}"]);
        const remotes = (await tree.git.tryRun(["remote"]))?.split("\n").filter(Boolean) ?? [];
        if (upstream === null && !remotes.includes("origin")) throw new Error(noUpstream(remotes));
        await pushLfs(tree, upstream === null ? "origin" : await pushRemote(tree));
        if (upstream === null) await tree.git.run(["push", "-u", "origin", "HEAD"]);
        else await tree.git.run(["push"]);
        return { state: "published", revision };
      } catch (error) {
        const pushError = error instanceof Error ? error.message : String(error);
        options.logger.warn("Publish committed but the push failed", { revision, pushError });
        return { state: "committed-pending-push", revision, pushError };
      }
    },
  };
}

/**
 * Sends the LFS objects first when the content root uses LFS, also from a
 * checkout without the LFS pre-push hook. The start checked that LFS is set up.
 */
async function pushLfs(tree: GitTree, remote: string): Promise<void> {
  if (!(await lfsUnderRoot(tree.git, "HEAD", tree.prefix))) return;
  try {
    // The large files travel here, so the limit is longer than for a Git call.
    await pushLfsObjects(tree.git, remote, "HEAD", 10 * 60_000);
  } catch (error) {
    throw new Error(`Git LFS could not send the files to ${remote}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/** The remote that a plain `git push` sends the branch to, in Git's own order. */
async function pushRemote(tree: GitTree): Promise<string> {
  const branch = await currentBranch(tree);
  const read = (key: string) => tree.git.tryRun(["config", "--get", key]);
  return (
    (await read(`branch.${branch}.pushRemote`)) ??
    (await read("remote.pushDefault")) ??
    (await read(`branch.${branch}.remote`)) ??
    "origin"
  );
}

/** A commit on a detached HEAD is on no branch, so no push can send it to the website. */
async function refuseDetachedHead(tree: GitTree): Promise<void> {
  const detached = await detachedHead(tree);
  if (detached) throw new ApiError("conflict", detachedHeadMessage(detached));
}

/** Why Publish waits on a detached HEAD, and the command that ends the wait. */
function detachedHeadMessage(detached: DetachedHead): string {
  const what = detached.superproject
    ? "The content repository is a Git submodule of the website, and it is not on a branch (detached HEAD)"
    : "The repository is not on a branch (detached HEAD)";
  return `${what}, so Mica does not publish. Check out the branch with \`${detached.command}\`, then publish again.`;
}

/** A push sends every commit that no remote has; the developer's own commits are theirs to send. */
async function refuseOtherCommits(tree: GitTree): Promise<void> {
  const other = (await unpushedCommits(tree))?.other ?? 0;
  if (other === 0) return;
  // A new project's first commits: its branch has no upstream yet, so a plain `git push` fails too.
  const upstream = await tree.git.tryRun(["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{upstream}"]);
  const remote = (await tree.git.tryRun(["remote"]))?.split("\n").find(Boolean) ?? "origin";
  const push = upstream === null ? `git push -u ${remote} HEAD` : "git push";
  throw new ApiError(
    "conflict",
    `Publishing would also send ${other} change${other === 1 ? "" : "s"} that ${other === 1 ? "was" : "were"} not made in Mica ` +
      `and that the website does not have yet. Send them with Git first (\`${push}\`), or move them to another branch. ` +
      "Then publish again.",
  );
}

function noUpstream(remotes: string[]): string {
  return remotes.length === 0
    ? "This repository has no remote. Add one with `git remote add origin <url>`, then publish again."
    : `This branch has no upstream. Push it once with \`git push -u ${remotes[0]} HEAD\`, then publish again.`;
}
