/**
 * Git operations on a working tree whose content root is the draft workspace.
 * The owner policy does the push. Every operation is limited to paths under the
 * content root, never `git add -A` over the repository, so other work in the
 * same checkout is never swept into a commit.
 */

import { existsSync } from "node:fs";
import { realpath, rm } from "node:fs/promises";
import { relative, sep } from "node:path";

import { contentPath, type ContentChange, type ContentSource, type DirectoryEntry } from "@micacms/core/internal";
import { within } from "@micacms/core/node";

import type { Author } from "./files.js";
import { GitError, gitRunner, type GitRunner, type GitRunnerOptions } from "./git.js";

/**
 * Makes every path argument literal: `tour[1].json` is not a pattern that also
 * matches `tour1.json`.
 */
export const LITERAL = "--literal-pathspecs";

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
    // Git resolves symlinks in the toplevel (`/private/var` for `/var` on
    // macOS); do the same, or the prefix is wrong.
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
  // `-uall`: Git otherwise collapses a new, untracked entry directory to one line.
  // `GIT_OPTIONAL_LOCKS=0`: no `index.lock`, so a parallel commit cannot fail on it.
  const raw = await tree.git.run(
    [LITERAL, "status", "--porcelain=v1", "-z", "-uall", "--", tree.prefix === "" ? "." : tree.prefix],
    { env: { GIT_OPTIONAL_LOCKS: "0" } },
  );
  return parseStatus(raw, tree.prefix);
}

/**
 * Stages and commits only `paths` (content-root relative) and returns the new
 * HEAD. The pathspec limits both steps, so all other staged or unstaged work
 * stays. Without `author`, Git's configured identity applies.
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
 * Commits `paths` again with the message, author and date of `original`, after
 * a rejected push. Returns the new HEAD.
 */
export async function recommitPaths(tree: GitTree, paths: string[], original: string): Promise<string> {
  const inRepository = await stagePaths(tree, paths);
  await tree.git.run([LITERAL, "commit", "-C", original, "--", ...inRepository]);
  return tree.git.run(["rev-parse", "HEAD"]);
}

/**
 * Stages `paths`, because `git commit -- <paths>` refuses a file Git has never
 * seen. A path gone from the disk uses `rm --cached`, because `git add` refuses
 * a deletion that is already staged (as `reset --soft` leaves it).
 */
async function stagePaths(tree: GitTree, paths: string[]): Promise<string[]> {
  const present: string[] = [];
  const gone: string[] = [];
  for (const path of paths) {
    (existsSync(within(tree.contentRoot, path)) ? present : gone).push(inRepo(tree.prefix, path));
  }
  for (const batch of chunked(present, 500)) {
    await tree.git.run([LITERAL, "add", "-A", "--", ...batch]);
  }
  for (const batch of chunked(gone, 500)) {
    await tree.git.run([LITERAL, "rm", "--cached", "--ignore-unmatch", "--quiet", "--", ...batch]);
  }
  return paths.map((path) => inRepo(tree.prefix, path));
}

