/** The staging API types, the before/after comparison and the analysis of a pending change set. */

import type { Author } from "../workspace/files.js";
import {
  type Collection,
  collectReferences,
  type ContentChange,
  type ContentSource,
  createReferenceCheck,
  entryDataPath,
  entryFolder,
  entryTitle,
  type FieldIssue,
  type FieldMap,
  isValidSlug,
  markdocImages,
  MEDIA_DIR,
  ORDER_FILE,
  type PublishResult,
  readCollection,
  readCollectionEntry,
  readOrder,
  readSingleton,
  relativizeMedia,
  resolveMarkdocTarget,
  resolveSlugField,
  richTextValues,
  type Site,
  validateFields,
} from "@micacms/core";

import { badRequest } from "../lib/errors.js";
import type { SyncStatus } from "../workspace/policy.js";
import type { UnpushedCommits } from "../workspace/tree.js";

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
  /** Brings a clone that Mica keeps up to date now. Refused for the developer's checkout. */
  sync(): Promise<void>;
  resolve(group: string, choice: "mine" | "website", editor?: string): Promise<void>;
  repository(): Promise<RepositoryInfo>;
}

/** What to compare on the Publish page. */
export type CompareTarget =
  /** `from` names the published slug of a renamed entry. */
  | { kind: "entry"; collection: string; slug: string; from?: string }
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
 * Reads one document from `published` and from `staged`. An order target
 * becomes `{ order: [{ slug, title }] }` on each side, in position order.
 */
