/**
 * Repository access, as narrow as it can usefully be.
 *
 * Mica does not implement Git. It needs four things from a repository — read a
 * file, list a directory, ask whether something has changed, and write a set of
 * changes as one unit — and a provider API supplies all four far more cheaply
 * than a Git client in a server would.
 *
 * The interface extends `ContentSource`, so `readCollection` and `readSingleton`
 * work unchanged over a connector. That is the point: the Astro build reading a
 * checkout and the Mica server reading a remote repository run the *same*
 * discovery and parsing code, and cannot drift into disagreeing about what a
 * content directory means.
 */

import type { ContentSource } from "./source.js";

export class ConnectorError extends Error {
  override name = "ConnectorError";
}

/**
 * Raised when the repository moved under an editor.
 *
 * Separate from `ConnectorError` because it is the one failure with a sensible
 * answer in the editor — reload and reapply — rather than a message to report.
 */
export class ConflictError extends ConnectorError {
  override name = "ConflictError";
  constructor(
    message: string,
    /** Paths whose revision no longer matched. */
    readonly paths: string[],
  ) {
    super(message);
  }
}

export interface Author {
  name: string;
  email: string;
}

export type Change =
  | { type: "write"; path: string; contents: string | Uint8Array }
  | { type: "delete"; path: string }
  /** Deletes every file under `path`. Removing an entry removes its directory. */
  | { type: "deleteTree"; path: string };

export interface CommitInput {
  /** Subject line of the commit. Written for a person reading `git log`. */
  message: string;
  changes: Change[];
  /**
   * Revisions the editor's work was based on, keyed by path.
   *
   * Per path rather than one repository head, so that two editors working on
   * different entries never block each other. A value of null asserts the path
   * did not exist — which is how creating an entry avoids overwriting one that
   * appeared in the meantime.
   *
   * Omitted entirely, the write is unconditional. That is correct for a first
   * import and wrong for anything an editor did.
   */
  expect?: Record<string, string | null>;
  author?: Author;
}

export interface CommitResult {
  /** Provider-assigned identity of the commit, for logs and diagnostics. */
  revision: string;
}

export interface RepositoryConnector extends ContentSource {
  /** Bytes of a file, for media. Null when there is no such file. */
  readBinary(path: string): Promise<Uint8Array | null>;

  /**
   * An opaque token for the current state of `path`, or null when it is absent.
   *
   * Only ever compared for equality. A connector may return a blob SHA, a
   * content hash or a version counter — nothing above this interface may assume
   * which, or attempt to order two of them.
   */
  revision(path: string): Promise<string | null>;

  /**
   * The current head of the configured branch, or null when the repository
   * cannot name one.
   *
   * A draft records this when it begins, so the editor can show what the
   * pending changes are based on. Display only: the publish gate stays per
   * path (`expect`), because a branch head moves on every push, including
   * pushes that touch nothing an editor cares about.
   *
   * Null for the local connector — a working tree has no commit identity of
   * its own, and asking Git is the local publisher's job, not this one's.
   */
  head(): Promise<string | null>;

  /**
   * Applies every change, or none of them.
   *
   * Atomicity is what makes publishing safe: an entry is an `index.json`, its
   * rich-text sidecars and its media, and a half-written entry is content
   * corruption. Providers give this naturally — one commit — and a local
   * implementation has to work for it.
   *
   * Throws `ConflictError` when any `expect` no longer holds.
   */
  commit(input: CommitInput): Promise<CommitResult>;
}
