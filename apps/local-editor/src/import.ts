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
  collectionEntryPath,
  entryFiles,
  serializeEntry,
  singletonPath,
  slugify,
  validateFields,
  type AnyField,
  type FieldMap,
} from "@micacms/core";
import { within } from "@micacms/core/node";
import { contentFiles, loadSchema } from "@micacms/runtime";

import { unflatten } from "./devalue.js";

/** Astro's marker for a path that `image()` resolves against the entry's file. */
const IMAGE_MARKER = "__ASTRO_IMAGE_";

export interface ImportOptions {
  /** The Mica content root. */
  root: string;
  /** The Astro project, which the entries' file paths are relative to. */
  project: string;
  /** Astro's data store from before Mica replaced the collections: `node_modules/.astro/data-store.json`. */
  store: string;
  /** `collection.targetField` (dots for nested fields and `.alt`) → source key; `$body` is the Markdown body. */
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

  for (const name of names) {
    const entries = astro.get(name)!;
    const singleton = site.singletons[name];
    const fields = (singleton ?? site.collections[name]!).fields;
    const target = singleton ? singletonPath(fields, name) : name;
    if (existsSync(within(options.root, target))) {
      throw new ImportError(`${target} exists in the content root. Delete it to import "${name}" again.`);
    }
    if (singleton && entries.length !== 1) {
      result.problems.push(`${name}: a singleton takes one entry, and the collection has ${entries.length}. Not imported.`);
      continue;
    }

    const used = new Set<string>();
    const slugs = new Map<string, string>();
    const written: Array<{ slug: string; source: StoredEntry }> = [];

    for (const entry of entries) {
      const slug = slugify(entry.id.replace(/\//g, "-"));
      if (!singleton && slugs.has(slug)) {
        result.problems.push(`${name}: "${entry.id}" and "${slugs.get(slug)}" both become "${slug}". Not imported: "${entry.id}".`);
        continue;
      }
      slugs.set(slug, entry.id);

      const base = singleton ? singletonPath(fields, name) : collectionEntryPath(fields, name, slug);
      const context: Context = { options, map, name, entry, base, slug, used, problems: result.problems, copies: [] };
      const data = convertFields(fields, entry.data, "", context, singleton ? undefined : slug);

      const check = validateFields(fields, data);
      if (!check.ok) {
        for (const issue of check.issues) result.problems.push(`${name}/${slug}: ${issue.path}: ${issue.message}`);
      }
      for (const [file, contents] of Object.entries(entryFiles(fields, base, serializeEntry(fields, data)))) {
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
        const position = (item: { source: StoredEntry }) => Number(item.source.data[orderField] ?? Number.POSITIVE_INFINITY);
        const order = [...written].sort((a, b) => position(a) - position(b)).map((item) => item.slug);
        await writeFile(within(options.root, `${name}/_order.json`), `${JSON.stringify(order, null, 2)}\n`);
        used.add(orderField);
      }
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
  if (mapped === "$body") return context.entry.body;
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
      return value ?? (at === "body" && !(`${context.name}.body` in context.map) ? context.entry.body?.trim() || null : null);
    case "date":
      return toDate(value, where, context);
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
    case "object":
      return isRecord(value) ? convertFields(field.fields, value, at, context) : null;
    case "repeater":
      return Array.isArray(value)
        ? value.map((row, index) => (isRecord(row) ? convertFields(field.fields, row, `${at}.${index}`, { ...context, map: {} }) : {}))
        : [];
    case "select":
      return field.multiple ? (Array.isArray(value) ? value : []) : (value ?? null);
    case "boolean":
      return typeof value === "boolean" ? value : (field.default ?? false);
    case "number":
      return typeof value === "number" ? value : value == null ? null : Number(value);
    default:
      return value instanceof Date ? value.toISOString() : (value ?? null);
  }
}

/** A date as `YYYY-MM-DD`, in UTC: a local-time date would give the day before east of UTC. */
function toDate(value: unknown, where: string, context: Context): string | null {
  if (value == null || value === "") return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.toISOString().slice(0, 10);
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}/.test(value)) return value.slice(0, 10);
  const parsed = new Date(`${String(value)} UTC`);
  if (Number.isNaN(parsed.getTime())) {
    context.problems.push(`${where}: "${String(value)}" is not a date.`);
    return null;
  }
  return parsed.toISOString().slice(0, 10);
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
