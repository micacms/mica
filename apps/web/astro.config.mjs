import { fileURLToPath } from "node:url";

import { mica } from "@micacms/astro";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "astro/config";

import site from "../../mica.config.ts";

/**
 * `SITE_URL` still has to be folded in by hand: Astro exposes `.env` as
 * `import.meta.env`, which does not exist yet while this config is evaluated,
 * and never reaches `process.env` at all. Without this a production build bakes
 * localhost into `og:url` and the sitemap. Already-set variables win, so CI and
 * containers keep overriding the file.
 *
 * It is now the only variable this build reads. Content comes from the
 * checkout, so there is no CMS URL and no read token to get wrong.
 */
try {
  process.loadEnvFile(fileURLToPath(new URL(".env", import.meta.url)));
} catch (error) {
  // Absent is fine — the environment may supply this directly.
  if (error.code !== "ENOENT") throw error;
}

const siteUrl = process.env.SITE_URL ?? "http://localhost:4321";
const contentRoot = fileURLToPath(new URL("../../content", import.meta.url));

export default defineConfig({
  // Static output, no adapter: deployable to any static host.
  output: "static",
  site: siteUrl,

  /**
   * Content itself is wired up in `src/content.config.ts`. This makes
   * `astro dev` notice edits to the content directory, which Astro's own
   * watcher does not reach because no page imports a content file. It also
   * writes the protocol manifest into the build output.
   */
  integrations: [mica({ site, root: contentRoot })],

  build: {
    // Directory-style URLs work identically on nginx, S3, Netlify and Pages.
    format: "directory",
  },

  /**
   * No `remotePatterns` and no `domains`.
   *
   * Media is a file in the repository, so every image is a local asset that
   * Astro optimises and emits into `_astro/`. There is no remote origin left
   * for the build to fetch from, which is what makes the deployed site
   * independent of anything Mica runs.
   */

  vite: {
    plugins: [tailwindcss()],
    resolve: {
      alias: {
        "@": fileURLToPath(new URL("./src", import.meta.url)),
      },
    },
  },
});
