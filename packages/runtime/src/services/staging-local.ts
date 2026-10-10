/**
 * Working-tree staging: local mode's half of the staging service.
 *
 * The checked-out working tree *is* the draft workspace. Autosave has already
 * written the files — that is what lets the Astro dev server hot-reload them,
 * which is the whole value of local mode — so this service's job is reading
 * what Git thinks of the tree and, on Publish, turning exactly the reviewed
 * paths into one commit and one push.
 *
 * Three rules keep it safe in a repository that belongs to a developer:
 *
 *   - Only Mica-managed paths. Every Git operation is limited to an explicit
 *     path set derived from the change list — never `git add -A` over the
 *     repository, so unrelated work in the same checkout is never swept in.
 *   - HEAD is verified against the base the editor reviewed. A repository
 *     that moved refuses, like a provider branch that moved.
 *   - A commit and a push are two operations. When the push fails the commit
 *     is retained and reported as `committed-pending-push`; a retry pushes
 *     again and never creates a second commit.
 */

import { realpath, rm } from "node:fs/promises";
import { join, relative, sep } from "node:path";

import type { RepositoryConnector } from "@micacms/connectors";
import {
  MANIFEST_PATH,
  memorySource,
  type ContentChange,
  type ContentSource,
  type DirectoryEntry,
  type PublishResult,
  type Site,
} from "@micacms/core";
import { within } from "@micacms/core/node";

import { ApiError, badRequest } from "../lib/errors.js";
import { firstLine, gitRunner, GitError, type GitRunner } from "../lib/git.js";
import type { Logger } from "../lib/logger.js";
import {
  analyseChanges,
  compareSources,
  describeProblems,
  flattenProblems,
  type CompareTarget,
  type Comparison,
  type ContentStagingService,
  type PublishInput,
  type StagingStatus,
  type StagingValidation,
} from "./staging.js";

export interface WorkingTreeStagingDeps {
  model: Site;
  /** Reads the working tree — the same local connector autosave writes through. */
  connector: RepositoryConnector;
  /** Absolute path of the content root. */
  contentRoot: string;
  /** Revision of `.mica/schema.json` when the model was loaded. */
  schemaRevision: string | null;
  /** `MICA_LOCAL_PUBLISH`. False reduces this to a read-only changes view. */
  publishEnabled: boolean;
  logger: Logger;
}

/** A changed file plus what only Git status knows about it. */
export interface TreeChange extends ContentChange {
  /** Not yet known to Git — discarding means deleting, not restoring. */
  untracked: boolean;
  /** Mid-merge conflict markers. Unpublishable until resolved with Git tools. */
  conflicted: boolean;
}

interface Workspace {
  git: GitRunner;
  /** Content root relative to the repository root; "" when they coincide. */
  prefix: string;
}

