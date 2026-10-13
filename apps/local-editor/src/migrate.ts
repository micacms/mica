/**
 * `mica migrate-layout`: moves the entries that a model change left in the
 * other layout. The developer runs it in the working tree and commits the
 * result with the model change; Git is the undo.
 */

import { existsSync } from "node:fs";
import { mkdir, readdir, rename, rm, rmdir } from "node:fs/promises";
import path from "node:path";

import {
  collectReferences,
  DOCUMENT_EXTENSION,
  entryLayout,
  INDEX_FILE,
  MEDIA_DIR,
  misplacedFiles,
  readCollection,
  readSingleton,
  type ContentSource,
  type FieldMap,
  type Site,
} from "@micacms/core";
import { within } from "@micacms/core/node";
import { contentFiles, loadSchema } from "@micacms/runtime";

export interface LayoutMigration {
  /** Each entry moved, as content-root paths. */
  moved: Array<{ from: string; to: string }>;
  /** Rich text and media of an entry that became a file: no field reads them now. */
  removed: string[];
  /** Files that Mica did not write, left in the old folder. */
  kept: string[];
  /** Entries not moved, because the target already exists. */
  conflicts: string[];
}

/** Moves every entry in the other layout into the layout that the model gives. */
export async function migrateLayout(root: string): Promise<LayoutMigration> {
  const files = contentFiles({ root });
  const site = await loadSchema(files);
  const result: LayoutMigration = { moved: [], removed: [], kept: [], conflicts: [] };

  const parts: Array<[string, FieldMap, "collection" | "singleton"]> = [
    ...Object.entries(site.collections).map(([name, def]) => [name, def.fields, "collection"] as [string, FieldMap, "collection"]),
    ...Object.entries(site.singletons).map(([name, def]) => [name, def.fields, "singleton"] as [string, FieldMap, "singleton"]),
  ];

  const formerFolders: string[] = [];
  for (const [name, fields, kind] of parts) {
    // The model decides the direction: `pages/index.json` is an entry named `index` in a file collection.
    const toFolder = entryLayout(fields) === "directory";
    for (const from of await misplacedFiles(files, fields, name, kind)) {
      const to = toFolder ? `${from.slice(0, -".json".length)}/${INDEX_FILE}` : `${path.posix.dirname(from)}.json`;

      if (existsSync(within(root, to))) {
        result.conflicts.push(`${from}: ${to} exists too. Merge the two by hand.`);
        continue;
      }

      await mkdir(path.dirname(within(root, to)), { recursive: true });
      await rename(within(root, from), within(root, to));
      if (!toFolder) formerFolders.push(path.posix.dirname(from));
      result.moved.push({ from, to });
    }
  }

  const used = await usedMedia(files, site);
  for (const folder of formerFolders) await emptyFolder(root, folder, used, result);
  return result;
}

/**
 * Every media path that an entry uses, after the moves. Null when a collection
 * cannot be read: then no media file is removed.
 */
async function usedMedia(files: ContentSource, site: Site): Promise<Set<string> | null> {
  const used = new Set<string>();
  const note = (fields: FieldMap, data: Record<string, unknown>) => {
    for (const reference of collectReferences(fields, data)) if (reference.kind === "media") used.add(reference.path);
  };
  try {
    for (const [name, def] of Object.entries(site.collections)) {
      for (const entry of await readCollection(files, def, name)) note(def.fields, entry.data);
    }
    for (const [name, def] of Object.entries(site.singletons)) {
      const data = await readSingleton(files, def, name);
      if (data) note(def.fields, data);
    }
  } catch {
    return null;
  }
  return used;
}

/** Removes the sidecars and the unused media of a former folder entry; keeps anything else. */
async function emptyFolder(root: string, folder: string, used: Set<string> | null, result: LayoutMigration): Promise<void> {
  for (const item of await readdir(within(root, folder), { withFileTypes: true, recursive: true })) {
    if (!item.isFile()) continue;
    const file = path.relative(path.resolve(root), path.join(item.parentPath, item.name)).split(path.sep).join("/");
    const inMedia = file.startsWith(`${folder}/${MEDIA_DIR}/`);
    const sidecar = path.posix.dirname(file) === folder && file.endsWith(DOCUMENT_EXTENSION);
    if (inMedia && (used === null || used.has(file))) {
      result.kept.push(`${file} (${used ? "another entry uses it" : "a collection could not be read"})`);
    } else if (inMedia || sidecar) {
      await rm(within(root, file));
      result.removed.push(file);
    } else {
      result.kept.push(`${file} (not written by Mica)`);
    }
  }
  await removeEmpty(within(root, folder));
}

async function removeEmpty(directory: string): Promise<void> {
  for (const item of await readdir(directory, { withFileTypes: true })) {
    if (item.isDirectory()) await removeEmpty(path.join(directory, item.name));
  }
  if ((await readdir(directory)).length === 0) await rmdir(directory);
}

/** The result as a person or an agent reads it. */
export function formatMigration(result: LayoutMigration): string {
  const lines: string[] = [];
  for (const { from, to } of result.moved) lines.push(`  moved    ${from} -> ${to}`);
  for (const file of result.removed) lines.push(`  removed  ${file}`);
  for (const file of result.kept) lines.push(`  kept     ${file}`);
  for (const conflict of result.conflicts) lines.push(`  error    ${conflict}`);
  if (lines.length === 0) return "Every entry is in the layout of the model. Nothing to move.\n";
  lines.push("", "Next: run `npx mica check`, look at `git status`, and commit the result with the model change.");
  return `${lines.join("\n")}\n`;
}
