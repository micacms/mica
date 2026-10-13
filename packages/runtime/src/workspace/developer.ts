/**
 * The policy for the developer's own checkout. Mica never fetches, merges or
 * resets here. Publish pushes with the developer's `git`, credentials and
 * upstream; a new branch without one is pushed to `origin` and tracks it. A
 * failed push keeps the commit. A push sends only Mica's own commits: other
 * commits that no remote has make Publish refuse.
 */

import type { PublishResult } from "@micacms/core";

import { ApiError } from "../lib/errors.js";
import type { Logger } from "../lib/logger.js";
import type { OwnerPolicy, PublishAvailability } from "./policy.js";
import { unpushedCommits, type GitTree } from "./tree.js";

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
      await refuseOtherCommits(tree);
    },

    // The commit keeps the developer's own Git identity.
    commitAuthor: () => undefined,

    async push(tree: GitTree, revision: string): Promise<PublishResult> {
      try {
        // Checked again: a commit made in a terminal since `prepare` would go along.
        await refuseOtherCommits(tree);
        // Publishing is the request to push, so a new branch gets its upstream here.
        const upstream = await tree.git.tryRun(["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{upstream}"]);
        const remotes = (await tree.git.tryRun(["remote"]))?.split("\n").filter(Boolean) ?? [];
        if (upstream === null && remotes.includes("origin")) await tree.git.run(["push", "-u", "origin", "HEAD"]);
        else if (upstream === null) throw new Error(noUpstream(remotes));
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

/** A push sends every commit that no remote has; the developer's own commits are theirs to send. */
async function refuseOtherCommits(tree: GitTree): Promise<void> {
  const other = (await unpushedCommits(tree))?.other ?? 0;
  if (other === 0) return;
  throw new ApiError(
    "conflict",
    `Publishing would also send ${other} change${other === 1 ? "" : "s"} that ${other === 1 ? "was" : "were"} not made in Mica ` +
      "and that the website does not have yet. Send them with Git first (`git push`), or move them to another branch. " +
      "Then publish again.",
  );
}

function noUpstream(remotes: string[]): string {
  return remotes.length === 0
    ? "This repository has no remote. Add one with `git remote add origin <url>`, then publish again."
    : `This branch has no upstream. Push it once with \`git push -u ${remotes[0]} HEAD\`, then publish again.`;
}
