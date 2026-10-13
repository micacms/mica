/**
 * `mica check` — reads every entry the way Mica and the website read it, and
 * reports what they would skip, refuse or render as a gap. It never opens a
 * browser and exits with 1 when it finds an error, for CI and coding agents.
 */

import { existsSync } from "node:fs";
import { relative } from "node:path";

import {
  type AnyField,
  type ContentSource,
  DOCUMENT_EXTENSION,
  documentPath,
  entryLayout,
  type FieldMap,
  INDEX_FILE,
  isValidSlug,
  isWebAddress,
  MANIFEST_PATH,
  markdocImages,
  misplacedFiles,
  ORDER_FILE,
  type PathSegment,
  readCollectionEntry,
  readSingleton,
  resolveMarkdocTarget,
  resolveSlugField,
  singletonPath,
  type Site,
  validateFields,
} from "@micacms/core";
import { within } from "@micacms/core/node";
import { contentFiles, loadSchema, readOnlyParts } from "@micacms/runtime";

export interface CheckProblem {
  level: "error" | "warning";
  /** The file, relative to the content root. */
  path: string;
  message: string;
}

export interface CheckReport {
  problems: CheckProblem[];
  /** False when the model could not be read, so nothing else was checked. */
  model: boolean;
  collections: number;
  entries: number;
  singletons: number;
}

/** Checks the content under `root` against the model in `<root>/.mica/schema.json`. */
export async function checkContent(root: string): Promise<CheckReport> {
  const files = contentFiles({ root });
  const report: CheckReport = { problems: [], model: false, collections: 0, entries: 0, singletons: 0 };
  const error = (path: string, message: string) => report.problems.push({ level: "error", path, message });
  const warning = (path: string, message: string) => report.problems.push({ level: "warning", path, message });

  const manifest = await readText(files, MANIFEST_PATH);
  if (manifest === null || manifest instanceof Error) {
    error(MANIFEST_PATH, manifest?.message ?? "There is no content model. Run `npx astro sync` in the Astro project to write it.");
    return report;
  }
  let site: Site;
  try {
    site = await loadSchema(files);
  } catch (cause) {
    error(MANIFEST_PATH, (cause as Error).message);
    return report;
  }
  report.model = true;

  // A model from a newer @micacms/astro: this check cannot judge those entries.
  const readOnly = readOnlyParts(site);
  for (const reason of readOnly.values()) error(MANIFEST_PATH, `Not checked. ${reason}`);

  const slugs = new Map<string, Set<string>>();
  for (const [name, def] of Object.entries(site.collections)) {
    slugs.set(name, new Set(await entrySlugs(files, def.fields, name, error, warning)));
  }

  const context: EntryContext = { root, files, site, slugs, error, warning };

  for (const [name, def] of Object.entries(site.collections)) {
    report.collections++;
    if (readOnly.has(`collections.${name}`)) continue;
    const slugField = resolveSlugField(def);
    for (const slug of slugs.get(name)!) {
      report.entries++;
      const directory = entryLayout(def.fields) === "directory";
      const base = directory ? `${name}/${slug}` : null;
      const dataPath = directory ? `${base}/${INDEX_FILE}` : `${name}/${slug}.json`;

      const data = await readOrReport(() => readCollectionEntry(files, def, name, slug), dataPath, error);
      if (!data) continue;
      // The reader puts the name into the slug field, so the file itself shows a mismatch.
      const stored = slugField ? rawField(await files.read(dataPath), slugField) : undefined;
      if (typeof stored === "string" && stored !== "" && stored !== slug) {
        warning(dataPath, `${slugField} is "${stored}", but the entry is named "${slug}". Mica uses the name; the next save writes it into the file.`);
      }
      await checkEntry(context, def.fields, data, dataPath, base);
    }
  }

  for (const [name, def] of Object.entries(site.singletons)) {
    report.singletons++;
    if (readOnly.has(`singletons.${name}`)) continue;
    const directory = entryLayout(def.fields) === "directory";
    const base = singletonPath(def.fields, name);
    const dataPath = directory ? `${base}/${INDEX_FILE}` : base;
    const [otherLayout] = await misplacedFiles(files, def.fields, name, "singleton");
    if (otherLayout) {
      error(otherLayout, `Not read: "${def.label}" is stored as ${dataPath}, because ${directory ? "it has" : "it has no"} rich text or media. Run \`npx mica migrate-layout\`.`);
      // Without a file in the model's layout, the reader stops at the other one: reported above.
      if ((await readText(files, dataPath)) === null) continue;
    }

    const data = await readOrReport(() => readSingleton(files, def, name), dataPath, error);
    if (data === undefined) continue;
    if (data === null) {
      warning(dataPath, `No content for "${def.label}" yet.`);
      continue;
    }
    await checkEntry(context, def.fields, data, dataPath, directory ? base : null);
  }

  return report;
}

