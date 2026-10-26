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
  ReferenceSet,
  ReferenceSetOptions,
  Singleton,
  SingletonOptions,
  Site,
} from "./types.js";
import { MEDIA_DIR } from "./layout.js";
import { mapProblem } from "./map.js";
import { isMediaFileType, MEDIA_FILE_TYPE_NAMES } from "./media-types.js";
import { pageUrlProblem } from "./page-url.js";
import { nestedRepeat, textPattern } from "./pattern.js";
import { RICH_TEXT_TOOLBARS } from "./rich-text.js";
import { compareDates, validateFields } from "./validation.js";

export class ModelError extends Error {
  override name = "ModelError";
}

/** What a collection's list can be sorted by: `"position"` (the order editors arrange) or one of its fields. */
export type SortableBy<O extends CollectionOptions> = "position" | Extract<keyof O["fields"], string>;

export function collection<O extends CollectionOptions>(
  options: O & { defaultSort?: { field: SortableBy<O>; direction: "asc" | "desc" } },
): Collection & O {
  return { type: "collection", name: "", ...options } as Collection & O;
}

export function singleton<O extends SingletonOptions>(options: O): Singleton & O {
  return { type: "singleton", name: "", ...options } as Singleton & O;
}

/** Data from a file of the website, that relations point to and Mica never edits. */
export function referenceSet<O extends ReferenceSetOptions>(options: O): ReferenceSet & O {
  return { type: "reference", name: "", ...options } as ReferenceSet & O;
}

export function defineSite<
  C extends Record<string, Collection>,
  S extends Record<string, Singleton>,
>(options: { root?: string; label?: string; collections: C; singletons?: S; references?: Record<string, ReferenceSet> }): Site<C, S> {
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
  if (options.label !== undefined) site.label = options.label;
  if (options.references && Object.keys(options.references).length > 0) {
    site.references = Object.fromEntries(Object.entries(options.references).map(([name, def]) => [name, { ...def, type: "reference", name }]));
  }

  assertValidSite(site);
  return site;
}

/* ------------------------------------------------------------------ *
 * Model validation
 * ------------------------------------------------------------------ */

const NAME_PATTERN = /^[a-z][a-zA-Z0-9]*$/;

/**
 * Names that would collide with the structure of the protocol manifest, which
 * keys collections and singletons by name alongside its own metadata, or with
 * the shared media folder beside their folders. Rejected here rather than
 * producing a confusing shadowing later.
 */
const RESERVED_NAMES = new Set([
  "collections",
  "singletons",
  "protocolVersion",
  "generatedBy",
  "references",
  MEDIA_DIR,
]);