export function createWorkingTreeStagingService(
  deps: WorkingTreeStagingDeps,
): ContentStagingService {
  const { model, connector, contentRoot, logger } = deps;

  // One Git mutation at a time. Editing is untouched — autosave writes files,
  // not Git — this only refuses to interleave two commits or pushes.
  let running = false;

  /**
   * Finds the repository the content root sits in, freshly each time: a
   * `git init` after startup should start working, not require a restart.
   */
  const locate = async (): Promise<Workspace | { reason: string }> => {
    const probe = gitRunner(contentRoot);
    try {
      const repoRoot = await probe.run(["rev-parse", "--show-toplevel"]);
      // Git reports the toplevel with symlinks resolved (`/private/var` where
      // the caller said `/var`, on macOS). Resolve our side the same way, or
      // the relative prefix walks out of the repository.
      const resolved = await realpath(contentRoot);
      return { git: gitRunner(repoRoot), prefix: toPosix(relative(repoRoot, resolved)) };
    } catch (error) {
      return {
        reason:
          error instanceof GitError && error.exitCode === null
            ? error.message
            : "The content directory is not inside a Git repository.",
      };
    }
  };

  const listChanges = async (workspace: Workspace): Promise<TreeChange[]> => {
    // `-uall` because Git collapses a fully-untracked directory to one line,
    // and a brand-new entry is exactly that. The change list must name files.
    const raw = await workspace.git.run([
      "status",
      "--porcelain=v1",
      "-z",
      "-uall",
      "--",
      workspace.prefix === "" ? "." : workspace.prefix,
    ]);
    return parseStatus(raw, workspace.prefix);
  };

  const analyse = async (workspace: Workspace, treeChanges: TreeChange[]) => {
    const { changes, validation } = await analyseChanges(
      model,
      connector,
      treeChanges,
      headSource(workspace),
    );

    // A merge conflict is a validity problem the field validator cannot see:
    // the file on disk is Git's conflict format, not content.
    for (const change of treeChanges) {
      if (!change.conflicted) continue;
      validation.problems.push({
        path: change.path,
        label: change.path,
        issues: [
          { path: "", message: "This file has a Git merge conflict. Resolve it with your Git tools." },
        ],
      });
    }
    validation.ok = validation.problems.length === 0;

    return { changes, validation };
  };

  const guardPublishable = async (): Promise<Workspace> => {
    if (!deps.publishEnabled) {
      throw badRequest("Publishing from local mode is disabled (MICA_LOCAL_PUBLISH=false).");
    }
    const located = await locate();
    if ("reason" in located) throw badRequest(located.reason);
    return located;
  };

  /** Runs `fn` holding the one-mutation-at-a-time flag. */
  const exclusive = async <T>(fn: () => Promise<T>): Promise<T> => {
    if (running) {
      throw new ApiError("conflict", "A publication is already running. Wait for it to finish.");
    }
    running = true;
    try {
      return await fn();
    } finally {
      running = false;
    }
  };

  const pushOutcome = async (git: GitRunner, revision: string): Promise<PublishResult> => {
    try {
      await git.run(["push"]);
      return { state: "published", revision };
    } catch (error) {
      // The commit is real and retained; only the second half failed. This is
      // a state, not an exception — the editor shows it and offers a retry.
      const pushError = error instanceof GitError ? error.message : String(error);
      logger.warn("Publish committed but the push failed", { revision, pushError });
      return { state: "committed-pending-push", revision, pushError };
    }
  };

  return {
    async status(): Promise<StagingStatus> {
      const located = await locate();

      if ("reason" in located) {
        return {
          workspace: "working-tree",
          publish: { enabled: false, reason: located.reason },
          baseRevision: null,
          branch: null,
          ahead: null,
          changes: [],
          validation: emptyValidation(),
          updatedAt: null,
        };
      }

      const treeChanges = await listChanges(located);
      const { changes, validation } = await analyse(located, treeChanges);

      return {
        workspace: "working-tree",
        publish: deps.publishEnabled
          ? { enabled: true }
          : { enabled: false, reason: "Disabled with MICA_LOCAL_PUBLISH=false." },
        baseRevision: await located.git.tryRun(["rev-parse", "HEAD"]),
        branch: await located.git.tryRun(["rev-parse", "--abbrev-ref", "HEAD"]),
        ahead: await aheadOfUpstream(located.git),
        changes,
        validation,
        updatedAt: null,
      };
    },

    async publish(input: PublishInput): Promise<PublishResult> {
      const message = input.message.trim();
      if (!message) throw badRequest("A publication needs a commit message.");

      const workspace = await guardPublishable();

      return exclusive(async () => {
        const treeChanges = await listChanges(workspace);
        if (treeChanges.length === 0) throw badRequest("There is nothing to publish.");

        /**
         * The reviewed base. The working tree has no per-path gate the way a
         * provider commit does — the tree is already the truth — so the gate
         * is HEAD: if the repository moved since the editor reviewed the
         * change list, what a commit would be based on is not what they saw.
         */
        const head = await workspace.git.tryRun(["rev-parse", "HEAD"]);
        if (input.expectedBase !== head) {
          throw new ApiError(
            "conflict",
            "The repository moved while these changes were being reviewed. Refresh the " +
              "change list and publish again.",
          );
        }

        // The model drift gate — same rule as the draft store: the staged set
        // was validated against the model this process started with.
        if ((await connector.revision(MANIFEST_PATH)) !== deps.schemaRevision) {
          throw new ApiError(
            "conflict",
            "The content model changed after this server started. Restart Mica to load " +
              "the new model, then review the pending changes and publish again.",
          );
        }

        const { validation } = await analyse(workspace, treeChanges);
        if (!validation.ok) {
          throw new ApiError("validation_failed", describeProblems(validation.problems), {
            issues: flattenProblems(validation.problems),
          });
        }

        const paths = treeChanges.map((change) => inRepo(workspace.prefix, change.path));

        try {
          // Stage and commit exactly the reviewed set. The pathspec limits
          // both operations, so anything else in the developer's index or
          // tree — staged or not — stays theirs.
          for (const batch of chunked(paths, 500)) {
            await workspace.git.run(["add", "-A", "--", ...batch]);
          }
          await workspace.git.run(["commit", "-m", message, "--", ...paths]);
        } catch (error) {
          if (error instanceof GitError) {
            // Git's own verdict is the actionable part: no identity
            // configured, a hook that refused, an unborn branch mid-rebase.
            throw new ApiError("conflict", `Git refused the commit: ${error.message}`);
          }
          throw error;
        }

        const revision = await workspace.git.run(["rev-parse", "HEAD"]);
        logger.info("Published from the working tree", { revision, files: paths.length });

        return pushOutcome(workspace.git, revision);
      });
    },

    async push(): Promise<PublishResult> {
      const workspace = await guardPublishable();

      return exclusive(async () => {
        const revision = await workspace.git.tryRun(["rev-parse", "HEAD"]);
        if (revision === null) throw badRequest("There is no commit to push yet.");
        return pushOutcome(workspace.git, revision);
      });
    },

    async discard(requested: string[]): Promise<{ discarded: string[] }> {
      const located = await locate();
      if ("reason" in located) throw badRequest(located.reason);

      return exclusive(async () => {
        // Only paths the change list actually names. Discard is the one
        // destructive operation here, and it must not be able to reach
        // anything the editor was not shown.
        const current = new Map(
          (await listChanges(located)).map((change) => [change.path, change]),
        );

        const discarded: string[] = [];
        for (const path of requested) {
          const change = current.get(path);
          if (!change) continue;

          if (change.kind === "create") {
            // Nothing to restore: before this change there was no file. A
            // creation the developer had already staged is unstaged first,
            // so the index does not keep pointing at a file that is gone.
            if (!change.untracked) {
              await located.git.tryRun([
                "rm",
                "--cached",
                "--force",
                "--",
                inRepo(located.prefix, path),
              ]);
            }
            await rm(within(contentRoot, path), { force: true });
          } else {
            await located.git.run([
              "restore",
              "--source=HEAD",
              "--staged",
              "--worktree",
              "--",
              inRepo(located.prefix, path),
            ]);
          }
          discarded.push(path);
        }

        return { discarded };
      });
    },

    async compare(target: CompareTarget): Promise<Comparison> {
      const located = await locate();
      // Without a repository (or before the first commit) nothing has ever
      // been published, so the honest "before" is a source with no files.
      const published = "reason" in located ? memorySource({}, "unpublished") : headSource(located);
      return compareSources(model, published, connector, target);
    },
  };
}