interface EntryContext {
  root: string;
  files: ContentSource;
  site: Site;
  slugs: Map<string, Set<string>>;
  error(path: string, message: string): void;
  warning(path: string, message: string): void;
}

/** The slugs Mica reads in a collection, reporting what it would skip. */
async function entrySlugs(
  files: ContentSource,
  fields: FieldMap,
  name: string,
  error: (path: string, message: string) => void,
  warning: (path: string, message: string) => void,
): Promise<string[]> {
  const directory = entryLayout(fields) === "directory";
  const shape = directory ? `a folder with ${INDEX_FILE}` : "a <slug>.json file";
  const found: string[] = [];
  // The reader's own rule, so that `check` and `migrate-layout` agree.
  const misplaced = new Set(await misplacedFiles(files, fields, name, "collection"));

  for (const item of await files.list(name)) {
    const path = `${name}/${item.name}`;
    if (item.name.startsWith(".")) continue;
    if (item.name === ORDER_FILE) {
      checkOrder(await readText(files, path), path, error);
      continue;
    }

    // An entry in the other layout is lost content, not a stray file: the model gained or lost rich text or media.
    if (directory && misplaced.has(path)) {
      error(path, `Not read: entries of "${name}" are folders with ${INDEX_FILE}, because it has rich text or media. Run \`npx mica migrate-layout\`.`);
      continue;
    }
    if (!directory && misplaced.has(`${path}/${INDEX_FILE}`)) {
      error(path, `Not read: entries of "${name}" are <slug>.json files, because it has no rich text or media. Run \`npx mica migrate-layout\`.`);
      continue;
    }

    const slug = directory ? item.name : item.name.replace(/\.json$/, "");
    const looksLikeEntry = directory ? item.type === "directory" : item.type === "file" && item.name.endsWith(".json");
    if (!looksLikeEntry) {
      warning(path, `Not read. Each entry of "${name}" is ${shape}.`);
      continue;
    }
    if (!isValidSlug(slug)) {
      error(path, `Not read: "${slug}" is not a slug. Use lowercase letters, digits and single hyphens.`);
      continue;
    }
    const index = directory ? await readText(files, `${path}/${INDEX_FILE}`) : "";
    if (index === null || index instanceof Error) {
      error(path, `Not read: ${index?.message ?? `the folder has no ${INDEX_FILE}.`}`);
      continue;
    }
    found.push(slug);
  }
  return found;
}

/** The file's text, null when it is not there, or the error that reading it gave. */
async function readText(files: ContentSource, path: string): Promise<string | null | Error> {
  try {
    return await files.read(path);
  } catch (cause) {
    return cause as Error;
  }
}

function checkOrder(text: string | null | Error, path: string, error: (path: string, message: string) => void): void {
  if (text === null) return;
  if (text instanceof Error) return error(path, text.message);
  let order: unknown;
  try {
    order = JSON.parse(text);
  } catch {
    return error(path, "Not valid JSON. The build fails on it.");
  }
  if (!Array.isArray(order)) {
    error(path, 'Must be a JSON array of slugs, such as ["second", "first"]. The build fails on it.');
  }
}

async function readOrReport<T>(
  read: () => Promise<T>,
  path: string,
  error: (path: string, message: string) => void,
): Promise<T | undefined> {
  try {
    return await read();
  } catch (cause) {
    error(path, (cause as Error).message.replace(`${path}: `, ""));
    return undefined;
  }
}

