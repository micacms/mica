/**
 * One-off migration: the CMS database becomes a content repository.
 *
 *   pnpm cms:export-content [--out ./content] [--drafts]
 *
 * Reads what the SQLite tables hold and writes it in the authoring format, so
 * that a site which was served by the CMS content API can be built from a Git
 * checkout instead. After this runs and the result is committed, the database
 * is no longer the source of truth for anything.
 *
 * Two rules shape the output, and both are deliberate:
 *
 *   - Only published entries are exported. A draft is a state of an editor's
 *     browser now, not a row; carrying half-finished work into Git would put it
 *     one CI run away from being live. `--drafts` overrides this for anyone who
 *     needs the data out.
 *   - Media is copied beside the entry that references it, and its opaque ULID
 *     becomes the file name an author would have chosen. A content repository
 *     nobody can read by hand is only half migrated.
 *
 * This script is expected to be deleted once every site has been migrated.
 */

import { copyFile, mkdir, readdir, rm, writeFile } from "node:fs/promises";
import { dirname, extname, join } from "node:path";
import { parseArgs } from "node:util";

import {
  collectionEntryPath,
  entryFiles,
  serializeEntry,
  singletonPath,
  slugify,
  withDefaults,
  type AnyField,
  type Collection,
  type FieldMap,
  type Singleton,
} from "@micacms/model";

import { loadConfig } from "../config.js";
import { htmlToMarkdoc } from "./html-to-markdoc.js";
import { openDatabase } from "../db/index.js";
import { loadSchema } from "../schema.js";

interface MediaRow {
  id: string;
  filename: string;
  storage_key: string;
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      out: { type: "string", default: "./content" },
      drafts: { type: "boolean", default: false },
    },
  });

  const out = values.out!;
  const config = loadConfig();
  const site = await loadSchema(config.schemaPath);
  const db = openDatabase(config.databasePath);

  const media = new Map<string, MediaRow>(
    db
      .all<MediaRow>("select id, filename, storage_key from media")
      .map((row) => [row.id, row]),
  );

  // A clean directory, so that an entry deleted in the CMS does not survive as
  // a file nobody remembers writing.
  await rm(out, { recursive: true, force: true });
  await mkdir(out, { recursive: true });

  const copies: Array<{ from: string; to: string }> = [];
  let entryCount = 0;

  /* -------------------------------------------------------------- *
   * Collections
   * -------------------------------------------------------------- */

  const statuses = values.drafts ? ["published", "draft"] : ["published"];

  for (const [name, def] of Object.entries(site.collections) as [string, Collection][]) {
    const rows = db.all<{ slug: string; data: string; position: number }>(
      `select slug, data, position from entries
        where collection = ? and status in (${statuses.map(() => "?").join(", ")})
        order by position asc, slug asc`,
      [name, ...statuses],
    );

    for (const row of rows) {
      const base = collectionEntryPath(def.fields, name, row.slug);
      const data = withDefaults(def.fields, JSON.parse(row.data) as Record<string, unknown>);
      const converted = convertRichText(def.fields, data);
      const rewritten = rewriteMedia(def.fields, converted, media, copies, base);

      await writeAll(out, entryFiles(def.fields, base, serializeEntry(def.fields, rewritten)));
      entryCount += 1;
    }

    // Only where an editor could actually arrange the collection. Writing an
    // order file for a collection sorted by date would freeze that order and
    // silently override the sort the model asks for.
    if (def.sortable && rows.length > 0) {
      const order = rows.map((row) => row.slug);
      await writeAll(out, { [`${name}/_order.json`]: `${JSON.stringify(order, null, 2)}\n` });
    }

    console.log(`${name}: ${rows.length} ${rows.length === 1 ? "entry" : "entries"}`);
  }

  /* -------------------------------------------------------------- *
   * Singletons
   * -------------------------------------------------------------- */

  for (const [name, def] of Object.entries(site.singletons) as [string, Singleton][]) {
    const row = db.get<{ data: string }>("select data from globals where name = ?", [name]);

    if (!row) {
      console.log(`${name}: not filled in, skipped`);
      continue;
    }

    const base = singletonPath(def.fields, name);
    const data = withDefaults(def.fields, JSON.parse(row.data) as Record<string, unknown>);
    const converted = convertRichText(def.fields, data);
    const rewritten = rewriteMedia(def.fields, converted, media, copies, base);

    await writeAll(out, entryFiles(def.fields, base, serializeEntry(def.fields, rewritten)));
    console.log(`${name}: exported`);
  }

  /* -------------------------------------------------------------- *
   * Media
   * -------------------------------------------------------------- */

  for (const { from, to } of copies) {
    await mkdir(dirname(join(out, to)), { recursive: true });
    await copyFile(join(config.mediaDir, from), join(out, to));
  }

  const orphans = await countOrphans(config.mediaDir, copies.length);

  console.log(`\n${entryCount} entries and ${copies.length} files written to ${out}`);
  if (orphans > 0) {
    console.log(
      `${orphans} media files are not referenced by any entry and were not copied.\n` +
        `  Check the media library before deleting the old store.`,
    );
  }

  db.close();
}

