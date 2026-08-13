/**
 * Schema, dashboard, system information and manual publish routes.
 *
 * The schema endpoint is what makes the admin generic: the SPA ships no
 * knowledge of any particular collection, it renders whatever this returns.
 */

import fs from "node:fs";

import { Hono } from "hono";

import { listedFields, resolveSlugField, resolveTitleField } from "@micacms/model";

import { databaseVersion } from "../db/migrations.js";
import type { Env } from "../http.js";
import { actorOf } from "../http.js";
import { schemaStats } from "../lib/schema-stats.js";
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
      collections: Object.values(site.collections).map((def) => ({
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
      globals: Object.values(site.singletons).map((def) => ({
        name: def.name,
        label: def.label,
        description: def.description ?? null,
        fields: def.fields,
      })),
    });
  });

  app.get("/overview", async (c) => {
    const ctx = c.get("ctx");
    const counts = ctx.repositories.entries.counts();
    const usage = await ctx.storage.usage();

    const recent = ctx.repositories.entries.recent(8).map((record) => {
      const def = ctx.site.collections[record.collection];
      return {
        id: record.id,
        collection: record.collection,
        collectionLabel: def?.label ?? record.collection,
        slug: record.slug,
        status: record.status,
        updatedAt: record.updatedAt,
        title:
          (def && typeof record.data[resolveTitleField(def) ?? ""] === "string"
            ? (record.data[resolveTitleField(def)!] as string)
            : record.slug) || record.slug,
      };
    });

    return c.json({
      collections: Object.values(ctx.site.collections).map((def) => ({
        name: def.name,
        label: def.label,
        ...(counts[def.name] ?? { total: 0, drafts: 0, published: 0 }),
      })),
      media: {
        files: usage.files,
        bytes: usage.bytes,
        readable: formatBytes(usage.bytes),
      },
      users: ctx.repositories.users.count(),
      recent,
      publisher: ctx.publisher.status(),
      contentVersion: ctx.services.content.contentVersion(),
    });
  });

  /**
   * What this deployment is and what it is serving.
   *
   * Answers the questions that otherwise need shell access: which version is
   * running, which content model it was handed, how large the database has
   * grown, whether builds are wired up. Everything an editor may see is
   * descriptive; the deployment block — filesystem paths, limits, which
   * secrets are still development defaults — is for administrators only.
   *
   * No secret value is returned anywhere, only whether one is set.
   */
  app.get("/system", async (c) => {
    const ctx = c.get("ctx");
    const { config } = ctx;

    const stats = schemaStats(ctx.site);
    const counts = ctx.repositories.entries.counts();
    const usage = await ctx.storage.usage();

    const entries = Object.values(counts).reduce(
      (sum, item) => ({
        total: sum.total + item.total,
        drafts: sum.drafts + item.drafts,
        published: sum.published + item.published,
      }),
      { total: 0, drafts: 0, published: 0 },
    );

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
        fingerprint: ctx.services.content.schemaFingerprint(),
        contentVersion: ctx.services.content.contentVersion(),
        totals: stats.totals,
        kinds: stats.kinds,
        relations: stats.relations,
        // Entry counts alongside the shape, because "8 fields, 0 entries" is
        // the pair that tells an editor a collection was never filled in.
        collections: stats.collections.map((item) => ({
          ...item,
          entries: counts[item.name] ?? { total: 0, drafts: 0, published: 0 },
        })),
        globals: stats.globals,
      },
      storage: {
        entries,
        revisions: ctx.repositories.revisions.count(),
        users: ctx.repositories.users.count(),
        database: {
          version: databaseVersion(ctx.db),
          bytes: databaseBytes === null ? null : databaseBytes + (walBytes ?? 0),
        },
        media: {
          files: usage.files,
          bytes: usage.bytes,
          readable: formatBytes(usage.bytes),
        },
      },
      publisher: ctx.publisher.status(),
      deployment:
        c.get("user").role === "admin"
          ? {
              baseUrl: config.CMS_BASE_URL,
              schemaPath: config.schemaPath,
              dataDir: config.dataDir,
              databasePath: config.databasePath,
              mediaDir: config.mediaDir,
              logLevel: config.LOG_LEVEL,
              maxUploadBytes: config.MAX_UPLOAD_BYTES,
              maxUploadReadable: formatBytes(config.MAX_UPLOAD_BYTES),
              sessionTtlHours: config.SESSION_TTL_HOURS,
              sessionIdleHours: config.SESSION_IDLE_HOURS,
              publishDebounceMs: config.PUBLISH_DEBOUNCE_MS,
              trustProxy: config.TRUST_PROXY,
              cookieSecure: config.cookieSecure,
              adminOrigins: config.adminOrigins,
              buildWebhookConfigured: Boolean(config.BUILD_WEBHOOK_URL),
              buildWebhookSigned: Boolean(config.BUILD_WEBHOOK_SECRET),
              /** Names of the secrets this process generated for itself. */
              generatedSecrets: (config as { devSecrets?: string[] }).devSecrets ?? [],
              memoryBytes: process.memoryUsage().rss,
            }
          : null,
    });
  });

  /** "Rebuild the website now" — publishes without any content change. */
  app.post("/publish", async (c) => {
    const ctx = c.get("ctx");
    await ctx.publisher.publish({ type: "manual", actor: actorOf(c) });
    await ctx.publisher.flush();

    c.get("logger").info("Manual publish triggered", { by: c.get("user").id });
    return c.json({ ok: true, publisher: ctx.publisher.status() });
  });

  app.get("/publish/status", (c) => c.json(c.get("ctx").publisher.status()));

  return app;
}
