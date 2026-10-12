/**
 * Working-tree staging: local mode's half of the staging service.
 *
 * The checked-out working tree *is* the draft workspace. Autosave has already
 * written the files — that is what lets the Astro dev server hot-reload them,
 * which is the whole value of local mode — so this service's job is reading
 * what Git thinks of the tree and, on Publish, turning exactly the reviewed
 * paths into one commit and one push. The Git operations are in
 * `workspace/tree.ts`, the push in the owner policy, and the locks that keep
 * saves and commits apart in `workspace/locks.ts`.
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

import type { RepositoryConnector } from "@micacms/connectors";
import { MANIFEST_PATH, memorySource, type PublishResult, type Site } from "@micacms/core";

import { ApiError, badRequest } from "../lib/errors.js";
import type { Logger } from "../lib/logger.js";
import { developerPolicy } from "../workspace/developer.js";
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
  type CompareTarget,
  type Comparison,
  type ContentStagingService,
  type PublishInput,
  type StagingStatus,
  type StagingValidation,
} from "./changes.js";

export interface WorkingTreeStagingDeps {
  model: Site;
  /**
   * Reads the working tree — the same local connector autosave writes
   * through, but without the lock wrapper: this service holds the locks
   * itself, around whole operations.
   */
  connector: RepositoryConnector;
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
}

export function createWorkingTreeStagingService(
  deps: WorkingTreeStagingDeps,
): ContentStagingService {
  const { model, connector, contentRoot, logger } = deps;
  const policy = deps.policy ?? developerPolicy({ publishEnabled: deps.publishEnabled, logger });
  const locks = deps.locks ?? createWorkspaceLocks();

  const analyse = async (tree: GitTree, treeChanges: TreeChange[]) => {
    const { changes, validation } = await analyseChanges(
      model,
      connector,
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

  const located = async (): Promise<GitTree> => {
    const tree = await locateTree(contentRoot);
    if ("reason" in tree) throw badRequest(tree.reason);
    return tree;
  };

  const publishable = async (): Promise<GitTree> => {
    const availability = policy.publishAvailability();
    if (!availability.enabled) throw badRequest(availability.reason);
    return located();
  };

  return {
    async status(): Promise<StagingStatus> {
      const tree = await locateTree(contentRoot);

      if ("reason" in tree) {
        return {
          workspace: "working-tree",
          publish: { enabled: false, reason: tree.reason },
          baseRevision: null,
          branch: null,
          ahead: null,
          changes: [],
          validation: emptyValidation(),
          updatedAt: null,
        };
      }

      const { changes, validation, head, branch } = await locks.tree.read(async () => ({
        ...(await analyse(tree, await listTreeChanges(tree))),
        head: await headRevision(tree),
        branch: await currentBranch(tree),
      }));

      return {
        workspace: "working-tree",
        publish: policy.publishAvailability(),
        baseRevision: head,
        branch,
        ahead: await aheadOfUpstream(tree),
        changes,
        validation,
        updatedAt: null,
      };
    },

    async publish(input: PublishInput): Promise<PublishResult> {
      const message = input.message.trim();
      if (!message) throw badRequest("A publication needs a commit message.");

      const tree = await publishable();

      const revision = await locks.tree.write(async () => {
        const treeChanges = await listTreeChanges(tree);
        if (treeChanges.length === 0) throw badRequest("There is nothing to publish.");

        /**
         * The reviewed base. The working tree has no per-path gate the way a
         * provider commit does — the tree is already the truth — so the gate
         * is HEAD: if the repository moved since the editor reviewed the
         * change list, what a commit would be based on is not what they saw.
         */
        if (input.expectedBase !== (await headRevision(tree))) {
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

        const { validation } = await analyse(tree, treeChanges);
        if (!validation.ok) {
          throw new ApiError("validation_failed", describeProblems(validation.problems), {
            issues: flattenProblems(validation.problems),
          });
        }

        try {
          const revision = await commitPaths(tree, treeChanges.map((change) => change.path), message);
          logger.info("Published from the working tree", { revision, files: treeChanges.length });
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

    async compare(target: CompareTarget): Promise<Comparison> {
      const tree = await locateTree(contentRoot);
      // Without a repository (or before the first commit) nothing has ever
      // been published, so the honest "before" is a source with no files.
      const published = "reason" in tree ? memorySource({}, "unpublished") : headSource(tree);
      return locks.tree.read(() => compareSources(model, published, connector, target));
    },
  };
}

function emptyValidation(): StagingValidation {
  return { ok: true, problems: [] };
}