async function checkEntry(
  context: EntryContext,
  fields: FieldMap,
  data: Record<string, unknown>,
  dataPath: string,
  base: string | null,
): Promise<void> {
  const { root, files, slugs, error, warning } = context;

  const result = validateFields(fields, data);
  if (!result.ok) {
    for (const issue of result.issues) error(dataPath, issue.path ? `${issue.path}: ${issue.message}` : issue.message);
  }

  const raw = JSON.parse((await files.read(dataPath))!) as Record<string, unknown>;
  for (const message of unknownKeys(fields, raw, [])) warning(dataPath, message);

  visit(fields, data, [], (field, value, path) => {
    const key = path.join(".");
    if (field.kind === "media") {
      for (const file of list(mediaPaths(value))) {
        let exists = false;
        try {
          exists = existsSync(within(root, file));
        } catch {
          // A path outside the content root does not exist for Mica.
        }
        if (!exists) error(dataPath, `${key}: the file "${file}" does not exist under the content root.`);
      }
    }
    if (field.kind === "relation") {
      for (const slug of list(value)) {
        if (!slugs.get(field.collection)?.has(slug)) {
          error(dataPath, `${key}: there is no "${slug}" in "${field.collection}".`);
        }
      }
    }
  });

  if (base === null) return;
  for (const item of await files.list(base)) {
    if (item.type !== "file" || !item.name.endsWith(DOCUMENT_EXTENSION)) continue;
    const path = `${base}/${item.name}`;
    if (!namesRichText(fields, documentPath(item.name))) {
      warning(path, "Not read: no rich-text field has this name.");
      continue;
    }
    const text = (await files.read(path)) ?? "";
    for (const message of markdocWarnings(text)) warning(path, message);
    for (const target of markdocImages(text)) {
      // An address on the web is the website's business, not a file in the content.
      if (isWebAddress(target)) continue;
      const file = resolveMarkdocTarget(target, base);
      if (file === null) {
        error(path, `The image "${target}" is outside the content root.`);
        continue;
      }
      let exists = false;
      try {
        exists = existsSync(within(root, file));
      } catch {
        // A path outside the content root does not exist for Mica.
      }
      if (exists) continue;
      // A `/path` can be a file of the website, such as one in Astro's `public/` folder.
      if (target.startsWith("/")) warning(path, `The image "${target}" is not under the content root. It works on the website only if it is in public/, and the editor cannot show it.`);
      else error(path, `The image "${target}" does not exist under the content root.`);
    }
  }
}

/**
 * What Markdoc renders differently from Markdown, found in the text outside
 * code. A scan, not a parse: it can warn about too much, never about too little.
 */
