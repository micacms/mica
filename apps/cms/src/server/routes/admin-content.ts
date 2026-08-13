/**
 * Admin content routes — entries, revisions and singletons.
 *
 * These are thin: parse, delegate to the content service, serialise. All the
 * rules about validation, revisions and publishing live in the service.
 */

import { Hono } from "hono";
import { z } from "zod";

import { badRequest } from "../lib/errors.js";
import { actorOf, intParam, type Env } from "../http.js";

const saveSchema = z.object({
  data: z.record(z.unknown()),
  status: z.enum(["draft", "published"]).optional(),
  slug: z.string().max(120).optional(),
});

const statusSchema = z.object({ status: z.enum(["draft", "published"]) });
const reorderSchema = z.object({ ids: z.array(z.string().min(1)).max(2000) });

async function jsonBody(c: { req: { json(): Promise<unknown> } }): Promise<unknown> {
  return c.req.json().catch(() => {
    throw badRequest("The request body must be valid JSON.");
  });
}

export function adminContentRoutes(): Hono<Env> {
  const app = new Hono<Env>();

  /* ------------------------------------------------------------ entries */

  app.get("/collections/:collection/entries", (c) => {
    const { content } = c.get("ctx").services;
    const statusParam = c.req.query("status");

    const result = content.listEntries(c.req.param("collection"), {
      status: statusParam === "draft" || statusParam === "published" ? statusParam : undefined,
      search: c.req.query("search"),
      limit: intParam(c.req.query("limit"), 50, 200),
      offset: intParam(c.req.query("offset"), 0, 100_000),
    });

    return c.json(result);
  });

  app.post("/collections/:collection/entries", async (c) => {
    const { content } = c.get("ctx").services;
    const parsed = saveSchema.safeParse(await jsonBody(c));
    if (!parsed.success) throw badRequest("The entry payload is malformed.");

    const entry = await content.createEntry(c.req.param("collection"), parsed.data, actorOf(c));
    return c.json(entry, 201);
  });

  app.post("/collections/:collection/reorder", async (c) => {
    const { content } = c.get("ctx").services;
    const parsed = reorderSchema.safeParse(await jsonBody(c));
    if (!parsed.success) throw badRequest("Expected a list of entry ids.");

    await content.reorderEntries(c.req.param("collection"), parsed.data.ids, actorOf(c));
    return c.json({ ok: true });
  });

  /** Server-side slug generation, so the URL preview matches what is saved. */
  app.get("/collections/:collection/slug", (c) => {
    const { content } = c.get("ctx").services;
    const source = c.req.query("source") ?? "";
    if (!source.trim()) return c.json({ slug: "" });

    return c.json({
      slug: content.suggestSlug(c.req.param("collection"), source, c.req.query("except")),
    });
  });

  app.get("/entries/:id", (c) => {
    const { content } = c.get("ctx").services;
    return c.json(content.getEntry(c.req.param("id")));
  });

  app.put("/entries/:id", async (c) => {
    const { content } = c.get("ctx").services;
    const parsed = saveSchema.safeParse(await jsonBody(c));
    if (!parsed.success) throw badRequest("The entry payload is malformed.");

    return c.json(await content.updateEntry(c.req.param("id"), parsed.data, actorOf(c)));
  });

  app.post("/entries/:id/status", async (c) => {
    const { content } = c.get("ctx").services;
    const parsed = statusSchema.safeParse(await jsonBody(c));
    if (!parsed.success) throw badRequest('Status must be "draft" or "published".');

    return c.json(await content.setEntryStatus(c.req.param("id"), parsed.data.status, actorOf(c)));
  });

  app.delete("/entries/:id", async (c) => {
    const { content } = c.get("ctx").services;
    await content.deleteEntry(c.req.param("id"), actorOf(c));
    return c.json({ ok: true });
  });

  /** Entries elsewhere that point at this one — shown before a delete. */
  app.get("/entries/:id/references", (c) => {
    const { content } = c.get("ctx").services;
    const entry = content.getEntry(c.req.param("id"));
    return c.json({ references: content.findReferences(entry.collection, entry.slug) });
  });

  /* ---------------------------------------------------------- revisions */

  app.get("/entries/:id/revisions", (c) => {
    const { content } = c.get("ctx").services;
    // Payloads are large and the list only needs the metadata.
    const revisions = content.listRevisions(c.req.param("id")).map(({ data: _data, ...rest }) => rest);
    return c.json({ revisions });
  });

  app.get("/entries/:id/revisions/:revisionId", (c) => {
    const { content } = c.get("ctx").services;
    const revision = content
      .listRevisions(c.req.param("id"))
      .find((item) => item.id === c.req.param("revisionId"));

    if (!revision) return c.json({ error: { code: "not_found", message: "No such revision." } }, 404);
    return c.json({ revision });
  });

  app.post("/entries/:id/revisions/:revisionId/restore", async (c) => {
    const { content } = c.get("ctx").services;
    return c.json(
      await content.restoreRevision(c.req.param("id"), c.req.param("revisionId"), actorOf(c)),
    );
  });

  /* ------------------------------------------------------------ globals */

  app.get("/globals/:name", (c) => {
    const { content } = c.get("ctx").services;
    return c.json(content.getGlobal(c.req.param("name")));
  });

  app.put("/globals/:name", async (c) => {
    const { content } = c.get("ctx").services;
    const body = (await jsonBody(c)) as { data?: unknown };
    return c.json(await content.saveGlobal(c.req.param("name"), body?.data ?? {}, actorOf(c)));
  });

  app.get("/globals/:name/revisions", (c) => {
    const { content } = c.get("ctx").services;
    const revisions = content
      .listGlobalRevisions(c.req.param("name"))
      .map(({ data: _data, ...rest }) => rest);
    return c.json({ revisions });
  });

  app.post("/globals/:name/revisions/:revisionId/restore", async (c) => {
    const { content } = c.get("ctx").services;
    return c.json(
      await content.restoreGlobalRevision(c.req.param("name"), c.req.param("revisionId"), actorOf(c)),
    );
  });

  return app;
}
