/**
 * What changes with the owner of a working tree: whether Publish may run and
 * how a commit reaches the remote. The app that keeps a managed clone supplies
 * its policy; `developer.ts` is the developer's.
 */

import type { PublishResult } from "@micacms/core/internal";

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
  publishAvailability(): PublishAvailability;
  /**
   * Runs with the remote lock held, before the tree lock. A managed clone syncs
   * here and must not take the remote lock again. Throws an `ApiError` when
   * Publish must wait.
   */
  prepare(tree: GitTree): Promise<void>;
  /** Who a commit names as its author, given the signed-in editor. Undefined leaves it to Git. */
  commitAuthor(editor: Author | undefined): Author | undefined;
  /**
   * Sends HEAD to the remote. A failure returns `committed-pending-push`, not
   * an exception: the commit is real.
   */
  push(tree: GitTree, revision: string): Promise<PublishResult>;

  /* A clone that Mica keeps answers these; the developer's checkout does not. */

  syncStatus?(): SyncStatus;
  sync?(): Promise<void>;
  /** Keeps the editor's version of a conflicting group, or takes the website's. */
  resolve?(group: string, choice: "mine" | "website"): Promise<void>;
  /** The ref that holds the website's version, for a conflict's comparison. */
  upstreamRef?: string;
  describe?(): Promise<RepositoryDescription>;
}
