/**
 * Serves the built administration SPA.
 *
 * Small enough to do directly rather than pull in a static-file middleware,
 * and doing it here means the caching rules are explicit: hashed asset files
 * are immutable, `index.html` never is — otherwise a deploy leaves editors on
 * a stale bundle pointing at assets that no longer exist.
 */

import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";

import { Hono, type Context } from "hono";

import type { Env } from "../http.js";

const CONTENT_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".map": "application/json; charset=utf-8",
};

export function adminAssetsExist(directory: string): boolean {
  return fs.existsSync(path.join(directory, "index.html"));
}

export function adminSpaRoutes(directory: string): Hono<Env> {
  const app = new Hono<Env>();
  const root = path.resolve(directory);

  const send = async (c: Context<Env>, filePath: string, immutable: boolean) => {
    const stat = await fsp.stat(filePath);
    const extension = path.extname(filePath).toLowerCase();

    return c.body(Readable.toWeb(fs.createReadStream(filePath)) as ReadableStream<Uint8Array>, 200, {
      "content-type": CONTENT_TYPES[extension] ?? "application/octet-stream",
      "content-length": String(stat.size),
      "cache-control": immutable
        ? "public, max-age=31536000, immutable"
        : "no-cache, must-revalidate",
    });
  };

  app.get("/*", async (c) => {
    const url = new URL(c.req.url);
    const relative = decodeURIComponent(url.pathname.replace(/^\/admin\/?/, ""));
    const target = path.join(root, relative);

    // Never serve outside the build directory, whatever the path contains.
    if (relative && !path.relative(root, target).startsWith("..")) {
      try {
        const stat = await fsp.stat(target);
        if (stat.isFile()) {
          // Vite emits hashed filenames under /assets, so those are immutable.
          return await send(c, target, relative.startsWith("assets/"));
        }
      } catch {
        // Fall through to the SPA entry point.
      }
    }

    // Any other path belongs to the client-side router.
    try {
      return await send(c, path.join(root, "index.html"), false);
    } catch {
      return c.text("The admin interface has not been built. Run `pnpm build`.", 503);
    }
  });

  return app;
}
