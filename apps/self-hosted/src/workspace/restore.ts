/**
 * Puts paths back to how a commit has them. Two parts, because one `git
 * restore` fails as a whole when a path is in neither the commit, the index nor
 * the tree, which is how an interrupted fast-forward leaves an upstream
 * deletion.
 */

import { rm } from "node:fs/promises";
import { join } from "node:path";

import { parseStatusEntries, type GitRunner } from "@micacms/runtime";

/** `paths` are repository-relative. */
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
 * Every path under `prefix` that differs from HEAD, ignored files included: a
 * fast-forward overwrites them without asking. `--ignored=traditional` names
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
  return parseStatusEntries(raw).map((entry) => entry.path);
}

/** Repository-relative paths that differ between two commits. */
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