function assertValidSite(site: Site): void {
  if (site.label !== undefined && labelProblem(site.label)) throw new ModelError(`The site's label ${labelProblem(site.label)}.`);
  const collectionNames = new Set(Object.keys(site.collections));
  const references = site.references ?? {};
  // A relation points to a collection or to a reference set.
  const relationTargets = new Set([...collectionNames, ...Object.keys(references)]);

  for (const [name, def] of Object.entries(references)) {
    if (!NAME_PATTERN.test(name)) throw new ModelError(`Reference set name "${name}" must be lowerCamelCase and start with a letter.`);
    if (RESERVED_NAMES.has(name)) throw new ModelError(`Reference set name "${name}" is reserved.`);
    if (collectionNames.has(name) || Object.hasOwn(site.singletons, name)) {
      throw new ModelError(`"${name}" is a reference set and a collection or singleton. Names must be unique across all three.`);
    }
    if (typeof def.label !== "string" || def.label === "") throw new ModelError(`Reference set "${name}" needs a label.`);
    if (typeof def.file !== "string" || def.file === "") throw new ModelError(`Reference set "${name}" needs a file.`);
  }

  // Each name is a folder: on macOS and Windows, two names that differ only in case are one folder.
  const byLowerCase = new Map<string, string>();
  for (const name of [...Object.keys(site.collections), ...Object.keys(site.singletons)]) {
    const other = byLowerCase.get(name.toLowerCase());
    if (other && other !== name) {
      throw new ModelError(`"${other}" and "${name}" differ only in case. On macOS and Windows they are one folder: rename one.`);
    }
    byLowerCase.set(name.toLowerCase(), name);
  }

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
    checkFields(def.fields, `collections.${name}`, relationTargets);

    const slugKey = resolveSlugField(def);
    if (!slugKey) {
      throw new ModelError(
        `Collection "${name}" has no slug field. Add one with \`slug({ from: "title" })\`, ` +
          `or point \`slugField\` at an existing field.`,
      );
    }
    if (def.slugField && def.fields[def.slugField]?.kind !== "slug") {
      throw new ModelError(
        `Collection "${name}" declares slugField "${def.slugField}", which is not a slug() field.`,
      );
    }

    if (def.titleField && !def.fields[def.titleField]) {
      throw new ModelError(
        `Collection "${name}" declares titleField "${def.titleField}" which is not a field.`,
      );
    }

    const urlProblem = def.url === undefined ? null : pageUrlProblem(def.url, "collection", def.fields);
    if (urlProblem) throw new ModelError(`Collection "${name}" has the url "${def.url}": ${urlProblem}.`);

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
    checkFields(def.fields, `singletons.${name}`, relationTargets);
    const pageProblem = def.url === undefined ? null : pageUrlProblem(def.url, "singleton");
    if (pageProblem) throw new ModelError(`Singleton "${name}" has the url "${def.url}": ${pageProblem}.`);
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
          `Known collections and reference sets: ${[...collectionNames].join(", ") || "(none)"}.`,
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
      const repeat = nestedRepeat(field.pattern);
      if (repeat) {
        throw new ModelError(
          `Text field "${here}" has a pattern that can be very slow: ${repeat} repeats a group that repeats inside. ` +
            "Repeat the group or its contents, not both.",
        );
      }
    }

    if (field.kind === "richText" && field.toolbar !== undefined) {
      const known = RICH_TEXT_TOOLBARS.full as readonly string[];
      const valid = Array.isArray(field.toolbar)
        ? field.toolbar.every((feature) => known.includes(feature))
        : Object.hasOwn(RICH_TEXT_TOOLBARS, field.toolbar);
      if (!valid) {
        throw new ModelError(
          `Rich-text field "${here}" has an unknown toolbar. Use "minimal", "default", "full", or a list of: ${known.join(", ")}.`,
        );
      }
    }

    if (field.kind === "media" && field.accept !== undefined && !isValidAccept(field.accept)) {
      throw new ModelError(
        `Media field "${here}" has an unknown accept. Use "image", "document", "any", or a list of: ${MEDIA_FILE_TYPE_NAMES.join(", ")}.`,
      );
    }

    if (field.kind === "coordinates" && field.map !== undefined) {
      const problem = mapProblem(field.map);
      if (problem) throw new ModelError(`Coordinates field "${here}" has an invalid map: ${problem}.`);
    }

    if (field.kind === "select" && field.options.length === 0) {
      throw new ModelError(`Select field "${here}" must declare at least one option.`);
    }

    if (field.kind === "repeater" && field.itemLabel && !field.fields[field.itemLabel]) {
      throw new ModelError(
        `Repeater "${here}" uses itemLabel "${field.itemLabel}", which is not a child field.`,
      );
    }

    checkRange(field, here);

    if ("default" in field && field.default !== undefined) {
      const result = validateFields({ [key]: field } as FieldMap, { [key]: field.default }, { enforceRequired: false });
      if (!result.ok) {
        throw new ModelError(`The default of "${here}" is not a valid value: ${result.issues[0]!.message}`);
      }
    }

    if (field.kind === "object" || field.kind === "repeater") {
      checkFields(field.fields, here, collectionNames);
    }
  }
}

/** A lower bound above the upper bound leaves no valid value. */
/** A group, or a list of known types without repeats. */
function isValidAccept(accept: unknown): boolean {
  if (accept === "image" || accept === "document" || accept === "any") return true;
  return Array.isArray(accept) && accept.length > 0 && accept.every(isMediaFileType) && new Set(accept).size === accept.length;
}

function checkRange(field: AnyField, here: string): void {
  const pairs: Array<[unknown, unknown, string]> = [];
  if (field.kind === "number" || field.kind === "repeater") pairs.push([field.min, field.max, "min"]);
  if (field.kind === "text" || field.kind === "textarea") pairs.push([field.minLength, field.maxLength, "minLength"]);
  for (const [low, high, name] of pairs) {
    if (typeof low === "number" && typeof high === "number" && low > high) {
      throw new ModelError(`"${here}" has a ${name} above its upper bound: ${low} > ${high}.`);
    }
  }
  if (field.kind === "date" && field.min && field.max && compareDates(field.max, field.min) < 0) {
    throw new ModelError(`"${here}" has a min date after its max date: ${field.min} > ${field.max}.`);
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
  const field = def.fields[sort.field];

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

    // A date with a time has an offset: compare the instants, not the text.
    if (field?.kind === "date") {
      return (Date.parse(String(left)) - Date.parse(String(right))) * sign || byPosition(a, b);
    }

    return TEXT_ORDER.compare(String(left), String(right)) * sign || byPosition(a, b);
  };
}

/** One collation for every machine, so a list never depends on the locale of the build. */
const TEXT_ORDER = new Intl.Collator("en");

/** Field keys shown as columns in the collection overview. */
export function listedFields(def: Collection): string[] {
  return Object.entries(def.fields)
    .filter(([, f]) => f.listed)
    .map(([key]) => key);
}

/** The longest site label: it must fit the top of the editor's menu. */
export const SITE_LABEL_MAX = 60;

/** Why a site label cannot be used, as the end of a sentence; null when it can. */
export function labelProblem(label: unknown): string | null {
  if (typeof label !== "string" || label.trim() === "") return "must be a text that is not empty";
  if (label.length > SITE_LABEL_MAX) return `must have ${SITE_LABEL_MAX} characters at most`;
  return null;
}
