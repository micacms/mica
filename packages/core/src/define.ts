/**
 * Collection, singleton and site definition helpers.
 *
 * `defineSite` is where the loose descriptors become a checked model: it
 * injects the names taken from the map keys and validates cross-references so
 * that a typo in a relation target fails at process start rather than at the
 * moment an editor opens the form.
 */

import type {
  Collection,
  CollectionOptions,
  FieldMap,
  Singleton,
  SingletonOptions,
  Site,
} from "./types.js";
import { textPattern } from "./validation.js";

export class ModelError extends Error {
  override name = "ModelError";
}

export function collection<O extends CollectionOptions>(options: O): Collection & O {
  return { type: "collection", name: "", ...options } as Collection & O;
}

export function singleton<O extends SingletonOptions>(options: O): Singleton & O {
  return { type: "singleton", name: "", ...options } as Singleton & O;
}

export function defineSite<
  C extends Record<string, Collection>,
  S extends Record<string, Singleton>,
>(options: { root?: string; collections: C; singletons?: S }): Site<C, S> {
  const collections = {} as C;
  for (const [name, def] of Object.entries(options.collections)) {
    (collections as Record<string, Collection>)[name] = { ...def, name };
  }

  const singletons = {} as S;
  for (const [name, def] of Object.entries(options.singletons ?? {})) {
    (singletons as Record<string, Singleton>)[name] = { ...def, name };
  }

  // Only when given: a model that came back from a manifest has no root, and
  // writing a default into it would claim to know something it does not.
  const site: Site<C, S> = options.root === undefined
    ? { collections, singletons }
    : { root: options.root, collections, singletons };

  assertValidSite(site);
  return site;
}

/* ------------------------------------------------------------------ *
 * Model validation
 * ------------------------------------------------------------------ */

const NAME_PATTERN = /^[a-z][a-zA-Z0-9]*$/;

/**
 * Names that would collide with the structure of the protocol manifest, which
 * keys collections and singletons by name alongside its own metadata. Rejected
 * here rather than producing a confusing shadowing later.
 */
const RESERVED_NAMES = new Set([
  "collections",
  "singletons",
  "protocolVersion",
  "generatedBy",
]);

function assertValidSite(site: Site): void {
  const collectionNames = new Set(Object.keys(site.collections));

  for (const [name, def] of Object.entries(site.collections)) {
    if (!NAME_PATTERN.test(name)) {
      throw new ModelError(
        `Collection name "${name}" must be lowerCamelCase and start with a letter.`,
      );
    }
    if (RESERVED_NAMES.has(name)) {
      throw new ModelError(
        `Collection name "${name}" is reserved. Reserved names: ${[...RESERVED_NAMES].join(", ")}.`,
      );
    }
    checkFields(def.fields, `collections.${name}`, collectionNames);

    const slugKey = resolveSlugField(def);
    if (!slugKey) {
      throw new ModelError(
        `Collection "${name}" has no slug field. Add one with \`slug({ from: "title" })\`, ` +
          `or point \`slugField\` at an existing field.`,
      );
    }
    if (def.slugField && !def.fields[def.slugField]) {
      throw new ModelError(
        `Collection "${name}" declares slugField "${def.slugField}" which is not a field.`,
      );
    }
    if (def.titleField && !def.fields[def.titleField]) {
      throw new ModelError(
        `Collection "${name}" declares titleField "${def.titleField}" which is not a field.`,
      );
    }

    const sortField = def.defaultSort?.field;
    if (sortField && sortField !== "position" && !def.fields[sortField]) {
      throw new ModelError(
        `Collection "${name}" sorts by "${sortField}" which is not a field. ` +
          `Use "position" for the order editors arrange by hand, or one of: ` +
          `${Object.keys(def.fields).join(", ")}.`,
      );
    }
  }

  for (const [name, def] of Object.entries(site.singletons)) {
    if (!NAME_PATTERN.test(name)) {
      throw new ModelError(
        `Singleton name "${name}" must be lowerCamelCase and start with a letter.`,
      );
    }
    if (RESERVED_NAMES.has(name)) {
      throw new ModelError(
        `Singleton name "${name}" is reserved. Reserved names: ${[...RESERVED_NAMES].join(", ")}.`,
      );
    }
    // Both occupy one namespace in the manifest and on disk, so a shared name
    // would make one shadow the other.
    if (collectionNames.has(name)) {
      throw new ModelError(
        `"${name}" is both a collection and a singleton. Names must be unique across both.`,
      );
    }
    checkFields(def.fields, `singletons.${name}`, collectionNames);
  }
}

