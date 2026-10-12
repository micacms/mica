/**
 * Draft-store staging: the self-hosted half of the staging service.
 *
 * The repository is remote and writing through its API would already be a
 * commit, so saves accumulate in SQLite and Publish turns the whole set into
 * one provider-side commit. The working-tree half is `staging-local.ts`; the
 * types and the analysis both share are in `changes.ts`.
 */

import type { Change, RepositoryConnector } from "@micacms/connectors";
import {
  MANIFEST_PATH,
  toContentChange,
  type DraftStore,
  type PublishResult,
  type Site,
} from "@micacms/core";

import { ApiError, badRequest } from "../lib/errors.js";
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
} from "./changes.js";

export interface DraftStagingDeps {
  model: Site;
  drafts: DraftStore;
  /** The real repository. The one thing here that writes to it. */
  repository: RepositoryConnector;
  /** The staged overlay the rest of the application reads through. */
  overlay: RepositoryConnector;
  /** Revision of `.mica/schema.json` when the model was loaded. */
  schemaRevision: string | null;
}

export function createDraftStagingService(deps: DraftStagingDeps): ContentStagingService {
  const { model, drafts, repository, overlay } = deps;

  // One publication at a time. Not a lock on editing — saves keep landing in
  // the draft store — just a refusal to run two commits of the same set.
  let publishing = false;

  const statusOf = async () => {
    const rows = await drafts.list();
    const summary = rows.map(toContentChange);
    const { changes, validation } = await analyseChanges(model, overlay, summary, repository);

    return { rows, changes, validation };
  };

  return {
    async status(): Promise<StagingStatus> {
      const { rows, changes, validation } = await statusOf();

      return {
        workspace: "draft-store",
        publish: { enabled: true },
        baseRevision: await drafts.base(),
        branch: null,
        ahead: null,
        changes,
        validation,
        updatedAt: rows.reduce<string | null>(
          (latest, row) => (latest === null || row.updatedAt > latest ? row.updatedAt : latest),
          null,
        ),
      };
    },

    async publish(input: PublishInput): Promise<PublishResult> {
      const message = input.message.trim();
      if (!message) throw badRequest("A publication needs a commit message.");

      if (publishing) {
        throw new ApiError("conflict", "A publication is already running. Wait for it to finish.");
      }
      publishing = true;

      try {
        const snapshot = await drafts.list();
        if (snapshot.length === 0) throw badRequest("There is nothing to publish.");

        /**
         * The model drift gate: refuse, name the drift, require a restart.
         * The staged set was validated against the model this
         * process read at startup; a manifest that moved since may disagree,
         * and publishing content the new model rejects would hand the next
         * build a broken tree.
         */
        const manifestNow = await repository.revision(MANIFEST_PATH);
        if (manifestNow !== deps.schemaRevision) {
          throw new ApiError(
            "conflict",
            "The content model changed in the repository after this server started. " +
              "Restart Mica to load the new model, then review the pending changes and " +
              "publish again.",
          );
        }

        const { validation } = await statusOf();
        if (!validation.ok) {
          throw new ApiError("validation_failed", describeProblems(validation.problems), {
            issues: flattenProblems(validation.problems),
          });
        }

        const changes: Change[] = snapshot.map((row) =>
          row.kind === "write"
            ? {
                type: "write",
                path: row.path,
                contents: row.text ? new TextDecoder().decode(row.contents) : row.contents,
              }
            : { type: "delete", path: row.path },
        );

        // The per-path gate: every file this publication writes or removes,
        // expected to be as it was when first staged. A branch that moved on
        // other paths sails through, which is the point.
        const result = await repository.commit({
          message,
          changes,
          expect: Object.fromEntries(snapshot.map((row) => [row.path, row.baseRevision])),
          author: input.author,
        });

        await drafts.clearPublished(snapshot.map(({ path, version }) => ({ path, version })));

        // An autosave that landed while the commit ran survives — re-based
        // onto what the repository now holds, so the next publication's gate
        // is the commit that just happened rather than a stale ancestor.
        const survivors = await drafts.list();
        for (const row of survivors) {
          await drafts.rebase(row.path, await repository.revision(row.path));
        }
        if (survivors.length > 0) await drafts.setBase(await repository.head());

        return { state: "published", revision: result.revision };
      } finally {
        publishing = false;
      }
    },

    async discard(paths: string[]): Promise<{ discarded: string[] }> {
      return { discarded: await drafts.discard(paths) };
    },

    async push(): Promise<PublishResult> {
      // A provider commit is already on the branch; there is no second step.
      throw badRequest("Publications here are single repository commits. There is nothing to push.");
    },

    async compare(target: CompareTarget): Promise<Comparison> {
      // "Before" is the repository the drafts have not touched; "after" is the
      // overlay every other read already goes through.
      return compareSources(model, repository, overlay, target);
    },
  };
}
