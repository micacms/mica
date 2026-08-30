/**
 * The staged connector: a draft store overlaid on a repository.
 *
 * This is how a save stops being a commit. Everything that writes content —
 * the content store, the media service — already speaks `RepositoryConnector`,
 * so staging is a decorator rather than a second write path: reads see the
 * repository *as it will be* once the pending changes are published, and
 * `commit()` records a change set into the draft store instead of sending it
 * anywhere.
 *
 * Nothing above this file can tell the difference, which is the point. The
 * editor validates, renames and autosaves exactly as before; the one thing
 * that changed is what "saved" means, and the staging service is where that
 * word is turned back into a real commit.
 *
 * `deleteTree` is resolved here, at staging time, against the overlay. The
 * draft store stays a flat map of file paths, publications never send a
 * directory operation to a provider, and "delete then recreate" composes the
 * way an editor expects instead of depending on the order of two rows.
 */

import { createHash } from "node:crypto";

import {
  ConflictError,
  ConnectorError,
  type CommitInput,
  type CommitResult,
  type DirectoryEntry,
  type DraftStore,
  type RepositoryConnector,
  type StageInput,
} from "@micacms/core";

/** A content path with no leading or trailing slash — how the store keys it. */
const clean = (path: string): string => path.replace(/^\/+|\/+$/g, "");

const toBytes = (contents: string | Uint8Array): Uint8Array =>
  typeof contents === "string" ? new TextEncoder().encode(contents) : contents;

export function stagedConnector(
  base: RepositoryConnector,
  drafts: DraftStore,
): RepositoryConnector {
  const readBytes = async (path: string): Promise<Uint8Array | null> => {
    const row = await drafts.get(clean(path));
    if (row?.kind === "write") return row.contents;
    if (row?.kind === "delete") return null;
    return base.readBinary(path);
  };

  const revisionOf = async (path: string): Promise<string | null> => {
    const row = await drafts.get(clean(path));
    // A content hash, like the local connector's: derived, never assigned, and
    // equal exactly when the staged bytes are equal.
    if (row?.kind === "write") {
      return createHash("sha256").update(row.contents).digest("hex").slice(0, 16);
    }
    if (row?.kind === "delete") return null;
    return base.revision(path);
  };

  /** Every file under `dir` as the overlay sees it — repository plus draft. */
  const filesUnder = async (dir: string): Promise<string[]> => {
    const found: string[] = [];
    const walk = async (at: string): Promise<void> => {
      for (const item of await listMerged(at)) {
        const child = at === "" ? item.name : `${at}/${item.name}`;
        if (item.type === "directory") await walk(child);
        else found.push(child);
      }
    };
    await walk(clean(dir));
    return found;
  };

  const listMerged = async (path: string): Promise<DirectoryEntry[]> => {
    const dir = clean(path);
    const prefix = dir === "" ? "" : `${dir}/`;

    const entries = new Map<string, "file" | "directory">();
    for (const item of await base.list(dir)) entries.set(item.name, item.type);

    for (const row of await drafts.list()) {
      if (!row.path.startsWith(prefix)) continue;

      const rest = row.path.slice(prefix.length);
      const slash = rest.indexOf("/");

      if (slash === -1) {
        if (row.kind === "write") entries.set(rest, "file");
        else entries.delete(rest);
        continue;
      }

      // A staged write deeper down makes the directory exist. A staged delete
      // cannot remove one — other files may remain — and a directory emptied
      // by staged deletes still lists, which is harmless: readers treat a
      // directory without its data file as absent.
      if (row.kind === "write") entries.set(rest.slice(0, slash), "directory");
    }

    return [...entries]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([name, type]) => ({ name, type }));
  };

  return {
    origin: base.origin,

    async read(path) {
      const bytes = await readBytes(path);
      return bytes === null ? null : new TextDecoder().decode(bytes);
    },

    readBinary: readBytes,

    list: listMerged,

    revision: revisionOf,

    // The branch the draft will eventually be published onto.
    head: () => base.head(),

    async commit(input: CommitInput): Promise<CommitResult> {
      if (input.changes.length === 0) {
        throw new ConnectorError("A commit needs at least one change.");
      }

      /**
       * Checked against the overlay, not the repository. This is the check
       * that keeps two browser sessions honest with *each other*: a session
       * that opened an entry before a colleague's autosave holds a revision
       * the draft has since replaced, and must lose here rather than at
       * publication, when the colleague's work would already be underneath.
       */
      if (input.expect) {
        const stale: string[] = [];
        for (const [path, expected] of Object.entries(input.expect)) {
          if ((await revisionOf(path)) !== expected) stale.push(path);
        }
        if (stale.length > 0) {
          throw new ConflictError(
            "This content changed after you opened it. Reload to see the current version.",
            stale,
          );
        }
      }

      /* -------------------------------------------------- resolution */

      type Resolved =
        | { kind: "write"; contents: Uint8Array; text: boolean }
        | { kind: "delete" };

      // Later changes win within one change set, which is what a caller that
      // wrote a list in order meant by it.
      const byPath = new Map<string, Resolved>();

      for (const change of input.changes) {
        const path = clean(change.path);

        if (change.type === "write") {
          byPath.set(path, {
            kind: "write",
            contents: toBytes(change.contents),
            text: typeof change.contents === "string",
          });
        } else if (change.type === "delete") {
          byPath.set(path, { kind: "delete" });
        } else {
          for (const file of await filesUnder(path)) byPath.set(file, { kind: "delete" });
        }
      }

      /* ----------------------------------------------------- staging */

      const wasEmpty = (await drafts.list()).length === 0;

      const inputs: StageInput[] = [];
      const drops: string[] = [];

      for (const [path, op] of byPath) {
        const existing = await drafts.get(path);
        // The publish gate: the repository as it was when this path was first
        // touched. Read from the *base*, because the overlay's answer would be
        // the draft's own hash.
        const baseRevision = existing ? existing.baseRevision : await base.revision(path);

        if (op.kind === "delete") {
          // Deleting a path the repository never had: the staged write and the
          // deletion cancel out, and nothing needs publishing at all.
          if (baseRevision === null) {
            if (existing) drops.push(path);
            continue;
          }
          inputs.push({ kind: "delete", path, baseRevision });
          continue;
        }

        inputs.push({ kind: "write", path, contents: op.contents, text: op.text, baseRevision });
      }

      if (drops.length > 0) await drafts.discard(drops);

      if (inputs.length === 0 && drops.length === 0) {
        throw new ConnectorError("Nothing in this change set exists to be changed.");
      }

      if (inputs.length > 0) {
        // The first change of a fresh draft records what it is based on — for
        // display, never for the gate, which stays per path.
        if (wasEmpty) await drafts.setBase(await base.head());
        await drafts.stage(inputs);
      }

      // Derived, like the local connector's: the draft store has no commit to
      // name, and pretending otherwise would hand the caller a token that
      // looks like one.
      const digest = createHash("sha256");
      for (const [path, op] of byPath) digest.update(op.kind).update(path);
      return { revision: `staged:${digest.digest("hex").slice(0, 12)}` };
    },
  };
}
