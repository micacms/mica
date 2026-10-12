/**
 * Understanding a pending change set, shared by every staging implementation.
 *
 * The types the staging API speaks, the before/after comparison of one
 * document, and the analysis that names each changed file and validates the
 * entries it touches. Nothing here knows where the changes are kept.
 */

import type { Author } from "@micacms/connectors";
import {
  ORDER_FILE,
  collectionEntryPath,
  entryLayout,
  entryTitle,
  isValidSlug,
  readCollection,
  readCollectionEntry,
  readSingleton,
  relativizeMedia,
  resolveSlugField,
  singletonPath,
  validateFields,
  type Collection,
  type ContentChange,
  type ContentSource,
  type FieldIssue,
  type PublishResult,
  type Site,
} from "@micacms/core";

import { badRequest } from "../lib/errors.js";

/** Where the change happened, in words an editor recognises. */
export type ChangeOwner =
  | {
      kind: "entry";
      collection: string;
      slug: string;
      label: string;
      /** The slug before a pending rename. Set on the files of both slugs. */
      renamedFrom?: string;
    }
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
   * What the pending changes are based on: the working tree's HEAD. Sent back
   * with Publish as `expectedBase`.
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
  /** The document a pending change touches, before and after that change. */
  compare(target: CompareTarget): Promise<Comparison>;
}

/** One thing an editor recognises on the Publish page, named for comparison. */
export type CompareTarget =
  /** `from` names the published slug of a renamed entry. */
  | { kind: "entry"; collection: string; slug: string; from?: string }
  | { kind: "singleton"; name: string }
  | { kind: "order"; collection: string };

/**
 * A document on both sides of the pending change set.
 *
 * Raw field data, deliberately: the editor holds the model and can name,
 * order and render every field, so the friendly comparison is its job. What
 * only the server can do is read the same document from two places.
 */
export interface Comparison {
  /** As the repository has it — null when the change creates the document. */
  before: Record<string, unknown> | null;
  /** As staged for publication — null when the change deletes it. */
  after: Record<string, unknown> | null;
}

/**
 * Reads one document from the repository (`published`) and from the pending
 * workspace (`staged`) — the whole of a before/after comparison, shared by
 * both staging implementations since a `ContentSource` is all it needs.
 *
 * An order target compares the collection's ordering rather than a document:
 * each side becomes `{ order: [{ slug, title }] }`, in position order.
 */