export async function compareSources(
  model: Site,
  published: ContentSource,
  staged: ContentSource,
  target: CompareTarget,
): Promise<Omit<Comparison, "revisions">> {
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
    const old = await readCollectionEntry(published, def, target.collection, from);
    const after = await readCollectionEntry(staged, def, target.collection, target.slug);
    if (from === target.slug) return { before: old, after };

    // A rename: compare the on-disk form, where colocated media paths do not
    // name the entry's folder.
    return {
      before: old && onDisk(def, target.collection, from, old),
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
): Promise<{ changes: AnnotatedChange[]; validation: StagingValidation }> {
  const owners = changes.map((change) => classifyPath(model, change.path));

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

  const slugsToRead = new Map<string, Set<string>>();
  for (const owner of owners) {
    if (owner.kind !== "entry") continue;
    const slugs = slugsToRead.get(owner.collection) ?? new Set<string>();
    slugsToRead.set(owner.collection, slugs);
    slugs.add(owner.slug);
  }
  await Promise.all(
    [...slugsToRead].flatMap(([name, slugs]) => {
      const def = model.collections[name]!;
      const read = new Map<string, Record<string, unknown> | null>();
      entriesByCollection.set(name, read);
      return [...slugs].map(async (slug) => {
        try {
          const data = await readCollectionEntry(source, def, name, slug);
          read.set(slug, data);
          if (data) titles.set(`${name}/${slug}`, entryTitle(def, data));
        } catch (error) {
          // An unreadable entry is a problem at the path it names.
          read.set(slug, null);
          problems.push({
            path: (error as { path?: string }).path ?? entryDataPath(name, slug),
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
  /** How to read each changed document as the website has it, by its data file. */
  const publishedOf = new Map<string, () => Promise<Record<string, unknown> | null>>();
  const addNeeds = (dataPath: string, fields: Collection["fields"], data: Record<string, unknown>): void => {
    const needed = new Set<string>();
    for (const reference of collectReferences(fields, data)) {
      const path = reference.kind === "media" ? reference.path : entryDataPath(reference.collection, reference.slug);
      if (path !== dataPath && created.has(path)) needed.add(path);
    }
    // An image in rich text needs its new file too, for example an upload to the shared folder.
    for (const text of richTextValues(fields, data)) {
      for (const target of markdocImages(text)) {
        const path = resolveMarkdocTarget(target, folderOf(dataPath));
        if (path && created.has(path)) needed.add(path);
      }
    }
    if (needed.size > 0) needsByPath.set(dataPath, [...needed]);
  };
  /** The folder of a data file, from which its rich text reads a relative path. */
  const folderOf = (dataPath: string): string => dataPath.slice(0, dataPath.lastIndexOf("/"));

  const validated = new Set<string>();
  // Each linked entry is looked up by its data file: only the targets that a changed document names.
  const targets = createReferenceCheck(model, source);

  for (const owner of owners) {
    if (owner.kind === "entry") {
      const key = `${owner.collection}/${owner.slug}`;
      if (validated.has(key)) continue;
      validated.add(key);

      const def = model.collections[owner.collection]!;
      // Absent means the change set deletes this entry.
      const data = entriesByCollection.get(owner.collection)?.get(owner.slug);
      if (!data) continue;

      const entryData = entryDataPath(owner.collection, owner.slug);
      addNeeds(entryData, def.fields, data);
      if (published) {
        const { collection, slug } = owner;
        publishedOf.set(entryData, () => readCollectionEntry(published, def, collection, slug).catch(() => null));
      }
      const result = validateFields(def.fields, data);
      const issues = [...(result.ok ? [] : result.issues), ...(await targets.issues(def.fields, data, folderOf(entryData)))];
      if (issues.length > 0) {
        problems.push({
          path: entryData,
          label: labelEntry(def, owner.slug, titles.get(key)),
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

  // A URL change and the links that follow it are published together, both ways. A
  // document follows when the website's version of it links to the old URL; a new
  // draft that links to the new URL only needs the change, and does not hold it back.
  const renamed = new Map(
    owners.flatMap((owner) =>
      owner.kind === "entry" && owner.renamedFrom
        ? [[entryDataPath(owner.collection, owner.slug), owner] as const]
        : [],
    ),
  );
  for (const [document, needed] of [...needsByPath]) {
    for (const path of needed) {
      const target = renamed.get(path);
      if (!target || target.kind !== "entry") continue;
      const before = await publishedOf.get(document)?.();
      const fields = before && fieldsOfDocument(model, document);
      const linkedBefore =
        before &&
        fields &&
        collectReferences(fields, before).some(
          (reference) => reference.kind === "relation" && reference.collection === target.collection && reference.slug === target.renamedFrom,
        );
      if (linkedBefore) needsByPath.set(path, [...new Set([...(needsByPath.get(path) ?? []), document])]);
    }
  }

  problems.push(...(await brokenByRemoval(model, source, changes, owners, entriesByCollection, titles)));

  const annotated = changes.map((change, index): AnnotatedChange => {
    const owner = owners[index]!;
    const needs = needsByPath.get(change.path);
    const extra = needs ? { needs } : {};
    if (owner.kind === "entry") {
      const def = model.collections[owner.collection]!;
      return {
        ...change,
        ...extra,
        owner: { ...owner, label: labelEntry(def, owner.slug, titles.get(`${owner.collection}/${owner.slug}`)) },
      };
    }
    return { ...change, ...extra, owner };
  });

  return {
    changes: annotated,
    validation: { ok: problems.length === 0, problems },
  };
}

/** The fields of the entry or singleton whose data file is `path`. */
function fieldsOfDocument(model: Site, path: string): Collection["fields"] | null {
  const owner = classifyPath(model, path);
  if (owner.kind === "entry") return model.collections[owner.collection]?.fields ?? null;
  if (owner.kind === "singleton") return model.singletons[owner.name]?.fields ?? null;
  return null;
}

/**
 * Whether a file of `owner` can be part of the document that `target` compares.
 * A URL change can take its collection's order file along (`detectRenames`).
 */
export function ownedByTarget(owner: ChangeOwner, target: CompareTarget): boolean {
  if (target.kind === "entry") {
    if (owner.kind === "order") return target.from !== undefined && owner.collection === target.collection;
    return owner.kind === "entry" && owner.collection === target.collection && (owner.slug === target.slug || owner.slug === target.from);
  }
  if (target.kind === "singleton") return owner.kind === "singleton" && owner.name === target.name;
  return owner.kind === "order" && owner.collection === target.collection;
}

/** Which piece of content a file belongs to, read from the model's path layout. */
export function classifyPath(model: Site, path: string): ChangeOwner {
  const segments = path.split("/");
  const head = segments[0] ?? "";

  const collection = model.collections[head];
  if (collection && segments.length > 1) {
    if (segments.length === 2 && segments[1] === ORDER_FILE) {
      return { kind: "order", collection: head, label: `${collection.label}: order` };
    }

    const slug = segments[1]!;
    if (segments.length >= 3 && isValidSlug(slug)) return { kind: "entry", collection: head, slug, label: slug };
  }

  const singleton = model.singletons[head];
  if (singleton && segments.length > 1) return { kind: "singleton", name: head, label: singleton.label };

  if (head === MEDIA_DIR) return { kind: "media", label: "Shared media" };

  return { kind: "other", label: path };
}

/** Content share that two versions of an entry need to count as one moved entry, as in Git. */
const RENAME_SIMILARITY = 0.5;

/**
 * Marks renamed entries in place in `owners`. An entry has no identity but its
 * slug, so deleted and created entries are paired by content, like Git's rename
 * detection. An order file whose only change is the renamed slug joins the
 * entry, so a discard cannot leave the order naming a slug that does not exist.
 */
async function detectRenames(
  model: Site,
  published: ContentSource,
  source: ContentSource,
  changes: ContentChange[],
  owners: ChangeOwner[],
  /** The changed entries as staged; null for a removed one. */
  staged: Map<string, Map<string, Record<string, unknown> | null>>,
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
    const deleted = only("delete").filter((slug) => !after.get(slug));
    const created = only("create").filter((slug) => after.get(slug));
    if (deleted.length === 0 || created.length === 0) continue;

    // Only the candidates are read on the published side, not the collection.
    const def = model.collections[name]!;
    const publishedEntry = (slug: string) => readCollectionEntry(published, def, name, slug).catch(() => null);
    const before = new Map<string, Record<string, unknown> | null>();
    await Promise.all([...deleted, ...created].map(async (slug) => before.set(slug, await publishedEntry(slug))));

    const candidates: Array<{ from: string; to: string; score: number }> = [];
    for (const from of deleted) {
      const old = before.get(from);
      if (!old) continue;
      for (const to of created) {
        if (before.get(to)) continue;
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

/** Entry data with media paths as the files store them: relative to the entry's folder. */
function onDisk(
  def: Collection,
  collection: string,
  slug: string,
  data: Record<string, unknown>,
): Record<string, unknown> {
  return relativizeMedia(def.fields, data, entryFolder(collection, slug));
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

/**
 * Entries and files that the change set removes while another entry still
 * points at them. Publishing them would break a link or an image on the site.
 */
async function brokenByRemoval(
  model: Site,
  source: ContentSource,
  changes: ContentChange[],
  owners: ChangeOwner[],
  /** The changed entries as staged; null for a removed one. */
  entriesByCollection: Map<string, Map<string, Record<string, unknown> | null>>,
  titles: Map<string, string>,
): Promise<StagingProblem[]> {
  const removedEntries = new Map<string, { collection: string; slug: string; renamedTo?: string }>();
  const removedFiles = new Set<string>();
  changes.forEach((change, index) => {
    const owner = owners[index]!;
    if (change.kind !== "delete") return;
    if (owner.kind === "entry") {
      // A URL change removes the old slug: links to it break as with a delete.
      const gone = owner.renamedFrom ?? owner.slug;
      if (!entriesByCollection.get(owner.collection)?.get(gone)) {
        const renamedTo = owner.renamedFrom ? owner.slug : undefined;
        removedEntries.set(`${owner.collection}/${gone}`, { collection: owner.collection, slug: gone, ...(renamedTo ? { renamedTo } : {}) });
        return;
      }
    }
    // Only a media file can be a target; a cleared rich-text file or an order file cannot.
    if (!change.path.endsWith(".json") && !change.path.endsWith(".mdoc")) removedFiles.add(change.path);
  });
  if (removedEntries.size === 0 && removedFiles.size === 0) return [];

  const linkedFrom = new Map<string, string[]>();
  const note = (target: string, from: string) => linkedFrom.set(target, [...(linkedFrom.get(target) ?? []), from]);

  const scan = (label: string, fields: FieldMap, data: Record<string, unknown>) => {
    for (const reference of collectReferences(fields, data)) {
      const target = reference.kind === "relation" ? `${reference.collection}/${reference.slug}` : reference.path;
      if (removedEntries.has(target) || removedFiles.has(target)) note(target, label);
    }
  };

  // Only a removal reads the whole site: what links to the removed entry or file can be anywhere.
  for (const [name, def] of Object.entries(model.collections)) {
    let entries: Awaited<ReturnType<typeof readCollection>>;
    try {
      entries = await readCollection(source, def, name);
    } catch {
      continue; // An unreadable collection is reported where it is changed.
    }
    for (const { slug, data } of entries) scan(labelEntry(def, slug, entryTitle(def, data)), def.fields, data);
  }
  for (const [name, def] of Object.entries(model.singletons)) {
    const data = await readSingleton(source, def, name).catch(() => null);
    if (data) scan(def.label, def.fields, data);
  }

  const problems: StagingProblem[] = [];
  for (const [target, from] of linkedFrom) {
    const entry = removedEntries.get(target);
    const def = entry ? model.collections[entry.collection]! : null;
    const message = entry?.renamedTo
      ? `The URL changes from "${entry.slug}" to "${entry.renamedTo}", and ${from.join(", ")} still link to "${entry.slug}". Change those links first, or publish them together.`
      : `Still linked from ${from.join(", ")}. Remove those links first, or publish them together.`;
    problems.push({
      path: entry ? entryDataPath(entry.collection, entry.slug) : target,
      label: entry && def ? labelEntry(def, entry.slug, titles.get(target)) : target,
      issues: [{ path: "", message }],
    });
  }
  return problems;
}

function labelEntry(def: Collection, slug: string, title: string | undefined): string {
  return `${def.labelSingular ?? def.label}: ${title ?? slug}`;
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
