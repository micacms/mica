/**
 * Entry repository.
 *
 * Content is stored generically: one row per entry, payload as JSON in `data`.
 * Adding or removing a field in the content model therefore never requires a
 * schema migration.
 */

import type { EntryStatus, SortField } from "@micacms/model";

import type { SqlDatabase } from "../db/driver.js";
import { ulid } from "../lib/id.js";

export interface EntryRecord {
  id: string;
  collection: string;
  slug: string;
  status: EntryStatus;
  position: number;
  data: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
  publishedAt: string | null;
  version: number;
  createdBy: string | null;
  updatedBy: string | null;
}

interface EntryRow {
  id: string;
  collection: string;
  slug: string;
  status: EntryStatus;
  position: number;
  data: string;
  created_at: string;
  updated_at: string;
  published_at: string | null;
  version: number;
  created_by: string | null;
  updated_by: string | null;
}

function toRecord(row: EntryRow): EntryRecord {
  return {
    id: row.id,
    collection: row.collection,
    slug: row.slug,
    status: row.status,
    position: row.position,
    data: JSON.parse(row.data) as Record<string, unknown>,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    publishedAt: row.published_at,
    version: row.version,
    createdBy: row.created_by,
    updatedBy: row.updated_by,
  };
}

const COLUMNS = `
  id, collection, slug, status, position, data,
  created_at, updated_at, published_at, version, created_by, updated_by
`;

const SORT_COLUMNS: Record<SortField, string> = {
  createdAt: "created_at",
  updatedAt: "updated_at",
  publishedAt: "published_at",
  position: "position",
  title: "slug",
};

export interface ListEntriesOptions {
  collection: string;
  status?: EntryStatus;
  search?: string;
  sort?: SortField;
  direction?: "asc" | "desc";
  limit?: number;
  offset?: number;
}

export interface CreateEntryInput {
  collection: string;
  slug: string;
  status: EntryStatus;
  data: Record<string, unknown>;
  userId: string | null;
}

export interface UpdateEntryInput {
  slug?: string;
  status?: EntryStatus;
  data?: Record<string, unknown>;
  userId: string | null;
}

