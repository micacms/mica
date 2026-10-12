/**
 * Who owns a working tree, and what that changes.
 *
 * The staging service is the same for both owners: the tree is the draft
 * workspace, and Publish commits an explicit path set. What differs is what
 * happens around it — whether Publish is allowed, and how a commit reaches
 * the remote. The developer's policy is in `developer.ts`; a clone that Mica
 * keeps itself gets its policy from the app that owns the clone.
 */

import type { PublishResult } from "@micacms/core";

import type { Author } from "./files.js";

import type { GitTree } from "./tree.js";

export type PublishAvailability = { enabled: true } | { enabled: false; reason: string };

/** One piece of content that an editor changed and the website changed too. */
export interface SyncConflict {
  /** Identifies the group in `resolve`. */
  group: string;
  label: string;
  /** Content-relative paths of the group, on either side. */
  paths: string[];
  upstream: "changed" | "deleted" | "added";
  /** What the comparison shows, when the group is one document. */
  target?: { kind: "entry"; collection: string; slug: string } | { kind: "singleton"; name: string } | { kind: "order"; collection: string };
}

/** Where a clone that Mica keeps stands against its remote. Managed owners only. */
export interface SyncStatus {
  lastSyncAt: string | null;
  /** Upstream commits not yet in the clone. */
  behind: number;
  error: { code: string; message: string; since: string } | null;
  /** The content model changed upstream; a restart applies it. */
  restartRequired: boolean;
  /** A publication committed and not yet pushed. Mica retries it. */
  pendingPush: { revision: string; reason: string } | null;
  /** The last publication the host refused; it is a draft again. */
  refused: { reason: string; at: string } | null;
  conflicts: SyncConflict[];
}

/** What the System page says about the repository, beyond what the runtime knows. */
export interface RepositoryDescription {
  /** The remote URL, without credentials. */
  url: string;
  branch: string;
  /** Bytes the clone takes on the data volume. */
  cloneBytes: number | null;
}

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

  /* A clone that Mica keeps answers these; the developer's checkout does not. */

  syncStatus?(): SyncStatus;
  /** Brings the clone up to date now. */
  sync?(): Promise<void>;
  /** Keeps the editor's version of a conflicting group, or takes the website's. */
  resolve?(group: string, choice: "mine" | "website"): Promise<void>;
  /** The ref that holds the website's version, for a conflict's comparison. */
  upstreamRef?: string;
  describe?(): Promise<RepositoryDescription>;
}
