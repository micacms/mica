/** The staging API types, and the analysis of a pending change set: owners, groups, needs and problems. */

import type { Author } from "../workspace/files.js";
import {
  type Collection,
  type ContentChange,
  type ContentSource,
  createReferenceCheck,
  entryDataPath,
  entryTitle,
  type FieldIssue,
  ORDER_FILE,
  ownerOfPath,
  type PathOwner,
  type PublishResult,
  readCollectionEntry,
  readOrder,
  readSingleton,
  type Site,
  validateFields,
} from "@micacms/core/internal";

import type { SyncStatus } from "../workspace/policy.js";
import type { DetachedHead, UnpushedCommits } from "../workspace/tree.js";
import { brokenByRemoval, folderOf, labelEntry, linkNeeds } from "./links.js";
import { detectRenames, followRenamedLinks } from "./renames.js";

/**
 * Where the change happened, in words an editor recognises: core's
 * `ownerOfPath`, and on an entry the ID before a pending rename, set on the
 * files of both IDs.
 */
export type ChangeOwner =
  | (Extract<PathOwner, { kind: "entry" }> & { renamedFrom?: string })
  | Exclude<PathOwner, { kind: "entry" }>;

export interface AnnotatedChange extends ContentChange {
  owner: ChangeOwner;
  /** The edit that the file belongs to, from `groupOf`: Publish and Discard never split one. */
  group: string;
  /**
   * The file's revision, null for a deletion. Publish sends it back, so a file
   * saved after the review is not published unseen.
   */
  revision?: string | null;
  /** When the file was last saved, for "changed 2 hours ago". Null for a deletion. */
  savedAt?: string | null;
  /**
   * New pending files that this document uses (a linked entry, an image), so
   * that it cannot be published without them. On the document's data file.
   */
  needs?: string[];
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
  /** Whose working tree it is. The UI wording changes with it. */
  owner: "developer" | "managed";
  publish: { enabled: boolean; reason?: string };
  /** The commit the pending changes sit on. */
  head: string | null;
  /** The branch a publication lands on, where the workspace knows it. */
  branch: string | null;
  /**
   * Commits that no remote has, in the developer's checkout: Mica's waits for a
   * retry, another one blocks Publish. Null for a clone that Mica keeps, or
   * without a remote.
   */
  unpushed: UnpushedCommits | null;
  /**
   * The developer's checkout on no branch, as a submodule usually is: Publish
   * waits until the developer runs `command`. Null otherwise.
   */
  detached: DetachedHead | null;
  changes: AnnotatedChange[];
  validation: StagingValidation;
  /** Where a clone that Mica keeps stands against its remote. Null for the developer's checkout. */
  sync: SyncStatus | null;
}

export interface PublishInput {
  /** Subject line of the commit. */
  message: string;
  /**
   * The reviewed paths, with the revision each had in the review. Only these
   * are published; a file saved again since, or another file of the same entry,
   * makes Publish refuse.
   */
  paths: Record<string, string | null>;
  author?: Author;
  /** Who published, for the log. */
  editor?: string;
}

/** What the System page shows about the repository. */
export interface RepositoryInfo {
  owner: "developer" | "managed";
  branch: string | null;
  head: string | null;
  /** The remote, for a clone that Mica keeps. */
  url: string | null;
  cloneBytes: number | null;
  sync: SyncStatus | null;
}

export interface ContentStagingService {
  status(): Promise<StagingStatus>;
  publish(input: PublishInput): Promise<PublishResult>;
  /**
   * Restores the reviewed paths, each with the revision the editor saw, under
   * the same check as Publish. `editor` names who discarded, for the log.
   */
  discard(paths: Record<string, string | null>, editor?: string): Promise<{ discarded: string[] }>;
  /** Retries the push after `committed-pending-push`. */
  push(): Promise<PublishResult>;
  /**
   * A document before and after a pending change. `origin` compares against the
   * website's version, not the last commit.
   */
  compare(target: CompareTarget, against?: "head" | "origin"): Promise<Comparison>;
  /** `compare` for many documents at once, in their order, with one view of the pending files. Each one succeeds or fails alone. */
  compareMany(targets: CompareTarget[], against?: "head" | "origin"): Promise<PromiseSettledResult<Comparison>[]>;
  /** Brings a clone that Mica keeps up to date now. Refused for the developer's checkout. */
  sync(): Promise<void>;
  resolve(group: string, choice: "mine" | "website", editor?: string): Promise<void>;
  repository(): Promise<RepositoryInfo>;
}

