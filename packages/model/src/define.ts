/**
 * Collection, singleton and site definition helpers.
 *
 * `defineSite` is where the loose descriptors become a checked model: it
 * injects the names taken from the map keys and validates cross-references so
 * that a typo in a relation target fails at process start rather than at the
 * moment an editor opens the form.
 */

import type {
  AnyField,
  Collection,
  CollectionOptions,
  FieldMap,
  Singleton,
  SingletonOptions,
  Site,
} from "./types.js";

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
>(options: { collections: C; singletons?: S }): Site<C, S> {
  const collections = {} as C;
  for (const [name, def] of Object.entries(options.collections)) {
    (collections as Record<string, Collection>)[name] = { ...def, name };
  }

  const singletons = {} as S;
  for (const [name, def] of Object.entries(options.singletons ?? {})) {
    (singletons as Record<string, Singleton>)[name] = { ...def, name };
  }

  const site: Site<C, S> = { collections, singletons };
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

/** Walks every field in a map, depth-first, yielding dotted paths. */
export function* walkFields(
  fields: FieldMap,
  prefix: string[] = [],
): Generator<{ path: string[]; key: string; field: AnyField }> {
  for (const [key, field] of Object.entries(fields)) {
    const path = [...prefix, key];
    yield { path, key, field };
    if (field.kind === "object" || field.kind === "repeater") {
      yield* walkFields(field.fields, path);
    }
  }
}

/** Every media id referenced by an entry payload, at any nesting depth. */
export function collectMediaIds(fields: FieldMap, data: unknown): string[] {
  const ids: string[] = [];

  const visit = (map: FieldMap, value: unknown): void => {
    if (value === null || typeof value !== "object") return;
    const record = value as Record<string, unknown>;

    for (const [key, field] of Object.entries(map)) {
      const item = record[key];
      if (item === null || item === undefined) continue;

      switch (field.kind) {
        case "media":
          if (Array.isArray(item)) {
            for (const id of item) if (typeof id === "string") ids.push(id);
          } else if (typeof item === "string") {
            ids.push(item);
          }
          break;
        case "object":
          visit(field.fields, item);
          break;
        case "repeater":
          if (Array.isArray(item)) for (const row of item) visit(field.fields, row);
          break;
        default:
          break;
      }
    }
  };

  visit(fields, data);
  return [...new Set(ids)];
}