export function markdocWarnings(source: string): string[] {
  const prose = source.replace(/^(`{3,}|~{3,})[^\n]*\n[\s\S]*?^\1[ \t]*$/gm, "").replace(/`[^`\n]*`/g, "");
  const messages: string[] = [];
  const html = [...new Set([...prose.matchAll(/<\/?([a-zA-Z][a-zA-Z0-9-]*)(?=[\s/>])[^>\n]*>/g)].map((match) => match[1]!.toLowerCase()))];
  if (html.length > 0) {
    messages.push(`Raw HTML (${html.map((tag) => `<${tag}>`).join(", ")}) is not rendered: Markdoc escapes it.`);
  }
  const tags = [...new Set([...prose.matchAll(/\{%\s*([a-zA-Z][\w-]*)/g)].map((match) => match[1]!))];
  if (tags.length > 0) {
    messages.push(
      `Markdoc tags (${tags.join(", ")}) render only if the website declares them in renderRichText(source, { config }).`,
    );
  }
  if (/\[\^[^\]]+\]/.test(prose)) messages.push("Footnotes ([^1]) are not Markdoc: they render as plain text.");
  return messages;
}

/** The paths of a media value: a path, `{ path, alt }`, or a list of either. */
function mediaPaths(value: unknown): unknown[] {
  const values = Array.isArray(value) ? value : [value];
  return values.map((item) => (item !== null && typeof item === "object" ? (item as { path?: unknown }).path : item));
}

function list(value: unknown): string[] {
  const values = Array.isArray(value) ? value : [value];
  return values.filter((item): item is string => typeof item === "string" && item !== "");
}

/** Calls `onField` for every field with a value, nested fields included. */
function visit(
  fields: FieldMap,
  data: Record<string, unknown>,
  path: PathSegment[],
  onField: (field: AnyField, value: unknown, path: PathSegment[]) => void,
): void {
  for (const [key, field] of Object.entries(fields)) {
    const value = data[key];
    if (value === undefined || value === null) continue;
    onField(field, value, [...path, key]);
    if (field.kind === "object" && isRecord(value)) visit(field.fields, value, [...path, key], onField);
    if (field.kind === "repeater" && Array.isArray(value)) {
      value.forEach((row, index) => {
        if (isRecord(row)) visit(field.fields, row, [...path, key, index], onField);
      });
    }
  }
}

/** Keys in the stored JSON that the model does not have; Mica drops them on the next save. */
function unknownKeys(fields: FieldMap, raw: Record<string, unknown>, path: PathSegment[]): string[] {
  const messages: string[] = [];
  for (const [key, value] of Object.entries(raw)) {
    const at = [...path, key].join(".");
    const field = fields[key];
    if (!field) {
      messages.push(`${at}: the model has no such field. Mica drops it on the next save.`);
    } else if (field.kind === "richText") {
      messages.push(`${at}: rich text belongs in ${[...path, key].join(".")}${DOCUMENT_EXTENSION}, not in the JSON.`);
    } else if (field.kind === "object" && isRecord(value)) {
      messages.push(...unknownKeys(field.fields, value, [...path, key]));
    } else if (field.kind === "repeater" && Array.isArray(value)) {
      value.forEach((row, index) => {
        if (isRecord(row)) messages.push(...unknownKeys(field.fields, row, [...path, key, index]));
      });
    }
  }
  return messages;
}

/** Whether a sidecar's dotted path leads to a rich-text field. */
function namesRichText(fields: FieldMap, path: PathSegment[]): boolean {
  let map: FieldMap | undefined = fields;
  for (const [index, segment] of path.entries()) {
    if (typeof segment === "number") continue;
    const field: AnyField | undefined = map?.[segment];
    if (!field) return false;
    if (index === path.length - 1) return field.kind === "richText";
    map = field.kind === "object" || field.kind === "repeater" ? field.fields : undefined;
  }
  return false;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** The report as a person or an agent reads it. */
export function formatReport(report: CheckReport, root: string): string {
  const errors = report.problems.filter((problem) => problem.level === "error").length;
  const warnings = report.problems.length - errors;
  const lines = [
    report.model
      ? `Checked ${report.entries} ${report.entries === 1 ? "entry" : "entries"} in ${report.collections} ` +
        `${report.collections === 1 ? "collection" : "collections"} and ${report.singletons} ` +
        `${report.singletons === 1 ? "singleton" : "singletons"} in ${relative(process.cwd(), root) || "."}.`
      : `Could not read the content model in ${relative(process.cwd(), root) || "."}, so no entry was checked.`,
    "",
  ];
  for (const problem of report.problems) {
    lines.push(`  ${problem.level === "error" ? "error  " : "warning"}  ${problem.path}`);
    for (const line of problem.message.split("\n")) lines.push(`           ${line.trim()}`);
  }
  if (report.problems.length > 0) lines.push("");
  lines.push(`${errors} ${errors === 1 ? "error" : "errors"}, ${warnings} ${warnings === 1 ? "warning" : "warnings"}.`);
  return `${lines.join("\n")}\n`;
}

/** One top-level value of a JSON file as written, or undefined when it cannot be read. */
function rawField(text: string | null, key: string): unknown {
  try {
    const parsed: unknown = text === null ? null : JSON.parse(text);
    return parsed !== null && typeof parsed === "object" ? (parsed as Record<string, unknown>)[key] : undefined;
  } catch {
    return undefined;
  }
}
