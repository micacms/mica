/**
 * `mica import`: moves the entries of Astro content collections into Mica.
 *
 * It reads `.astro/data-store.json`, where Astro keeps every entry after its
 * own loader and schema ran, so one importer covers `glob()`, `file()`,
 * Markdown, MDX frontmatter, JSON and YAML alike. Each field of the Mica model
 * takes the field with the same name, unless `--map` names another; values are
 * converted to the stored form and written with the editor's own serializer.
 */

import { existsSync, readFileSync } from "node:fs";
import { copyFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  entryFiles,
  entryFolder,
  serializeEntry,
  slugify,
  validateFields,
  type AnyField,
  type FieldMap,
} from "@micacms/core/internal";
import { within } from "@micacms/core/node";
import { contentFiles, loadSchema } from "@micacms/runtime";

import { unflatten } from "./devalue.js";

/** The `--map` value for the Markdown body. Not `$body`: a shell would expand it. */
export const BODY = "@body";

/** Astro's marker for a path that `image()` resolves against the entry's file. */
const IMAGE_MARKER = "__ASTRO_IMAGE_";

export interface ImportOptions {
  /** The Mica content root. */
  root: string;
  /** The Astro project, which the entries' file paths are relative to. */
  project: string;
  /** Astro's data store from before Mica replaced the collections: `node_modules/.astro/data-store.json`. */
  store: string;
  /** `collection.targetField` (dots for fields in an object, and `.alt`) → source key; `@body` is the Markdown body. Not inside repeater rows. */
  map?: Record<string, string>;
  /** Collection → the number field that gives the initial manual order. */
  order?: Record<string, string>;
  /** Only these collections and singletons; all that match by name when empty. */
  only?: string[];
}

export interface ImportResult {
  imported: Array<{ name: string; entries: number }>;
  problems: string[];
}

interface StoredEntry {
  id: string;
  data: Record<string, unknown>;
  body?: string;
  filePath?: string;
}

export class ImportError extends Error {
  override name = "ImportError";
}

export async function importCollections(options: ImportOptions): Promise<ImportResult> {
  try {
    return await importAll(options);
  } catch (error) {
    // Any refusal reads as one, not as a stack trace.
    if (error instanceof ImportError) throw error;
    throw new ImportError((error as Error).message, { cause: error });
  }
}

