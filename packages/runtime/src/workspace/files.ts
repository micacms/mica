/**
 * The content files of a working tree: the port everything reads and saves
 * through, and its implementation. It extends `ContentSource`, so the Astro
 * build and Mica share the same content reading code. `apply` is atomic: an
 * entry is several files, and half of one is corruption.
 */

import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, rename, rm, stat, unlink, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import { contentPath, type ContentSource } from "@micacms/core/internal";
import { isMissing, within } from "@micacms/core/node";

export class FilesError extends Error {
  override name = "FilesError";
}

/** A file changed under an editor. The editor can recover: reload and apply again. */
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

export interface FileStat {
  size: number;
  /** ISO 8601. */
  modifiedAt: string;
}

export interface FileChanges {
  changes: FileChange[];
  /**
   * Revisions the edit was based on, per path, so editors of different entries
   * never block each other. Null asserts that the path does not exist. Omitted,
   * the write is unconditional.
   */
  expect?: Record<string, string | null>;
}

export interface ContentFiles extends ContentSource {
  /** Bytes of a file, for media. Null when there is no such file. */
  readBinary(path: string): Promise<Uint8Array | null>;

  /** Size and last change of a file, without reading it. Null when there is no such file. */
  stat(path: string): Promise<FileStat | null>;

  /**
   * An opaque token for the current state of `path`, or null when it is absent.
   * Compare only for equality.
   */
  revision(path: string): Promise<string | null>;

  /**
   * Applies every change, or none of them. Throws `ConflictError` when any
   * `expect` no longer holds.
   */
  apply(input: FileChanges): Promise<void>;
}

/**
 * Refuses, before any write, a change or expectation that names the content
 * root or a path outside it.
 */
export function checkChangePaths(input: FileChanges): void {
  for (const change of input.changes) contentPath(change.path);
  for (const path of Object.keys(input.expect ?? {})) contentPath(path);
}

export interface ContentFilesOptions {
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

    async stat(path) {
      try {
        const info = await stat(full(path));
        return info.isFile() ? { size: info.size, modifiedAt: info.mtime.toISOString() } : null;
      } catch (error) {
        if (isMissing(error)) return null;
        throw error;
      }
    },

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
     * A content hash, not an mtime: a checkout that rewrites identical bytes
     * must not cause a conflict.
     */
    async revision(path) {
      const bytes = await readBytes(path);
      if (bytes === null) return null;
      return createHash("sha256").update(bytes).digest("hex").slice(0, 16);
    },

    async apply(input: FileChanges): Promise<void> {
      checkChangePaths(input);
      await assertExpected(this, input);

      // In-memory undo of every overwrite and removal. Content trees are small,
      // so no journal is necessary.
      const undo: Array<() => Promise<void>> = [];
      const staging: string[] = [];

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
            // Write beside the target and rename, so a reader (the Astro dev
            // server) never sees a partial file.
            const staged = `${target}.mica-${process.pid}-${staging.length}`;
            staging.push(staged);
            await writeFile(staged, change.contents);
            await rename(staged, target);
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
        // Reverse order, so a path written and then deleted comes back in its first state.
        for (const step of undo.reverse()) {
          // The original failure is what matters, not a rollback failure.
          await step().catch(() => {});
        }
        for (const staged of staging) await rm(staged, { force: true }).catch(() => {});

        throw error instanceof FilesError
          ? error
          : new FilesError(
              `Could not apply changes to ${base}: ${(error as Error).message}`,
            );
      }
    },
  };
}

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
