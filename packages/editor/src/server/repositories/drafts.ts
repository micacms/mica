/**
 * The SQLite draft store.
 *
 * Implements the `DraftStore` port over the same database that holds
 * sessions, which is deliberate: a self-hosted deployment has exactly one
 * file to back up, and a backup cannot capture the sessions and miss the
 * unpublished work. `v3-arch.md` §10.4 sketches "SQLite plus a media
 * directory"; the media bytes live in here instead, because a second
 * location would make staging a two-phase write and the backup a two-file
 * promise. Content trees are small and uploads are capped, so the rows stay
 * within what SQLite is comfortable holding.
 *
 * The port's semantics — replace-but-keep-base, versioning, clearing by
 * (path, version) — are specified by `memoryDraftStore` in @micacms/model and
 * its tests; this file is the durable twin.
 */

import type { DraftStore, Revision, StagedChange, StageInput } from "@micacms/model";

import type { SqlDatabase } from "../db/driver.js";

interface DraftRow {
  path: string;
  kind: "write" | "delete";
  contents: Uint8Array | null;
  is_text: number;
  base_revision: string | null;
  version: number;
  updated_at: string;
}

const COLUMNS = "path, kind, contents, is_text, base_revision, version, updated_at";

function toChange(row: DraftRow): StagedChange {
  const shared = {
    path: row.path,
    baseRevision: row.base_revision,
    version: row.version,
    updatedAt: row.updated_at,
  };

  return row.kind === "write"
    ? {
        kind: "write",
        contents: new Uint8Array(row.contents ?? new Uint8Array()),
        text: row.is_text === 1,
        ...shared,
      }
    : { kind: "delete", ...shared };
}

export function createDraftRepository(db: SqlDatabase): DraftStore {
  const nextVersion = (): number =>
    (db.get<{ version: number | null }>("SELECT MAX(version) AS version FROM drafts")?.version ??
      0) + 1;

  return {
    async list(): Promise<StagedChange[]> {
      return db
        .all<DraftRow>(`SELECT ${COLUMNS} FROM drafts ORDER BY version`)
        .map(toChange);
    },

    async get(path: string): Promise<StagedChange | null> {
      const row = db.get<DraftRow>(`SELECT ${COLUMNS} FROM drafts WHERE path = ?`, [path]);
      return row ? toChange(row) : null;
    },

    async stage(changes: StageInput[]): Promise<void> {
      db.transaction(() => {
        let version = nextVersion();
        const now = new Date().toISOString();

        for (const change of changes) {
          const existing = db.get<{ base_revision: string | null }>(
            "SELECT base_revision FROM drafts WHERE path = ?",
            [change.path],
          );

          db.run(
            `INSERT OR REPLACE INTO drafts (${COLUMNS}) VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [
              change.path,
              change.kind,
              change.kind === "write" ? change.contents : null,
              change.kind === "write" && change.text ? 1 : 0,
              // First staging wins: the publish gate is the repository as it
              // was then, not at the latest keystroke.
              existing ? existing.base_revision : change.baseRevision,
              version++,
              now,
            ],
          );
        }
      });
    },

    async discard(paths: string[]): Promise<string[]> {
      return db.transaction(() => {
        const removed: string[] = [];
        for (const path of paths) {
          if (db.run("DELETE FROM drafts WHERE path = ?", [path]).changes > 0) {
            removed.push(path);
          }
        }
        forgetBaseWhenEmpty(db);
        return removed;
      });
    },

    async clearPublished(published): Promise<void> {
      db.transaction(() => {
        for (const { path, version } of published) {
          db.run("DELETE FROM drafts WHERE path = ? AND version = ?", [path, version]);
        }
        forgetBaseWhenEmpty(db);
      });
    },

    async rebase(path: string, baseRevision: Revision | null): Promise<void> {
      db.run("UPDATE drafts SET base_revision = ? WHERE path = ?", [baseRevision, path]);
    },

    async base(): Promise<Revision | null> {
      return (
        db.get<{ revision: string }>("SELECT revision FROM draft_base WHERE id = 1")?.revision ??
        null
      );
    },

    async setBase(revision: Revision | null): Promise<void> {
      if (revision === null) {
        db.run("DELETE FROM draft_base WHERE id = 1");
        return;
      }
      db.run(
        "INSERT OR REPLACE INTO draft_base (id, revision, recorded_at) VALUES (1, ?, ?)",
        [revision, new Date().toISOString()],
      );
    },
  };
}

/** An empty draft is based on nothing; keeping the row would display a lie. */
function forgetBaseWhenEmpty(db: SqlDatabase): void {
  const count = db.get<{ count: number }>("SELECT COUNT(*) AS count FROM drafts")?.count ?? 0;
  if (count === 0) db.run("DELETE FROM draft_base WHERE id = 1");
}

export type DraftRepository = ReturnType<typeof createDraftRepository>;
