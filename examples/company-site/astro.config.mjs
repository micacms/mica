import { fileURLToPath } from "node:url";

import { micaPreview } from "@micacms/astro/preview";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "astro/config";

/**
 * `SITE_URL` still has to be folded in by hand: Astro exposes `.env` as
 * `import.meta.env`, which does not exist yet while this config is evaluated,
 * and never reaches `process.env` at all. Without this a production build bakes
 * localhost into `og:url` and the sitemap. Already-set variables win, so CI and
 * containers keep overriding the file.
 *
 * It is the only variable this build reads. Content comes from the checkout, so
 * there is no CMS URL and no read token to get wrong.
 */
try {
  process.loadEnvFile(fileURLToPath(new URL(".env", import.meta.url)));
} catch (error) {
  // Absent is fine — the environment may supply this directly.
  if (error.code !== "ENOENT") throw error;
}

export default defineConfig({
  // Static output, no adapter: deployable to any static host.
  output: "static",
  // `||`, not `??`: an undefined CI variable — `${{ vars.SITE_URL }}` with
  // nothing behind it — arrives as an empty string, which Astro rejects as
  // an invalid URL rather than falling back.
  site: process.env.SITE_URL || "http://localhost:4321",

  /**
   * The content model, the content root, the collections, publishing the model
   * for Mica to read and reloading on an editor's save are all in
   * `src/content.config.ts` — which is also what lets that file define ordinary
   * Astro collections beside Mica's. The integration here only adds the live
   * preview's script, and only with `MICA_PREVIEW=1 astro dev` (`npm run mica` starts it).
   */
  integrations: [micaPreview()],

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
    // Rush keeps the packages in common/temp, outside this site. In dev, MapLibre's worker imports its shared file from there.
    server: { fs: { allow: [fileURLToPath(new URL("../..", import.meta.url))] } },
    resolve: {
      alias: {
        "@": fileURLToPath(new URL("./src", import.meta.url)),
      },
    },
  },
});