function checkFields(fields: FieldMap, path: string, collectionNames: Set<string>): void {
  for (const [key, field] of Object.entries(fields)) {
    const here = `${path}.${key}`;

    if (!NAME_PATTERN.test(key)) {
      throw new ModelError(`Field key "${here}" must be lowerCamelCase and start with a letter.`);
    }

    if (field.kind === "relation" && !collectionNames.has(field.collection)) {
      throw new ModelError(
        `Relation "${here}" points at unknown collection "${field.collection}". ` +
          `Known collections: ${[...collectionNames].join(", ") || "(none)"}.`,
      );
    }

    if (field.kind === "slug" && field.from && !fields[field.from]) {
      throw new ModelError(
        `Slug field "${here}" derives from "${field.from}", which is not a sibling field.`,
      );
    }

    if (field.kind === "text" && field.pattern !== undefined) {
      try {
        textPattern(field.pattern);
      } catch (error) {
        throw new ModelError(`Text field "${here}" has an invalid pattern: ${(error as Error).message}`);
      }
    }

    if (field.kind === "select" && field.options.length === 0) {
      throw new ModelError(`Select field "${here}" must declare at least one option.`);
    }

    if (field.kind === "repeater" && field.itemLabel && !field.fields[field.itemLabel]) {
      throw new ModelError(
        `Repeater "${here}" uses itemLabel "${field.itemLabel}", which is not a child field.`,
      );
    }

    if (field.kind === "object" || field.kind === "repeater") {
      checkFields(field.fields, here, collectionNames);
    }
  }
}

/* ------------------------------------------------------------------ *
 * Model queries — used by the server, the admin SPA and the loaders
 * ------------------------------------------------------------------ */

/** The field key holding the slug: the declared one, else the first `slug` field. */
export function resolveSlugField(def: Collection): string | undefined {
  if (def.slugField) return def.slugField;
  return Object.entries(def.fields).find(([, f]) => f.kind === "slug")?.[0];
}

/**
 * The field key used as the entry title in list views: the declared one, else
 * `title`, else the first plain text field, else the slug.
 */
export function resolveTitleField(def: Collection): string | undefined {
  if (def.titleField) return def.titleField;
  if (def.fields["title"]) return "title";
  const firstText = Object.entries(def.fields).find(([, f]) => f.kind === "text")?.[0];
  return firstText ?? resolveSlugField(def);
}

/** Best-effort human label for an entry, for list views and revision summaries. */
export function entryTitle(def: Collection, data: Record<string, unknown>): string {
  const key = resolveTitleField(def);
  const value = key ? data[key] : undefined;
  if (typeof value === "string" && value.trim()) return value.trim();

  const slugKey = resolveSlugField(def);
  const slugValue = slugKey ? data[slugKey] : undefined;
  if (typeof slugValue === "string" && slugValue.trim()) return slugValue.trim();

  return "Untitled";
}

/** An entry as a list view holds it: its manual order, and its values. */
export interface SortableEntry {
  position: number;
  data: Record<string, unknown>;
}

/**
 * Orders entries the way the collection asks to be listed.
 *
 * `defaultSort` described this for a long time without doing it — nothing read
 * the option, so a collection of news articles opened in whatever order its
 * directory happened to be read in, and the wrong field name in it went
 * unnoticed because the right one would not have changed anything either.
 *
 * Absent, the answer is `position`: the order an editor arranged by hand, and
 * the only order that is theirs rather than derived.
 */
export function compareEntries(def: Collection): (a: SortableEntry, b: SortableEntry) => number {
  const sort = def.defaultSort;
  const byPosition = (a: SortableEntry, b: SortableEntry) => a.position - b.position;

  if (!sort || sort.field === "position") {
    return sort?.direction === "desc" ? (a, b) => byPosition(b, a) : byPosition;
  }

  const sign = sort.direction === "desc" ? -1 : 1;

  return (a, b) => {
    const left = a.data[sort.field];
    const right = b.data[sort.field];

    // An entry that has not been given the value yet goes last in both
    // directions. Sinking it in one and floating it in the other would put the
    // emptiest entries first exactly when a list is sorted newest-first.
    const leftEmpty = left === null || left === undefined || left === "";
    const rightEmpty = right === null || right === undefined || right === "";
    if (leftEmpty || rightEmpty) {
      if (leftEmpty && rightEmpty) return byPosition(a, b);
      return leftEmpty ? 1 : -1;
    }

    if (typeof left === "number" && typeof right === "number") {
      return (left - right) * sign || byPosition(a, b);
    }

    // Dates are ISO strings, which compare correctly as text.
    return String(left).localeCompare(String(right)) * sign || byPosition(a, b);
  };
}

/** Field keys shown as columns in the collection overview. */
export function listedFields(def: Collection): string[] {
  return Object.entries(def.fields)
    .filter(([, f]) => f.listed)
    .map(([key]) => key);
}

export function getCollection(site: Site, name: string): Collection | undefined {
  return site.collections[name];
}

export function getSingleton(site: Site, name: string): Singleton | undefined {
  return site.singletons[name];
}

