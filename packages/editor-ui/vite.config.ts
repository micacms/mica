import path from "node:path";
import { fileURLToPath, URL } from "node:url";

import tailwindcss from "@tailwindcss/vite";
import vue from "@vitejs/plugin-vue";
import { defineConfig, type Plugin } from "vite";

import { dependencyRoots, formatNotices, packageRoot, readPackage } from "../../scripts/third-party-notices.mjs";

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
      // MapLibre ships its dependencies inside its own files, so they are not modules of the bundle.
      for (const root of [...roots]) {
        if (path.basename(root) === "maplibre-gl") for (const dependency of dependencyRoots(root)) roots.add(dependency);
      }
      const intro =
        "The Instrument Sans and IBM Plex Mono fonts are under the SIL Open Font License: fonts/InstrumentSans-LICENSE.txt and fonts/IBMPlexMono-LICENSE.txt.\n\n";
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

  // MapLibre's worker imports its shared code as a module.
  worker: { format: "es" },

  build: {
    outDir: "dist",
    emptyOutDir: true,
    sourcemap: true,
    // The limit sits where real growth would cross it, not where a dependency
    // bump does. The largest chunks load only with the field that needs them:
    // rich text (Tiptap and Markdoc, ~600 kB) and a map (MapLibre, ~1,040 kB).
    chunkSizeWarningLimit: 1100,
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
