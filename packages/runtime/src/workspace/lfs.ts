/**
 * Git LFS under the content root. The site owner sets the LFS paths in
 * `.gitattributes`; Mica never writes that file. This reads `.gitattributes`
 * itself, so one answer serves a ref and the working tree. A pattern that
 * might match counts: a false alarm costs one LFS call, a miss sends whole
 * files where LFS should hold pointers.
 */

import { readFile } from "node:fs/promises";
import { join } from "node:path";

import type { GitRunner } from "./git.js";

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

/** Whether the `.gitattributes` text of `file` can assign LFS to a path under `root`. */
export function assignsLfsUnder(file: string, text: string, root: string): boolean {
  const place = attributesPlace(file, root);
  if (!place) return false;
  for (const line of text.split("\n")) {
    const [pattern, ...attributes] = line.trim().split(/\s+/);
    if (!pattern || pattern.startsWith("#")) continue;
    if (!attributes.includes("filter=lfs")) continue;
    if (place === "below" || mayMatchUnder(pattern, relativeRoot(root, attributesDir(file)))) return true;
  }
  return false;
}

/** The `.gitattributes` file that assigns LFS under `root` at `ref`, or null. */
export async function lfsUnderRoot(git: GitRunner, ref: string, root: string): Promise<string | null> {
  const listed = await git.run(["ls-tree", "-r", "-z", "--name-only", ref]);
  for (const file of listed.split("\0")) {
    if (!attributesPlace(file, root)) continue;
    if (assignsLfsUnder(file, await git.run(["show", `${ref}:${file}`]), root)) return file;
  }
  return null;
}

/**
 * The `.gitattributes` file in the working tree, tracked or not, that assigns
 * LFS under `root`, or null. `repositoryDir` is where `git` runs.
 */
export async function lfsUnderRootInTree(git: GitRunner, repositoryDir: string, root: string): Promise<string | null> {
  const listed = await git.run(["ls-files", "-z", "--cached", "--others", "--exclude-standard"]);
  for (const file of new Set(listed.split("\0"))) {
    if (!attributesPlace(file, root)) continue;
    const text = await readFile(join(repositoryDir, file), "utf8").catch(() => null);
    if (text !== null && assignsLfsUnder(file, text, root)) return file;
  }
  return null;
}

/**
 * Sends the LFS objects of the commits on `ref` that `remote` does not have.
 * Mica runs no hooks on a server, and a checkout can lack the LFS pre-push
 * hook, so this does what that hook does.
 */
export function pushLfsObjects(git: GitRunner, remote: string, ref: string, timeoutMs?: number): Promise<string> {
  return git.run(["lfs", "push", remote, ref], timeoutMs === undefined ? {} : { timeoutMs });
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
