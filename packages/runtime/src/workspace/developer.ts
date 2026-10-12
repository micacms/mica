/**
 * The policy for the developer's own checkout. Mica never fetches, merges or
 * resets here. Publish pushes with the developer's `git`, credentials and
 * upstream; a failed push keeps the commit.
 */

import type { PublishResult } from "@micacms/core";

import type { Logger } from "../lib/logger.js";
import { GitError } from "./git.js";
import type { OwnerPolicy, PublishAvailability } from "./policy.js";
import type { GitTree } from "./tree.js";

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

    async prepare() {},

    // The commit keeps the developer's own Git identity.
    commitAuthor: () => undefined,

    async push(tree: GitTree, revision: string): Promise<PublishResult> {
      try {
        await tree.git.run(["push"]);
        return { state: "published", revision };
      } catch (error) {
        const pushError = error instanceof GitError ? error.message : String(error);
        options.logger.warn("Publish committed but the push failed", { revision, pushError });
        return { state: "committed-pending-push", revision, pushError };
      }
    },
  };
}
