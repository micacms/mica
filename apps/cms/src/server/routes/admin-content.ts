/**
 * Admin content routes — entries and singletons.
 *
 * Thin: parse, delegate to the content store, serialise. Every rule about
 * validation, slugs and layout lives in the store, which is shared with the
 * Astro build rather than reimplemented here.
 *
 * Three things that used to be here are gone, and each is a deletion rather
 * than a move:
 *
 *   - An entry is addressed by `collection/slug`, not by a ULID. The path in
 *     the API is the path in the repository.
 *   - No revision endpoints. Git is the history.
 *   - No status endpoint. Committed is published; a draft is unsaved work in
 *     the editor and never reaches the server.
 *
 * What replaced them is `revision` — an opaque token identifying the version of
 * an entry the editor opened. Sending it back with a save is what makes
 * concurrent editing safe.
 */

import { ConflictError, ValidationError } from "@micacms/connectors";
import { collectionEntryPath, entryTitle, singletonPath } from "@micacms/model";
import { Hono } from "hono";
import { z } from "zod";

import { ApiError, badRequest, notFound } from "../lib/errors.js";
import { actorOf, type Env } from "../http.js";

const saveSchema = z.object({
  data: z.record(z.unknown()),
  slug: z.string().max(120).optional(),
  /**
   * The revision the editor opened. `null` asserts the entry did not exist,
   * which is what makes two simultaneous creates fail instead of one silently
   * overwriting the other.
   */
  revision: z.string().nullable().optional(),
});

const reorderSchema = z.object({ slugs: z.array(z.string().min(1)).max(2000) });

async function jsonBody(c: { req: { json(): Promise<unknown> } }): Promise<unknown> {
  return c.req.json().catch(() => {
    throw badRequest("The request body must be valid JSON.");
  });
}

/**
 * Turns a store failure into the HTTP answer it deserves.
 *
 * A conflict is 409 and is recoverable in the editor — reload and reapply. A
 * validation failure is 422 with the offending fields. Everything else is a
 * genuine fault and reaches the error handler unchanged.
 */
async function handled<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    if (error instanceof ConflictError) throw new ApiError("conflict", error.message);
    if (error instanceof ValidationError) {
      throw new ApiError("validation_failed", error.message, { issues: error.issues });
    }
    throw error;
  }
}

export function adminContentRoutes(): Hono<Env> {
  const app = new Hono<Env>();

  /* ------------------------------------------------------------ entries */

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
      // A substring match over the payload, which is what the SQL `LIKE` did.
      // Content trees are small enough that filtering in memory is simpler than
      // an index, and it can no longer disagree with what is on disk.
      .filter((item) => !search || JSON.stringify(item.data).toLowerCase().includes(search));

    return c.json({ items, total: items.length });
  });

  app.post("/collections/:collection/entries", async (c) => {
    const { content } = c.get("ctx").services;
    const parsed = saveSchema.safeParse(await jsonBody(c));
    if (!parsed.success) throw badRequest("The entry payload is malformed.");

    const saved = await handled(() =>
      content.save(c.req.param("collection"), {
        data: parsed.data.data,
        // A create asserts absence unless the client says otherwise.
        expectedRevision: parsed.data.revision ?? null,
        author: actorOf(c) ? { name: actorOf(c)!.email, email: actorOf(c)!.email } : undefined,
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
      position: entry.position,
      title: entryTitle(def, entry.data),
      data: entry.data,
      // Where this entry is on disk. Derived from the model, because whether an
      // entry is one file or a directory depends on whether it has rich text or
      // media — a rule the editor should not have to reimplement to show it.
      path: collectionEntryPath(def.fields, collection, entry.slug),
      // Sent back with the save. Without it the editor cannot tell the server
      // which version of the entry it was looking at.
      revision: await content.revisionOf(collection, slug),
    });
  });

  app.put("/collections/:collection/entries/:slug", async (c) => {
    const { content } = c.get("ctx").services;
    const parsed = saveSchema.safeParse(await jsonBody(c));
    if (!parsed.success) throw badRequest("The entry payload is malformed.");

    const actor = actorOf(c);
    const saved = await handled(() =>
      content.save(c.req.param("collection"), {
        data: parsed.data.data,
        slug: c.req.param("slug"),
        expectedRevision: parsed.data.revision,
        author: actor ? { name: actor.email, email: actor.email } : undefined,
      }),
    );

    return c.json(saved);
  });

  app.delete("/collections/:collection/entries/:slug", async (c) => {
    const { content } = c.get("ctx").services;
    const actor = actorOf(c);

    await handled(() =>
      content.remove(c.req.param("collection"), c.req.param("slug"), {
        author: actor ? { name: actor.email, email: actor.email } : undefined,
      }),
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

  /* --------------------------------------------------------- singletons */

  app.get("/singletons/:name", async (c) => {
    const { content } = c.get("ctx").services;
    const name = c.req.param("name");
    const def = content.requireSingleton(name);

    return c.json({
      name,
      label: def.label,
      path: singletonPath(def.fields, name),
      data: await handled(() => content.getSingleton(name)),
      revision: await content.revisionOfSingleton(name),
    });
  });

  app.put("/singletons/:name", async (c) => {
    const { content } = c.get("ctx").services;
    const body = (await jsonBody(c)) as { data?: unknown; revision?: string | null };
    const actor = actorOf(c);

    const saved = await handled(() =>
      content.saveSingleton(c.req.param("name"), body?.data ?? {}, {
        expectedRevision: body?.revision,
        author: actor ? { name: actor.email, email: actor.email } : undefined,
      }),
    );

    return c.json(saved);
  });

  return app;
}
