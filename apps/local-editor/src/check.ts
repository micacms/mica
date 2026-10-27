/**
 * `mica check` — reads every entry the way Mica and the website read it, and
 * reports what they would skip, refuse or render as a gap. It never opens a
 * browser and exits with 1 when it finds an error, for CI and coding agents.
 */

import { existsSync } from "node:fs";
import { relative } from "node:path";

import {
  type ContentSource,
  declaresDocument,
  DOCUMENT_EXTENSION,
  documentLinks,
  documentPath,
  duplicateLocalizedIds,
  entryDataPath,
  entryFolder,
  type FieldMap,
  INDEX_FILE,
  isRecord,
  isValidId,
  MANIFEST_PATH,
  missingTranslations,
  needsRowKey,
  ORDER_FILE,
  readManifest,
  readReferenceIndex,
  referenceIndexPath,
  readsDocument,
  type PathSegment,
  readCollectionEntry,
  ROW_KEY,
  readSingleton,
  resolveIdField,
  richTextLinks,
  type Site,
  siteLocales,
  validateFields,
} from "@micacms/core/internal";
import { within } from "@micacms/core/node";
import { contentFiles } from "@micacms/runtime";

interface CheckProblem {
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
  /** For each locale but the default: the entries and singletons with missing translations, such as `news/opening-hours`. Not a problem. */
  missing: Record<string, string[]>;
}

/** Checks the content under `root` against the model in `<root>/.mica/schema.json`. */
export async function checkContent(root: string): Promise<CheckReport> {
  const files = contentFiles({ root });
  const report: CheckReport = { problems: [], model: false, collections: 0, entries: 0, singletons: 0, missing: {} };
  const error = (path: string, message: string) => report.problems.push({ level: "error", path, message });
  const warning = (path: string, message: string) => report.problems.push({ level: "warning", path, message });

  const manifest = await readText(files, MANIFEST_PATH);
  if (manifest === null || manifest instanceof Error) {
    error(MANIFEST_PATH, manifest?.message ?? "There is no content model. Run `npx astro sync` in the Astro project to write it.");
    return report;
  }
  let site: Site;
  let readOnly: Map<string, string>;
  try {
    const read = readManifest(JSON.parse(manifest), MANIFEST_PATH);
    ({ site, readOnly } = read);
    for (const message of read.warnings) warning(MANIFEST_PATH, message);
  } catch (cause) {
    error(MANIFEST_PATH, cause instanceof SyntaxError ? `Not valid JSON: ${cause.message}` : (cause as Error).message);
    return report;
  }
  report.model = true;

  // A model from a newer @micacms/astro: this check cannot judge those entries.
  for (const reason of readOnly.values()) error(MANIFEST_PATH, `Not checked. ${reason}`);

  const ids = new Map<string, Set<string>>();
  for (const name of Object.keys(site.collections)) {
    ids.set(name, new Set(await entryIds(files, name, error, warning)));
  }

  // A reference set's ids come from its index; without one, its relations are not checked, and the index is named once.
  for (const def of Object.values(site.references ?? {})) {
    try {
      const items = await readReferenceIndex(files, def.name);
      if (items) ids.set(def.name, new Set(items.map((item) => item.id)));
      else error(referenceIndexPath(def.name), `${def.label} has no index. Build the website, and commit the file.`);
    } catch (cause) {
      error(referenceIndexPath(def.name), `Not a reference index: ${(cause as Error).message}`);
    }
  }

  const locales = siteLocales(site);
  const others = locales ? locales.locales.filter((locale) => locale !== locales.defaultLocale) : [];
  const translations = (fields: FieldMap, data: Record<string, unknown>, name: string) => {
    for (const locale of others) if (missingTranslations(site, fields, data, locale) > 0) (report.missing[locale] ??= []).push(name);
  };
  const context: EntryContext = { root, files, site, ids, error, warning };

  for (const [name, def] of Object.entries(site.collections)) {
    report.collections++;
    if (readOnly.has(`collections.${name}`)) continue;
    const idField = resolveIdField(def);
    // For the localized IDs, which must differ between the entries.
    const entries: Array<readonly [string, Record<string, unknown>]> = [];
    for (const id of ids.get(name)!) {
      report.entries++;
      const dataPath = entryDataPath(name, id);

      const data = await readOrReport(() => readCollectionEntry(files, def, name, id), dataPath, error);
      if (!data) continue;
      // The reader puts the name into the ID field, so the file itself shows a mismatch.
      const stored = idField ? rawField(await files.read(dataPath), idField) : undefined;
      if (typeof stored === "string" && stored !== "" && stored !== id) {
        warning(dataPath, `${idField} is "${stored}", but the entry is named "${id}". Mica uses the name; the next save writes it into the file.`);
      }
      await checkEntry(context, def.fields, data, entryFolder(name, id));
      translations(def.fields, data, `${name}/${id}`);
      entries.push([id, data]);
    }
    for (const [id, data] of entries) {
      for (const issue of duplicateLocalizedIds(site, def.fields, id, data, entries)) error(entryDataPath(name, id), `${issue.path}: ${issue.message}`);
    }
  }

  for (const [name, def] of Object.entries(site.singletons)) {
    report.singletons++;
    if (readOnly.has(`singletons.${name}`)) continue;
    const dataPath = entryDataPath(name);
    const data = await readOrReport(() => readSingleton(files, def, name), dataPath, error);
    if (data === undefined) continue;
    if (data === null) {
      warning(dataPath, `No content for "${def.label}" yet.`);
      continue;
    }
    await checkEntry(context, def.fields, data, entryFolder(name));
    translations(def.fields, data, name);
  }

  return report;
}

