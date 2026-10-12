/**
 * Who owns a working tree, and what that changes.
 *
 * The staging service is the same for both owners: the tree is the draft
 * workspace, and Publish commits an explicit path set. What differs is what
 * happens around it — whether Publish is allowed, and how a commit reaches
 * the remote. The developer's policy is in `developer.ts`; a clone that Mica
 * keeps itself gets its policy from the app that owns the clone.
 */

import type { Author, PublishResult } from "@micacms/core";

import type { GitTree } from "./tree.js";

export type PublishAvailability = { enabled: true } | { enabled: false; reason: string };

export interface OwnerPolicy {
  readonly owner: "developer" | "managed";
  /** Whether Publish may run here, and the reason when it may not. */
  publishAvailability(): PublishAvailability;
  /**
   * Runs before a publication takes the tree lock — a managed clone brings
   * itself up to date here. Throws an `ApiError` when Publish must wait.
   */
  prepare(tree: GitTree): Promise<void>;
  /** Who a commit names as its author, given the signed-in editor. Undefined leaves it to Git. */
  commitAuthor(editor: Author | undefined): Author | undefined;
  /**
   * Sends HEAD to the remote. A failure is a state, not an exception: the
   * commit is real, and `committed-pending-push` says that only the second
   * half is missing.
   */
  push(tree: GitTree, revision: string): Promise<PublishResult>;
}
