/**
 * The index of each reference set: the loader reads the website's file and
 * writes the id and title of each item to `.mica/references/<name>.json`, which
 * the repository carries to Mica beside the model. In CI it only checks it.
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, extname, join, resolve } from "node:path";

import { referenceIndexPath, serializeReferenceIndex, type ReferenceItem, type ReferenceSet } from "@micacms/core/internal";

/** The rows of a CSV text with a header row: comma or semicolon, quotes as in RFC 4180. */
export function parseCsv(text: string): Array<Record<string, string>> {
  const firstLine = text.slice(0, text.search(/\r?\n|$/));
  const delimiter = firstLine.includes(";") && !firstLine.includes(",") ? ";" : ",";
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let index = 0; index < text.length; index++) {
    const char = text[index]!;
    if (quoted) {
      if (char === '"' && text[index + 1] === '"') (cell += '"'), index++;
      else if (char === '"') quoted = false;
      else cell += char;
    } else if (char === '"' && cell === "") quoted = true;
    else if (char === delimiter) row.push(cell), (cell = "");
    else if (char === "\n" || char === "\r") {
      if (char === "\r" && text[index + 1] === "\n") index++;
      row.push(cell), rows.push(row), (row = []), (cell = "");
    } else cell += char;
  }
  if (cell !== "" || row.length > 0) row.push(cell), rows.push(row);
  const [header, ...body] = rows.filter((line) => line.some((value) => value !== ""));
  if (!header) return [];
  const keys = header.map((key) => key.replace(/^﻿/, "").trim());
  return body.map((line) => Object.fromEntries(keys.map((key, column) => [key, line[column] ?? ""])));
}

/** The items of a JSON file: a list of objects, or an object whose keys are the ids. */
function jsonRows(text: string, idKey: string): Array<Record<string, unknown>> {
  const raw: unknown = JSON.parse(text);
  if (Array.isArray(raw)) return raw as Array<Record<string, unknown>>;
  if (raw !== null && typeof raw === "object") {
    return Object.entries(raw).map(([id, value]) => ({ [idKey]: id, ...(value as Record<string, unknown>) }));
  }
  throw new Error("must be a list of objects, or an object by id");
}

/** The id and title of each item of a reference set's file. */
export async function readReferenceItems(set: ReferenceSet, projectRoot: string): Promise<ReferenceItem[]> {
  const file = resolve(projectRoot, set.file);
  const text = await readFile(file, "utf8");
  const idKey = set.id ?? "id";
  const titleKey = set.title ?? "title";
  const rows = extname(file).toLowerCase() === ".csv" ? parseCsv(text) : jsonRows(text, idKey);
  const seen = new Set<string>();
  const items: ReferenceItem[] = [];
  for (const [index, row] of rows.entries()) {
    const id = row[idKey];
    if (typeof id !== "string" && typeof id !== "number") throw new Error(`${set.file}: item ${index + 1} has no "${idKey}".`);
    const key = String(id);
    if (seen.has(key)) throw new Error(`${set.file}: the id "${key}" is there twice.`);
    seen.add(key);
    const title = row[titleKey];
    items.push({ id: key, title: typeof title === "string" && title !== "" ? title : typeof title === "number" ? String(title) : key });
  }
  return items;
}

/**
 * Writes the index of each reference set when it differs. In CI, fails when the
 * committed index is not the one of the file, as for the model.
 */
export async function publishReferences(
  references: Record<string, ReferenceSet>,
  contentRoot: string,
  projectRoot: string,
  ci: boolean,
  logger: { info(message: string): void },
): Promise<void> {
  for (const set of Object.values(references)) {
    const target = join(contentRoot, referenceIndexPath(set.name));
    const contents = serializeReferenceIndex(await readReferenceItems(set, projectRoot));
    const committed = await readFile(target, "utf8").catch(() => null);
    if (committed === contents) continue;
    if (ci) throw new Error(`The index of "${set.label}" in ${referenceIndexPath(set.name)} is not the one of ${set.file}. Run astro dev or astro build, and commit the file.`);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, contents, "utf8");
    logger.info(`Wrote the index of "${set.label}" to ${referenceIndexPath(set.name)} — commit it for Mica to read.`);
  }
}