interface EntryContext {
  root: string;
  files: ContentSource;
  site: Site;
  ids: Map<string, Set<string>>;
  error(path: string, message: string): void;
  warning(path: string, message: string): void;
}

/** The IDs Mica reads in a collection, reporting what it would skip. */
async function entryIds(
  files: ContentSource,
  name: string,
  error: (path: string, message: string) => void,
  warning: (path: string, message: string) => void,
): Promise<string[]> {
  const found: string[] = [];
  for (const item of await files.list(name)) {
    const path = `${name}/${item.name}`;
    if (item.name.startsWith(".")) continue;
    if (item.name === ORDER_FILE) {
      checkOrder(await readText(files, path), path, error);
      continue;
    }
    if (item.type !== "directory") {
      warning(path, `Not read. Each entry of "${name}" is a folder with ${INDEX_FILE}.`);
      continue;
    }
    if (!isValidId(item.name)) {
      error(path, `Not read: "${item.name}" is not an ID. Use lowercase letters, digits and single hyphens.`);
      continue;
    }
    const index = await readText(files, `${path}/${INDEX_FILE}`);
    if (index === null || index instanceof Error) {
      error(path, `Not read: ${index?.message ?? `the folder has no ${INDEX_FILE}.`}`);
      continue;
    }
    found.push(item.name);
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
    error(path, 'Must be a JSON array of IDs, such as ["second", "first"]. The build fails on it.');
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
  folder: string,
): Promise<void> {
  const { root, files, ids, error, warning } = context;
  const dataPath = `${folder}/${INDEX_FILE}`;

  const result = validateFields(fields, data);
  if (!result.ok) {
    for (const issue of result.issues) error(dataPath, issue.path ? `${issue.path}: ${issue.message}` : issue.message);
  }

  const raw = JSON.parse((await files.read(dataPath))!) as Record<string, unknown>;
  for (const message of unknownKeys(fields, raw, [])) warning(dataPath, message);

  // The images in rich text are checked below, from each file that the website reads.
  for (const link of documentLinks(fields, data, folder)) {
    if (link.kind === "media" && !existsUnder(root, link.path)) {
      error(dataPath, `${link.field}: the file "${link.path}" does not exist under the content root.`);
    }
    if (link.kind === "relation" && ids.get(link.collection)?.has(link.id) === false) {
      error(dataPath, `${link.field}: there is no "${link.id}" in "${link.collection}".`);
    }
  }

  for (const item of await files.list(folder)) {
    if (item.type !== "file" || !item.name.endsWith(DOCUMENT_EXTENSION)) continue;
    const path = `${folder}/${item.name}`;
    if (!declaresDocument(fields, documentPath(item.name))) {
      warning(path, "Not read: no rich-text field has this name. Mica keeps the file.");
      continue;
    }
    // A row of the file's name must exist: a key that a hand edit or a merge lost hides the text.
    if (!readsDocument(fields, raw, item.name)) {
      warning(path, "Not read: the list has no such row. The next save in Mica deletes the file.");
      continue;
    }
    const text = (await files.read(path)) ?? "";
    for (const message of markdocWarnings(text)) warning(path, message);
    for (const link of richTextLinks(text, folder, "")) {
      if (link.kind !== "image" || (link.path !== null && existsUnder(root, link.path))) continue;
      if (link.path === null) error(path, `The image "${link.target}" is outside the content root.`);
      // A `/path` can be a file of the website, such as one in Astro's `public/` folder.
      else if (link.target.startsWith("/")) warning(path, `The image "${link.target}" is not under the content root. It works on the website only if it is in public/, and the editor cannot show it.`);
      else error(path, `The image "${link.target}" does not exist under the content root.`);
    }
  }
}

/** Whether a file exists under the content root. A path outside it does not exist for Mica. */
function existsUnder(root: string, path: string): boolean {
  try {
    return existsSync(within(root, path));
  } catch {
    return false;
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
      `Markdoc tags (${tags.join(", ")}) render only if the website declares them in renderRichText(source, entry.data, { config }).`,
    );
  }
  if (/\[\^[^\]]+\]/.test(prose)) messages.push("Footnotes ([^1]) are not Markdoc: they render as plain text.");
  return messages;
}

