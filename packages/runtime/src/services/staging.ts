/**
 * Content staging: the orchestration between "saved" and "published".
 *
 * Two implementations of one service, because the two deployment shapes have
 * genuinely different draft workspaces:
 *
 *   - working tree  (`staging-local.ts`): the checkout is the draft. Autosave
 *     writes files the Astro dev server can hot-reload, which is the whole
 *     value of local mode; Recent changes is `git status`, and Publish is a
 *     real commit and push through the developer's own Git.
 *   - draft store   (this file): the repository is remote and writing through
 *     its API would already be a commit, so saves accumulate in SQLite and
 *     Publish turns the whole set into one provider-side commit.
 *
 * The editor sees one API either way. What differs is only what Saved means —
 * and the two must stay visibly different words in the UI, because in neither
 * mode does Saved imply that a change is in Git.
 */

import type { Author, Change, RepositoryConnector } from "@micacms/connectors";
import {
  MANIFEST_PATH,
  ORDER_FILE,
  collectionEntryPath,
  entryLayout,
  entryTitle,
  isValidSlug,
  readCollection,
  readSingleton,
  singletonPath,
  toContentChange,
  validateFields,
  type Collection,
  type ContentChange,
  type ContentSource,
  type DraftStore,
  type FieldIssue,
  type PublishResult,
  type Site,
} from "@micacms/core";

import { ApiError, badRequest } from "../lib/errors.js";

/** Where the change happened, in words an editor recognises. */
export type ChangeOwner =
  | { kind: "entry"; collection: string; slug: string; label: string }
  | { kind: "singleton"; name: string; label: string }
  | { kind: "order"; collection: string; label: string }
  | { kind: "media"; label: string }
  | { kind: "other"; label: string };

export interface AnnotatedChange extends ContentChange {
  owner: ChangeOwner;
}

/** One thing that would make the staged result unpublishable. */
export interface StagingProblem {
  /** The file the problem is about, relative to the content root. */
  path: string;
  label: string;
  issues: FieldIssue[];
}

export interface StagingValidation {
  ok: boolean;
  problems: StagingProblem[];
}

export interface StagingStatus {
  /** How this deployment stages. The UI words differ with it. */
  workspace: "working-tree" | "draft-store";
  publish: { enabled: boolean; reason?: string };
  /**
   * What the pending changes are based on: HEAD for a working tree, the
   * branch head for a draft store. Sent back with Publish as `expectedBase`.
   */
  baseRevision: string | null;
  /** The branch a publication lands on, where the workspace knows it. */
  branch: string | null;
  /** Commits created and not yet pushed. Working tree only. */
  ahead: number | null;
  changes: AnnotatedChange[];
  validation: StagingValidation;
  /** When the pending set last moved. Null when nothing is pending. */
  updatedAt: string | null;
}

export interface PublishInput {
  /** Subject line of the commit. Written by the editor, for `git log`. */
  message: string;
  /** The base the editor reviewed. A repository that moved past it refuses. */
  expectedBase: string | null;
  author?: Author;
}

export interface ContentStagingService {
  status(): Promise<StagingStatus>;
  publish(input: PublishInput): Promise<PublishResult>;
  discard(paths: string[]): Promise<{ discarded: string[] }>;
  /** Retries the push after `committed-pending-push`. Working tree only. */
  push(): Promise<PublishResult>;
}

/* ------------------------------------------------------------------ *
 * Understanding a change set
 * ------------------------------------------------------------------ */

/**
 * Annotates a change set with owners and validates the entries it touches.
 *
 * One pass on purpose: naming a change and validating it both need the same
 * read of the same entries, and content trees are small enough to read the
 * affected collections whole.
 *
 * Validation is scoped to *changed* documents (v3-arch §10.6). Content that
 * was already in the repository is not this publication's problem — refusing
 * to publish a fixed typo because somebody once hand-committed a broken entry
 * elsewhere would make the editor hostage to history it cannot touch.
 */