/* ------------------------------------------------------------------ *
 * Rich text
 * ------------------------------------------------------------------ */

/**
 * Turns every rich-text field from the stored HTML into Markdoc.
 *
 * The one conversion in this migration that is not simply a move. HTML was a
 * reasonable choice when a database held it and a browser was the only reader;
 * it is the wrong thing to commit to Git, where the file should be legible and
 * its diffs should be about words rather than tags.
 */
function convertRichText(fields: FieldMap, data: Record<string, unknown>): Record<string, unknown> {
  const visit = (map: FieldMap, record: Record<string, unknown>): Record<string, unknown> => {
    const result: Record<string, unknown> = { ...record };

    for (const [key, field] of Object.entries(map) as [string, AnyField][]) {
      const value = record[key];

      if (field.kind === "richText") {
        result[key] = typeof value === "string" && value.trim() ? htmlToMarkdoc(value) : null;
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

/* ------------------------------------------------------------------ *
 * Media references
 * ------------------------------------------------------------------ */

/**
 * Replaces every media id with a path beside the entry that uses it.
 *
 * The file name comes from what was uploaded, not from the ULID that replaced
 * it, because the point of the migration is a repository a person can read.
 * Two different files with the same original name inside one entry are
 * disambiguated by a suffix rather than allowed to overwrite each other.
 */
function rewriteMedia(
  fields: FieldMap,
  data: Record<string, unknown>,
  media: Map<string, MediaRow>,
  copies: Array<{ from: string; to: string }>,
  base: string,
): Record<string, unknown> {
  const taken = new Set<string>();

  const nameFor = (row: MediaRow): string => {
    const extension = extname(row.filename) || extname(row.storage_key);
    const stem = slugify(row.filename.slice(0, row.filename.length - extension.length)) || "file";

    let candidate = `${stem}${extension}`;
    for (let n = 2; taken.has(candidate); n += 1) candidate = `${stem}-${n}${extension}`;

    taken.add(candidate);
    return candidate;
  };

  const resolveOne = (value: unknown): unknown => {
    if (typeof value !== "string") return value;

    const row = media.get(value);
    // A dangling id is left as-is. It is already broken, and silently dropping
    // it would hide that from whoever checks the migration.
    if (!row) return value;

    const name = nameFor(row);
    copies.push({ from: row.storage_key, to: `${base}/media/${name}` });
    return `media/${name}`;
  };

  const visit = (map: FieldMap, record: Record<string, unknown>): Record<string, unknown> => {
    const result: Record<string, unknown> = { ...record };

    for (const [key, field] of Object.entries(map) as [string, AnyField][]) {
      const value = record[key];

      if (field.kind === "media") {
        result[key] = Array.isArray(value) ? value.map(resolveOne) : resolveOne(value);
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/* ------------------------------------------------------------------ */

async function writeAll(out: string, files: Record<string, string>): Promise<void> {
  for (const [path, contents] of Object.entries(files)) {
    const target = join(out, path);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, contents, "utf8");
  }
}

async function countOrphans(mediaPath: string, copied: number): Promise<number> {
  try {
    const files = await readdir(mediaPath);
    return Math.max(0, files.length - copied);
  } catch {
    return 0;
  }
}

await main();
