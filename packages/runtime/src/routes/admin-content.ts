/**
 * Admin routes for entries and singletons. The content store holds every rule;
 * these routes only parse and serialize. The API path is the repository path,
 * Git is the history, and `revision` makes concurrent edits safe.
 */

import { ReadOnlyError, ValidationError } from "../services/content-store.js";
import { ConflictError } from "../workspace/files.js";
import { compareEntries, entryFolder, entryTitle } from "@micacms/core";
import { Hono } from "hono";
import { z } from "zod";

import { ApiError, badRequest, notFound } from "../lib/errors.js";
import { editorOf, type Env } from "../http.js";

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

const reorderSchema = z.object({ slugs: z.array(z.string().min(1)).max(2000) });

async function jsonBody(c: { req: { json(): Promise<unknown> } }): Promise<unknown> {
  return c.req.json().catch(() => {
    throw badRequest("The request body must be valid JSON.");
  });
}

/** Maps a conflict to 409 and a validation failure to 422; other errors go to the error handler. */
async function handled<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    if (error instanceof ConflictError || error instanceof ReadOnlyError) {
      throw new ApiError("conflict", error.message);
    }
    if (error instanceof ValidationError) {
      throw new ApiError("validation_failed", error.message, { issues: error.issues });
    }
    throw error;
  }
}

export function adminContentRoutes(): Hono<Env> {
  const app = new Hono<Env>();

  app.get("/collections/:collection/entries", async (c) => {
    const { content } = c.get("ctx").services;
    const collection = c.req.param("collection");
    const def = content.requireCollection(collection);

    const entries = await handled(() => content.list(collection));
    const search = c.req.query("search")?.trim().toLowerCase();

    const items = entries
      .map((entry) => ({
        slug: entry.slug,
        position: entry.position,
        title: entryTitle(def, entry.data),
        data: entry.data,
      }))
      // Content trees are small, so an in-memory substring match is sufficient.
      .filter((item) => !search || JSON.stringify(item.data).toLowerCase().includes(search))
      .sort(compareEntries(def));

    return c.json({ items, total: items.length });
  });

  app.post("/collections/:collection/entries", async (c) => {
    const { content } = c.get("ctx").services;
    const parsed = saveSchema.safeParse(await jsonBody(c));
    if (!parsed.success) throw badRequest("The entry payload is malformed.");

    const saved = await handled(() =>
      content.save(c.req.param("collection"), {
        data: parsed.data.data,
        expectedRevision: parsed.data.revision ?? null,
      }),
    );

    return c.json(saved, 201);
  });

  app.post("/collections/:collection/reorder", async (c) => {
    const { content } = c.get("ctx").services;
    const parsed = reorderSchema.safeParse(await jsonBody(c));
    if (!parsed.success) throw badRequest("Expected a list of entry slugs.");

    await handled(() => content.reorder(c.req.param("collection"), parsed.data.slugs));
    return c.json({ ok: true });
  });

  /** Server-side slug generation, so the URL preview matches what is saved. */
  app.get("/collections/:collection/slug", async (c) => {
    const { content } = c.get("ctx").services;
    const source = c.req.query("source") ?? "";
    if (!source.trim()) return c.json({ slug: "" });

    return c.json({
      slug: await handled(() =>
        content.suggestSlug(c.req.param("collection"), source, c.req.query("except")),
      ),
    });
  });

  app.get("/collections/:collection/entries/:slug", async (c) => {
    const { content } = c.get("ctx").services;
    const collection = c.req.param("collection");
    const slug = c.req.param("slug");

    const entry = await handled(() => content.get(collection, slug));
    if (!entry) throw notFound("This entry no longer exists.");

    const def = content.requireCollection(collection);

    return c.json({
      collection,
      slug: entry.slug,
      title: entryTitle(def, entry.data),
      data: entry.data,
      path: entryFolder(collection, entry.slug),
      revision: await content.revisionOf(collection, slug),
    });
  });

  app.put("/collections/:collection/entries/:slug", async (c) => {
    const { content } = c.get("ctx").services;
    const parsed = saveSchema.safeParse(await jsonBody(c));
    if (!parsed.success) throw badRequest("The entry payload is malformed.");

    const saved = await handled(() =>
      content.save(c.req.param("collection"), {
        data: parsed.data.data,
        slug: c.req.param("slug"),
        expectedRevision: parsed.data.revision,
        ...(parsed.data.updateLinks ? { updateLinks: true } : {}),
      }),
    );
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

    await handled(() =>
      content.remove(c.req.param("collection"), c.req.param("slug")),
    );

    return c.json({ ok: true });
  });

  /** Entries elsewhere that point at this one — shown before a delete. */
  app.get("/collections/:collection/entries/:slug/references", async (c) => {
    const { content } = c.get("ctx").services;
    const references = await handled(() =>
      content.findReferences(c.req.param("collection"), c.req.param("slug")),
    );

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
      data: await handled(() => content.getSingleton(name)),
      revision: await content.revisionOfSingleton(name),
    });
  });

  app.put("/singletons/:name", async (c) => {
    const { content } = c.get("ctx").services;
    const body = (await jsonBody(c)) as { data?: unknown; revision?: string | null; keepMine?: boolean };

    const saved = await handled(() =>
      content.saveSingleton(c.req.param("name"), body?.data ?? {}, {
        expectedRevision: body?.revision,
      }),
    );
    if (body?.keepMine === true) {
      c.get("ctx").logger.info("Kept own version over a newer save", { singleton: c.req.param("name"), editor: editorOf(c) });
    }

    return c.json(saved);
  });

  return app;
}