/** Puts one changed file back to its HEAD version, or removes it if HEAD has none. */
export async function discardChange(tree: GitTree, change: TreeChange): Promise<void> {
  if (change.kind === "create") {
    // Unstage a staged creation first, so the index does not point at a deleted file.
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

/** The trailer that marks a commit that Mica made for a publication. */
export const PUBLISHED_WITH_MICA = "Published-with: Mica";

/** A publication's commit message: the editor's summary, and Mica's trailer. */
export function publicationMessage(summary: string): string {
  return `${summary}\n\n${PUBLISHED_WITH_MICA}`;
}

/** Commits on HEAD that no remote has, split into Mica's publications and other commits. */
export interface UnpushedCommits {
  mica: number;
  other: number;
}

/**
 * What a push of HEAD would send: the commits after the upstream branch, or,
 * for a branch without one, the commits that no remote has. Null without a
 * remote, because then nothing can be pushed and everything would count.
 */
export async function unpushedCommits(tree: GitTree): Promise<UnpushedCommits | null> {
  const remotes = await tree.git.tryRun(["remote"]);
  if (!remotes) return null;
  // A commit can be on another remote branch and still be new to the upstream.
  const upstream = await tree.git.tryRun(["rev-parse", "--verify", "--quiet", "@{upstream}"]);
  const range = upstream ? [`${upstream}..HEAD`] : ["HEAD", "--not", "--remotes"];
  // %x1e ends a commit, so a multi-line message stays one record.
  const log = await tree.git.tryRun(["log", "--max-count=1000", "--format=%B%x1e", ...range]);
  if (log === null) return { mica: 0, other: 0 };
  const counted = { mica: 0, other: 0 };
  for (const message of log.split("\x1e")) {
    if (message.trim() === "") continue;
    const lines = message.trim().split("\n");
    counted[lines.includes(PUBLISHED_WITH_MICA) ? "mica" : "other"] += 1;
  }
  return counted;
}

/**
 * The content root as `ref` has it, read from Git's object store, because the
 * working tree holds the drafts.
 */
export function headSource(tree: GitTree, ref = "HEAD"): ContentSource {
  const at = (path: string) => `${ref}:${path === "" ? tree.prefix : inRepo(tree.prefix, path)}`;

  return {
    origin: ref,

    async read(path) {
      // "Not in HEAD" and "no commits yet" both mean that there is no published version.
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
 * `base` with `paths` taken from `top`: what a commit of exactly those paths
 * would hold. Publish checks a selection against it, not against drafts that
 * stay behind.
 */
export function overlaySource(base: ContentSource, top: ContentSource, paths: Iterable<string>): ContentSource {
  const selected = new Set(paths);

  return {
    origin: `${base.origin} with the selected changes`,

    read: (path) => (selected.has(path) ? top.read(path) : base.read(path)),

    async list(directory) {
      const prefix = directory === "" ? "" : `${directory}/`;
      const items = new Map((await base.list(directory)).map((item) => [item.name, item]));
      for (const path of selected) {
        if (!path.startsWith(prefix)) continue;
        const [name, ...deeper] = path.slice(prefix.length).split("/");
        if (deeper.length > 0) items.set(name!, { name: name!, type: "directory" });
        else if ((await top.read(path)) === null) items.delete(name!);
        else items.set(name!, { name: name!, type: "file" });
      }
      return [...items.values()];
    },
  };
}

/**
 * A save's temporary file or folder (`*.mica-<pid>-<n>`): a file being written,
 * an upload, or what a save put aside. Seen during a save or after a crash.
 * Never content.
 */
const TEMPORARY_FILE = /\.mica-\d+-\d+(?:\/|$)/;

/**
 * Parses `git status --porcelain=v1 -z` into content-root-relative changes.
 * `-z` never changes a path; a rename is two fields and becomes a create and a
 * delete. `.mica/` is excluded: the developer commits the manifest, and the
 * drift check guards model changes.
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

    // A merge conflict state, whatever the tree holds.
    if (x === "U" || y === "U" || (x === "A" && y === "A") || (x === "D" && y === "D")) {
      push(repoPath, "update", { conflicted: true });
      continue;
    }

    if (x === "R" || x === "C") {
      // The next field is the source path; only a rename deletes it.
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

/**
 * A content-root-relative path as Git sees it, from the repository root.
 * `contentPath` first: `path.join` would resolve a `..` out of the content root.
 */
export function inRepo(prefix: string, path: string): string {
  const clean = contentPath(path);
  return prefix === "" ? clean : `${prefix}/${clean}`;
}

function toPosix(path: string): string {
  return sep === "/" ? path : path.split(sep).join("/");
}

function chunked<T>(items: T[], size: number): T[][] {
  const batches: T[][] = [];
  for (let at = 0; at < items.length; at += size) batches.push(items.slice(at, at + size));
  return batches;
}