/**
 * Keys in the stored JSON that the model does not have. A save keeps them (#217),
 * except in a list row without a key, which has no identity across a reorder.
 */
function unknownKeys(fields: FieldMap, raw: Record<string, unknown>, path: PathSegment[], kept = true): string[] {
  const messages: string[] = [];
  for (const [key, value] of Object.entries(raw)) {
    const at = [...path, key].join(".");
    const field = fields[key];
    if (!field) {
      messages.push(
        kept
          ? `${at}: the model has no such field. Mica keeps it in the file, and the website does not get it.`
          : `${at}: the model has no such field. Mica drops it on the next save.`,
      );
    } else if (field.kind === "richText") {
      messages.push(`${at}: rich text belongs in ${[...path, key].join(".")}${DOCUMENT_EXTENSION}, not in the JSON.`);
    } else if (field.kind === "object" && isRecord(value)) {
      messages.push(...unknownKeys(field.fields, value, [...path, key], kept));
    } else if (field.kind === "repeater" && Array.isArray(value)) {
      // A row with rich text has a key that names its files (#220).
      const keyed = needsRowKey(field.fields);
      value.forEach((row, index) => {
        if (!isRecord(row)) return;
        const own = keyed ? Object.fromEntries(Object.entries(row).filter(([name]) => name !== ROW_KEY)) : row;
        messages.push(...unknownKeys(field.fields, own, [...path, key, index], kept && keyed));
      });
    }
  }
  return messages;
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
  const missing = Object.entries(report.missing);
  if (missing.length > 0) {
    lines.push("Missing translations (information only):");
    for (const [locale, names] of missing) lines.push(`  ${locale.padEnd(7)}  ${shortList(names)} (${names.length})`);
    lines.push("");
  }
  lines.push(`${errors} ${errors === 1 ? "error" : "errors"}, ${warnings} ${warnings === 1 ? "warning" : "warnings"}.`);
  return `${lines.join("\n")}\n`;
}

/** The first names of a long list, and how many more. */
function shortList(names: string[], shown = 5): string {
  return names.length <= shown ? names.join(", ") : `${names.slice(0, shown).join(", ")} and ${names.length - shown} more`;
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