export async function analyseChanges(
  model: Site,
  source: ContentSource,
  changes: ContentChange[],
): Promise<{ changes: AnnotatedChange[]; validation: StagingValidation }> {
  const owners = changes.map((change) => classifyPath(model, change.path));

  /* ------------------------------------------------------- reading */

  const collectionsToRead = new Set<string>();
  for (const owner of owners) {
    if (owner.kind === "entry" || owner.kind === "order") collectionsToRead.add(owner.collection);
  }

  const problems: StagingProblem[] = [];
  const titles = new Map<string, string>();
  const entriesByCollection = new Map<string, Map<string, Record<string, unknown>>>();

  for (const name of collectionsToRead) {
    const def = model.collections[name]!;
    try {
      const entries = await readCollection(source, def, name);
      const bySlug = new Map(entries.map((entry) => [entry.slug, entry.data]));
      entriesByCollection.set(name, bySlug);
      for (const [slug, data] of bySlug) titles.set(`${name}/${slug}`, entryTitle(def, data));
    } catch (error) {
      // The collection cannot be read at all — a malformed file, possibly one
      // this change set did not touch. Publication needs the whole picture,
      // so the honest answer is the error, at the path it names.
      const path = (error as { path?: string }).path ?? name;
      problems.push({
        path,
        label: def.label,
        issues: [{ path: "", message: (error as Error).message }],
      });
    }
  }

  /* ---------------------------------------------------- validation */

  const validated = new Set<string>();

  for (const owner of owners) {
    if (owner.kind === "entry") {
      const key = `${owner.collection}/${owner.slug}`;
      if (validated.has(key)) continue;
      validated.add(key);

      const def = model.collections[owner.collection]!;
      // Absent means the change set deletes this entry; there is nothing left
      // to validate, which is exactly right.
      const data = entriesByCollection.get(owner.collection)?.get(owner.slug);
      if (!data) continue;

      const result = validateFields(def.fields, data, "storage");
      if (!result.ok) {
        problems.push({
          path: entryDataPath(def, owner.collection, owner.slug),
          label: labelEntry(def, owner.slug, titles.get(key)),
          issues: result.issues,
        });
      }
    }

    if (owner.kind === "singleton" && !validated.has(`singleton:${owner.name}`)) {
      validated.add(`singleton:${owner.name}`);

      const def = model.singletons[owner.name]!;
      const dataPath = singletonPath(def.fields, owner.name);
      try {
        const data = await readSingleton(source, def, owner.name);
        if (data === null) continue;

        const result = validateFields(def.fields, data, "storage");
        if (!result.ok) {
          problems.push({ path: dataPath, label: def.label, issues: result.issues });
        }
      } catch (error) {
        problems.push({
          path: (error as { path?: string }).path ?? dataPath,
          label: def.label,
          issues: [{ path: "", message: (error as Error).message }],
        });
      }
    }
  }

  /* ---------------------------------------------------- annotation */

  const annotated = changes.map((change, index): AnnotatedChange => {
    const owner = owners[index]!;
    if (owner.kind === "entry") {
      const def = model.collections[owner.collection]!;
      return {
        ...change,
        owner: { ...owner, label: labelEntry(def, owner.slug, titles.get(`${owner.collection}/${owner.slug}`)) },
      };
    }
    return { ...change, owner };
  });

  return {
    changes: annotated,
    validation: { ok: problems.length === 0, problems },
  };
}

/**
 * Which piece of content a file belongs to.
 *
 * The path layout is the model's own (`layout.ts`), so this is a reading of
 * it, not a second convention: `collection/slug/…` or `collection/slug.json`,
 * `singleton.json` or `singleton/…`, and the shared `media/` directory.
 */
export function classifyPath(model: Site, path: string): ChangeOwner {
  const segments = path.split("/");
  const head = segments[0] ?? "";

  const collection = model.collections[head];
  if (collection && segments.length > 1) {
    if (segments.length === 2 && segments[1] === ORDER_FILE) {
      return { kind: "order", collection: head, label: `${collection.label}: order` };
    }

    if (entryLayout(collection.fields) === "directory") {
      const slug = segments[1]!;
      if (segments.length >= 3 && isValidSlug(slug)) {
        return { kind: "entry", collection: head, slug, label: slug };
      }
    } else if (segments.length === 2 && segments[1]!.endsWith(".json")) {
      const slug = segments[1]!.slice(0, -".json".length);
      if (isValidSlug(slug)) return { kind: "entry", collection: head, slug, label: slug };
    }
  }

  const singletonDir = model.singletons[head];
  if (singletonDir && segments.length > 1) {
    return { kind: "singleton", name: head, label: singletonDir.label };
  }
  if (head.endsWith(".json")) {
    const name = head.slice(0, -".json".length);
    const singleton = model.singletons[name];
    if (singleton && segments.length === 1) {
      return { kind: "singleton", name, label: singleton.label };
    }
  }

  if (head === "media") return { kind: "media", label: "Shared media" };

  return { kind: "other", label: path };
}

function labelEntry(def: Collection, slug: string, title: string | undefined): string {
  return `${def.labelSingular ?? def.label}: ${title ?? slug}`;
}

function entryDataPath(def: Collection, collection: string, slug: string): string {
  const base = collectionEntryPath(def.fields, collection, slug);
  return entryLayout(def.fields) === "directory" ? `${base}/index.json` : base;
}

/* ------------------------------------------------------------------ *
 * The draft-store implementation
 * ------------------------------------------------------------------ */

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
    const { changes, validation } = await analyseChanges(model, overlay, summary);

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
         * The model drift gate — the open question v3-plan.md left to this
         * phase, answered as it predicted: refuse, name the drift, require a
         * restart. The staged set was validated against the model this
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
  };
}

/* ------------------------------------------------------------------ */

export function describeProblems(problems: StagingProblem[]): string {
  const names = problems.map((problem) => problem.label);
  const listed = names.slice(0, 3).join(", ") + (names.length > 3 ? ", …" : "");
  return `The pending changes cannot be published until they are valid: ${listed}.`;
}

/** Field issues with the file path folded in, for the flat API envelope. */
export function flattenProblems(problems: StagingProblem[]): FieldIssue[] {
  return problems.flatMap((problem) =>
    problem.issues.map((issue) => ({
      path: issue.path ? `${problem.path}: ${issue.path}` : problem.path,
      message: issue.message,
    })),
  );
}