/**
 * The content root as HEAD has it — the published side of a comparison.
 *
 * Reading `HEAD:` rather than the tree is the point: the working tree *is*
 * the draft workspace here, so the repository's own version of a document
 * only exists in Git's object store.
 */
function headSource(workspace: Workspace): ContentSource {
  const at = (path: string) => `HEAD:${path === "" ? workspace.prefix : inRepo(workspace.prefix, path)}`;

  return {
    origin: "HEAD",

    async read(path) {
      // tryRun, because "not in HEAD" and "no commits yet" both simply mean
      // there is no published version. Stdout arrives trimmed, which the
      // entry parsers already tolerate.
      return workspace.git.tryRun(["show", at(path)]);
    },

    async list(path) {
      const raw = await workspace.git.tryRun(["ls-tree", "-z", at(path)]);
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

/* ------------------------------------------------------------------ */

function emptyValidation(): StagingValidation {
  return { ok: true, problems: [] };
}

function toPosix(path: string): string {
  return sep === "/" ? path : path.split(sep).join("/");
}

/** A content-root-relative path as Git sees it, from the repository root. */
function inRepo(prefix: string, path: string): string {
  return prefix === "" ? path : join(prefix, path).split(sep).join("/");
}

function chunked<T>(items: T[], size: number): T[][] {
  const batches: T[][] = [];
  for (let at = 0; at < items.length; at += size) batches.push(items.slice(at, at + size));
  return batches;
}

/** Commits waiting to be pushed, or null when there is no upstream to say. */
async function aheadOfUpstream(git: GitRunner): Promise<number | null> {
  const counted = await git.tryRun(["rev-list", "--count", "@{upstream}..HEAD"]);
  if (counted === null) return null;
  const ahead = Number(counted);
  return Number.isFinite(ahead) ? ahead : null;
}

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

  const push = (repoPath: string, kind: TreeChange["kind"], flags: { untracked?: boolean; conflicted?: boolean } = {}) => {
    const path = relativeToContent(repoPath, prefix);
    if (path === null || path === ".mica" || path.startsWith(".mica/")) return;
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
