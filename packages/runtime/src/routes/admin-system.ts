/**
 * Schema, dashboard and system information. The SPA knows no collection; it
 * renders what `/schema` returns.
 */

import { Hono } from "hono";

import { listedFields, resolveSlugField, resolveTitleField } from "@micacms/core/internal";

import type { Env } from "../http.js";
import { schemaStats } from "../lib/schema-stats.js";
import { schemaOrigin } from "../schema.js";
import { VERSION } from "../lib/version.js";
import { formatBytes } from "../services/media.js";

export function adminSystemRoutes(): Hono<Env> {
  const app = new Hono<Env>();

  /** The content model, plus the derived values that the UI would otherwise recompute. */
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
        readOnly: site.readOnly.get(`collections.${def.name}`) ?? null,
      })),
      singletons: Object.values(site.model.singletons).map((def) => ({
        name: def.name,
        label: def.label,
        description: def.description ?? null,
        fields: def.fields,
        readOnly: site.readOnly.get(`singletons.${def.name}`) ?? null,
      })),
      /** Which model this is, so that a page can tell that a newer one is in use. */
      revision: site.schemaRevision,
    });
  });

  app.get("/overview", async (c) => {
    const ctx = c.get("ctx");
    const { content, media } = ctx.services;

    const collections = await Promise.all(
      Object.values(ctx.site.model.collections).map(async (def) => ({
        name: def.name,
        label: def.label,
        total: await content.count(def.name),
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
   * What this deployment is and serves. Every admitted editor sees it, because
   * there is no administrator role. It never returns a secret value.
   */
  app.get("/system", async (c) => {
    const ctx = c.get("ctx");
    const { config } = ctx;

    const stats = schemaStats(ctx.site.model);

    const counts = Object.fromEntries(
      await Promise.all(
        Object.values(ctx.site.model.collections).map(
          async (def) => [def.name, await ctx.services.content.count(def.name)] as const,
        ),
      ),
    );

    const files = await ctx.services.media.list();
    const mediaBytes = files.reduce((sum, file) => sum + file.size, 0);

    const uptimeSeconds = Math.floor(process.uptime());

    const operational = ctx.operational();
    const repository = await ctx.services.staging.repository();

    return c.json({
      cms: {
        version: VERSION,
        mode: repository.owner === "managed" ? "self-hosted" : "local editor",
        node: process.version,
        platform: `${process.platform}/${process.arch}`,
        startedAt: new Date(Date.now() - uptimeSeconds * 1000).toISOString(),
        uptimeSeconds,
      },
      schema: {
        totals: stats.totals,
        kinds: stats.kinds,
        relations: stats.relations,
        collections: stats.collections.map((item) => ({
          ...item,
          entries: counts[item.name] ?? 0,
        })),
        singletons: stats.singletons,
        /** Why a newer model in the working tree is not in use, or null. */
        warning: ctx.site.modelWarning?.message ?? null,
      },
      repository: {
        origin: ctx.site.contentRepository.origin,
        entries: Object.values(counts).reduce((sum, count) => sum + count, 0),
        media: { files: files.length, bytes: mediaBytes, readable: formatBytes(mediaBytes) },
        ...repository,
      },
      deployment: {
        site: ctx.site.id,
        baseUrl: config.MICA_PUBLIC_URL,
        schemaOrigin: schemaOrigin(ctx.site.contentRepository),
        // A clone that Mica keeps names its remote in `repository.url` instead.
        contentRoot: repository.owner === "developer" ? config.contentRoot : null,
        dataDir: operational.dataDir ?? null,
        logLevel: config.MICA_LOG_LEVEL,
        maxUploadBytes: config.MICA_MAX_UPLOAD_BYTES,
        maxUploadReadable: formatBytes(config.MICA_MAX_UPLOAD_BYTES),
        sessionTtlHours: operational.sessionTtlHours ?? null,
        sessionIdleHours: operational.sessionIdleHours ?? null,
        auth: operational.auth,
        admission: operational.admission ?? null,
        trustProxy: config.MICA_TRUST_PROXY,
        adminOrigins: config.adminOrigins,
        memoryBytes: process.memoryUsage().rss,
      },
    });
  });

  return app;
}
