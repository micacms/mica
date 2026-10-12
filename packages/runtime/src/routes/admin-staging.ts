/**
 * Admin staging routes — the pending change set, and Publish.
 *
 * Thin, like the content routes: the staging service owns every rule, and
 * what happens here is parsing and the mapping of its refusals onto the API's
 * error envelope. Sync and conflict resolution exist only for a clone that
 * Mica keeps; the developer's checkout answers them with 404.
 *
 * `committed-pending-push` is a 200, deliberately. The commit is real and the
 * state is recoverable by design; an error status would make the editor treat
 * a publication that half-happened as one that did not happen at all.
 */

import { Hono } from "hono";
import { z } from "zod";

import { actorOf, type Env } from "../http.js";
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

  // The document one pending change touches, before and after that change —
  // raw data on both sides; the editor renders the comparison from the model.
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
        // The provider's name where it sends one; the address otherwise.
        author: actor ? { name: actor.name || actor.email, email: actor.email } : undefined,
      }),
    );

    return c.json(result);
  });

  app.post("/publish/push", async (c) => {
    const { staging } = c.get("ctx").services;
    return c.json(await handled(() => staging.push()));
  });

  // Brings a clone that Mica keeps up to date now: "Try again" after a sync error.
  app.post("/sync", async (c) => {
    const { staging } = c.get("ctx").services;
    await staging.sync();
    return c.json(await staging.status());
  });

  app.post("/changes/resolve", async (c) => {
    const { staging } = c.get("ctx").services;
    const parsed = resolveSchema.safeParse(await jsonBody(c));
    if (!parsed.success) throw badRequest("Expected a group and a choice: mine or website.");

    await handled(() => staging.resolve(parsed.data.group, parsed.data.choice));
    return c.json(await staging.status());
  });

  app.post("/changes/discard", async (c) => {
    const { staging } = c.get("ctx").services;
    const parsed = discardSchema.safeParse(await jsonBody(c));
    if (!parsed.success) throw badRequest("Expected a list of change paths.");

    return c.json(await handled(() => staging.discard(parsed.data.paths)));
  });

  return app;
}
