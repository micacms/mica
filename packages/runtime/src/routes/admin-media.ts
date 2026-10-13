/**
 * Admin media routes. Media is files in the content repository, and there is no delete endpoint.
 * An upload is written on its own, before the entry save, because the editor needs its path first.
 */

import { Hono } from "hono";

import { ApiError, badRequest, notFound } from "../lib/errors.js";
import { isImageType } from "../lib/file-type.js";
import { MAX_FILES_PER_UPLOAD } from "../middleware/index.js";
import type { Env } from "../http.js";

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

    // The cast picks one of the two structurally different `File` types (Node's and undici's).
    const files = form
      .getAll("file")
      .filter((value) => typeof value !== "string") as unknown as File[];

    if (files.length === 0) throw badRequest("No file was uploaded.");
    if (files.length > MAX_FILES_PER_UPLOAD) {
      throw badRequest(`Upload at most ${MAX_FILES_PER_UPLOAD} files at a time.`);
    }

    const accept = form.get("accept");
    // An entry's own `media/` directory or the shared one; the media service refuses anything else.
    const directory = typeof form.get("directory") === "string" ? String(form.get("directory")) : undefined;
    // The media service accepts `/gallery/x/media` too; take the owner from the path it will write to.
    const owner = (directory ?? "").replace(/^[/\\]+/, "").split(/[/\\]/)[0] ?? "";
    const readOnly = ctx.site.readOnly.get(`collections.${owner}`) ?? ctx.site.readOnly.get(`singletons.${owner}`);
    if (readOnly) throw new ApiError("conflict", readOnly);

    const prepared = await Promise.all(
      files.map((file) =>
        ctx.services.media.prepare({
          file,
          directory,
          accept: accept === "image" || accept === "document" ? accept : "any",
        }),
      ),
    );

    await ctx.site.contentRepository.apply({
      changes: prepared.map((item) => ({
        type: "write" as const,
        path: item.file.path,
        contents: item.contents,
      })),
    });

    return c.json({ items: prepared.map((item) => item.file) }, 201);
  });

  /**
   * Serves a file to the editor, behind the admin gate. The site build reads
   * the repository, not this route.
   */
  app.get("/file/*", async (c) => {
    const { media } = c.get("ctx").services;
    const mediaPath = c.req.path.replace(/^.*\/file\//, "");

    let decoded: string;
    try {
      decoded = decodeURIComponent(mediaPath);
    } catch {
      throw badRequest("The file path is not valid.");
    }

    const found = await media.read(decoded);
    if (!found) throw notFound("No such file.");

    return c.body(found.bytes as unknown as ArrayBuffer, 200, {
      // Text without a charset is decoded by guessing; the repository's text is UTF-8.
      "content-type": found.mimeType.startsWith("text/") ? `${found.mimeType}; charset=utf-8` : found.mimeType,
      "cache-control": "private, max-age=60",
      // A file opened directly runs nothing and reaches nothing on this origin.
      "content-security-policy": "sandbox; default-src 'none'",
      // An image is shown as a preview; anything else is downloaded, never rendered here.
      ...(isImageType(found.mimeType) ? {} : { "content-disposition": "attachment" }),
    });
  });

  return app;
}
