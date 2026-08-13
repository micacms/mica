/**
 * Media library routes.
 */

import { Hono } from "hono";
import { z } from "zod";

import { badRequest, notFound } from "../lib/errors.js";
import { intParam, type Env } from "../http.js";
import { toMediaRef } from "../services/content.js";

const patchSchema = z.object({
  filename: z.string().trim().min(1).max(150).optional(),
  altText: z.string().max(500).optional(),
});

export function adminMediaRoutes(): Hono<Env> {
  const app = new Hono<Env>();

  app.get("/", (c) => {
    const ctx = c.get("ctx");
    const { items, total } = ctx.repositories.media.list({
      search: c.req.query("search"),
      image: c.req.query("image") === "true",
      limit: intParam(c.req.query("limit"), 60, 200),
      offset: intParam(c.req.query("offset"), 0, 100_000),
    });

    // One pass over the payloads answers "is this still in use?" for the page.
    const referenced = ctx.services.media.usageFlags();

    return c.json({
      items: items.map((record) => ({
        ...toMediaRef(record, ctx.config.CMS_BASE_URL),
        createdAt: record.createdAt,
        inUse: referenced.has(record.id),
      })),
      total,
    });
  });

  app.post("/", async (c) => {
    const ctx = c.get("ctx");

    const form = await c.req.parseBody({ all: true }).catch(() => {
      throw badRequest("Expected a multipart upload.");
    });

    const raw = form["file"];
    const files = (Array.isArray(raw) ? raw : [raw]).filter(
      (item): item is File => item instanceof File,
    );

    if (files.length === 0) throw badRequest("No file was uploaded.");
    if (files.length > 20) throw badRequest("Upload at most 20 files at a time.");

    const acceptValue = form["accept"];
    const accept =
      acceptValue === "image" || acceptValue === "document" || acceptValue === "any"
        ? acceptValue
        : "any";

    const uploaded = [];
    for (const file of files) {
      const { record } = await ctx.services.media.upload({
        file,
        accept,
        userId: c.get("user").id,
      });
      uploaded.push(toMediaRef(record, ctx.config.CMS_BASE_URL));
    }

    return c.json({ items: uploaded }, 201);
  });

  app.patch("/:id", async (c) => {
    const ctx = c.get("ctx");
    const parsed = patchSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) throw badRequest("Provide a filename or alt text.");

    const record = ctx.repositories.media.update(c.req.param("id"), parsed.data);
    if (!record) throw notFound("This file no longer exists.");

    return c.json(toMediaRef(record, ctx.config.CMS_BASE_URL));
  });

  app.delete("/:id", async (c) => {
    const ctx = c.get("ctx");
    const id = c.req.param("id");

    // Deleting a referenced asset leaves a gap on the live site, so it takes a
    // deliberate `?force=true` from a UI that has shown the warning.
    if (c.req.query("force") !== "true" && ctx.services.media.usageFlags().has(id)) {
      return c.json(
        {
          error: {
            code: "conflict" as const,
            message: "This file is still used by published content.",
          },
        },
        409,
      );
    }

    await ctx.services.media.delete(id);
    return c.json({ ok: true });
  });

  return app;
}
