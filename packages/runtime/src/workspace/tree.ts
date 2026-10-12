/**
 * Git operations on a working tree whose content root is the draft workspace.
 *
 * What both owners of a tree need — the developer's checkout and a clone that
 * Mica keeps itself: finding the repository, reading what Git thinks of the
 * content root, committing an explicit path set, discarding a change, and
 * reading the published side from HEAD. Who pushes, and how, is the owner
 * policy's business (`policy.ts`).
 *
 * Every operation is limited to paths under the content root. Mica never runs
 * `git add -A` over the repository, so unrelated work in the same checkout is
 * never swept into an editor's commit. Paths are passed with
 * `--literal-pathspecs`: a file called `tour[1].json` is not a pattern that
 * also matches `tour1.json`.
 */

/** Git's global option that makes every path argument a literal path. */
export const LITERAL = "--literal-pathspecs";

import { realpath, rm } from "node:fs/promises";
import { join, relative, sep } from "node:path";

import type { Author, ContentChange, ContentSource, DirectoryEntry } from "@micacms/core";
import { within } from "@micacms/core/node";

import { GitError, gitRunner, type GitRunner, type GitRunnerOptions } from "./git.js";

/** A content root inside a Git repository. */
export interface GitTree {
  /** Runs in the repository root. */
  git: GitRunner;
  /** Content root relative to the repository root; "" when they coincide. */
  prefix: string;
  /** Absolute path of the content root. */
  contentRoot: string;
}

/** A changed file plus what only Git status knows about it. */
export interface TreeChange extends ContentChange {
  /** Not yet known to Git — discarding means deleting, not restoring. */
  untracked: boolean;
  /** Mid-merge conflict markers. Unpublishable until resolved with Git tools. */
  conflicted: boolean;
}

/**
 * Finds the repository the content root sits in, freshly each time: a
 * `git init` after startup should start working, not require a restart.
 */
export async function locateTree(
  contentRoot: string,
  options: GitRunnerOptions = {},
): Promise<GitTree | { reason: string }> {
  const probe = gitRunner(contentRoot, options);
  try {
    const repoRoot = await probe.run(["rev-parse", "--show-toplevel"]);
    // Git reports the toplevel with symlinks resolved (`/private/var` where
    // the caller said `/var`, on macOS). Resolve our side the same way, or
    // the relative prefix walks out of the repository.
    const resolved = await realpath(contentRoot);
    return {
      git: gitRunner(repoRoot, options),
      prefix: toPosix(relative(repoRoot, resolved)),
      contentRoot,
    };
  } catch (error) {
    return {
      reason:
        error instanceof GitError && error.exitCode === null
          ? error.message
          : "The content directory is not inside a Git repository.",
    };
  }
}

/** The content root's changes, as `git status` sees them. */
export async function listTreeChanges(tree: GitTree): Promise<TreeChange[]> {
  // `-uall` because Git collapses a fully-untracked directory to one line,
  // and a brand-new entry is exactly that. The change list must name files.
  const raw = await tree.git.run([
    LITERAL,
    "status",
    "--porcelain=v1",
    "-z",
    "-uall",
    "--",
    tree.prefix === "" ? "." : tree.prefix,
  ]);
  return parseStatus(raw, tree.prefix);
}

/**
 * Stages and commits exactly `paths` (content-root relative) and returns the
 * new HEAD. The pathspec limits both operations, so anything else in the
 * index or the tree — staged or not — stays where it was. Without an
 * `author`, Git's configured identity writes the commit.
 */
export async function commitPaths(
  tree: GitTree,
  paths: string[],
  message: string,
  author?: Author,
): Promise<string> {
  const inRepository = await stagePaths(tree, paths);
  const as = author ? [`--author=${author.name} <${author.email}>`] : [];
  await tree.git.run([LITERAL, "commit", "-m", message, ...as, "--", ...inRepository]);
  return tree.git.run(["rev-parse", "HEAD"]);
}

/**
 * Commits `paths` again with the message, author and author date of
 * `original` — a publication re-made on a newer base after its push was
 * rejected. Returns the new HEAD.
 */
export async function recommitPaths(tree: GitTree, paths: string[], original: string): Promise<string> {
  const inRepository = await stagePaths(tree, paths);
  await tree.git.run([LITERAL, "commit", "-C", original, "--", ...inRepository]);
  return tree.git.run(["rev-parse", "HEAD"]);
}

/** `git add` first: `git commit -- <paths>` alone refuses a file Git has never seen. */
async function stagePaths(tree: GitTree, paths: string[]): Promise<string[]> {
  const inRepository = paths.map((path) => inRepo(tree.prefix, path));
  for (const batch of chunked(inRepository, 500)) {
    await tree.git.run([LITERAL, "add", "-A", "--", ...batch]);
  }
  return inRepository;
}

/** Puts one changed file back to its HEAD version, or removes it if HEAD has none. */
export async function discardChange(tree: GitTree, change: TreeChange): Promise<void> {
  if (change.kind === "create") {
    // Nothing to restore: before this change there was no file. A creation
    // already staged is unstaged first, so the index does not keep pointing
    // at a file that is gone.
    if (!change.untracked) {
      await tree.git.tryRun([LITERAL, "rm", "--cached", "--force", "--", inRepo(tree.prefix, change.path)]);
    }
    await rm(within(tree.contentRoot, change.path), { force: true });
    return;
  }
  await tree.git.run([
    LITERAL,
    "restore",
    "--source=HEAD",
    "--staged",
    "--worktree",
    "--",
    inRepo(tree.prefix, change.path),
  ]);
}

