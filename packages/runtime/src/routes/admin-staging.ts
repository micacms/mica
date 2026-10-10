/**
 * Admin staging routes — the pending change set, and Publish.
 *
 * Thin, like the content routes: the two staging implementations own every
 * rule, and what happens here is parsing and the mapping of their refusals
 * onto the API's error envelope.
 *
 * `committed-pending-push` is a 200, deliberately. The commit is real and the
 * state is recoverable by design; an error status would make the editor treat
 * a publication that half-happened as one that did not happen at all.
 */

import { ConflictError } from "@micacms/connectors";
import { Hono } from "hono";
import { z } from "zod";

import { ApiError, badRequest } from "../lib/errors.js";
import { actorOf, type Env } from "../http.js";

const publishSchema = z.object({
  message: z.string().max(500),
  /** The base revision the editor reviewed. Null where the workspace has none. */
  expectedBase: z.string().nullable().optional(),
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

    return c.json(await staging.compare(parsed.data));
  });

  app.post("/publish", async (c) => {
    const { staging } = c.get("ctx").services;
    const parsed = publishSchema.safeParse(await jsonBody(c));
    if (!parsed.success) throw badRequest("The publish payload is malformed.");

    const actor = actorOf(c);
    const result = await handled(() =>
      staging.publish({
        message: parsed.data.message,
        expectedBase: parsed.data.expectedBase ?? null,
        author: actor ? { name: actor.email, email: actor.email } : undefined,
      }),
    );

    return c.json(result);
  });

  app.post("/publish/push", async (c) => {
    const { staging } = c.get("ctx").services;
    return c.json(await handled(() => staging.push()));
  });

  app.post("/changes/discard", async (c) => {
    const { staging } = c.get("ctx").services;
    const parsed = discardSchema.safeParse(await jsonBody(c));
    if (!parsed.success) throw badRequest("Expected a list of change paths.");

    return c.json(await handled(() => staging.discard(parsed.data.paths)));
  });

  return app;
}
