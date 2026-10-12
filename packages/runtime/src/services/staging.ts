/**
 * The staging service on a Git working tree. Autosave has already written the
 * files; Publish commits the reviewed paths.
 *
 *   - Every Git operation is limited to an explicit path set, so other work in
 *     the same checkout is never swept in.
 *   - Only the reviewed files are published, as the editor saw them. Drafts of
 *     other entries stay drafts.
 *   - When the push fails, the commit stays as `committed-pending-push`; a
 *     retry pushes and never commits again.
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
   * The working tree's files without the lock wrapper: this service holds the
   * locks around whole operations.
   */
  files: ContentFiles;
  contentRoot: string;
  schemaRevision: string | null;
  /** `MICA_LOCAL_PUBLISH`, for the default developer policy. */
  publishEnabled: boolean;
  logger: Logger;
  /** Defaults to the developer. */
  policy?: OwnerPolicy;
  /** Shared with the services that write content. */
  locks?: WorkspaceLocks;
  /**
   * Set by a managed clone, whose Git runs in an isolated environment. Without
   * it, the developer's Git finds the tree.
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

    // The field validator cannot see a merge conflict: the file holds Git's conflict format.
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

      // One publication at a time from sync to push: no sync can run in
      // between, and no second commit can stack up.
      return locks.remote.run(async () => {
        await policy.prepare(tree);

        const revision = await locks.tree.write(async () => {
          const pending = await withRevisions((await analyse(tree, await listTreeChanges(tree))).changes);
          const byPath = new Map(pending.map((change) => [change.path, change]));

          // The review gate refuses a file saved again since the review, a
          // reviewed file that is no longer pending, or another file of a
          // reviewed entry. Drafts of other entries never block a publication.
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

          // The model drift gate: validation used the model that this process started with.
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
              // Git's message is the actionable part: no identity, a hook that
              // refused, a rebase in progress.
              throw new ApiError("conflict", `Git refused the commit: ${error.message}`);
            }
            throw error;
          }
        });

        return policy.push(tree, revision);
      });
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
        // Discard is destructive, so it reaches only paths that the change list names.
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
      // Without a repository nothing is published, so "before" is an empty source.
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
