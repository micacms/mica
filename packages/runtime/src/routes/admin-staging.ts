/**
 * Admin routes for the pending changes and Publish. Sync and conflict
 * resolution exist only for a clone that Mica keeps. `committed-pending-push`
 * is a 200: the commit is real, and an error status would tell the editor that
 * nothing happened.
 */

import { Hono } from "hono";
import { z } from "zod";

import { actorOf, editorOf, type Env } from "../http.js";
import { badRequest } from "../lib/errors.js";
import { apiErrorOf } from "../middleware/index.js";
import { publishChanges } from "../services/publish.js";
import type { ChangesResponse, CompareManyResponse, ModelState } from "./responses.js";

const publishSchema = z.object({
  message: z.string().max(500),
  /** The reviewed paths, with the revision each had in the review. */
  paths: z.record(z.string().min(1), z.string().nullable()),
});

const resolveSchema = z.object({
  group: z.string().min(1),
  choice: z.enum(["mine", "website"]),
});

/** The reviewed paths, with the revision each had in the review: the check of Publish. */
const discardSchema = z.object({ paths: z.record(z.string().min(1), z.string().nullable()) });

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

/** The most documents that one request compares. The Publish page sends as many (`useComparisons`). */
export const COMPARE_BATCH = 25;

const compareManySchema = z.array(compareSchema).min(1).max(COMPARE_BATCH);

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

async function jsonBody(c: { req: { json(): Promise<unknown> } }): Promise<unknown> {
  return c.req.json().catch(() => {
    throw badRequest("The request body must be valid JSON.");
  });
}

/** Which model is in use, so that the editor can tell a stale form, and why a newer one is not. */
function modelState(ctx: Env["Variables"]["ctx"]): ModelState {
  return { revision: ctx.site.schemaRevision, warning: ctx.site.modelWarning?.message ?? null };
}

export function adminStagingRoutes(): Hono<Env> {
  const app = new Hono<Env>();

  app.get("/changes", async (c) => {
    const ctx = c.get("ctx");
    return c.json({ ...(await ctx.services.staging.status()), model: modelState(ctx) } satisfies ChangesResponse);
  });

  // Raw data before and after one pending change; the editor renders the comparison.
  // With `targets`, a JSON list, many at once: the Publish page compares the rows on the screen with one status of the files.
  app.get("/changes/compare", async (c) => {
    const { staging } = c.get("ctx").services;
    const against = c.req.query("against") === "origin" ? "origin" : "head";
    const targets = c.req.query("targets");
    if (targets !== undefined) {
      const many = compareManySchema.safeParse(parseJson(targets));
      if (!many.success) throw badRequest("The compare targets are malformed.");
      const results = await staging.compareMany(many.data, against);
      const logger = c.get("logger") ?? c.get("ctx").logger;
      return c.json({
        comparisons: results.map((result) => {
          if (result.status === "fulfilled") return { comparison: result.value };
          const refused = apiErrorOf(result.reason);
          if (!refused) logger.error("Unhandled error", { error: String(result.reason) });
          return { error: refused?.message ?? "Mica could not compare this change." };
        }),
      } satisfies CompareManyResponse);
    }
    const parsed = compareSchema.safeParse({
      kind: c.req.query("kind"),
      collection: c.req.query("collection"),
      slug: c.req.query("slug"),
      from: c.req.query("from"),
      name: c.req.query("name"),
    });
    if (!parsed.success) throw badRequest("The compare target is malformed.");

    return c.json(await staging.compare(parsed.data, against));
  });

  app.post("/publish", async (c) => {
    const parsed = publishSchema.safeParse(await jsonBody(c));
    if (!parsed.success) throw badRequest("The publish payload is malformed.");

    const actor = actorOf(c);
    const result = await publishChanges(c.get("ctx"), {
      message: parsed.data.message,
      paths: parsed.data.paths,
      author: actor ? { name: actor.name || actor.email, email: actor.email } : undefined,
      editor: editorOf(c),
    });

    return c.json(result);
  });

  app.post("/publish/push", async (c) => {
    const { staging } = c.get("ctx").services;
    return c.json(await staging.push());
  });

  // "Try again" after a sync error.
  app.post("/sync", async (c) => {
    const { staging } = c.get("ctx").services;
    await staging.sync();
    return c.json({ ...(await staging.status()), model: modelState(c.get("ctx")) });
  });

  app.post("/changes/resolve", async (c) => {
    const { staging } = c.get("ctx").services;
    const parsed = resolveSchema.safeParse(await jsonBody(c));
    if (!parsed.success) throw badRequest("Expected a group and a choice: mine or website.");

    await staging.resolve(parsed.data.group, parsed.data.choice, editorOf(c));
    return c.json({ ...(await staging.status()), model: modelState(c.get("ctx")) });
  });

  app.post("/changes/discard", async (c) => {
    const { staging } = c.get("ctx").services;
    const parsed = discardSchema.safeParse(await jsonBody(c));
    if (!parsed.success || Object.keys(parsed.data.paths).length === 0) throw badRequest("Expected the reviewed paths with their revisions.");

    return c.json(await staging.discard(parsed.data.paths, editorOf(c)));
  });

  return app;
}
