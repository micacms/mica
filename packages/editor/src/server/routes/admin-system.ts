/**
 * Schema, dashboard and system information.
 *
 * The schema endpoint is what makes the admin generic: the SPA ships no
 * knowledge of any particular collection, it renders whatever this returns.
 *
 * There is no publish route. Publishing is a commit, and the commit happened
 * when the editor pressed Save; what follows belongs to the repository's CI,
 * which Mica neither owns nor should pretend to.
 */

import fs from "node:fs";

import { Hono } from "hono";

import { listedFields, resolveSlugField, resolveTitleField } from "@micacms/core";

import { databaseVersion } from "../db/migrations.js";
import type { Env } from "../http.js";
import { schemaStats } from "../lib/schema-stats.js";
import { schemaOrigin } from "../schema.js";
import { VERSION } from "../lib/version.js";
import { formatBytes } from "../services/media.js";

/** Size on disk, or null when the file is not there — an in-memory database. */
function fileSize(filename: string): number | null {
  try {
    return fs.statSync(filename).size;
  } catch {
    return null;
  }
}

export function adminSystemRoutes(): Hono<Env> {
  const app = new Hono<Env>();

  /**
   * The content model, plus the few derived values the UI would otherwise have
   * to recompute. Field descriptors are already plain data, so the model
   * serialises as-is.
   */
  app.get("/schema", (c) => {
    const { site } = c.get("ctx");

    return c.json({
      collections: Object.values(site.model.collections).map((def) => ({
        name: def.name,
        label: def.label,
        labelSingular: def.labelSingular ?? def.label,
        description: def.description ?? null,
        sortable: def.sortable ?? false,
        defaultSort: def.defaultSort ?? null,
        titleField: resolveTitleField(def),
        slugField: resolveSlugField(def),
        listedFields: listedFields(def),
        fields: def.fields,
      })),
      singletons: Object.values(site.model.singletons).map((def) => ({
        name: def.name,
        label: def.label,
        description: def.description ?? null,
        fields: def.fields,
      })),
    });
  });

  app.get("/overview", async (c) => {
    const ctx = c.get("ctx");
    const { content, media } = ctx.services;

    // Read from the repository rather than counted in SQL. A count that can
    // disagree with the files is worse than no count.
    const collections = await Promise.all(
      Object.values(ctx.site.model.collections).map(async (def) => ({
        name: def.name,
        label: def.label,
        total: (await content.list(def.name)).length,
      })),
    );

    const files = await media.list();

    return c.json({
      collections,
      media: {
        files: files.length,
        bytes: files.reduce((sum, file) => sum + file.size, 0),
        readable: formatBytes(files.reduce((sum, file) => sum + file.size, 0)),
      },
      repository: ctx.site.contentRepository.origin,
    });
  });

  /**
   * What this deployment is and what it is serving.
   *
   * Answers the questions that otherwise need shell access: which version is
   * running, which content model it was handed, how large the database has
   * grown, how this deployment decides who may edit it.
   *
   * All of it goes to everybody who is admitted. There is no administrator
   * role to withhold it from: admission is configuration, so the people who
   * reach this endpoint are exactly the people the operator named. No secret
   * value is returned anywhere, only whether one is set.
   */
  app.get("/system", async (c) => {
    const ctx = c.get("ctx");
    const { config } = ctx;

    const stats = schemaStats(ctx.site.model);

    const counts = Object.fromEntries(
      await Promise.all(
        Object.values(ctx.site.model.collections).map(
          async (def) => [def.name, (await ctx.services.content.list(def.name)).length] as const,
        ),
      ),
    );

    const files = await ctx.services.media.list();
    const mediaBytes = files.reduce((sum, file) => sum + file.size, 0);

    // The WAL holds committed transactions that have not been checkpointed
    // into the main file yet, so leaving it out understates the database.
    const databaseBytes = fileSize(config.databasePath);
    const walBytes = fileSize(`${config.databasePath}-wal`);

    const uptimeSeconds = Math.floor(process.uptime());

    return c.json({
      cms: {
        version: VERSION,
        environment: config.NODE_ENV,
        node: process.version,
        platform: `${process.platform}/${process.arch}`,
        startedAt: new Date(Date.now() - uptimeSeconds * 1000).toISOString(),
        uptimeSeconds,
      },
      schema: {
        totals: stats.totals,
        kinds: stats.kinds,
        relations: stats.relations,
        // Entry counts alongside the shape, because "8 fields, 0 entries" is
        // the pair that tells an editor a collection was never filled in.
        collections: stats.collections.map((item) => ({
          ...item,
          entries: counts[item.name] ?? 0,
        })),
        singletons: stats.singletons,
      },
      /**
       * Deliberately two separate things.
       *
       * `repository` is where the website's content lives and what must be
       * backed up — by Git, which is doing it already. `database` is Mica's own
       * operational state: sessions. Losing it signs everyone out and costs
       * nothing else, and the shape of this response should say so.
       */
      repository: {
        origin: ctx.site.contentRepository.origin,
        entries: Object.values(counts).reduce((sum, count) => sum + count, 0),
        media: { files: files.length, bytes: mediaBytes, readable: formatBytes(mediaBytes) },
      },
      database: {
        sessions: ctx.repositories.sessions.count(),
        version: databaseVersion(ctx.db),
        bytes: databaseBytes === null ? null : databaseBytes + (walBytes ?? 0),
      },
      deployment: {
        site: ctx.site.id,
        baseUrl: config.MICA_PUBLIC_URL,
        schemaOrigin: schemaOrigin(ctx.site.contentRepository),
        repositoryMode: config.REPOSITORY,
        // Only meaningful for the local connector; a remote one names itself
        // in `repository.origin` above.
        contentRoot: config.REPOSITORY === "local" ? config.contentRoot : null,
        dataDir: config.dataDir,
        databasePath: config.databasePath,
        logLevel: config.LOG_LEVEL,
        maxUploadBytes: config.MAX_UPLOAD_BYTES,
        maxUploadReadable: formatBytes(config.MAX_UPLOAD_BYTES),
        sessionTtlHours: config.SESSION_TTL_HOURS,
        sessionIdleHours: config.SESSION_IDLE_HOURS,
        /** What decides who may edit here, in the operator's own words. */
        admission: ctx.services.admission.summary,
        trustProxy: config.TRUST_PROXY,
        cookieSecure: config.cookieSecure,
        adminOrigins: config.adminOrigins,
        /** Names of the secrets this process generated for itself. */
        generatedSecrets: (config as { devSecrets?: string[] }).devSecrets ?? [],
        memoryBytes: process.memoryUsage().rss,
      },
    });
  });

  return app;
}