async function importAll(options: ImportOptions): Promise<ImportResult> {
  const site = await loadSchema(contentFiles({ root: options.root }));
  const astro = readStore(options.store);
  const result: ImportResult = { imported: [], problems: [] };
  const map = options.map ?? {};

  const names = [...Object.keys(site.collections), ...Object.keys(site.singletons)].filter(
    (name) => astro.has(name) && (!options.only?.length || options.only.includes(name)),
  );
  for (const name of options.only ?? []) {
    if (!astro.has(name)) result.problems.push(`${name}: the data store has no collection with this name.`);
  }
  if (names.length === 0) throw new ImportError("No Astro collection has the name of a Mica collection or singleton.");

  // Before the first write, so that a refusal leaves nothing half done.
  for (const name of names) {
    const target = entryFolder(name);
    if (existsSync(within(options.root, target))) {
      throw new ImportError(`${target} exists in the content root. Delete it to import "${name}" again.`);
    }
    if (!site.singletons[name]) {
      const empty = astro.get(name)!.find((entry) => slugify(entry.id.replace(/\//g, "-")) === "");
      if (empty) throw new ImportError(`${name}: the id "${empty.id}" gives no slug. Rename the entry first.`);
    }
  }

  for (const name of names) {
    const entries = astro.get(name)!;
    const singleton = site.singletons[name];
    const fields = (singleton ?? site.collections[name]!).fields;
    if (singleton && entries.length !== 1) {
      result.problems.push(`${name}: a singleton takes one entry, and the collection has ${entries.length}. Not imported.`);
      continue;
    }

    const used = new Set<string>();
    let bodyTaken = false;
    const slugs = new Map<string, string>();
    const written: Array<{ slug: string; source: StoredEntry }> = [];

    for (const entry of entries) {
      const slug = slugify(entry.id.replace(/\//g, "-"));
      if (!singleton && slugs.has(slug)) {
        result.problems.push(`${name}: "${entry.id}" and "${slugs.get(slug)}" both become "${slug}". Not imported: "${entry.id}".`);
        continue;
      }
      slugs.set(slug, entry.id);

      const base = entryFolder(name, singleton ? undefined : slug);
      const context: Context = { options, map, name, entry, base, slug, used, problems: result.problems, copies: [], body: false };
      const data = convertFields(fields, entry.data, "", context, singleton ? undefined : slug);
      bodyTaken ||= context.body;

      const check = validateFields(fields, data);
      if (!check.ok) {
        for (const issue of check.issues) result.problems.push(`${name}/${slug}: ${issue.path}: ${issue.message}`);
      }
      for (const [file, contents] of Object.entries(entryFiles(base, serializeEntry(fields, data)))) {
        await mkdir(path.dirname(within(options.root, file)), { recursive: true });
        await writeFile(within(options.root, file), contents);
      }
      for (const { from, to } of context.copies) {
        await mkdir(path.dirname(within(options.root, to)), { recursive: true });
        await copyFile(from, within(options.root, to));
      }
      written.push({ slug, source: entry });
    }

    const orderField = options.order?.[name];
    if (orderField) {
      const def = site.collections[name];
      if (!def?.sortable) result.problems.push(`${name}: --order needs a collection with \`sortable: true\`.`);
      else {
        const position = (item: { source: StoredEntry }) => {
          const value = Number(item.source.data[orderField]);
          return Number.isFinite(value) ? value : Number.POSITIVE_INFINITY;
        };
        const order = [...written].sort((a, b) => position(a) - position(b)).map((item) => item.slug);
        await writeFile(within(options.root, `${name}/_order.json`), `${JSON.stringify(order, null, 2)}\n`);
        used.add(orderField);
      }
    }

    if (!bodyTaken && entries.some((entry) => entry.body?.trim())) {
      result.problems.push(`${name}: not imported: the Markdown body. The model has no rich-text field \`body\`; map one with --map ${name}.<field>=@body.`);
    }
    const left = new Set(entries.flatMap((entry) => Object.keys(entry.data)).filter((key) => !used.has(key)));
    if (left.size > 0) result.problems.push(`${name}: not imported: ${[...left].join(", ")}. Map them with --map, or leave them out.`);
    result.imported.push({ name, entries: written.length });
  }

  return result;
}

interface Context {
  options: ImportOptions;
  map: Record<string, string>;
  name: string;
  entry: StoredEntry;
  base: string;
  slug: string;
  /** Top-level source keys that some field took. */
  used: Set<string>;
  problems: string[];
  copies: Array<{ from: string; to: string }>;
  /** Whether a field took the Markdown body. */
  body: boolean;
}

function convertFields(
  fields: FieldMap,
  source: Record<string, unknown>,
  prefix: string,
  context: Context,
  slug?: string,
): Record<string, unknown> {
  const data: Record<string, unknown> = {};
  for (const [key, field] of Object.entries(fields)) {
    const at = prefix ? `${prefix}.${key}` : key;
    if (field.kind === "slug" && prefix === "" && slug !== undefined) {
      data[key] = slug;
      continue;
    }
    data[key] = convert(field, read(source, at, key, context), at, context);
  }
  return data;
}

/** The source value for a target field: mapped, else the key of the same name. */
function read(source: Record<string, unknown>, at: string, key: string, context: Context): unknown {
  const mapped = context.map[`${context.name}.${at}`];
  if (mapped === BODY) {
    context.body = true;
    return context.entry.body?.trim() || null;
  }
  if (mapped !== undefined) {
    context.used.add(mapped.split(".")[0]!);
    return mapped.split(".").reduce<unknown>((value, part) => (isRecord(value) ? value[part] : undefined), context.entry.data);
  }
  if (!at.includes(".")) context.used.add(key);
  return source[key];
}

function convert(field: AnyField, value: unknown, at: string, context: Context): unknown {
  const where = `${context.name}/${context.slug}: ${at}`;
  switch (field.kind) {
    case "richText":
      // The body goes to the rich-text field named `body`, unless a map says otherwise.
      if (value == null && at === "body" && !(`${context.name}.body` in context.map) && context.entry.body?.trim()) {
        context.body = true;
        return context.entry.body.trim();
      }
      return value ?? null;
    case "date":
      return toDate(value, where, context, field.includeTime === true);
    case "relation": {
      const one = (item: unknown) => (isRecord(item) ? slugify(String(item["id"] ?? "")) : typeof item === "string" ? slugify(item) : null);
      return field.multiple ? (Array.isArray(value) ? value.map(one).filter(Boolean) : []) : one(value);
    }
    case "media": {
      const one = (item: unknown, index?: number) => {
        const stored = copyMedia(item, `${where}${index === undefined ? "" : `.${index}`}`, context);
        if (stored === null || !field.alt) return stored;
        const alt = context.map[`${context.name}.${at}.alt`];
        if (alt !== undefined) context.used.add(alt.split(".")[0]!);
        const text = alt === undefined ? null : alt.split(".").reduce<unknown>((v, p) => (isRecord(v) ? v[p] : undefined), context.entry.data);
        return { path: stored, alt: typeof text === "string" ? text : null };
      };
      if (field.multiple) return Array.isArray(value) ? value.map((item, index) => one(item, index)).filter((item) => item !== null) : [];
      return one(value);
    }
    case "object": {
      // A map can fill an object from flat keys, for example `blog.seo.title=metaTitle`.
      const mapped = Object.keys(context.map).some((key) => key.startsWith(`${context.name}.${at}.`));
      return isRecord(value) || mapped ? convertFields(field.fields, isRecord(value) ? value : {}, at, context) : null;
    }
    case "repeater":
      return Array.isArray(value)
        ? value.map((row, index) => (isRecord(row) ? convertFields(field.fields, row, `${at}.${index}`, { ...context, map: {} }) : {}))
        : [];
    case "select":
      return field.multiple ? (Array.isArray(value) ? value : []) : (value ?? null);
    case "tags": {
      // Astro sites keep tags as a list, or sometimes as one comma-separated string.
      const list = Array.isArray(value) ? value : typeof value === "string" ? value.split(",") : [];
      // Validation refuses a tag twice in any case: keep the first spelling.
      const seen = new Set<string>();
      return list
        .map((tag) => String(tag).trim())
        .filter((tag) => tag !== "" && !seen.has(tag.toLowerCase()) && seen.add(tag.toLowerCase()));
    }
    case "boolean":
      return typeof value === "boolean" ? value : (field.default ?? false);
    case "number":
      return typeof value === "number" ? value : value == null ? null : Number(value);
    default:
      return value instanceof Date ? value.toISOString() : (value ?? null);
  }
}

/**
 * A date as `YYYY-MM-DD` in UTC (a local-time date would give the day before
 * east of UTC), or a full ISO timestamp for `date({ includeTime: true })`.
 */
function toDate(value: unknown, where: string, context: Context, withTime: boolean): string | null {
  if (value == null || value === "") return null;
  const parsed =
    value instanceof Date
      ? value
      : typeof value === "string" && /^\d{4}-\d{2}-\d{2}/.test(value)
        ? new Date(value.length === 10 ? `${value}T00:00:00Z` : value)
        : new Date(`${String(value)} UTC`);
  if (Number.isNaN(parsed.getTime())) {
    context.problems.push(`${where}: "${String(value)}" is not a date.`);
    return null;
  }
  return withTime ? parsed.toISOString() : parsed.toISOString().slice(0, 10);
}

/** Copies a media file into the entry's `media/` folder, and gives the stored path. */
function copyMedia(value: unknown, where: string, context: Context): string | null {
  if (typeof value !== "string" || value === "") return null;
  const raw = value.startsWith(IMAGE_MARKER) ? value.slice(IMAGE_MARKER.length) : value;
  if (/^[a-z]+:\/\//i.test(raw)) {
    context.problems.push(`${where}: "${raw}" is a URL. Download the file and add it in the editor.`);
    return null;
  }
  const from = raw.startsWith("/")
    ? path.join(context.options.project, raw)
    : path.resolve(context.options.project, path.dirname(context.entry.filePath ?? "."), raw);
  if (!existsSync(from)) {
    context.problems.push(`${where}: the file "${raw}" does not exist.`);
    return null;
  }
  const taken = new Set(context.copies.map((copy) => path.posix.basename(copy.to)));
  let name = path.basename(from);
  for (let n = 2; taken.has(name); n++) name = `${path.parse(from).name}-${n}${path.extname(from)}`;
  context.copies.push({ from, to: `${context.base}/media/${name}` });
  return `media/${name}`;
}

/** Collection name → its entries, from Astro's data store. */
function readStore(file: string): Map<string, StoredEntry[]> {
  if (!existsSync(file)) {
    throw new ImportError(`There is no data store at ${file}. Run \`npx astro sync\` before Mica replaces the collections, and keep a copy.`);
  }
  const root = unflatten(JSON.parse(readFileSync(file, "utf8")) as unknown[]);
  if (!(root instanceof Map)) throw new ImportError(`${file} is not an Astro data store.`);
  const collections = new Map<string, StoredEntry[]>();
  for (const [name, entries] of root) {
    if (typeof name !== "string" || name.includes("::") || !(entries instanceof Map)) continue;
    collections.set(name, [...entries.values()] as StoredEntry[]);
  }
  return collections;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value) && !(value instanceof Date);
}

/** The result as a person or an agent reads it. */
export function formatImport(result: ImportResult): string {
  const lines = result.imported.map(({ name, entries }) => `  imported ${name}: ${entries} ${entries === 1 ? "entry" : "entries"}`);
  for (const problem of result.problems) lines.push(`  check    ${problem}`);
  lines.push("", "Next: run `npx mica check`, and compare the website with the version before.");
  return `${lines.join("\n")}\n`;
}
