/**
 * Working-tree staging: the staging service of both apps.
 *
 * The working tree *is* the draft workspace — the developer's checkout in
 * the local editor, Mica's own clone when self-hosted. Autosave has already
 * written the files (in the local editor, that is what lets the Astro dev
 * server hot-reload them), so this service's job is reading what Git thinks
 * of the tree and, on Publish, turning exactly the reviewed paths into one
 * commit and one push. The Git operations are in
 * `workspace/tree.ts`, the push in the owner policy, and the locks that keep
 * saves and commits apart in `workspace/locks.ts`.
 *
 * Three rules keep it safe in a repository that people share:
 *
 *   - Only Mica-managed paths. Every Git operation is limited to an explicit
 *     path set derived from the change list — never `git add -A` over the
 *     repository, so unrelated work in the same checkout is never swept in.
 *   - Exactly the reviewed files are published, as the editor saw them. A
 *     file saved again since, or another file of the same entry, refuses;
 *     drafts of other entries stay drafts.
 *   - A commit and a push are two operations. When the push fails the commit
 *     is retained and reported as `committed-pending-push`; a retry pushes
 *     again and never creates a second commit.
 */

import { MANIFEST_PATH, memorySource, type PublishResult, type Site } from "@micacms/core";

import { ApiError, badRequest, notFound } from "../lib/errors.js";
import type { Logger } from "../lib/logger.js";
import { developerPolicy } from "../workspace/developer.js";
import type { ContentFiles } from "../workspace/files.js";
import { GitError } from "../workspace/git.js";
import { createWorkspaceLocks, type WorkspaceLocks } from "../workspace/locks.js";
import type { OwnerPolicy } from "../workspace/policy.js";
import {
  aheadOfUpstream,
  commitPaths,
  currentBranch,
  discardChange,
  headRevision,
  headSource,
  listTreeChanges,
  locateTree,
  type GitTree,
  type TreeChange,
} from "../workspace/tree.js";
import {
  analyseChanges,
  compareSources,
  describeProblems,
  flattenProblems,
  type AnnotatedChange,
  type CompareTarget,
  type Comparison,
  type ContentStagingService,
  type PublishInput,
  type RepositoryInfo,
  type StagingStatus,
  type StagingValidation,
} from "./changes.js";

export interface WorkingTreeStagingDeps {
  model: Site;
  /**
   * Reads the working tree — the same files autosave writes
   * through, but without the lock wrapper: this service holds the locks
   * itself, around whole operations.
   */
  files: ContentFiles;
  /** Absolute path of the content root. */
  contentRoot: string;
  /** Revision of `.mica/schema.json` when the model was loaded. */
  schemaRevision: string | null;
  /** `MICA_LOCAL_PUBLISH`, for the default developer policy. */
  publishEnabled: boolean;
  logger: Logger;
  /** Who owns the tree. Defaults to the developer. */
  policy?: OwnerPolicy;
  /** Shared with the services that write content. Defaults to locks of its own. */
  locks?: WorkspaceLocks;
  /**
   * The tree, when the owner already knows it — a managed clone, whose Git
   * runs in an isolated environment. Without it, the repository around
   * `contentRoot` is found with the developer's own Git.
   */
  tree?: GitTree;
}

