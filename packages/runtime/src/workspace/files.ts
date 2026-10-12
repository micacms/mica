/**
 * The content files of a working tree: the port everything reads and saves
 * through, and its one implementation.
 *
 * Four operations, as narrow as they can usefully be — read a file, list a
 * directory, ask whether something has changed, and apply a set of changes as
 * one unit. Deliberately *not* Git: applying changes writes files, and only
 * Publish turns them into a commit (`tree.ts`).
 *
 * The interface extends `ContentSource`, so `readCollection` and
 * `readSingleton` work unchanged over it. That is the point: the Astro build
 * reading a checkout and the Mica server reading its working tree run the
 * *same* discovery and parsing code, and cannot drift into disagreeing about
 * what a content directory means.
 *
 * Atomicity is what makes an entry safe to save: an entry is an `index.json`,
 * its rich-text sidecars and its media, and half of one is corruption. So
 * every file is written beside its target and renamed into place, and a
 * failure part-way through undoes the whole change set.
 */

import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, rename, rm, unlink, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import { contentPath, type ContentSource } from "@micacms/core";
import { isMissing, within } from "@micacms/core/node";

export class FilesError extends Error {
  override name = "FilesError";
}

/**
 * Raised when a file moved under an editor.
 *
 * Separate from `FilesError` because it is the one failure with a sensible
 * answer in the editor — reload and reapply — rather than a message to report.
 */
export class ConflictError extends FilesError {
  override name = "ConflictError";
  constructor(
    message: string,
    /** Paths whose revision no longer matched. */
    readonly paths: string[],
  ) {
    super(message);
  }
}

/** Who a commit names. */
export interface Author {
  name: string;
  email: string;
}

export type FileChange =
  | { type: "write"; path: string; contents: string | Uint8Array }
  | { type: "delete"; path: string }
  /** Deletes every file under `path`. Removing an entry removes its directory. */
  | { type: "deleteTree"; path: string };

export interface FileChanges {
  changes: FileChange[];
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
}

export interface AppliedChanges {
  /** A digest of what was written, for logs. Not a commit. */
  revision: string;
}

export interface ContentFiles extends ContentSource {
  /** Bytes of a file, for media. Null when there is no such file. */
  readBinary(path: string): Promise<Uint8Array | null>;

  /**
   * An opaque token for the current state of `path`, or null when it is absent.
   *
   * Only ever compared for equality — nothing above this interface may assume
   * what it is, or attempt to order two of them.
   */
  revision(path: string): Promise<string | null>;

  /** Applies every change, or none of them. Throws `ConflictError` when any `expect` no longer holds. */
  apply(input: FileChanges): Promise<AppliedChanges>;
}

/**
 * Refuses changes or expectations that name a path outside the content root,
 * or the root itself — before anything is written.
 */
export function checkChangePaths(input: FileChanges): void {
  for (const change of input.changes) contentPath(change.path);
  for (const path of Object.keys(input.expect ?? {})) contentPath(path);
}

export interface ContentFilesOptions {
  /** The content root: the directory collections and singletons live in. */
  root: string;
}

