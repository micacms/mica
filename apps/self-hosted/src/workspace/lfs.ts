/**
 * With filters off (`isolation.ts`), Mica would commit whole files where LFS
 * should hold pointers, so it refuses LFS. `git check-attr` cannot tell,
 * because the isolation attributes unset every filter, so this reads
 * `.gitattributes`. A pattern that might match counts: a false alarm costs a
 * configuration change, a miss costs the repository.
 */

import type { GitRunner } from "@micacms/runtime";

/**
 * Whether `path` is a `.gitattributes` file in `root` or below it, in an
 * ancestor of `root`, or neither.
 */
export function attributesPlace(path: string, root: string): "below" | "above" | null {
  if (path !== ".gitattributes" && !path.endsWith("/.gitattributes")) return null;
  const dir = attributesDir(path);
  if (root === "" || dir === root || dir.startsWith(`${root}/`)) return "below";
  if (dir === "" || root.startsWith(`${dir}/`)) return "above";
  return null;
}

/** The `.gitattributes` file that assigns LFS under `root` at `ref`, or null. */
export async function lfsUnderRoot(git: GitRunner, ref: string, root: string): Promise<string | null> {
  const listed = await git.run(["ls-tree", "-r", "-z", "--name-only", ref]);
  for (const file of listed.split("\0")) {
    const place = attributesPlace(file, root);
    if (!place) continue;

    const text = await git.run(["show", `${ref}:${file}`]);
    for (const line of text.split("\n")) {
      const [pattern, ...attributes] = line.trim().split(/\s+/);
      if (!pattern || pattern.startsWith("#")) continue;
      if (!attributes.includes("filter=lfs")) continue;
      if (place === "below" || mayMatchUnder(pattern, relativeRoot(root, attributesDir(file)))) return file;
    }
  }
  return null;
}

function attributesDir(path: string): string {
  return path === ".gitattributes" ? "" : path.slice(0, -"/.gitattributes".length);
}

/** The root as seen from `dir`, an ancestor of it. */
function relativeRoot(root: string, dir: string): string {
  return dir === "" ? root : root.slice(dir.length + 1);
}

/**
 * Whether a pattern from an ancestor's `.gitattributes` can match a path
 * under `root` (relative to that ancestor). A pattern without a slash matches
 * a name at any depth; one with a slash is anchored, and matches under the
 * root when its literal start does not lead somewhere else.
 */
function mayMatchUnder(pattern: string, root: string): boolean {
  // A trailing slash only says "a directory"; it does not anchor the pattern.
  const anchored = pattern.replace(/^\//, "").replace(/\/$/, "");
  if (!anchored.includes("/") && !pattern.startsWith("/")) return true;
  const literal = anchored.split(/[*?[]/)[0]!;
  return literal === "" || literal.startsWith(`${root}/`) || `${root}/`.startsWith(literal);
}
