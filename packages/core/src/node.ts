/**
 * @micacms/core/node — the parts that need a filesystem.
 *
 * A separate entry point because the main one is bundled into the editor, which
 * runs in a browser. A `node:fs` import in that graph is at best dead weight and
 * at worst a build failure, so the boundary is drawn here rather than left to a
 * bundler to work out.
 */

import { createHash } from "node:crypto";
import { realpathSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, join, resolve, sep } from "node:path";

import { contentPath, ContentPathError, type ContentSource, type DirectoryEntry } from "./source.js";

/**
 * Reads a content directory in a checked-out repository.
 *
 * A missing file is not an error: an entry with no rich text has no `.mdoc`
 * beside it, and a collection an editor has not filled in yet is an empty
 * directory. Refusing to build over either would be wrong. Anything else — a
 * permission problem, a path that escapes the root — is raised, because it
 * means the content that was asked for is not there.
 */
export function fileSystemSource(root: string): ContentSource {
  const base = resolve(root);

  return {
    origin: base,

    async read(path) {
      try {
        return await readFile(within(base, path, { allowRoot: true }), "utf8");
      } catch (error) {
        if (isMissing(error)) return null;
        throw error;
      }
    },

    async list(path) {
      let items;
      try {
        items = await readdir(within(base, path, { allowRoot: true }), { withFileTypes: true });
      } catch (error) {
        if (isMissing(error)) return [];
        throw error;
      }

      return items
        .filter((item) => item.isFile() || item.isDirectory())
        // Sorted here rather than at each call site, so that a build never
        // depends on the order a filesystem happens to report.
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((item): DirectoryEntry => ({ name: item.name, type: item.isFile() ? "file" : "directory" }));
    },
  };
}

/**
 * Resolves `path` inside `base`, or refuses.
 *
 * Exported because every filesystem-backed implementation needs exactly this
 * check, and it is the boundary where a traversal would become a real read or
 * a real write. The root itself is refused unless `allowRoot` is set, so that a
 * write or a delete can never name the whole content root.
 */
export function within(base: string, path: string, options: { allowRoot?: boolean } = {}): string {
  // Before `contentPath` drops the leading slash: on disk, `/etc/passwd` is a real place.
  if (isAbsolute(path)) {
    throw new ContentPathError(`Content path "${path}" must be relative to the content root.`);
  }
  const relative = contentPath(path, options);

  const full = resolve(base, relative);
  // A second check after resolving: `startsWith(base)` alone would accept a sibling called `content-old`.
  if (full !== base && !full.startsWith(base + sep)) {
    throw new ContentPathError(`Content path "${path}" escapes the content root.`);
  }
  return full;
}

/** ENOENT, and ENOTDIR for a path whose parent turned out to be a file. */
export function isMissing(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException | null)?.code;
  return code === "ENOENT" || code === "ENOTDIR";
}

/** What `astro dev` writes while it runs for a content root, for the local editor's "Preview". */
export interface DevServerMarker {
  pid: number;
  /** The dev server's address with the site's base path, without a trailing slash: `http://localhost:4321`. */
  address: string;
}

/**
 * Where the marker of a content root is: a file in the system's temp folder,
 * named by the content root's real path. Never in the repository, so no
 * `.gitignore` is needed and it never shows as a change.
 */
export function devServerMarkerPath(contentRoot: string): string {
  let real = resolve(contentRoot);
  try {
    real = realpathSync(real);
  } catch {
    // A content root that does not exist yet has no other name.
  }
  return join(tmpdir(), "mica", `dev-server-${createHash("sha256").update(real).digest("hex").slice(0, 16)}.json`);
}
