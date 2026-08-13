/**
 * Media storage abstraction.
 *
 * The CMS only ever sees this interface, so an S3 or R2 backend can be added
 * later without touching routes or repositories. V1 ships the local filesystem
 * implementation only — an SME deployment is one container and one volume.
 */

import { createReadStream } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";

export interface StoredObject {
  stream: ReadableStream<Uint8Array>;
  size: number;
  /** Weak validator built from size and mtime; media bytes are immutable. */
  etag: string;
}

export interface MediaStorage {
  put(key: string, data: Uint8Array): Promise<void>;
  /** `range` is inclusive on both ends, matching the HTTP header. */
  get(key: string, range?: { start: number; end: number }): Promise<StoredObject | null>;
  delete(key: string): Promise<void>;
  exists(key: string): Promise<boolean>;
  /** Total bytes held, for the dashboard. */
  usage(): Promise<{ files: number; bytes: number }>;
}

/**
 * Storage keys are generated, never user-supplied, but this is the boundary
 * where a traversal would become a filesystem write — so it is enforced here
 * rather than assumed upstream.
 */
const KEY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

export class StorageError extends Error {
  override name = "StorageError";
}

function assertSafeKey(key: string): void {
  if (!KEY_PATTERN.test(key) || key.includes("..")) {
    throw new StorageError(`Refusing to use unsafe storage key: ${JSON.stringify(key)}`);
  }
}

export interface LocalStorageOptions {
  /** Directory the files live in. Created on first use. */
  directory: string;
}

/** Hermetic backend for the test suite — same contract, no filesystem. */
export function memoryStorage(): MediaStorage {
  const files = new Map<string, Uint8Array>();

  return {
    async put(key, data) {
      assertSafeKey(key);
      files.set(key, data);
    },

    async get(key, range) {
      assertSafeKey(key);
      const data = files.get(key);
      if (!data) return null;

      const start = range ? Math.max(0, range.start) : 0;
      const end = range ? Math.min(range.end, data.byteLength - 1) : data.byteLength - 1;
      const slice = data.subarray(start, end + 1);

      return {
        stream: new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(slice);
            controller.close();
          },
        }),
        size: slice.byteLength,
        etag: `"${data.byteLength.toString(16)}-mem"`,
      };
    },

    async delete(key) {
      files.delete(key);
    },

    async exists(key) {
      return files.has(key);
    },

    async usage() {
      let bytes = 0;
      for (const data of files.values()) bytes += data.byteLength;
      return { files: files.size, bytes };
    },
  };
}

export function localStorage(options: LocalStorageOptions): MediaStorage {
  const root = path.resolve(options.directory);
  let ready: Promise<void> | null = null;

  const ensureDirectory = (): Promise<void> => {
    ready ??= fs.mkdir(root, { recursive: true }).then(() => undefined);
    return ready;
  };

  const resolve = (key: string): string => {
    assertSafeKey(key);
    const full = path.join(root, key);
    // Defence in depth: even with the pattern check, never escape the root.
    if (path.relative(root, full).startsWith("..")) {
      throw new StorageError(`Resolved path escapes the media directory: ${key}`);
    }
    return full;
  };

  return {
    async put(key, data) {
      await ensureDirectory();
      const target = resolve(key);
      // Write to a temporary name first so a crash mid-write cannot leave a
      // truncated file behind a valid database row.
      const temp = `${target}.${process.pid}.tmp`;
      await fs.writeFile(temp, data, { flag: "wx" });
      await fs.rename(temp, target);
    },

    async get(key, range) {
      const target = resolve(key);

      let stat: Awaited<ReturnType<typeof fs.stat>>;
      try {
        stat = await fs.stat(target);
      } catch {
        return null;
      }
      if (!stat.isFile()) return null;

      const start = range ? Math.max(0, range.start) : 0;
      const end = range ? Math.min(range.end, stat.size - 1) : stat.size - 1;
      const nodeStream = createReadStream(target, range ? { start, end } : undefined);

      return {
        stream: Readable.toWeb(nodeStream) as ReadableStream<Uint8Array>,
        size: range ? end - start + 1 : stat.size,
        etag: `"${stat.size.toString(16)}-${stat.mtimeMs.toString(16)}"`,
      };
    },

    async delete(key) {
      try {
        await fs.unlink(resolve(key));
      } catch (error) {
        // Already gone is the desired end state.
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
    },

    async exists(key) {
      try {
        await fs.access(resolve(key));
        return true;
      } catch {
        return false;
      }
    },

    async usage() {
      await ensureDirectory();
      const names = await fs.readdir(root);
      let files = 0;
      let bytes = 0;

      for (const name of names) {
        if (name.endsWith(".tmp")) continue;
        try {
          const stat = await fs.stat(path.join(root, name));
          if (!stat.isFile()) continue;
          files++;
          bytes += stat.size;
        } catch {
          // Raced with a delete; skip it.
        }
      }

      return { files, bytes };
    },
  };
}