export function createWorkingTreeStagingService(
  deps: WorkingTreeStagingDeps,
): ContentStagingService {
  const { model, files, contentRoot, logger } = deps;
  const policy = deps.policy ?? developerPolicy({ publishEnabled: deps.publishEnabled, logger });
  const locks = deps.locks ?? createWorkspaceLocks();

  const analyse = async (tree: GitTree, treeChanges: TreeChange[]) => {
    const { changes, validation } = await analyseChanges(
      model,
      files,
      treeChanges,
      headSource(tree),
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

  const locate = async (): Promise<GitTree | { reason: string }> => deps.tree ?? locateTree(contentRoot);

  const located = async (): Promise<GitTree> => {
    const tree = await locate();
    if ("reason" in tree) throw badRequest(tree.reason);
    return tree;
  };

  const publishable = async (): Promise<GitTree> => {
    const availability = policy.publishAvailability();
    if (!availability.enabled) throw badRequest(availability.reason);
    return located();
  };

  /** The key that keeps an entry's files together: a publication never splits one. */
  const groupOf = (change: AnnotatedChange): string => {
    const owner = change.owner;
    if (owner.kind === "entry") return `entry:${owner.collection}/${owner.slug}`;
    if (owner.kind === "singleton") return `singleton:${owner.name}`;
    if (owner.kind === "order") return `order:${owner.collection}`;
    return `file:${change.path}`;
  };

  const withRevisions = async (changes: AnnotatedChange[]): Promise<AnnotatedChange[]> =>
    Promise.all(
      changes.map(async (change) => ({
        ...change,
        revision: change.kind === "delete" ? null : await files.revision(change.path),
      })),
    );

  /** Refused for the developer's checkout: Mica never fetches or merges there. */
  const managedOnly = <T>(action: T | undefined): T => {
    if (action === undefined) throw notFound("This is the developer's checkout; Git there is theirs.");
    return action;
  };

  return {
    async status(): Promise<StagingStatus> {
      const tree = await locate();
      const sync = policy.syncStatus?.() ?? null;

      if ("reason" in tree) {
        return {
          owner: policy.owner,
          publish: { enabled: false, reason: tree.reason },
          head: null,
          branch: null,
          ahead: null,
          changes: [],
          validation: emptyValidation(),
          sync,
        };
      }

      const { changes, validation, head, branch } = await locks.tree.read(async () => {
        const analysed = await analyse(tree, await listTreeChanges(tree));
        return {
          ...analysed,
          changes: await withRevisions(analysed.changes),
          head: await headRevision(tree),
          branch: await currentBranch(tree),
        };
      });

      return {
        owner: policy.owner,
        publish: policy.publishAvailability(),
        head,
        branch,
        ahead: await aheadOfUpstream(tree),
        changes,
        validation,
        sync,
      };
    },

    async publish(input: PublishInput): Promise<PublishResult> {
      const message = input.message.trim();
      if (!message) throw badRequest("A publication needs a commit message.");
      const reviewed = Object.keys(input.paths);
      if (reviewed.length === 0) throw badRequest("Choose at least one change to publish.");

      const tree = await publishable();
      await policy.prepare(tree);

      const revision = await locks.tree.write(async () => {
        const pending = await withRevisions((await analyse(tree, await listTreeChanges(tree))).changes);
        const byPath = new Map(pending.map((change) => [change.path, change]));

        /**
         * The review gate. Exactly the reviewed files are published, and only
         * as the editor saw them: a file saved again since, a reviewed file
         * that is no longer pending, or another file of the same entry that
         * the review did not include, all refuse. Drafts of other entries
         * stay drafts — somebody else's autosave never blocks a publication.
         */
        const reviewedGroups = new Set(
          reviewed.map((path) => byPath.get(path)).flatMap((change) => (change ? [groupOf(change)] : [])),
        );
        const stale = [
          ...reviewed.filter((path) => byPath.get(path)?.revision !== input.paths[path] || !byPath.has(path)),
          ...pending
            .filter((change) => reviewedGroups.has(groupOf(change)) && !(change.path in input.paths))
            .map((change) => change.path),
        ];
        if (stale.length > 0) {
          throw new ApiError(
            "conflict",
            "Some of these changes were edited after you reviewed them. Review them again, then publish.",
          );
        }

        // The model drift gate: the pending set was validated against the
        // model this process started with.
        if ((await files.revision(MANIFEST_PATH)) !== deps.schemaRevision) {
          throw new ApiError(
            "conflict",
            "The content model changed after this server started. Restart Mica to load " +
              "the new model, then review the pending changes and publish again.",
          );
        }

        const selected = (await listTreeChanges(tree)).filter((change) => change.path in input.paths);
        const { validation } = await analyse(tree, selected);
        if (!validation.ok) {
          throw new ApiError("validation_failed", describeProblems(validation.problems), {
            issues: flattenProblems(validation.problems),
          });
        }

        try {
          const revision = await commitPaths(tree, reviewed, message, policy.commitAuthor(input.author));
          logger.info("Published", { revision, files: reviewed.length, owner: policy.owner });
          return revision;
        } catch (error) {
          if (error instanceof GitError) {
            // Git's own verdict is the actionable part: no identity
            // configured, a hook that refused, an unborn branch mid-rebase.
            throw new ApiError("conflict", `Git refused the commit: ${error.message}`);
          }
          throw error;
        }
      });

      return locks.remote.run(() => policy.push(tree, revision));
    },

    async push(): Promise<PublishResult> {
      const tree = await publishable();

      return locks.remote.run(async () => {
        const revision = await headRevision(tree);
        if (revision === null) throw badRequest("There is no commit to push yet.");
        return policy.push(tree, revision);
      });
    },

    async discard(requested: string[]): Promise<{ discarded: string[] }> {
      const tree = await located();

      return locks.tree.write(async () => {
        // Only paths the change list actually names. Discard is the one
        // destructive operation here, and it must not be able to reach
        // anything the editor was not shown.
        const current = new Map((await listTreeChanges(tree)).map((change) => [change.path, change]));

        const discarded: string[] = [];
        for (const path of requested) {
          const change = current.get(path);
          if (!change) continue;
          await discardChange(tree, change);
          discarded.push(path);
        }

        return { discarded };
      });
    },

    async compare(target: CompareTarget, against: "head" | "origin" = "head"): Promise<Comparison> {
      const tree = await locate();
      if (against === "origin" && !policy.upstreamRef) throw badRequest("There is no website version to compare with here.");
      // Without a repository (or before the first commit) nothing has ever
      // been published, so the honest "before" is a source with no files.
      const published =
        "reason" in tree
          ? memorySource({}, "unpublished")
          : headSource(tree, against === "origin" ? policy.upstreamRef : "HEAD");
      return locks.tree.read(() => compareSources(model, published, files, target));
    },

    async sync(): Promise<void> {
      await managedOnly(policy.sync)();
    },

    async resolve(group: string, choice: "mine" | "website"): Promise<void> {
      await managedOnly(policy.resolve)(group, choice);
    },

    async repository(): Promise<RepositoryInfo> {
      const tree = await locate();
      const described = (await policy.describe?.()) ?? null;
      return {
        owner: policy.owner,
        branch: "reason" in tree ? null : await currentBranch(tree),
        head: "reason" in tree ? null : await headRevision(tree),
        url: described?.url ?? null,
        cloneBytes: described?.cloneBytes ?? null,
        sync: policy.syncStatus?.() ?? null,
      };
    },
  };
}

function emptyValidation(): StagingValidation {
  return { ok: true, problems: [] };
}
