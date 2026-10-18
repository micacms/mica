/**
 * The content files of a working tree: the port everything reads and saves
 * through, and its implementation. It extends `ContentSource`, so the Astro
 * build and Mica share the same content reading code. `apply` is atomic: an
 * entry is several files, and half of one is corruption.
 */

import { createHash } from "node:crypto";
import { createReadStream, createWriteStream, type Stats } from "node:fs";
import { copyFile, mkdir, open, readdir, readFile, realpath, rename, rm, stat, writeFile } from "node:fs/promises";
import { dirname, resolve, sep } from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";

import { contentPath, ContentPathError, type ContentSource } from "@micacms/core/internal";
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
  /**
   * Copies a file on disk, without reading it into memory: media of a renamed
   * entry, or an upload. A change that removes `from` must come after it.
   */
  | { type: "copy"; from: string; path: string }
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

/** An upload that went over its limit. */
export class TooLargeError extends FilesError {
  override name = "TooLargeError";
}

export interface ContentFiles extends ContentSource {
  /** The first `length` bytes of a file, for its type and size. Null when there is no such file. */
  readHead(path: string, length: number): Promise<Uint8Array | null>;

  /** A file as a stream, for the editor's file route. Null when there is no such file. */
  readStream(path: string): Promise<ReadableStream<Uint8Array> | null>;

  /**
   * Writes a stream to a new temporary file at `path` (`*.mica-<pid>-<n>`), at
   * most `limit` bytes, and returns its size and its first bytes. Throws
   * `TooLargeError` over the limit. `apply` copies it into place.
   */
  receive(path: string, body: ReadableStream<Uint8Array>, limit: number): Promise<{ size: number; head: Uint8Array }>;

  /** Size and last change of a file, without reading it. Null when there is no such file. */
  stat(path: string): Promise<FileStat | null>;

  /**
   * An opaque token for the current state of `path`, or null when it is absent.
   * Compare only for equality.
   */
  revision(path: string): Promise<string | null>;

  /**
   * Applies every change, or none of them. Throws `ConflictError` when any
   * `expect` no longer holds. `after` runs before the write lock ends, with
   * files that take no lock, so that a revision it reads is of this write.
   */
  apply<T = void>(input: FileChanges, after?: (files: ContentFiles) => Promise<T>): Promise<T>;
}

/**
 * Refuses, before any write, a change or expectation that names the content
 * root or a path outside it.
 */
function checkChangePaths(input: FileChanges): void {
  for (const change of input.changes) {
    contentPath(change.path);
    if (change.type === "copy") contentPath(change.from);
  }
  for (const path of Object.keys(input.expect ?? {})) contentPath(path);
}

export interface ContentFilesOptions {
  root: string;
}

/** Bytes of a file's head that the upload keeps: enough for its type and its dimensions. */
export const HEAD_BYTES = 512 * 1024;

/** Files hashed at the same time: `/changes` asks for every pending file at once. */
const PARALLEL_HASHES = 8;

/** A temporary name beside `target`, which `git status` and the readers skip. */
let temporaryCount = 0;
const temporaryName = (target: string) => `${target}.mica-${process.pid}-${temporaryCount++}`;

