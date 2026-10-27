/**
 * Schema, dashboard and system information. The SPA knows no collection; it
 * renders what `/schema` returns.
 */

import { Hono } from "hono";

import { listedFields, readReferenceIndex, resolveIdField, resolveTitleField, siteLocales, type Site } from "@micacms/core/internal";

import type { Env } from "../http.js";
import { ApiError } from "../lib/errors.js";
import { schemaStats } from "../lib/schema-stats.js";
import { schemaOrigin } from "../schema.js";
import { recentProblems } from "../lib/logger.js";
import { VERSION } from "../lib/version.js";
import { formatBytes } from "../services/media.js";
import type { Overview, Schema, SystemInfo } from "./responses.js";

export function adminSystemRoutes(): Hono<Env> {
  const app = new Hono<Env>();

  /** The content model, plus the derived values that the UI would otherwise recompute. */
  /** The id and title of each item of a reference set, from its index beside the model. */
  app.get("/references/:name", async (c) => {
    const { site } = c.get("ctx");
    const name = c.req.param("name");
    const def = Object.hasOwn(site.model.references ?? {}, name) ? site.model.references![name] : undefined;
    if (!def) throw new ApiError("not_found", `There is no reference set "${name}".`);
    let items;
    try {
      items = await readReferenceIndex(site.contentRepository, name);
    } catch (error) {
      throw new ApiError("conflict", `The index of ${def.label} cannot be read: ${(error as Error).message}`);
    }
    if (!items) throw new ApiError("not_found", `${def.label} has no index yet. Build the website, and commit .mica/references/${name}.json.`);
    return c.json({ items });
  });

  /** The dev server that shows the drafts, for "Preview", and the token that lets the browser into it when it is on another origin. */
  app.get("/preview", async (c) => {
    const ctx = c.get("ctx");
    // The lines are for the System page: the editor asks here again while the preview starts.
    const { lines: _lines, ...status } = await ctx.preview();
    const address = status.state === "live" ? status.address : null;
    return c.json({ ...status, address, handover: address && ctx.previewHandover ? ctx.previewHandover(c) : null });
  });

  app.get("/schema", (c) => {
    const { site, config } = c.get("ctx");
    /** The full address of a page, with the names of a collection's `url`, such as `{id}`; null without both parts. */
    const page = (url: string | undefined) => (url && config.MICA_SITE_URL ? `${config.MICA_SITE_URL}${url}` : null);

    return c.json({
      site: { label: site.model.label ?? null, url: config.MICA_SITE_URL ?? null, locales: schemaLocales(site.model) },
      collections: Object.values(site.model.collections).map((def) => ({
        name: def.name,
        label: def.label,
        labelSingular: def.labelSingular ?? def.label,
        description: def.description ?? null,
        sortable: def.sortable ?? false,
        defaultSort: def.defaultSort ?? null,
        titleField: resolveTitleField(def) ?? null,
        idField: resolveIdField(def) ?? null,
        listedFields: listedFields(def),
        fields: def.fields,
        url: def.url ?? null,
        page: page(def.url),
        readOnly: site.readOnly.get(`collections.${def.name}`) ?? null,
      })),
      singletons: Object.values(site.model.singletons).map((def) => ({
        name: def.name,
        label: def.label,
        description: def.description ?? null,
        fields: def.fields,
        url: def.url ?? null,
        page: page(def.url),
        readOnly: site.readOnly.get(`singletons.${def.name}`) ?? null,
      })),
      /** Data that relations point to and Mica never edits; its items come from `/references/:name`. */
      references: Object.values(site.model.references ?? {}).map((def) => ({ name: def.name, label: def.label })),
      /** Which model this is, so that a page can tell that a newer one is in use. */
      revision: site.schemaRevision,
    } satisfies Schema);
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
    } satisfies Overview);
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
        baseUrl: config.MICA_PUBLIC_URL,
        schemaOrigin: schemaOrigin(ctx.site.contentRepository),
        // A clone that Mica keeps names its remote in `repository.url` instead.
        contentRoot: repository.owner === "developer" ? config.contentRoot : null,
        dataDir: operational.dataDir ?? null,
        logLevel: config.MICA_LOG_LEVEL,
        maxUploadBytes: config.MICA_MAX_UPLOAD_BYTES,
        maxUploadReadable: formatBytes(config.MICA_MAX_UPLOAD_BYTES),
        auth: operational.auth,
        admission: operational.admission ?? null,
        facts: operational.facts ?? [],
        trustProxy: config.MICA_TRUST_PROXY,
        adminOrigins: config.adminOrigins,
        memoryBytes: process.memoryUsage().rss,
      },
      problems: recentProblems(),
      preview: await ctx.preview(),
    } satisfies SystemInfo);
  });

  return app;
}

/** The locales for the editor's language switcher, the default locale first. */
function schemaLocales(model: Site): Schema["site"]["locales"] {
  const locales = siteLocales(model);
  if (!locales) return null;
  const list = [locales.defaultLocale, ...locales.locales.filter((locale) => locale !== locales.defaultLocale)];
  return { list, default: locales.defaultLocale, fallback: locales.fallback };
}