export function contentFiles(options: ContentFilesOptions): ContentFiles {
  const base = resolve(options.root);
  const full = (path: string, allowRoot = false) => within(base, path, { allowRoot });

  const readBytes = async (path: string): Promise<Uint8Array | null> => {
    try {
      return await readFile(full(path));
    } catch (error) {
      if (isMissing(error)) return null;
      throw error;
    }
  };

  return {
    origin: base,

    async read(path) {
      const bytes = await readBytes(path);
      return bytes === null ? null : Buffer.from(bytes).toString("utf8");
    },

    readBinary: readBytes,

    async list(path) {
      let items;
      try {
        items = await readdir(full(path, true), { withFileTypes: true });
      } catch (error) {
        if (isMissing(error)) return [];
        throw error;
      }

      return items
        .filter((item) => item.isFile() || item.isDirectory())
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((item) => ({ name: item.name, type: item.isFile() ? ("file" as const) : ("directory" as const) }));
    },

    /**
     * A content hash, not an mtime.
     *
     * An mtime would call a file changed when a checkout rewrote it byte for
     * byte, which happens constantly in a working tree —
     * and would then reject the editor's next save for no reason.
     */
    async revision(path) {
      const bytes = await readBytes(path);
      if (bytes === null) return null;
      return createHash("sha256").update(bytes).digest("hex").slice(0, 16);
    },

    async apply(input: FileChanges): Promise<AppliedChanges> {
      checkChangePaths(input);
      await assertExpected(this, input);

      // Everything the change set will overwrite or remove, kept so that a
      // failure part-way through can be undone. Content trees are small — a
      // few hundred files of a few kilobytes — so holding one change set in
      // memory is cheaper than any journal that would replace it.
      const undo: Array<() => Promise<void>> = [];
      const written: string[] = [];

      try {
        for (const change of input.changes) {
          if (change.type === "write") {
            const target = full(change.path);
            const previous = await readBytes(change.path);

            undo.push(async () => {
              if (previous === null) await rm(target, { force: true });
              else await writeFile(target, previous);
            });

            await mkdir(dirname(target), { recursive: true });
            // Written beside the target and renamed into place, so a reader —
            // the Astro dev server watches this directory — never observes a
            // partially written file.
            const staged = `${target}.mica-${process.pid}-${written.length}`;
            await writeFile(staged, change.contents);
            await rename(staged, target);
            written.push(staged);
            continue;
          }

          const target = full(change.path);

          if (change.type === "delete") {
            const previous = await readBytes(change.path);
            if (previous === null) continue;

            undo.push(async () => {
              await mkdir(dirname(target), { recursive: true });
              await writeFile(target, previous);
            });
            await unlink(target);
            continue;
          }

          // deleteTree
          const saved = await snapshotTree(this, change.path);
          undo.push(async () => {
            for (const [path, bytes] of saved) {
              const restored = full(path);
              await mkdir(dirname(restored), { recursive: true });
              await writeFile(restored, bytes);
            }
          });
          await rm(target, { recursive: true, force: true });
        }
      } catch (error) {
        // Reverse order, so a path written and then deleted comes back in the
        // state it started in.
        for (const step of undo.reverse()) {
          await step().catch(() => {
            // Nothing useful to do: the original failure is what matters, and
            // hiding it behind a rollback failure would help nobody.
          });
        }
        for (const staged of written) await rm(staged, { force: true }).catch(() => {});

        throw error instanceof FilesError
          ? error
          : new FilesError(
              `Could not apply changes to ${base}: ${(error as Error).message}`,
            );
      }

      // The working tree has no commit identity. A digest of what was written
      // is enough for a log line, and is honest about being derived rather
      // than assigned.
      const digest = createHash("sha256");
      for (const change of input.changes) digest.update(change.type).update(change.path);

      return { revision: `local:${digest.digest("hex").slice(0, 12)}` };
    },
  };
}

/* ------------------------------------------------------------------ */

async function assertExpected(
  files: ContentFiles,
  input: FileChanges,
): Promise<void> {
  if (!input.expect) return;

  const stale: string[] = [];
  for (const [path, expected] of Object.entries(input.expect)) {
    if ((await files.revision(path)) !== expected) stale.push(path);
  }

  if (stale.length > 0) {
    throw new ConflictError(
      "This content changed after you opened it. Reload to see the current version.",
      stale,
    );
  }
}

/** Every file under `path`, so a tree deletion can be undone. */
async function snapshotTree(
  files: ContentFiles,
  path: string,
): Promise<Array<[string, Uint8Array]>> {
  const saved: Array<[string, Uint8Array]> = [];

  const walk = async (at: string): Promise<void> => {
    for (const item of await files.list(at)) {
      const child = `${at}/${item.name}`;
      if (item.type === "directory") {
        await walk(child);
        continue;
      }
      const bytes = await files.readBinary(child);
      if (bytes !== null) saved.push([child, bytes]);
    }
  };

  await walk(path);
  return saved;
}