export async function compareSources(
  model: Site,
  published: ContentSource,
  staged: ContentSource,
  target: CompareTarget,
): Promise<Comparison> {
  if (target.kind === "singleton") {
    const def = model.singletons[target.name];
    if (!def) throw badRequest(`There is no singleton called "${target.name}".`);
    return {
      before: await readSingleton(published, def, target.name),
      after: await readSingleton(staged, def, target.name),
    };
  }

  const def = model.collections[target.collection];
  if (!def) throw badRequest(`There is no collection called "${target.collection}".`);

  if (target.kind === "entry") {
    const from = target.from ?? target.slug;
    for (const slug of [target.slug, from]) {
      if (!isValidSlug(slug)) throw badRequest(`"${slug}" is not a slug.`);
    }
    const before = await readCollectionEntry(published, def, target.collection, from);
    const after = await readCollectionEntry(staged, def, target.collection, target.slug);
    if (from === target.slug) return { before, after };

    // A rename: colocated media paths name the entry's folder, so they are
    // compared in the on-disk form, where a moved file keeps its path.
    return {
      before: before && onDisk(def, target.collection, from, before),
      after: after && onDisk(def, target.collection, target.slug, after),
    };
  }

  const ordering = async (source: ContentSource) => {
    const entries = await readCollection(source, def, target.collection);
    if (entries.length === 0) return null;
    return {
      order: entries.map((entry) => ({ slug: entry.slug, title: entryTitle(def, entry.data) })),
    };
  };

  return { before: await ordering(published), after: await ordering(staged) };
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
 * Validation is scoped to *changed* documents. Content that was already in
 * the repository is not this publication's problem — refusing
 * to publish a fixed typo because somebody once hand-committed a broken entry
 * elsewhere would make the editor hostage to history it cannot touch.
 */
export async function analyseChanges(
  model: Site,
  source: ContentSource,
  changes: ContentChange[],
  /** The repository's side. When given, renamed entries are detected. */
  published?: ContentSource,
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

  if (published) {
    await detectRenames(model, published, source, changes, owners, entriesByCollection);
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

/** Content share that two versions of an entry need to count as one moved entry, as in Git. */
const RENAME_SIMILARITY = 0.5;

/**
 * Marks entries that a pending rename moved, in place in `owners`.
 *
 * A rename is a deleted and a created entry in one collection. The change set
 * holds only files and an entry has no identity but its slug, so the pairs are
 * found by content, like Git's rename detection: the published version of the
 * deleted entry against the staged version of the created one.
 *
 * An order file whose only change is the renamed slug joins the renamed entry:
 * it is part of the same edit, and discarding one without the other would
 * leave the order naming a slug that does not exist.
 */
async function detectRenames(
  model: Site,
  published: ContentSource,
  source: ContentSource,
  changes: ContentChange[],
  owners: ChangeOwner[],
  staged: Map<string, Map<string, Record<string, unknown>>>,
): Promise<void> {
  const kinds = new Map<string, Map<string, Set<ContentChange["kind"]>>>();
  owners.forEach((owner, index) => {
    if (owner.kind !== "entry") return;
    const bySlug = kinds.get(owner.collection) ?? new Map<string, Set<ContentChange["kind"]>>();
    kinds.set(owner.collection, bySlug);
    const set = bySlug.get(owner.slug) ?? new Set<ContentChange["kind"]>();
    bySlug.set(owner.slug, set);
    set.add(changes[index]!.kind);
  });

  for (const [name, bySlug] of kinds) {
    const after = staged.get(name);
    if (!after) continue;

    const only = (kind: ContentChange["kind"]) =>
      [...bySlug].filter(([, set]) => set.size === 1 && set.has(kind)).map(([slug]) => slug);
    const deleted = only("delete").filter((slug) => !after.has(slug));
    const created = only("create").filter((slug) => after.has(slug));
    if (deleted.length === 0 || created.length === 0) continue;

    const def = model.collections[name]!;
    let before: Map<string, Record<string, unknown>>;
    try {
      const entries = await readCollection(published, def, name);
      before = new Map(entries.map((entry) => [entry.slug, entry.data]));
    } catch {
      // A published side that cannot be read only costs the pairing.
      continue;
    }

    const candidates: Array<{ from: string; to: string; score: number }> = [];
    for (const from of deleted) {
      const old = before.get(from);
      if (!old) continue;
      for (const to of created) {
        if (before.has(to)) continue;
        const score = similarity(def, onDisk(def, name, from, old), onDisk(def, name, to, after.get(to)!));
        if (score >= RENAME_SIMILARITY) candidates.push({ from, to, score });
      }
    }

    const renamedTo = new Map<string, string>();
    const paired = new Set<string>();
    for (const { from, to } of candidates.sort((a, b) => b.score - a.score)) {
      if (renamedTo.has(from) || paired.has(to)) continue;
      renamedTo.set(from, to);
      paired.add(to);
    }

    if (renamedTo.size === 0) continue;

    const renamedFrom = new Map([...renamedTo].map(([from, to]) => [to, from]));
    const orderMovesOnlySlugs = await onlyRenamedInOrder(published, source, name, renamedTo);
    const [firstFrom, firstTo] = [...renamedTo][0]!;

    owners.forEach((owner, index) => {
      if (owner.kind === "order" && owner.collection === name && orderMovesOnlySlugs) {
        owners[index] = {
          kind: "entry",
          collection: name,
          slug: firstTo,
          label: firstTo,
          renamedFrom: firstFrom,
        };
      }
      if (owner.kind !== "entry" || owner.collection !== name) return;
      const to = renamedTo.get(owner.slug);
      if (to) owners[index] = { ...owner, slug: to, label: to, renamedFrom: owner.slug };
      const from = renamedFrom.get(owner.slug);
      if (from) owners[index] = { ...owner, renamedFrom: from };
    });
  }
}

/** True when a collection's staged order is the published one with the renamed slugs replaced. */
async function onlyRenamedInOrder(
  published: ContentSource,
  staged: ContentSource,
  name: string,
  renamedTo: Map<string, string>,
): Promise<boolean> {
  const path = `${name}/${ORDER_FILE}`;
  const parse = (raw: string | null): unknown => {
    try {
      return raw === null ? null : JSON.parse(raw);
    } catch {
      return null;
    }
  };

  const before = parse(await published.read(path));
  const after = parse(await staged.read(path));
  if (!Array.isArray(before) || !Array.isArray(after)) return false;

  const expected = before.map((slug: unknown) =>
    typeof slug === "string" ? (renamedTo.get(slug) ?? slug) : slug,
  );
  return canonical(expected) === canonical(after);
}

/** The share of non-empty fields, the slug aside, that two versions of an entry agree on. */
function similarity(def: Collection, a: Record<string, unknown>, b: Record<string, unknown>): number {
  const slugKey = resolveSlugField(def);
  let compared = 0;
  let equal = 0;
  for (const key of Object.keys(def.fields)) {
    if (key === slugKey || (isEmpty(a[key]) && isEmpty(b[key]))) continue;
    compared += 1;
    if (canonical(a[key]) === canonical(b[key])) equal += 1;
  }
  return compared === 0 ? 0 : equal / compared;
}

/** Entry data with media paths as the files store them: relative to the entry, where it has a folder. */
function onDisk(
  def: Collection,
  collection: string,
  slug: string,
  data: Record<string, unknown>,
): Record<string, unknown> {
  return entryLayout(def.fields) === "directory"
    ? relativizeMedia(def.fields, data, collectionEntryPath(def.fields, collection, slug))
    : data;
}

function isEmpty(value: unknown): boolean {
  return value === undefined || value === null || value === "" || (Array.isArray(value) && value.length === 0);
}

/** JSON with sorted keys, so two equal objects compare equal. */
function canonical(value: unknown): string {
  return JSON.stringify(value ?? null, (_key, entry: unknown) => {
    if (entry === null || typeof entry !== "object" || Array.isArray(entry)) return entry;
    const record = entry as Record<string, unknown>;
    return Object.fromEntries(Object.keys(record).sort().map((key) => [key, record[key]]));
  });
}

function labelEntry(def: Collection, slug: string, title: string | undefined): string {
  return `${def.labelSingular ?? def.label}: ${title ?? slug}`;
}

function entryDataPath(def: Collection, collection: string, slug: string): string {
  const base = collectionEntryPath(def.fields, collection, slug);
  return entryLayout(def.fields) === "directory" ? `${base}/index.json` : base;
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