/** HEAD's commit id, or null before the first commit. */
export function headRevision(tree: GitTree): Promise<string | null> {
  return tree.git.tryRun(["rev-parse", "HEAD"]);
}

/** The checked-out branch, or null when there is none to name. */
export function currentBranch(tree: GitTree): Promise<string | null> {
  return tree.git.tryRun(["rev-parse", "--abbrev-ref", "HEAD"]);
}

/** Commits waiting to be pushed, or null when there is no upstream to say. */
export async function aheadOfUpstream(tree: GitTree): Promise<number | null> {
  const counted = await tree.git.tryRun(["rev-list", "--count", "@{upstream}..HEAD"]);
  if (counted === null) return null;
  const ahead = Number(counted);
  return Number.isFinite(ahead) ? ahead : null;
}

/**
 * The content root as HEAD has it — the published side of a comparison.
 *
 * Reading `HEAD:` rather than the tree is the point: the working tree *is*
 * the draft workspace, so the repository's own version of a document only
 * exists in Git's object store.
 */
export function headSource(tree: GitTree): ContentSource {
  const at = (path: string) => `HEAD:${path === "" ? tree.prefix : inRepo(tree.prefix, path)}`;

  return {
    origin: "HEAD",

    async read(path) {
      // tryRun, because "not in HEAD" and "no commits yet" both simply mean
      // there is no published version. Stdout arrives trimmed, which the
      // entry parsers already tolerate.
      return tree.git.tryRun(["show", at(path)]);
    },

    async list(path) {
      const raw = await tree.git.tryRun(["ls-tree", "-z", at(path)]);
      if (raw === null) return [];

      const entries: DirectoryEntry[] = [];
      for (const field of raw.split("\0")) {
        const tab = field.indexOf("\t");
        if (tab === -1) continue;
        const type = field.slice(0, tab).split(" ")[1];
        entries.push({ name: field.slice(tab + 1), type: type === "tree" ? "directory" : "file" });
      }
      return entries;
    },
  };
}

/**
 * A save's temporary file: written beside its target, then renamed into
 * place (`*.mica-<pid>-<n>`). Seen only during a save, or after a crash in
 * one; never content.
 */
const TEMPORARY_FILE = /\.mica-\d+-\d+$/;

/**
 * Parses `git status --porcelain=v1 -z` into content-root-relative changes.
 *
 * The `-z` format is the one that never munges a path: entries are
 * NUL-terminated, and a rename is two fields — the new path, then the one it
 * came from. A rename becomes a create and a delete, which is how the rest of
 * Mica already thinks about moves.
 *
 * `.mica/` is excluded. The manifest there is build output a developer
 * commits with their own tools; the editor neither shows nor publishes it,
 * and model changes are guarded separately, by the drift check.
 */
export function parseStatus(raw: string, prefix: string): TreeChange[] {
  const fields = raw.split("\0").filter((field) => field !== "");
  const changes: TreeChange[] = [];

  const push = (
    repoPath: string,
    kind: TreeChange["kind"],
    flags: { untracked?: boolean; conflicted?: boolean } = {},
  ) => {
    const path = relativeToContent(repoPath, prefix);
    if (path === null || path === ".mica" || path.startsWith(".mica/")) return;
    if (TEMPORARY_FILE.test(path)) return;
    changes.push({
      path,
      kind,
      untracked: flags.untracked ?? false,
      conflicted: flags.conflicted ?? false,
    });
  };

  for (let at = 0; at < fields.length; at += 1) {
    const field = fields[at]!;
    const x = field[0] ?? " ";
    const y = field[1] ?? " ";
    const repoPath = field.slice(3);

    if (x === "?" && y === "?") {
      push(repoPath, "create", { untracked: true });
      continue;
    }

    // Both sides touched it in a merge, or one side deleted while the other
    // edited: the file is in Git's conflict state, whatever the tree holds.
    if (x === "U" || y === "U" || (x === "A" && y === "A") || (x === "D" && y === "D")) {
      push(repoPath, "update", { conflicted: true });
      continue;
    }

    if (x === "R" || x === "C") {
      // The next field is the source path. A copy keeps its source; a rename
      // loses it, which the status letters already said (C keeps both files).
      const from = fields[++at]!;
      push(repoPath, "create");
      if (x === "R") push(from, "delete");
      continue;
    }

    if (x === "D" || y === "D") {
      push(repoPath, "delete");
      continue;
    }

    push(repoPath, x === "A" ? "create" : "update");
  }

  return changes;
}

function relativeToContent(repoPath: string, prefix: string): string | null {
  if (prefix === "") return repoPath;
  if (repoPath === prefix) return null;
  return repoPath.startsWith(`${prefix}/`) ? repoPath.slice(prefix.length + 1) : null;
}

/** A content-root-relative path as Git sees it, from the repository root. */
export function inRepo(prefix: string, path: string): string {
  return prefix === "" ? path : join(prefix, path).split(sep).join("/");
}

function toPosix(path: string): string {
  return sep === "/" ? path : path.split(sep).join("/");
}

function chunked<T>(items: T[], size: number): T[][] {
  const batches: T[][] = [];
  for (let at = 0; at < items.length; at += size) batches.push(items.slice(at, at + size));
  return batches;
}
