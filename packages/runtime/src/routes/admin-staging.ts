/**
 * Admin routes for the pending changes and Publish. Sync and conflict
 * resolution exist only for a clone that Mica keeps. `committed-pending-push`
 * is a 200: the commit is real, and an error status would tell the editor that
 * nothing happened.
 */

import { Hono } from "hono";
import { z } from "zod";

import { actorOf, editorOf, type Env } from "../http.js";
import { ApiError, badRequest } from "../lib/errors.js";
import { ConflictError } from "../workspace/files.js";

const publishSchema = z.object({
  message: z.string().max(500),
  /** The reviewed paths, with the revision each had in the review. */
  paths: z.record(z.string().min(1), z.string().nullable()),
});

const resolveSchema = z.object({
  group: z.string().min(1),
  choice: z.enum(["mine", "website"]),
});

const discardSchema = z.object({ paths: z.array(z.string().min(1)).min(1).max(2000) });

const compareSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("entry"),
    collection: z.string().min(1),
    slug: z.string().min(1),
    from: z.string().min(1).optional(),
  }),
  z.object({ kind: z.literal("singleton"), name: z.string().min(1) }),
  z.object({ kind: z.literal("order"), collection: z.string().min(1) }),
]);

async function jsonBody(c: { req: { json(): Promise<unknown> } }): Promise<unknown> {
  return c.req.json().catch(() => {
    throw badRequest("The request body must be valid JSON.");
  });
}

/** A repository conflict is 409 and recoverable — refresh, review, retry. */
async function handled<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    if (error instanceof ConflictError) throw new ApiError("conflict", error.message);
    throw error;
  }
}

export function adminStagingRoutes(): Hono<Env> {
  const app = new Hono<Env>();

  app.get("/changes", async (c) => {
    const { staging } = c.get("ctx").services;
    return c.json(await staging.status());
  });

  // Raw data before and after one pending change; the editor renders the comparison.
  app.get("/changes/compare", async (c) => {
    const { staging } = c.get("ctx").services;
    const parsed = compareSchema.safeParse({
      kind: c.req.query("kind"),
      collection: c.req.query("collection"),
      slug: c.req.query("slug"),
      from: c.req.query("from"),
      name: c.req.query("name"),
    });
    if (!parsed.success) throw badRequest("The compare target is malformed.");
    const against = c.req.query("against") === "origin" ? "origin" : "head";

    return c.json(await staging.compare(parsed.data, against));
  });

  app.post("/publish", async (c) => {
    const { staging } = c.get("ctx").services;
    const parsed = publishSchema.safeParse(await jsonBody(c));
    if (!parsed.success) throw badRequest("The publish payload is malformed.");

    const actor = actorOf(c);
    const result = await handled(() =>
      staging.publish({
        message: parsed.data.message,
        paths: parsed.data.paths,
        author: actor ? { name: actor.name || actor.email, email: actor.email } : undefined,
        editor: editorOf(c),
      }),
    );

    return c.json(result);
  });

  app.post("/publish/push", async (c) => {
    const { staging } = c.get("ctx").services;
    return c.json(await handled(() => staging.push()));
  });

  // "Try again" after a sync error.
  app.post("/sync", async (c) => {
    const { staging } = c.get("ctx").services;
    await staging.sync();
    return c.json(await staging.status());
  });

  app.post("/changes/resolve", async (c) => {
    const { staging } = c.get("ctx").services;
    const parsed = resolveSchema.safeParse(await jsonBody(c));
    if (!parsed.success) throw badRequest("Expected a group and a choice: mine or website.");

    await handled(() => staging.resolve(parsed.data.group, parsed.data.choice, editorOf(c)));
    return c.json(await staging.status());
  });

  app.post("/changes/discard", async (c) => {
    const { staging } = c.get("ctx").services;
    const parsed = discardSchema.safeParse(await jsonBody(c));
    if (!parsed.success) throw badRequest("Expected a list of change paths.");

    return c.json(await handled(() => staging.discard(parsed.data.paths, editorOf(c))));
  });

  return app;
}
