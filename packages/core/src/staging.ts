/**
 * The types between "saved" and "published": a save lands in the Git working
 * tree, and Publish turns the pending changes into one commit.
 */

/**
 * An opaque token naming a state of the repository or of one file in it.
 *
 * Only ever compared for equality. Git hands back a commit id, a working tree
 * a content hash — nothing that holds a `Revision` may assume which, or
 * attempt to order two of them.
 */
export type Revision = string;

/**
 * One pending change. `create` and `update` are the same to a commit, but not
 * to a person who reads the list.
 */
export interface ContentChange {
  /** Path relative to the content root. */
  path: string;
  kind: "create" | "update" | "delete";
}

/** What a publication did, and how far it got. */
export interface PublishResult {
  /**
   * `committed-pending-push` exists because a local commit and a remote push
   * are not one operation. The commit is real and retained; retrying must
   * retry the push and never create a second commit.
   */
  state: "published" | "committed-pending-push";
  /** The commit that was created, when one was. */
  revision: Revision | null;
  /** Why the push did not happen, when the state says it is pending. */
  pushError?: string;
}
