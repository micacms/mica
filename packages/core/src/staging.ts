/**
 * Staging: the vocabulary between "saved" and "published".
 *
 * The two words are not synonyms here. A save lands in a draft workspace; an
 * explicit Publish turns the accumulated changes into one commit. These are
 * the types both sides of that boundary speak — the editor UI showing a
 * pending change set, and the server deciding what a publication writes.
 *
 * The `DraftStore` port is deliberately a *file* store, not a content store.
 * It records paths and bytes, exactly what a repository commit will carry,
 * and knows nothing about entries, fields or validation. Everything that is
 * about content happens above it, in the same code that already turns an
 * entry into files.
 */

/**
 * An opaque token naming a state of the repository or of one file in it.
 *
 * Only ever compared for equality. A provider hands back a commit SHA or a
 * blob SHA, a working tree hands back a content hash — nothing that holds a
 * `Revision` may assume which, or attempt to order two of them.
 */
export type Revision = string;

/**
 * One pending change, as the editor and the API describe it.
 *
 * A summary: the bytes stay in the draft store. `create` and `update` are the
 * same operation to a repository write, but not to a person reading a list of
 * what Publish is about to do.
 */
export interface ContentChange {
  /** Path relative to the content root. */
  path: string;
  kind: "create" | "update" | "delete";
  /** When the change was last staged. Absent when the store cannot say. */
  updatedAt?: string;
}

/**
 * The one shared pending change set of a site.
 *
 * There is exactly one per site, not one per editor — see decisions.md, "One
 * shared pending change set per site". `baseRevision` is the branch head when
 * the draft began; it is displayed, never enforced. The publish gate is per
 * path, so that two editors working on different entries never block each
 * other.
 */
export interface DraftChangeSet {
  baseRevision: Revision | null;
  changes: ContentChange[];
  /** The most recent staging, for "last saved" in the UI. */
  updatedAt: string | null;
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

/** A staged file write or deletion, as the draft store holds it. */
export type StagedChange =
  | {
      kind: "write";
      path: string;
      contents: Uint8Array;
      /** True when the contents were staged as text and may be published as text. */
      text: boolean;
      /**
       * The revision this path had in the *published* repository when it was
       * first staged — null when it did not exist. This is the publish gate:
       * a path whose repository revision no longer matches has moved under
       * the draft, and publishing would overwrite somebody's work.
       */
      baseRevision: Revision | null;
      /** Monotonic per-store counter; changes whenever the row is re-staged. */
      version: number;
      updatedAt: string;
    }
  | {
      kind: "delete";
      path: string;
      baseRevision: Revision | null;
      version: number;
      updatedAt: string;
    };

/** What a caller records. The store assigns `version` and `updatedAt`. */
export type StageInput =
  | { kind: "write"; path: string; contents: Uint8Array; text: boolean; baseRevision: Revision | null }
  | { kind: "delete"; path: string; baseRevision: Revision | null };

/**
 * Where unpublished work lives.
 *
 * Local mode does not implement this port — the checked-out working tree is
 * the draft workspace there, because the Astro dev server can only hot-reload
 * a change that is in the tree, and live preview is the whole value of local
 * mode. This port is for deployments where the repository is remote and a
 * save must be durable without becoming a commit.
 */
export interface DraftStore {
  /** Every pending change, oldest staging first. */
  list(): Promise<StagedChange[]>;
  get(path: string): Promise<StagedChange | null>;
  /**
   * Records changes atomically — all of them or none.
   *
   * A change replaces an existing row for the same path but keeps that row's
   * original `baseRevision`: the publish gate compares against the repository
   * as it was when the path was *first* staged, not at the latest keystroke.
   */
  stage(changes: StageInput[]): Promise<void>;
  /** Drops staged changes by path. Returns the paths that were present. */
  discard(paths: string[]): Promise<string[]>;
  /**
   * Removes exactly the rows a publication included.
   *
   * Keyed by `(path, version)` so that an autosave arriving *while* the
   * publication ran is kept: its row has a newer version and stays pending,
   * which is what "clears only what was published" means.
   */
  clearPublished(published: ReadonlyArray<{ path: string; version: number }>): Promise<void>;
  /** Replaces the recorded repository revision of one staged path. */
  rebase(path: string, baseRevision: Revision | null): Promise<void>;
  /** The branch head recorded when the draft began, for display. */
  base(): Promise<Revision | null>;
  setBase(revision: Revision | null): Promise<void>;
}

/** The API summary of one staged change. */
export function toContentChange(change: StagedChange): ContentChange {
  return {
    path: change.path,
    kind:
      change.kind === "delete" ? "delete" : change.baseRevision === null ? "create" : "update",
    updatedAt: change.updatedAt,
  };
}

/**
 * A draft store held in memory, for tests and fixtures.
 *
 * The reference implementation of the port's semantics: everything a real
 * store must do — replace-but-keep-base, versioning, publication clearing —
 * is expressed here without a database in the way.
 */
export function memoryDraftStore(): DraftStore {
  const rows = new Map<string, StagedChange>();
  let head: Revision | null = null;
  let counter = 0;

  return {
    async list() {
      return [...rows.values()].sort((a, b) => a.version - b.version);
    },

    async get(path) {
      return rows.get(path) ?? null;
    },

    async stage(changes) {
      for (const change of changes) {
        const existing = rows.get(change.path);
        const shared = {
          path: change.path,
          // First staging wins: the gate is the repository as it was then.
          baseRevision: existing ? existing.baseRevision : change.baseRevision,
          version: ++counter,
          updatedAt: new Date().toISOString(),
        };

        rows.set(
          change.path,
          change.kind === "write"
            ? { kind: "write", contents: change.contents, text: change.text, ...shared }
            : { kind: "delete", ...shared },
        );
      }
    },

    async discard(paths) {
      const removed: string[] = [];
      for (const path of paths) {
        if (rows.delete(path)) removed.push(path);
      }
      if (rows.size === 0) head = null;
      return removed;
    },

    async clearPublished(published) {
      for (const { path, version } of published) {
        const row = rows.get(path);
        if (row && row.version === version) rows.delete(path);
      }
      if (rows.size === 0) head = null;
    },

    async rebase(path, baseRevision) {
      const row = rows.get(path);
      if (row) rows.set(path, { ...row, baseRevision });
    },

    async base() {
      return head;
    },

    async setBase(revision) {
      head = revision;
    },
  };
}
