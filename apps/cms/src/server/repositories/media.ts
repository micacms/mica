/**
 * Media metadata repository. The bytes live in a `MediaStorage`; this table
 * only records what the CMS knows about them.
 */

import type { SqlDatabase } from "../db/driver.js";

export interface MediaRecord {
  id: string;
  filename: string;
  storageKey: string;
  mimeType: string;
  width: number | null;
  height: number | null;
  size: number;
  altText: string;
  checksum: string | null;
  createdAt: string;
  createdBy: string | null;
}

interface MediaRow {
  id: string;
  filename: string;
  storage_key: string;
  mime_type: string;
  width: number | null;
  height: number | null;
  size: number;
  alt_text: string;
  checksum: string | null;
  created_at: string;
  created_by: string | null;
}

function toRecord(row: MediaRow): MediaRecord {
  return {
    id: row.id,
    filename: row.filename,
    storageKey: row.storage_key,
    mimeType: row.mime_type,
    width: row.width,
    height: row.height,
    size: row.size,
    altText: row.alt_text,
    checksum: row.checksum,
    createdAt: row.created_at,
    createdBy: row.created_by,
  };
}

const COLUMNS = `
  id, filename, storage_key, mime_type, width, height,
  size, alt_text, checksum, created_at, created_by
`;

export interface CreateMediaInput {
  id: string;
  filename: string;
  storageKey: string;
  mimeType: string;
  width: number | null;
  height: number | null;
  size: number;
  altText?: string;
  checksum?: string | null;
  userId: string | null;
}

export function createMediaRepository(db: SqlDatabase) {
  return {
    list(options: { search?: string; limit?: number; offset?: number; image?: boolean } = {}): {
      items: MediaRecord[];
      total: number;
    } {
      const where: string[] = [];
      const params: (string | number)[] = [];

      if (options.search?.trim()) {
        where.push("(lower(filename) LIKE ? OR lower(alt_text) LIKE ?)");
        const needle = `%${options.search.trim().toLowerCase()}%`;
        params.push(needle, needle);
      }
      if (options.image) {
        where.push("mime_type LIKE 'image/%'");
      }

      const clause = where.length > 0 ? `WHERE ${where.join(" AND ")}` : "";
      const total = db.get<{ count: number }>(`SELECT COUNT(*) AS count FROM media ${clause}`, params);

      const limit = Math.min(options.limit ?? 60, 200);
      const offset = Math.max(options.offset ?? 0, 0);

      const rows = db.all<MediaRow>(
        `SELECT ${COLUMNS} FROM media ${clause} ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?`,
        [...params, limit, offset],
      );

      return { items: rows.map(toRecord), total: total?.count ?? 0 };
    },

    count(): number {
      return db.get<{ count: number }>("SELECT COUNT(*) AS count FROM media")?.count ?? 0;
    },

    find(id: string): MediaRecord | undefined {
      const row = db.get<MediaRow>(`SELECT ${COLUMNS} FROM media WHERE id = ?`, [id]);
      return row && toRecord(row);
    },

    /** Bulk lookup used when expanding media references on a page of entries. */
    findMany(ids: string[]): MediaRecord[] {
      if (ids.length === 0) return [];
      const placeholders = ids.map(() => "?").join(", ");
      return db
        .all<MediaRow>(`SELECT ${COLUMNS} FROM media WHERE id IN (${placeholders})`, ids)
        .map(toRecord);
    },

    /** Lets an upload of identical bytes reuse the existing file. */
    findByChecksum(checksum: string): MediaRecord | undefined {
      const row = db.get<MediaRow>(`SELECT ${COLUMNS} FROM media WHERE checksum = ? LIMIT 1`, [
        checksum,
      ]);
      return row && toRecord(row);
    },

    create(input: CreateMediaInput): MediaRecord {
      db.run(
        `INSERT INTO media
           (id, filename, storage_key, mime_type, width, height,
            size, alt_text, checksum, created_at, created_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          input.id,
          input.filename,
          input.storageKey,
          input.mimeType,
          input.width,
          input.height,
          input.size,
          input.altText ?? "",
          input.checksum ?? null,
          new Date().toISOString(),
          input.userId,
        ],
      );
      return this.find(input.id)!;
    },

    update(id: string, patch: { filename?: string; altText?: string }): MediaRecord | undefined {
      const current = this.find(id);
      if (!current) return undefined;

      db.run("UPDATE media SET filename = ?, alt_text = ? WHERE id = ?", [
        patch.filename ?? current.filename,
        patch.altText ?? current.altText,
        id,
      ]);
      return this.find(id);
    },

    delete(id: string): boolean {
      return db.run("DELETE FROM media WHERE id = ?", [id]).changes > 0;
    },

    /**
     * Ids referenced by any entry or global payload. Used to warn before a
     * delete removes an asset that is still on the live site.
     */
    referencedIds(): Set<string> {
      const rows = db.all<{ data: string }>(
        "SELECT data FROM entries UNION ALL SELECT data FROM globals",
      );

      const ids = new Set<string>();
      // The reference could sit at any depth, so walk the parsed payload.
      const visit = (value: unknown): void => {
        if (typeof value === "string") {
          if (value.length === 26) ids.add(value);
          return;
        }
        if (Array.isArray(value)) {
          value.forEach(visit);
          return;
        }
        if (value && typeof value === "object") {
          Object.values(value).forEach(visit);
        }
      };

      for (const row of rows) {
        try {
          visit(JSON.parse(row.data));
        } catch {
          // A payload that will not parse cannot hold a live reference either.
        }
      }
      return ids;
    },
  };
}

export type MediaRepository = ReturnType<typeof createMediaRepository>;
