/**
 * Putting a set of paths back to how one commit has them, in the index and in
 * the tree — the step behind a fast-forward's rollback, its recovery after a
 * crash, and "Use the website's version".
 *
 * Two parts, because one `git restore` over all the paths fails as a whole
 * when one of them is in neither the commit, the index nor the tree — which
 * is exactly the state an interrupted fast-forward leaves an upstream
 * deletion in. Paths the commit has are restored; paths it does not have are
 * removed from the index and from the disk.
 */

import { rm } from "node:fs/promises";
import { join } from "node:path";

import type { GitRunner } from "@micacms/runtime";

/** `paths` are relative to the repository root. */
export async function restorePaths(
  git: GitRunner,
  repositoryDir: string,
  source: string,
  paths: string[],
): Promise<void> {
  if (paths.length === 0) return;

  const inSource = new Set(
    (await git.run(["ls-tree", "-r", "-z", "--name-only", source])).split("\0").filter(Boolean),
  );
  const present = paths.filter((path) => inSource.has(path));
  const absent = paths.filter((path) => !inSource.has(path));

  if (present.length > 0) {
    await git.run(
      ["restore", `--source=${source}`, "--staged", "--worktree", "--pathspec-from-file=-", "--pathspec-file-nul"],
      { input: present.join("\0"), env: { GIT_NO_LAZY_FETCH: "1" } },
    );
  }
  if (absent.length > 0) {
    await git.run(
      ["rm", "--cached", "--ignore-unmatch", "--quiet", "--pathspec-from-file=-", "--pathspec-file-nul"],
      { input: absent.join("\0") },
    );
    for (const path of absent) await rm(join(repositoryDir, path), { force: true });
  }
}

/**
 * Every path under `prefix` that differs from HEAD: modified, staged,
 * deleted, untracked and ignored. Ignored files count, because a
 * fast-forward overwrites them without asking; `--ignored=traditional` names
 * the files inside an ignored directory, which `matching` does not.
 * Repository-relative.
 */
export async function draftPaths(git: GitRunner, prefix: string): Promise<string[]> {
  const raw = await git.run(
    [
      "status",
      "--porcelain=v1",
      "-z",
      "-uall",
      "--ignored=traditional",
      "--no-renames",
      "--",
      prefix === "" ? "." : prefix,
    ],
    { env: { GIT_OPTIONAL_LOCKS: "0" } },
  );
  return raw
    .split("\0")
    .filter((field) => field.length > 3)
    .map((field) => field.slice(3));
}

/** Paths that differ between two commits, without rename detection. Repository-relative. */
export async function changedBetween(git: GitRunner, from: string, to: string, prefix?: string): Promise<string[]> {
  const raw = await git.run([
    "diff",
    "--no-renames",
    "--name-only",
    "-z",
    from,
    to,
    ...(prefix === undefined ? [] : ["--", prefix === "" ? "." : prefix]),
  ]);
  return raw.split("\0").filter(Boolean);
}
