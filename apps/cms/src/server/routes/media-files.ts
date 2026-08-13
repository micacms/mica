/**
 * Media file serving.
 *
 * Public on purpose. These URLs end up in the static build, and the image
 * pipeline that fetches them during `astro build` cannot present a bearer
 * token. Keys are 26-character ULIDs, so an unpublished asset is unguessable
 * rather than access-controlled — which is documented in `docs/security.md`.
 *
 * Content is immutable: a new upload gets a new key, so responses can be
 * cached for a year.
 */

import { Hono } from "hono";

import type { Env } from "../http.js";
import { isScriptable } from "../lib/file-type.js";

const RANGE_PATTERN = /^bytes=(\d*)-(\d*)$/;

export function mediaFileRoutes(): Hono<Env> {
  const app = new Hono<Env>();

  app.get("/:key", async (c) => {
    const ctx = c.get("ctx");
    const key = c.req.param("key");

    const record = ctx.repositories.media.find(key.replace(/\.[^.]*$/, ""));
    if (!record || record.storageKey !== key) {
      return c.text("Not found", 404);
    }

    const headers: Record<string, string> = {
      "content-type": record.mimeType,
      "cache-control": "public, max-age=31536000, immutable",
      "x-content-type-options": "nosniff",
      // The stored name may contain non-ASCII, so use the RFC 5987 form.
      "content-disposition": `inline; filename*=UTF-8''${encodeURIComponent(record.filename)}`,
    };

    // SVG is the one accepted format that can carry script. Rendering it under
    // a sandbox CSP keeps a hostile upload from running on the CMS origin.
    if (isScriptable(record.mimeType)) {
      headers["content-security-policy"] = "sandbox; default-src 'none'; style-src 'unsafe-inline'";
    }

    const rangeHeader = c.req.header("range");
    const match = rangeHeader ? RANGE_PATTERN.exec(rangeHeader) : null;

    if (match) {
      const [, rawStart, rawEnd] = match;
      const start = rawStart ? Number(rawStart) : 0;
      const end = rawEnd ? Number(rawEnd) : record.size - 1;

      if (start >= record.size || start > end) {
        return c.body(null, 416, { "content-range": `bytes */${record.size}` });
      }

      const object = await ctx.storage.get(record.storageKey, { start, end });
      if (!object) return c.text("Not found", 404);

      return c.body(object.stream, 206, {
        ...headers,
        "content-length": String(object.size),
        "content-range": `bytes ${start}-${Math.min(end, record.size - 1)}/${record.size}`,
        "accept-ranges": "bytes",
        etag: object.etag,
      });
    }

    const object = await ctx.storage.get(record.storageKey);
    if (!object) {
      c.get("logger").error("Media row has no file behind it", { id: record.id, key });
      return c.text("Not found", 404);
    }

    if (c.req.header("if-none-match") === object.etag) {
      // The body must not be consumed on a 304, or the stream leaks.
      await object.stream.cancel().catch(() => {});
      return c.body(null, 304, { etag: object.etag, "cache-control": headers["cache-control"]! });
    }

    return c.body(object.stream, 200, {
      ...headers,
      "content-length": String(object.size),
      "accept-ranges": "bytes",
      etag: object.etag,
    });
  });

  return app;
}
