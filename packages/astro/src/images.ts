/**
 * Image fields reach Astro through its own `image()`, which resolves a path
 * against the entry's file, optimizes the image and gives `ImageMetadata`. A
 * site then needs no helper: `<Image {...entry.data.cover} />`.
 */

import { posix } from "node:path";

import { contentPath, type FieldMap } from "@micacms/core/internal";

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
    // Astro's `image()` reads any path it is given: a `..` must not reach it.
    contentPath(path);
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
 * The images of an entry's rich text whose files exist, each as Markdoc writes
 * it (`path`) and as a path from the entry's data file (`src`), which `image()`
 * resolves. `found` comes from the reference check of `@micacms/core`.
 */
export function richTextImageSources(
  found: ReadonlyArray<{ target: string; path: string }>,
  dataFile: string,
): Array<{ path: string; src: string }> {
  const folder = posix.dirname(dataFile);
  const sources = new Map<string, string>();
  for (const { target, path } of found) {
    const relative = posix.relative(folder, path);
    sources.set(target, relative.startsWith(".") ? relative : `./${relative}`);
  }
  return [...sources].map(([path, src]) => ({ path, src }));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
