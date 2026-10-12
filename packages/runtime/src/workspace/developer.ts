/**
 * The developer's policy: the local editor works on their own checkout.
 *
 * Mica never fetches, merges or resets here — the checkout belongs to the
 * developer, who stays in control of it. Publish pushes with their own `git`,
 * their credentials and their upstream; a push that fails leaves the commit
 * for a "Retry push" or for the developer's own tools.
 */

import type { PublishResult } from "@micacms/core";

import type { Logger } from "../lib/logger.js";
import { GitError } from "./git.js";
import type { OwnerPolicy, PublishAvailability } from "./policy.js";
import type { GitTree } from "./tree.js";

export interface DeveloperPolicyOptions {
  /** `MICA_LOCAL_PUBLISH`. False reduces the editor to a read-only changes view. */
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

    // The developer's checkout is theirs: Mica never fetches or merges here.
    async prepare() {},

    // The commit is the developer's, written with their own Git identity.
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