export function createEntryRepository(db: SqlDatabase) {
  return {
    list(options: ListEntriesOptions): { items: EntryRecord[]; total: number } {
      const where: string[] = ["collection = ?"];
      const params: (string | number)[] = [options.collection];

      if (options.status) {
        where.push("status = ?");
        params.push(options.status);
      }

      if (options.search?.trim()) {
        // Payloads are small and collections are in the hundreds, so a scan of
        // the JSON text is cheaper than maintaining an FTS index.
        where.push("(slug LIKE ? OR lower(data) LIKE ?)");
        const needle = `%${options.search.trim().toLowerCase()}%`;
        params.push(needle, needle);
      }

      const clause = `WHERE ${where.join(" AND ")}`;
      const total = db.get<{ count: number }>(
        `SELECT COUNT(*) AS count FROM entries ${clause}`,
        params,
      );

      const sort = SORT_COLUMNS[options.sort ?? "updatedAt"];
      const direction = options.direction === "asc" ? "ASC" : "DESC";
      const limit = Math.min(options.limit ?? 50, 200);
      const offset = Math.max(options.offset ?? 0, 0);

      const rows = db.all<EntryRow>(
        `SELECT ${COLUMNS} FROM entries ${clause}
         ORDER BY ${sort} ${direction} NULLS LAST, id DESC
         LIMIT ? OFFSET ?`,
        [...params, limit, offset],
      );

      return { items: rows.map(toRecord), total: total?.count ?? 0 };
    },

    /** Published entries for one collection, ordered for the static build. */
    listPublished(collection: string, sort: SortField = "position"): EntryRecord[] {
      const column = SORT_COLUMNS[sort];
      return db
        .all<EntryRow>(
          `SELECT ${COLUMNS} FROM entries
           WHERE collection = ? AND status = 'published'
           ORDER BY ${column} ASC NULLS LAST, id ASC`,
          [collection],
        )
        .map(toRecord);
    },

    findById(id: string): EntryRecord | undefined {
      const row = db.get<EntryRow>(`SELECT ${COLUMNS} FROM entries WHERE id = ?`, [id]);
      return row && toRecord(row);
    },

    findBySlug(collection: string, slug: string): EntryRecord | undefined {
      const row = db.get<EntryRow>(
        `SELECT ${COLUMNS} FROM entries WHERE collection = ? AND slug = ?`,
        [collection, slug],
      );
      return row && toRecord(row);
    },

    findPublishedBySlug(collection: string, slug: string): EntryRecord | undefined {
      const row = db.get<EntryRow>(
        `SELECT ${COLUMNS} FROM entries
         WHERE collection = ? AND slug = ? AND status = 'published'`,
        [collection, slug],
      );
      return row && toRecord(row);
    },

    /** Existing slugs in a collection, so a new one can be de-duplicated. */
    slugs(collection: string, exceptId?: string): string[] {
      const rows = exceptId
        ? db.all<{ slug: string }>(
            "SELECT slug FROM entries WHERE collection = ? AND id != ?",
            [collection, exceptId],
          )
        : db.all<{ slug: string }>("SELECT slug FROM entries WHERE collection = ?", [collection]);
      return rows.map((row) => row.slug);
    },

    create(input: CreateEntryInput): EntryRecord {
      const now = new Date().toISOString();
      const id = ulid();
      const next = db.get<{ next: number }>(
        "SELECT COALESCE(MAX(position), -1) + 1 AS next FROM entries WHERE collection = ?",
        [input.collection],
      );

      db.run(
        `INSERT INTO entries
           (id, collection, slug, status, position, data,
            created_at, updated_at, published_at, version, created_by, updated_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
        [
          id,
          input.collection,
          input.slug,
          input.status,
          next?.next ?? 0,
          JSON.stringify(input.data),
          now,
          now,
          input.status === "published" ? now : null,
          input.userId,
          input.userId,
        ],
      );

      return this.findById(id)!;
    },

    update(id: string, input: UpdateEntryInput): EntryRecord | undefined {
      const current = this.findById(id);
      if (!current) return undefined;

      const now = new Date().toISOString();
      const status = input.status ?? current.status;

      // `published_at` records the first publication and survives later edits;
      // re-publishing after a return to draft sets it again.
      const publishedAt =
        status === "published" ? (current.publishedAt ?? now) : current.publishedAt;

      db.run(
        `UPDATE entries
            SET slug = ?, status = ?, data = ?, updated_at = ?,
                published_at = ?, version = version + 1, updated_by = ?
          WHERE id = ?`,
        [
          input.slug ?? current.slug,
          status,
          JSON.stringify(input.data ?? current.data),
          now,
          publishedAt,
          input.userId,
          id,
        ],
      );

      return this.findById(id);
    },

    delete(id: string): boolean {
      return db.run("DELETE FROM entries WHERE id = ?", [id]).changes > 0;
    },

    /** Applies an editor-defined order. Ids not listed keep their position. */
    reorder(collection: string, orderedIds: string[]): void {
      db.transaction(() => {
        orderedIds.forEach((id, index) => {
          db.run("UPDATE entries SET position = ? WHERE id = ? AND collection = ?", [
            index,
            id,
            collection,
          ]);
        });
      });
    },

    /** Entry counts per collection, for the dashboard and sidebar badges. */
    counts(): Record<string, { total: number; drafts: number; published: number }> {
      const rows = db.all<{ collection: string; status: EntryStatus; count: number }>(
        "SELECT collection, status, COUNT(*) AS count FROM entries GROUP BY collection, status",
      );

      const result: Record<string, { total: number; drafts: number; published: number }> = {};
      for (const row of rows) {
        const bucket = (result[row.collection] ??= { total: 0, drafts: 0, published: 0 });
        bucket.total += row.count;
        if (row.status === "published") bucket.published += row.count;
        else bucket.drafts += row.count;
      }
      return result;
    },

    /** Most recently touched entries across all collections, for the dashboard. */
    recent(limit = 8): EntryRecord[] {
      return db
        .all<EntryRow>(
          `SELECT ${COLUMNS} FROM entries ORDER BY updated_at DESC LIMIT ?`,
          [limit],
        )
        .map(toRecord);
    },

    /** Entries in `collection` whose `field` references `slug`. */
    referencing(collection: string, field: string, slug: string): EntryRecord[] {
      return db
        .all<EntryRow>(
          `SELECT ${COLUMNS} FROM entries
            WHERE collection = ?
              AND (json_extract(data, '$.' || ?) = ?
                   OR EXISTS (
                     SELECT 1 FROM json_each(data, '$.' || ?)
                      WHERE json_each.value = ?
                   ))`,
          [collection, field, slug, field, slug],
        )
        .map(toRecord);
    },
  };
}

export type EntryRepository = ReturnType<typeof createEntryRepository>;
