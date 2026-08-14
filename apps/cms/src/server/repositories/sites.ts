/**
 * Tenants, sites and their repository connections.
 *
 * A tenant owns sites; a site is one content repository plus the people allowed
 * to edit it. Most deployments have exactly one of each and never see the word
 * "tenant" — `DEFAULT_SITE_ID` is what the server falls back to when nothing
 * names a site, and migration 3 guarantees the row exists.
 *
 * The structure is here now, before it is needed, because retrofitting a site
 * id onto memberships and connections later would mean touching every query
 * that reads them. Exposing it in the UI is a separate decision, and not yet
 * taken.
 */

import type { SqlDatabase } from "../db/driver.js";
import { ulid } from "../lib/id.js";

/** The tenant and site migration 3 creates. Single-site deployments live here. */
export const DEFAULT_TENANT_ID = "default";
export const DEFAULT_SITE_ID = "default";

export type ConnectionKind = "local" | "github" | "gitlab";

export interface SiteRecord {
  id: string;
  tenantId: string;
  slug: string;
  name: string;
  createdAt: string;
}

export interface RepositoryConnectionRecord {
  siteId: string;
  kind: ConnectionKind;
  /** `owner/repo` or `group/project`; null for a local working tree. */
  project: string | null;
  branch: string;
  root: string;
  apiBase: string | null;
  token: string | null;
}

interface SiteRow {
  id: string;
  tenant_id: string;
  slug: string;
  name: string;
  created_at: string;
}

interface ConnectionRow {
  site_id: string;
  kind: ConnectionKind;
  project: string | null;
  branch: string;
  root: string;
  api_base: string | null;
  token: string | null;
}

const toSite = (row: SiteRow): SiteRecord => ({
  id: row.id,
  tenantId: row.tenant_id,
  slug: row.slug,
  name: row.name,
  createdAt: row.created_at,
});

const toConnection = (row: ConnectionRow): RepositoryConnectionRecord => ({
  siteId: row.site_id,
  kind: row.kind,
  project: row.project,
  branch: row.branch,
  root: row.root,
  apiBase: row.api_base,
  token: row.token,
});

export function createSiteRepository(db: SqlDatabase) {
  return {
    list(): SiteRecord[] {
      return db
        .all<SiteRow>("SELECT * FROM sites ORDER BY created_at ASC")
        .map(toSite);
    },

    findById(id: string): SiteRecord | undefined {
      const row = db.get<SiteRow>("SELECT * FROM sites WHERE id = ?", [id]);
      return row && toSite(row);
    },

    findBySlug(slug: string): SiteRecord | undefined {
      const row = db.get<SiteRow>("SELECT * FROM sites WHERE slug = ?", [slug]);
      return row && toSite(row);
    },

    create(input: { tenantId?: string; slug: string; name: string }): SiteRecord {
      const id = ulid();
      db.run(
        "INSERT INTO sites (id, tenant_id, slug, name, created_at) VALUES (?, ?, ?, ?, ?)",
        [id, input.tenantId ?? DEFAULT_TENANT_ID, input.slug, input.name, new Date().toISOString()],
      );
      return this.findById(id)!;
    },

    /* --------------------------------------------------- connections */

    connection(siteId: string): RepositoryConnectionRecord | undefined {
      const row = db.get<ConnectionRow>(
        "SELECT * FROM repository_connections WHERE site_id = ?",
        [siteId],
      );
      return row && toConnection(row);
    },

    /**
     * Writes the connection for a site, replacing any previous one.
     *
     * One per site by construction: a site *is* a repository, and a second
     * connection would mean a second site.
     */
    setConnection(input: {
      siteId: string;
      kind: ConnectionKind;
      project?: string | null;
      branch?: string;
      root?: string;
      apiBase?: string | null;
      token?: string | null;
    }): RepositoryConnectionRecord {
      const now = new Date().toISOString();

      db.run(
        `INSERT INTO repository_connections
           (site_id, kind, project, branch, root, api_base, token, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (site_id) DO UPDATE SET
           kind = excluded.kind, project = excluded.project, branch = excluded.branch,
           root = excluded.root, api_base = excluded.api_base, token = excluded.token,
           updated_at = excluded.updated_at`,
        [
          input.siteId,
          input.kind,
          input.project ?? null,
          input.branch ?? "main",
          input.root ?? "content",
          input.apiBase ?? null,
          input.token ?? null,
          now,
          now,
        ],
      );

      return this.connection(input.siteId)!;
    },
  };
}

export type SiteRepository = ReturnType<typeof createSiteRepository>;
