/**
 * Image fields reach Astro through its own `image()`, which resolves a path
 * against the entry's file, optimizes the image and gives `ImageMetadata`. A
 * site then needs no helper: `<Image {...entry.data.cover} />`.
 */

import { posix } from "node:path";

import { markdocImages, resolveMarkdocTarget, richTextValues, type FieldMap } from "@micacms/core";

/**
 * Rewrites the paths of `media({ accept: "image" })` fields, which the reader
 * gives from the content root, to paths from the entry's data file.
 */
export function imagePathsFromEntry(
  fields: FieldMap,
  data: Record<string, unknown>,
  dataFile: string,
): Record<string, unknown> {
  const from = posix.dirname(dataFile);
  const relative = (path: unknown): unknown => {
    if (typeof path !== "string" || path === "") return path;
    const result = posix.relative(from, path);
    return result.startsWith(".") ? result : `./${result}`;
  };
  const one = (value: unknown): unknown =>
    isRecord(value) ? { ...value, path: relative(value["path"]) } : relative(value);

  const visit = (map: FieldMap, record: Record<string, unknown>): Record<string, unknown> => {
    const result = { ...record };
    for (const [key, field] of Object.entries(map)) {
      const value = record[key];
      if (field.kind === "media" && field.accept === "image") {
        result[key] = Array.isArray(value) ? value.map(one) : one(value);
      } else if (field.kind === "object" && isRecord(value)) {
        result[key] = visit(field.fields, value);
      } else if (field.kind === "repeater" && Array.isArray(value)) {
        result[key] = value.map((row) => (isRecord(row) ? visit(field.fields, row) : row));
      }
    }
    return result;
  };

  return visit(fields, data);
}

/**
 * The images in an entry's rich text, each as Markdoc writes it (`path`) and as
 * a path from the entry's data file (`src`), which `image()` resolves. An
 * address on the web is left to the website.
 */
export function richTextImages(
  fields: FieldMap,
  data: Record<string, unknown>,
  dataFile: string,
): Array<{ path: string; src: string }> {
  const folder = posix.dirname(dataFile);
  const found = new Map<string, string>();
  for (const text of richTextValues(fields, data)) {
    for (const target of markdocImages(text)) {
      const file = resolveMarkdocTarget(target, folder === "." ? "" : folder);
      if (file === null || found.has(target)) continue;
      const relative = posix.relative(folder, file);
      found.set(target, relative.startsWith(".") ? relative : `./${relative}`);
    }
  }
  return [...found].map(([path, src]) => ({ path, src }));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
