import { fileURLToPath, URL } from "node:url";

import tailwindcss from "@tailwindcss/vite";
import vue from "@vitejs/plugin-vue";
import { defineConfig } from "vite";

const API_TARGET = process.env.CMS_DEV_API ?? "http://localhost:6422";

export default defineConfig({
  // Served under /admin/ by the Hono app, so assets must be requested from there.
  base: "/admin/",

  plugins: [vue(), tailwindcss()],

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
    // ADMIN_ORIGINS=http://localhost:5173 for its Origin check.
    proxy: {
      "/api": { target: API_TARGET, changeOrigin: false },
    },
  },
});