export function contentFiles(options: ContentFilesOptions): ContentFiles {
  const base = resolve(options.root);
  let realBase: Promise<string> | undefined;

  /**
   * The path on disk. `within` checks the text of the path; a symbolic link in
   * the working tree could still lead out of the root, so the real location of
   * the deepest part that exists must stay inside the real root.
   */
  const full = async (path: string, allowRoot = false): Promise<string> => {
    const absolute = within(base, path, { allowRoot });
    realBase ??= realpath(base).catch(() => base);
    const root = await realBase;
    for (let probe = absolute; ; probe = dirname(probe)) {
      const real = await realpath(probe).catch((error: unknown) => (isMissing(error) ? null : Promise.reject(error)));
      if (real === null) {
        if (dirname(probe) === probe) return absolute;
        continue;
      }
      if (real !== root && !real.startsWith(root + sep)) {
        throw new ContentPathError(`Content path "${path}" leads out of the content root through a symbolic link.`);
      }
      return absolute;
    }
  };

  /** Null for a missing file, so that every reader answers "absent" the same way. */
  const missingAsNull = <T>(error: unknown): T | null => {
    if (isMissing(error)) return null;
    throw error;
  };

  const statOrNull = (target: string) => stat(target).catch((error: unknown) => missingAsNull<Stats>(error));

  /**
   * Digests by path, reused while the file's size, change times and inode stay
   * the same: opening an entry with many photos hashes them once, not each time.
   */
  const digests = new Map<string, { key: string; digest: string }>();
  let hashing = 0;
  const waiting: Array<() => void> = [];
  const hashFile = async (target: string): Promise<string> => {
    if (hashing >= PARALLEL_HASHES) await new Promise<void>((resolve) => waiting.push(resolve));
    hashing += 1;
    try {
      const hash = createHash("sha256");
      await pipeline(createReadStream(target), hash);
      return hash.digest("hex").slice(0, 16);
    } finally {
      hashing -= 1;
      waiting.shift()?.();
    }
  };

  const files: ContentFiles = {
    origin: base,

    async read(path) {
      try {
        return await readFile(await full(path), "utf8");
      } catch (error) {
        return missingAsNull(error);
      }
    },

    async readHead(path, length) {
      let handle;
      try {
        handle = await open(await full(path), "r");
      } catch (error) {
        return missingAsNull(error);
      }
      try {
        const buffer = Buffer.alloc(length);
        const { bytesRead } = await handle.read(buffer, 0, length, 0);
        return new Uint8Array(buffer.subarray(0, bytesRead));
      } finally {
        await handle.close();
      }
    },

    async readStream(path) {
      const target = await full(path);
      const info = await statOrNull(target);
      if (!info?.isFile()) return null;
      return Readable.toWeb(createReadStream(target)) as ReadableStream<Uint8Array>;
    },

    async receive(path, body, limit) {
      const target = await full(path);
      await mkdir(dirname(target), { recursive: true });
      let size = 0;
      const head: Buffer[] = [];
      let headSize = 0;
      const count = new Transform({
        transform(chunk: Buffer, _encoding, done) {
          size += chunk.length;
          if (size > limit) return done(new TooLargeError(`The file is larger than ${limit} bytes.`));
          if (headSize < HEAD_BYTES) {
            head.push(chunk.subarray(0, HEAD_BYTES - headSize));
            headSize += Math.min(chunk.length, HEAD_BYTES - headSize);
          }
          done(null, chunk);
        },
      });
      try {
        await pipeline(Readable.fromWeb(body as never), count, createWriteStream(target, { flags: "wx" }));
      } catch (error) {
        await rm(target, { force: true });
        throw error;
      }
      return { size, head: new Uint8Array(Buffer.concat(head)) };
    },

    async stat(path) {
      try {
        const info = await stat(await full(path));
        return info.isFile() ? { size: info.size, modifiedAt: info.mtime.toISOString() } : null;
      } catch (error) {
        return missingAsNull(error);
      }
    },

    async list(path) {
      let items;
      try {
        items = await readdir(await full(path, true), { withFileTypes: true });
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
      const target = await full(path);
      const info = await statOrNull(target);
      if (!info?.isFile()) return null;
      const key = `${info.size}:${info.mtimeMs}:${info.ctimeMs}:${info.ino}`;
      const known = digests.get(path);
      if (known?.key === key) return known.digest;
      const digest = await hashFile(target);
      if (digests.size >= 20_000) digests.clear();
      digests.set(path, { key, digest });
      return digest;
    },

    async apply<T>(input: FileChanges, after?: (files: ContentFiles) => Promise<T>): Promise<T> {
      checkChangePaths(input);
      await assertExpected(files, input);

      // Each overwritten or removed file or folder is renamed aside, and renamed
      // back on a failure: no copy in memory, however large the media.
      const undo: Array<() => Promise<void>> = [];
      const aside: string[] = [];
      const staging: string[] = [];

      /** Renames what is at `target` aside, if anything is. */
      const putAside = async (target: string): Promise<void> => {
        const kept = temporaryName(target);
        try {
          await rename(target, kept);
        } catch (error) {
          if (isMissing(error)) return;
          throw error;
        }
        aside.push(kept);
        undo.push(async () => {
          await rm(target, { recursive: true, force: true });
          await rename(kept, target);
        });
      };

      try {
        for (const change of input.changes) {
          const target = await full(change.path);

          if (change.type === "write" || change.type === "copy") {
            await mkdir(dirname(target), { recursive: true });
            // Write beside the target and rename, so a reader (the Astro dev
            // server) never sees a partial file.
            const staged = temporaryName(target);
            staging.push(staged);
            if (change.type === "write") await writeFile(staged, change.contents);
            else await copyFile(await full(change.from), staged);
            await putAside(target);
            undo.push(() => rm(target, { force: true }));
            await rename(staged, target);
            continue;
          }

          // A delete and a tree delete are the same move aside; a missing file is already gone.
          await putAside(target);
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
      for (const kept of aside) await rm(kept, { recursive: true, force: true });
      return (await after?.(files)) as T;
    },
  };
  return files;
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
