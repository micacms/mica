/**
 * Staging: the vocabulary between "saved" and "published".
 *
 * The two words are not synonyms here. A save lands in the draft workspace —
 * a Git working tree; an explicit Publish turns the accumulated changes into
 * one commit. These are the types both sides of that boundary speak: the
 * editor UI showing a pending change set, and the server deciding what a
 * publication writes.
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
 * One pending change, as the editor and the API describe it.
 *
 * A summary: the bytes stay in the working tree. `create` and `update` are
 * the same operation to a commit, but not to a person reading a list of what
 * Publish is about to do.
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
