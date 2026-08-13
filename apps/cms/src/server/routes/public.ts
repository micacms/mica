/**
 * Public content API — the read-only surface the Astro build consumes.
 *
 * Three guarantees, all enforced here rather than trusted upstream:
 *   • a valid read token is required;
 *   • only published entries are returned;
 *   • payloads are validated against the model on the way out, so a build never
 *     ingests content that would fail its own collection schema.
 */

import { Hono } from "hono";

import { validateFields } from "@micacms/model";

import { ApiError } from "../lib/errors.js";
import type { Env } from "../http.js";

export function publicRoutes(): Hono<Env> {
  const app = new Hono<Env>();

  /** Cheap change token: a build can skip work when this has not moved. */
  app.get("/version", (c) => {
    const ctx = c.get("ctx");
    return c.json({
      version: ctx.services.content.contentVersion(),
      generatedAt: new Date().toISOString(),
    });
  });

  /**
   * Everything in one response.
   *
   * A site with eight collections would otherwise cost the loader nine round
   * trips per build; content volumes here are small enough that one payload is
   * both faster and simpler to make consistent.
   */
  app.get("/manifest", (c) => {
    const ctx = c.get("ctx");

    const collections: Record<string, unknown[]> = {};
    for (const name of Object.keys(ctx.site.collections)) {
      collections[name] = ctx.services.content.publicCollection(name);
    }

    const globals: Record<string, unknown> = {};
    for (const name of Object.keys(ctx.site.singletons)) {
      globals[name] = ctx.services.content.publicGlobal(name);
    }

    return c.json({
      version: ctx.services.content.contentVersion(),
      generatedAt: new Date().toISOString(),
      collections,
      globals,
    });
  });

  app.get("/content/:collection", (c) => {
    const ctx = c.get("ctx");
    const name = c.req.param("collection");
    const def = ctx.services.content.requireCollection(name);
    const entries = ctx.services.content.publicCollection(name);

    // Output-mode validation: media references must already be expanded.
    for (const entry of entries) {
      const result = validateFields(def.fields, entry.data, "output");
      if (!result.ok) {
        c.get("logger").error("Published entry fails its own schema", {
          collection: name,
          slug: entry.slug,
          issues: result.issues,
        });
        throw new ApiError(
          "internal_error",
          `Published entry "${entry.slug}" in "${name}" does not match the current content model.`,
        );
      }
    }

    return c.json({ items: entries, total: entries.length });
  });

  app.get("/content/:collection/:slug", (c) => {
    const ctx = c.get("ctx");
    return c.json(
      ctx.services.content.publicEntry(c.req.param("collection"), c.req.param("slug")),
    );
  });

  app.get("/globals/:name", (c) => {
    const ctx = c.get("ctx");
    return c.json(ctx.services.content.publicGlobal(c.req.param("name")));
  });

  return app;
}
