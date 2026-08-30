/**
 * Admin media routes.
 *
 * Media is files in the content repository now, so these routes are much
 * smaller than they were. There is no upload table to keep in step, no storage
 * key to generate, and no delete endpoint — removing a file that an entry still
 * references is a content decision made in a diff, not an API call.
 *
 * Uploads are committed on their own rather than folded into the entry save.
 * The editor needs a path to put in the field before it can save the entry that
 * references it, and a two-step flow is the honest way to say so. The cost is
 * an occasional unreferenced file, which is visible in the repository and
 * cheap to remove; the alternative would be holding uploads in server memory
 * between requests.
 */

import { Hono } from "hono";

import { badRequest, notFound } from "../lib/errors.js";
import { actorOf, type Env } from "../http.js";

export function adminMediaRoutes(): Hono<Env> {
  const app = new Hono<Env>();

  app.get("/", async (c) => {
    const { media } = c.get("ctx").services;
    return c.json({ items: await media.list() });
  });

  app.post("/", async (c) => {
    const ctx = c.get("ctx");
    const form = await c.req.formData().catch(() => {
      throw badRequest("Expected a multipart upload.");
    });

    // Two `File` types are in scope here — Node's and undici's — and they are
    // structurally different. The runtime check is the same either way; the
    // cast is only to pick one of them for the compiler.
    const files = form
      .getAll("file")
      .filter((value) => typeof value !== "string") as unknown as File[];

    if (files.length === 0) throw badRequest("No file was uploaded.");

    const accept = form.get("accept");
    // Where the editor wants the file: an entry's own `media/` directory, or
    // the shared one. Validated by the connector, which refuses any path that
    // leaves the content root.
    const directory = typeof form.get("directory") === "string" ? String(form.get("directory")) : undefined;

    const prepared = await Promise.all(
      files.map((file) =>
        ctx.services.media.prepare({
          file,
          directory,
          accept: accept === "image" || accept === "document" ? accept : "any",
        }),
      ),
    );

    const actor = actorOf(c);
    await ctx.site.contentRepository.commit({
      message: `Media: upload ${prepared.map((item) => item.file.filename).join(", ")}`,
      changes: prepared.map((item) => ({
        type: "write" as const,
        path: item.file.path,
        contents: item.contents,
      })),
      author: actor ? { name: actor.email, email: actor.email } : undefined,
    });

    return c.json({ items: prepared.map((item) => item.file) }, 201);
  });

  /**
   * Serves a file to the editor.
   *
   * Behind the admin session, unlike the old `/media/*`, which had to be public
   * so that the Astro build could fetch it. The build reads the repository
   * directly now, so nothing outside this session needs these bytes and the
   * whole "media is effectively public" trade-off disappears with the route.
   */
  app.get("/file/*", async (c) => {
    const { media } = c.get("ctx").services;
    const mediaPath = c.req.path.replace(/^.*\/file\//, "");

    const found = await media.read(decodeURIComponent(mediaPath));
    if (!found) throw notFound("No such file.");

    return c.body(found.bytes as unknown as ArrayBuffer, 200, {
      "content-type": found.mimeType,
      "cache-control": "private, max-age=60",
    });
  });

  return app;
}