/** What to compare on the Publish page. */
export type CompareTarget =
  /** `from` names the published ID of a renamed entry. */
  | { kind: "entry"; collection: string; id: string; from?: string }
  | { kind: "singleton"; name: string }
  | { kind: "order"; collection: string };

/**
 * Raw field data on both sides of a pending change. The editor renders the
 * comparison from the model.
 */
export interface Comparison {
  /** As the repository has it — null when the change creates the document. */
  before: Record<string, unknown> | null;
  /** As staged for publication — null when the change deletes it. */
  after: Record<string, unknown> | null;
  /**
   * The pending files of the compared document, each with its revision when it
   * was compared: what Publish and Discard send back. Empty against `origin`.
   */
  revisions: Record<string, string | null>;
}

/**
 * Annotates a change set with owners and validates the entries it touches, in
 * one read of the affected collections. Only changed documents are validated: a
 * broken entry committed earlier must not block an unrelated publication.
 */
export async function analyseChanges(
  model: Site,
  source: ContentSource,
  changes: ContentChange[],
  /** The repository's side. When given, renamed entries are detected. */
  published?: ContentSource,
  /** `validate: false` only groups the changes, for the review check of Publish and Discard. */
  options: { validate?: boolean } = {},
): Promise<{ changes: AnnotatedChange[]; validation: StagingValidation }> {
  const owners: ChangeOwner[] = changes.map((change) => ownerOfPath(model, change.path));

  const problems: StagingProblem[] = [];
  const titles = new Map<string, string>();
  /**
   * The changed entries, as the source has them; null for one the change set
   * removes. Only these are read: the rest of a collection is not opened (#76).
   */
  const entriesByCollection = new Map<string, Map<string, Record<string, unknown> | null>>();

  const ordersChanged = new Set<string>();
  for (const owner of owners) if (owner.kind === "order") ordersChanged.add(owner.collection);
  // A changed order file must still parse: the website's build reads it.
  await Promise.all(
    [...ordersChanged].map(async (name) => {
      try {
        await readOrder(source, name);
      } catch (error) {
        const def = model.collections[name]!;
        const path = (error as { path?: string }).path ?? `${name}/${ORDER_FILE}`;
        problems.push({ path, label: `${def.label}: order`, issues: [{ path: "", message: (error as Error).message }] });
      }
    }),
  );

  const idsToRead = new Map<string, Set<string>>();
  for (const owner of owners) {
    if (owner.kind !== "entry") continue;
    const ids = idsToRead.get(owner.collection) ?? new Set<string>();
    idsToRead.set(owner.collection, ids);
    ids.add(owner.id);
  }
  await Promise.all(
    [...idsToRead].flatMap(([name, ids]) => {
      const def = model.collections[name]!;
      const read = new Map<string, Record<string, unknown> | null>();
      entriesByCollection.set(name, read);
      return [...ids].map(async (id) => {
        try {
          const data = await readCollectionEntry(source, def, name, id);
          read.set(id, data);
          if (data) titles.set(`${name}/${id}`, entryTitle(def, data));
        } catch (error) {
          // An unreadable entry is a problem at the path it names.
          read.set(id, null);
          problems.push({
            path: (error as { path?: string }).path ?? entryDataPath(name, id),
            label: def.label,
            issues: [{ path: "", message: (error as Error).message }],
          });
        }
      });
    }),
  );
  // The reads ran in parallel; the problems come out in the same order every time.
  problems.sort((a, b) => a.path.localeCompare(b.path));

  if (published) {
    await detectRenames(model, published, source, changes, owners, entriesByCollection);
  }

  const created = new Set(changes.filter((change) => change.kind === "create").map((change) => change.path));
  const needsByPath = new Map<string, string[]>();
  const annotate = (): AnnotatedChange[] =>
    changes.map((change, index): AnnotatedChange => {
      const owner = owners[index]!;
      const needs = needsByPath.get(change.path);
      const extra = needs ? { needs } : {};
      const group = groupOf(owner, change.path);
      if (owner.kind === "entry") {
        const def = model.collections[owner.collection]!;
        return {
          ...change,
          ...extra,
          owner: { ...owner, label: labelEntry(def, owner.id, titles.get(`${owner.collection}/${owner.id}`)) },
          group,
        };
      }
      return { ...change, ...extra, owner, group };
    });
  if (options.validate === false) return { changes: annotate(), validation: { ok: true, problems: [] } };

  /** How to read each changed document as the website has it, by its data file. */
  const publishedOf = new Map<string, () => Promise<Record<string, unknown> | null>>();
  const addNeeds = (dataPath: string, fields: Collection["fields"], data: Record<string, unknown>): void => {
    const needed = linkNeeds(dataPath, fields, data, created);
    if (needed.length > 0) needsByPath.set(dataPath, needed);
  };

  const validated = new Set<string>();
  // Each linked entry is looked up by its data file: only the targets that a changed document names.
  const targets = createReferenceCheck(model, source);

  for (const owner of owners) {
    if (owner.kind === "entry") {
      const key = `${owner.collection}/${owner.id}`;
      if (validated.has(key)) continue;
      validated.add(key);

      const def = model.collections[owner.collection]!;
      // Absent means the change set deletes this entry.
      const data = entriesByCollection.get(owner.collection)?.get(owner.id);
      if (!data) continue;

      const entryData = entryDataPath(owner.collection, owner.id);
      addNeeds(entryData, def.fields, data);
      if (published) {
        const { collection, id } = owner;
        publishedOf.set(entryData, () => readCollectionEntry(published, def, collection, id).catch(() => null));
      }
      const result = validateFields(def.fields, data);
      const issues = [...(result.ok ? [] : result.issues), ...(await targets.issues(def.fields, data, folderOf(entryData)))];
      if (issues.length > 0) {
        problems.push({
          path: entryData,
          label: labelEntry(def, owner.id, titles.get(key)),
          issues,
        });
      }
    }

    if (owner.kind === "singleton" && !validated.has(`singleton:${owner.name}`)) {
      validated.add(`singleton:${owner.name}`);

      const def = model.singletons[owner.name]!;
      const dataFile = entryDataPath(owner.name);
      try {
        const data = await readSingleton(source, def, owner.name);
        if (data === null) continue;

        addNeeds(dataFile, def.fields, data);
        if (published) {
          const name = owner.name;
          publishedOf.set(dataFile, () => readSingleton(published, def, name).catch(() => null));
        }
        const result = validateFields(def.fields, data);
        const issues = [...(result.ok ? [] : result.issues), ...(await targets.issues(def.fields, data, folderOf(dataFile)))];
        if (issues.length > 0) problems.push({ path: dataFile, label: def.label, issues });
      } catch (error) {
        problems.push({
          path: (error as { path?: string }).path ?? dataFile,
          label: def.label,
          issues: [{ path: "", message: (error as Error).message }],
        });
      }
    }
  }

  await followRenamedLinks(model, owners, needsByPath, publishedOf);

  problems.push(...(await brokenByRemoval(model, source, changes, owners, entriesByCollection, titles)));

  return {
    changes: annotate(),
    validation: { ok: problems.length === 0, problems },
  };
}

/**
 * Whether a file of `owner` can be part of the document that `target` compares.
 * An ID change can take its collection's order file along (`detectRenames`).
 */
export function ownedByTarget(owner: ChangeOwner, target: CompareTarget): boolean {
  if (target.kind === "entry") {
    if (owner.kind === "order") return target.from !== undefined && owner.collection === target.collection;
    return owner.kind === "entry" && owner.collection === target.collection && (owner.id === target.id || owner.id === target.from);
  }
  if (target.kind === "singleton") return owner.kind === "singleton" && owner.name === target.name;
  return owner.kind === "order" && owner.collection === target.collection;
}

/**
 * The key that keeps the files of one piece of content together: an entry, a
 * singleton, an order, or one file. Publish, Discard, the Publish page and a
 * sync conflict use the same keys.
 */
export function groupOf(owner: ChangeOwner, path: string): string {
  if (owner.kind === "entry") return `entry:${owner.collection}/${owner.id}`;
  if (owner.kind === "singleton") return `singleton:${owner.name}`;
  if (owner.kind === "order") return `order:${owner.collection}`;
  return `file:${path}`;
}

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
