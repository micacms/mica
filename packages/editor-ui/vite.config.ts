import { fileURLToPath, URL } from "node:url";

import tailwindcss from "@tailwindcss/vite";
import vue from "@vitejs/plugin-vue";
import { defineConfig, type Plugin } from "vite";

import { formatNotices, packageRoot, readPackage } from "../../scripts/third-party-notices.mjs";

const API_TARGET = process.env.CMS_DEV_API ?? "http://localhost:6422";

/** Writes `THIRD_PARTY_NOTICES.txt` for the packages in the bundle: their licenses require it. */
function thirdPartyNotices(): Plugin {
  return {
    name: "mica:third-party-notices",
    apply: "build",
    generateBundle() {
      const roots = new Set<string>();
      for (const id of this.getModuleIds()) {
        const root = packageRoot(id.replace(/^\0/, "").split("?")[0]!);
        if (root) roots.add(root);
      }
      // In the bundle, but not as modules: Tailwind's CSS, and the helpers that Vite and the Vue plugin inline.
      for (const name of ["tailwindcss", "vite", "@vitejs/plugin-vue"]) {
        const root = packageRoot(fileURLToPath(import.meta.resolve(name)));
        if (root) roots.add(root);
      }
      const intro = "The Inter font is under the SIL Open Font License: fonts/InterVariable-LICENSE.txt.\n\n";
      const source = formatNotices([...roots].map(readPackage), intro);
      this.emitFile({ type: "asset", fileName: "THIRD_PARTY_NOTICES.txt", source });
    },
  };
}

export default defineConfig({
  // Served under /admin/ by the Hono app, so assets must be requested from there.
  base: "/admin/",

  plugins: [vue(), tailwindcss(), thirdPartyNotices()],

  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },

  build: {
    outDir: "dist",
    emptyOutDir: true,
    sourcemap: true,
    // The admin is one deliberate bundle: fetched once, behind a sign-in, from
    // the app that serves it — route-splitting would buy round trips, not a
    // faster first paint. The limit sits where real growth would cross it,
    // not where a dependency bump does; today's bundle is ~510 kB.
    chunkSizeWarningLimit: 1000,
    rollupOptions: {
      onwarn(warning, warn) {
        // zod ships comments that Rollup misreads as misplaced tree-shaking
        // annotations and nags about on every build. Third-party code is not
        // ours to fix; annotations in our own code still warn.
        if (warning.code === "INVALID_ANNOTATION" && warning.id?.includes("node_modules")) return;
        warn(warning);
      },
    },
  },

  server: {
    port: 5173,
    // Proxying keeps the API same-origin for the browser, so the session cookie
    // is sent normally during development. The CMS still needs
    // MICA_ADMIN_ORIGINS=http://localhost:5173 for its Origin check.
    proxy: {
      "/api": { target: API_TARGET, changeOrigin: false },
    },
  },
});
