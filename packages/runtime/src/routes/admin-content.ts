/**
 * Admin routes for entries and singletons. The content store holds every rule;
 * these routes only parse and serialize. The API path is the repository path,
 * Git is the history, and `revision` makes concurrent edits safe.
 */

import { compareEntries, entryFolder, entryTitle } from "@micacms/core/internal";
import { Hono } from "hono";
import { z } from "zod";

import { badRequest, notFound } from "../lib/errors.js";
import { editorOf, type Env } from "../http.js";
import type { EntryDetail, EntrySummary, SingletonDetail } from "./responses.js";

const saveSchema = z.object({
  data: z.record(z.string(), z.unknown()),
  slug: z.string().max(120).optional(),
  /**
   * The revision the editor opened. `null` asserts that the entry does not
   * exist, so two parallel creates cannot overwrite.
   */
  revision: z.string().nullable().optional(),
  /** The editor saw that a colleague saved since, and chose to save over it. Logged. */
  keepMine: z.boolean().optional(),
  /** On a URL change: other entries and settings pages that link here follow the new URL. */
  updateLinks: z.boolean().optional(),
});

const singletonSchema = z.object({
  data: z.record(z.string(), z.unknown()),
  /** The revision the editor opened; absent writes unconditionally. */
  revision: z.string().nullable().optional(),
  /** The editor saw that a colleague saved since, and chose to save over it. Logged. */
  keepMine: z.boolean().optional(),
});

const reorderSchema = z.object({
  slugs: z.array(z.string().min(1)).max(2000),
  /** The revision of the order the editor saw; `null`: the collection had no order file. */
  revision: z.string().nullable(),
});

async function jsonBody(c: { req: { json(): Promise<unknown> } }): Promise<unknown> {
  return c.req.json().catch(() => {
    throw badRequest("The request body must be valid JSON.");
  });
}

export function adminContentRoutes(): Hono<Env> {
  const app = new Hono<Env>();

  app.get("/collections/:collection/entries", async (c) => {
    const { content } = c.get("ctx").services;
    const collection = c.req.param("collection");
    const def = content.requireCollection(collection);

    // Before the list: the revision is never newer than the order the editor sees.
    const orderRevision = await content.orderRevision(collection);
    const items = (await content.list(collection))
      .map((entry): EntrySummary => ({
        slug: entry.slug,
        position: entry.position,
        title: entryTitle(def, entry.data),
        data: entry.data,
      }))
      .sort(compareEntries(def));

    return c.json({ items, total: items.length, orderRevision });
  });

  app.post("/collections/:collection/entries", async (c) => {
    const { content } = c.get("ctx").services;
    const parsed = saveSchema.safeParse(await jsonBody(c));
    if (!parsed.success) throw badRequest("The entry payload is malformed.");

    const saved = await content.save(c.req.param("collection"), {
      data: parsed.data.data,
      expectedRevision: parsed.data.revision ?? null,
    });

    return c.json(saved, 201);
  });

  app.post("/collections/:collection/reorder", async (c) => {
    const { content } = c.get("ctx").services;
    const parsed = reorderSchema.safeParse(await jsonBody(c));
    if (!parsed.success) throw badRequest("Expected a list of entry slugs and the revision of the order.");

    const revision = await content.reorder(c.req.param("collection"), parsed.data.slugs, parsed.data.revision);
    return c.json({ ok: true, revision });
  });

  /** Server-side slug generation, so the URL preview matches what is saved. */
  app.get("/collections/:collection/slug", async (c) => {
    const { content } = c.get("ctx").services;
    const source = c.req.query("source") ?? "";
    if (!source.trim()) return c.json({ slug: "" });

    return c.json({
      slug: await content.suggestSlug(c.req.param("collection"), source, c.req.query("except")),
    });
  });

  app.get("/collections/:collection/entries/:slug", async (c) => {
    const { content } = c.get("ctx").services;
    const collection = c.req.param("collection");
    const slug = c.req.param("slug");

    const entry = await content.get(collection, slug);
    if (!entry) throw notFound("This entry no longer exists.");

    const def = content.requireCollection(collection);

    return c.json({
      collection,
      slug: entry.slug,
      title: entryTitle(def, entry.data),
      data: entry.data,
      path: entryFolder(collection, entry.slug),
      revision: await content.revisionOf(collection, slug),
    } satisfies EntryDetail);
  });

  app.put("/collections/:collection/entries/:slug", async (c) => {
    const { content } = c.get("ctx").services;
    const parsed = saveSchema.safeParse(await jsonBody(c));
    if (!parsed.success) throw badRequest("The entry payload is malformed.");

    const saved = await content.save(c.req.param("collection"), {
      data: parsed.data.data,
      slug: c.req.param("slug"),
      expectedRevision: parsed.data.revision,
      ...(parsed.data.updateLinks ? { updateLinks: true } : {}),
    });
    if (parsed.data.keepMine) {
      c.get("ctx").logger.info("Kept own version over a newer save", {
        entry: `${c.req.param("collection")}/${c.req.param("slug")}`,
        editor: editorOf(c),
      });
    }

    return c.json(saved);
  });

  app.delete("/collections/:collection/entries/:slug", async (c) => {
    const { content } = c.get("ctx").services;

    // The revision the editor saw: a colleague's later save is not deleted unseen.
    const revision = c.req.query("revision");
    if (!revision) throw badRequest("Send the revision of the entry that you delete.");
    await content.remove(c.req.param("collection"), c.req.param("slug"), { expectedRevision: revision });

    return c.json({ ok: true });
  });

  /** Entries elsewhere that point at this one — shown before a delete. */
  app.get("/collections/:collection/entries/:slug/references", async (c) => {
    const { content } = c.get("ctx").services;
    const references = await content.findReferences(c.req.param("collection"), c.req.param("slug"));

    return c.json({ references });
  });

  app.get("/singletons/:name", async (c) => {
    const { content } = c.get("ctx").services;
    const name = c.req.param("name");
    const def = content.requireSingleton(name);

    return c.json({
      name,
      label: def.label,
      path: entryFolder(name),
      data: await content.getSingleton(name),
      revision: await content.revisionOfSingleton(name),
    } satisfies SingletonDetail);
  });

  app.put("/singletons/:name", async (c) => {
    const { content } = c.get("ctx").services;
    const parsed = singletonSchema.safeParse(await jsonBody(c));
    if (!parsed.success) throw badRequest("The settings payload is malformed.");

    const saved = await content.saveSingleton(c.req.param("name"), parsed.data.data, {
      expectedRevision: parsed.data.revision,
    });
    if (parsed.data.keepMine === true) {
      c.get("ctx").logger.info("Kept own version over a newer save", { singleton: c.req.param("name"), editor: editorOf(c) });
    }

    return c.json(saved);
  });

  return app;
}
