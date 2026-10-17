/**
 * Admin media routes. Media is files in the content repository. An upload is
 * written on its own, before the entry save, because the editor needs its path
 * first. A delete is a pending change like any other, and is refused while
 * something uses the file.
 */

import { contentPath, ContentPathError, MEDIA_DIR } from "@micacms/core/internal";
import { Hono } from "hono";
import { z } from "zod";

import { ApiError, badRequest, notFound } from "../lib/errors.js";
import { acceptFromQuery, isImageType } from "../lib/file-type.js";
import { editorOf, type Env } from "../http.js";
import type { Referrer } from "../services/content-store.js";
import { storeUpload } from "../services/upload.js";

const deleteSchema = z.object({ paths: z.array(z.string().min(1)).min(1).max(500) });

/** Content paths, or a 400 for one that leaves the content root. */
function cleanPaths(paths: string[]): string[] {
  try {
    return [...new Set(paths.map((path) => contentPath(path)))];
  } catch (error) {
    if (error instanceof ContentPathError) throw badRequest(error.message);
    throw error;
  }
}

/** A file in a `media/` folder, as an upload writes it. Nothing else is deleted here. */
function mediaFilesOnly(paths: string[]): string[] {
  for (const path of paths) {
    if (path.split("/").at(-2) !== MEDIA_DIR) throw badRequest(`"${path}" is not a media file.`);
  }
  return paths;
}

function describeUses(path: string, referrers: Referrer[]): string {
  const names = referrers.map((item) => item.title);
  const listed = names.slice(0, 3).join(", ") + (names.length > 3 ? ` and ${names.length - 3} more` : "");
  return `"${path.split("/").at(-1)}" is still used by ${listed}. Remove it there first.`;
}

export function adminMediaRoutes(): Hono<Env> {
  const app = new Hono<Env>();

  app.get("/", async (c) => {
    const { media } = c.get("ctx").services;
    return c.json({ items: await media.list() });
  });

  /** One file with its dimensions: the list leaves them out, so that it reads no file. */
  app.get("/info", async (c) => {
    const { media } = c.get("ctx").services;
    const [path] = cleanPaths([c.req.query("path") ?? ""]);
    const found = await media.info(path!);
    if (!found) throw notFound("No such file.");
    return c.json(found);
  });

  /** Where files are used, before a delete: `?path=a&path=b`. */
  app.get("/usage", async (c) => {
    const { content } = c.get("ctx").services;
    const paths = cleanPaths(c.req.queries("path") ?? []);
    if (paths.length === 0) throw badRequest("Name at least one file.");
    return c.json(await content.mediaUses(paths));
  });

  app.post("/delete", async (c) => {
    const ctx = c.get("ctx");
    const parsed = deleteSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) throw badRequest("Expected a list of file paths.");
    const paths = mediaFilesOnly(cleanPaths(parsed.data.paths));

    for (const path of paths) {
      const owner = path.split("/")[0] ?? "";
      const readOnly = ctx.site.readOnly.get(`collections.${owner}`) ?? ctx.site.readOnly.get(`singletons.${owner}`);
      if (readOnly) throw new ApiError("conflict", readOnly);
      if ((await ctx.services.media.read(path)) === null) throw notFound(`There is no file "${path}".`);
    }

    const { uses, unreadable } = await ctx.services.content.mediaUses(paths);
    if (unreadable.length > 0) {
      throw new ApiError("conflict", `Mica cannot read ${unreadable.join(", ")}, so it cannot tell whether these files are used.`);
    }
    const used = paths.filter((path) => (uses[path] ?? []).length > 0);
    if (used.length > 0) throw new ApiError("conflict", used.map((path) => describeUses(path, uses[path]!)).join(" "));

    await ctx.site.contentRepository.apply({ changes: paths.map((path) => ({ type: "delete" as const, path })) });
    ctx.logger.info("Deleted media", { paths, editor: editorOf(c) });
    return c.json({ deleted: paths });
  });

  /**
   * One file for each request, as the request body; the rest is in the query.
   * The body streams to disk, so no upload is held in memory.
   */
  app.post("/", async (c) => {
    const ctx = c.get("ctx");
    const body = c.req.raw.body;
    if (!body) throw badRequest("No file was uploaded.");

    const accept = acceptFromQuery(c.req.query("accept"));
    if (accept === null) throw badRequest("The upload names a file type that Mica does not know.");
    // An entry's own `media/` directory or the shared one; the media service refuses anything else.
    const directory = c.req.query("directory");
    // A new entry uploads into the folder of the URL in its form; never into a saved entry's.
    const folder = /^([^/]+)\/([^/]+)\/media$/.exec((directory ?? "").replace(/^\/+/, ""));
    if (c.req.query("newEntry") === "true" && folder && ctx.site.model.collections[folder[1]!]) {
      if ((await ctx.services.content.revisionOf(folder[1]!, folder[2]!)) !== null) {
        throw new ApiError("conflict", `Another entry already has the URL “${folder[2]}”. Change the URL, then upload.`);
      }
    }

    const length = Number(c.req.header("content-length"));
    const file = await storeUpload(ctx, {
      body,
      name: c.req.query("name") ?? "upload",
      ...(Number.isFinite(length) ? { size: length } : {}),
      ...(directory !== undefined ? { directory } : {}),
      accept,
    });

    return c.json({ items: [file] }, 201);
  });

  /**
   * Serves a file to the editor, behind the admin gate. The site build reads
   * the repository, not this route.
   */
  app.get("/file/*", async (c) => {
    const { media } = c.get("ctx").services;
    // Only the route's own prefix: a collection named `file` has `…/file/…` in its paths too.
    const mediaPath = c.req.path.slice(c.req.path.indexOf("/file/") + "/file/".length);

    let decoded: string;
    try {
      decoded = decodeURIComponent(mediaPath);
    } catch {
      throw badRequest("The file path is not valid.");
    }

    // A weak validator from size and last change: an unchanged file is not sent again.
    const info = await media.stat(decoded);
    if (!info) throw notFound("No such file.");
    const etag = `W/"${info.size.toString(36)}-${Date.parse(info.modifiedAt).toString(36)}"`;
    // The 304's headers replace the stored ones, so the sandbox goes with it.
    if (c.req.header("if-none-match") === etag) {
      return c.body(null, 304, { etag, "cache-control": "private, no-cache", "content-security-policy": "sandbox; default-src 'none'" });
    }

    const found = await media.read(decoded);
    if (!found) throw notFound("No such file.");

    return c.body(found.stream, 200, {
      // Text without a charset is decoded by guessing; the repository's text is UTF-8.
      "content-type": found.mimeType.startsWith("text/") ? `${found.mimeType}; charset=utf-8` : found.mimeType,
      "cache-control": "private, no-cache",
      etag,
      // A file opened directly runs nothing and reaches nothing on this origin.
      "content-security-policy": "sandbox; default-src 'none'",
      // An image is shown as a preview; anything else is downloaded, never rendered here.
      ...(isImageType(found.mimeType) ? {} : { "content-disposition": "attachment" }),
    });
  });

  return app;
}
