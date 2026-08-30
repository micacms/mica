/**
 * The local connector: a working tree on disk.
 *
 * What `mica dev` uses. The editor writes into the developer's checkout, the
 * Astro dev server notices the files and reloads, and the developer commits
 * with their own tools. Deliberately *not* a Git client — there is no commit,
 * no author configuration and no credential handling here, because in local
 * mode the person at the keyboard already has all three and does the job
 * better than Mica would.
 *
 * `commit()` therefore means "apply this change set to the working tree". The
 * name is the connector's, not Git's, and the atomicity it promises is what
 * makes an entry safe to save: an entry is an `index.json`, its rich-text
 * sidecars and its media, and half of one is corruption.
 */

import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, rename, rm, unlink, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import { isMissing, within } from "@micacms/core/node";

import {
  ConflictError,
  ConnectorError,
  type CommitInput,
  type CommitResult,
  type RepositoryConnector,
} from "@micacms/core";

export interface LocalConnectorOptions {
  /** The content root: the directory collections and singletons live in. */
  root: string;
}

export function localConnector(options: LocalConnectorOptions): RepositoryConnector {
  const base = resolve(options.root);
  const full = (path: string) => within(base, path);

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
        items = await readdir(full(path), { withFileTypes: true });
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
     * byte, which happens constantly in the workflow this connector serves —
     * and would then reject the editor's next save for no reason.
     */
    async revision(path) {
      const bytes = await readBytes(path);
      if (bytes === null) return null;
      return createHash("sha256").update(bytes).digest("hex").slice(0, 16);
    },

    // A working tree has no commit identity; asking Git about the checkout is
    // the local publisher's business, deliberately not this connector's.
    async head() {
      return null;
    },

    async commit(input: CommitInput): Promise<CommitResult> {
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

        throw error instanceof ConnectorError
          ? error
          : new ConnectorError(
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
  connector: RepositoryConnector,
  input: CommitInput,
): Promise<void> {
  if (!input.expect) return;

  const stale: string[] = [];
  for (const [path, expected] of Object.entries(input.expect)) {
    if ((await connector.revision(path)) !== expected) stale.push(path);
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
  connector: RepositoryConnector,
  path: string,
): Promise<Array<[string, Uint8Array]>> {
  const saved: Array<[string, Uint8Array]> = [];

  const walk = async (at: string): Promise<void> => {
    for (const item of await connector.list(at)) {
      const child = `${at}/${item.name}`;
      if (item.type === "directory") {
        await walk(child);
        continue;
      }
      const bytes = await connector.readBinary(child);
      if (bytes !== null) saved.push([child, bytes]);
    }
  };

  await walk(path);
  return saved;
}
