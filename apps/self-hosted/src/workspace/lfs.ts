/**
 * Whether a commit puts Git LFS under the content root.
 *
 * Mica does not support LFS yet: with filters off (`isolation.ts`) it would
 * commit whole files to paths that LFS should hold. So it refuses, and it has
 * to find out by reading the `.gitattributes` files of a commit itself —
 * `git check-attr` cannot answer, because the isolation attributes unset
 * every filter. When a pattern might match under the root, the answer is
 * yes: a false alarm costs a configuration change, a miss costs the
 * repository.
 */

import type { GitRunner } from "@micacms/runtime";

/** The `.gitattributes` file that assigns LFS under `root` at `ref`, or null. */
export async function lfsUnderRoot(git: GitRunner, ref: string, root: string): Promise<string | null> {
  const listed = await git.run(["ls-tree", "-r", "-z", "--name-only", ref]);
  const files = listed.split("\0").filter((path) => path === ".gitattributes" || path.endsWith("/.gitattributes"));

  for (const file of files) {
    const dir = file === ".gitattributes" ? "" : file.slice(0, -"/.gitattributes".length);
    // Only files that can apply under the root: in the root or below it, or
    // in one of its ancestors.
    const below = root === "" || dir === root || dir.startsWith(`${root}/`);
    const above = dir === "" || root === dir || root.startsWith(`${dir}/`);
    if (!below && !above) continue;

    const text = await git.run(["show", `${ref}:${file}`]);
    for (const line of text.split("\n")) {
      const [pattern, ...attributes] = line.trim().split(/\s+/);
      if (!pattern || pattern.startsWith("#")) continue;
      if (!attributes.includes("filter=lfs")) continue;
      if (below || mayMatchUnder(pattern, relativeRoot(root, dir))) return file;
    }
  }
  return null;
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
