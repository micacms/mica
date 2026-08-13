/**
 * Revision repository.
 *
 * A revision is a snapshot of the payload *before* a modification, so the most
 * recent revision is the previous version rather than the current one. That
 * makes "restore" a straightforward write of an older snapshot.
 */

import type { SqlDatabase } from "../db/driver.js";
import { ulid } from "../lib/id.js";

export type RevisionTarget = "entry" | "global";

export interface RevisionRecord {
  id: string;
  targetType: RevisionTarget;
  targetId: string;
  collection: string | null;
  version: number;
  slug: string | null;
  status: string | null;
  title: string;
  data: Record<string, unknown>;
  note: string;
  createdAt: string;
  createdBy: string | null;
  /** Joined for display; null when the account has since been deleted. */
  authorName: string | null;
  authorEmail: string | null;
}

interface RevisionRow {
  id: string;
  target_type: RevisionTarget;
  target_id: string;
  collection: string | null;
  version: number;
  slug: string | null;
  status: string | null;
  title: string;
  data: string;
  note: string;
  created_at: string;
  created_by: string | null;
  author_name: string | null;
  author_email: string | null;
}

function toRecord(row: RevisionRow): RevisionRecord {
  return {
    id: row.id,
    targetType: row.target_type,
    targetId: row.target_id,
    collection: row.collection,
    version: row.version,
    slug: row.slug,
    status: row.status,
    title: row.title,
    data: JSON.parse(row.data) as Record<string, unknown>,
    note: row.note,
    createdAt: row.created_at,
    createdBy: row.created_by,
    authorName: row.author_name,
    authorEmail: row.author_email,
  };
}

const SELECT = `
  SELECT r.id, r.target_type, r.target_id, r.collection, r.version, r.slug,
         r.status, r.title, r.data, r.note, r.created_at, r.created_by,
         u.name AS author_name, u.email AS author_email
    FROM revisions r
    LEFT JOIN users u ON u.id = r.created_by
`;

export interface CreateRevisionInput {
  targetType: RevisionTarget;
  targetId: string;
  collection?: string | null;
  version: number;
  slug?: string | null;
  status?: string | null;
  title: string;
  data: Record<string, unknown>;
  note?: string;
  userId: string | null;
}

export function createRevisionRepository(db: SqlDatabase) {
  return {
    create(input: CreateRevisionInput): RevisionRecord {
      const id = ulid();
      db.run(
        `INSERT INTO revisions
           (id, target_type, target_id, collection, version, slug, status,
            title, data, note, created_at, created_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          id,
          input.targetType,
          input.targetId,
          input.collection ?? null,
          input.version,
          input.slug ?? null,
          input.status ?? null,
          input.title,
          JSON.stringify(input.data),
          input.note ?? "",
          new Date().toISOString(),
          input.userId,
        ],
      );
      return this.find(id)!;
    },

    count(): number {
      return db.get<{ count: number }>("SELECT COUNT(*) AS count FROM revisions")?.count ?? 0;
    },

    find(id: string): RevisionRecord | undefined {
      const row = db.get<RevisionRow>(`${SELECT} WHERE r.id = ?`, [id]);
      return row && toRecord(row);
    },

    list(targetType: RevisionTarget, targetId: string, limit = 50): RevisionRecord[] {
      return db
        .all<RevisionRow>(
          `${SELECT} WHERE r.target_type = ? AND r.target_id = ?
            ORDER BY r.created_at DESC, r.id DESC LIMIT ?`,
          [targetType, targetId, limit],
        )
        .map(toRecord);
    },

    /**
     * Keeps the newest `keep` revisions for a target and discards the rest, so
     * an entry edited daily for years does not grow the database without bound.
     */
    prune(targetType: RevisionTarget, targetId: string, keep: number): number {
      return db.run(
        `DELETE FROM revisions
          WHERE target_type = ? AND target_id = ?
            AND id NOT IN (
              SELECT id FROM revisions
               WHERE target_type = ? AND target_id = ?
               ORDER BY created_at DESC, id DESC
               LIMIT ?
            )`,
        [targetType, targetId, targetType, targetId, keep],
      ).changes;
    },

    deleteForTarget(targetType: RevisionTarget, targetId: string): number {
      return db.run("DELETE FROM revisions WHERE target_type = ? AND target_id = ?", [
        targetType,
        targetId,
      ]).changes;
    },
  };
}

export type RevisionRepository = ReturnType<typeof createRevisionRepository>;
