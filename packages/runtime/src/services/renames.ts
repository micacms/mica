/**
 * URL changes in a pending change set. An entry has no identity but its slug,
 * so a URL change is a deleted and a created entry with the same content, as
 * in Git's rename detection.
 */

import {
  type Collection,
  type ContentChange,
  type ContentSource,
  documentLinks,
  entryDataPath,
  type FieldMap,
  ORDER_FILE,
  ownerOfPath,
  readCollectionEntry,
  resolveSlugField,
  type Site,
} from "@micacms/core/internal";

import type { ChangeOwner } from "./changes.js";
import { onDisk } from "./compare.js";
import { folderOf } from "./links.js";

/** Content share that two versions of an entry need to count as one moved entry, as in Git. */
const RENAME_SIMILARITY = 0.5;

/**
 * Marks renamed entries in place in `owners`. Deleted and created entries are
 * paired by content. An order file whose only change is the renamed slug joins
 * the entry, so a discard cannot leave the order naming a slug that does not exist.
 */
export async function detectRenames(
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

/**
 * A URL change and the links that follow it are published together, both ways.
 * A document follows when the website's version of it links to the old URL; a
 * new draft that links to the new URL only needs the change, and does not hold
 * it back. Adds the documents to the needs of the URL change, in place.
 */
export async function followRenamedLinks(
  model: Site,
  owners: ChangeOwner[],
  needsByPath: Map<string, string[]>,
  /** How to read each changed document as the website has it, by its data file. */
  publishedOf: Map<string, () => Promise<Record<string, unknown> | null>>,
): Promise<void> {
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
        documentLinks(fields, before, folderOf(document)).some(
          (link) => link.kind === "relation" && link.collection === target.collection && link.slug === target.renamedFrom,
        );
      if (linkedBefore) needsByPath.set(path, [...new Set([...(needsByPath.get(path) ?? []), document])]);
    }
  }
}

/** The fields of the entry or singleton whose data file is `path`. */
function fieldsOfDocument(model: Site, path: string): FieldMap | null {
  const owner = ownerOfPath(model, path);
  if (owner.kind === "entry") return model.collections[owner.collection]?.fields ?? null;
  if (owner.kind === "singleton") return model.singletons[owner.name]?.fields ?? null;
  return null;
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
