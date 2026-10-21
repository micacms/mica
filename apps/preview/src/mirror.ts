/**
 * The site's own copy of the repository: what the clone has, without Git's
 * folder and the content root, which the preview links to the clone instead.
 * The installed packages, Astro's cache and the files that an install
 * generates stay: the copy removes only files that it copied itself.
 */

import { copyFileSync, existsSync, lstatSync, mkdirSync, readdirSync, rmSync, statSync, utimesSync } from "node:fs";
import { join } from "node:path";

/** Never copied from the clone. */
const KEPT = new Set([".git", "node_modules", ".astro"]);

/**
 * Makes `target` hold what `source` has, except the folders of `KEPT` and the
 * paths in `skip` (relative, with `/`). A file is copied only when its size or
 * its time differs. Of the files in `previous`, the files of the last copy,
 * it removes those that the source no longer has. Gives the counts, and the
 * files of this copy for the next one.
 */
export function mirror(
  source: string,
  target: string,
  skip: ReadonlySet<string>,
  previous: ReadonlySet<string> = new Set(),
): { copied: number; removed: number; files: Set<string> } {
  let copied = 0;
  const files = new Set<string>();

  const copy = (relative: string): void => {
    const from = join(source, relative);
    const to = join(target, relative);
    if (existsSync(to) && !lstatSync(to).isDirectory()) rmSync(to, { force: true });
    mkdirSync(to, { recursive: true });
    for (const entry of readdirSync(from, { withFileTypes: true })) {
      const path = relative ? `${relative}/${entry.name}` : entry.name;
      if (KEPT.has(entry.name) || skip.has(path)) continue;
      if (entry.isDirectory()) {
        copy(path);
        continue;
      }
      if (!entry.isFile()) continue;
      files.add(path);
      const stats = statSync(join(from, entry.name));
      const existing = existsSync(join(to, entry.name)) ? lstatSync(join(to, entry.name)) : null;
      if (existing?.isDirectory()) rmSync(join(to, entry.name), { recursive: true, force: true });
      // Below a millisecond the time is not the same on each system after a copy.
      if (existing?.isFile() && existing.size === stats.size && Math.abs(existing.mtimeMs - stats.mtimeMs) < 1) continue;
      copyFileSync(join(from, entry.name), join(to, entry.name));
      // The clone's time stays, so that the next copy finds the file unchanged. In seconds: a Date would round it.
      utimesSync(join(to, entry.name), stats.atimeMs / 1000, stats.mtimeMs / 1000);
      copied++;
    }
  };

  copy("");
  let removed = 0;
  for (const path of previous) {
    if (files.has(path)) continue;
    const file = join(target, path);
    if (existsSync(file) && lstatSync(file).isFile()) {
      rmSync(file, { force: true });
      removed++;
    }
  }
  return { copied, removed, files };
}
