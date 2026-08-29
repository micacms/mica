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
  },

  server: {
    port: 5173,
    // Proxying keeps the API same-origin for the browser, so the session cookie
    // is sent normally during development. The CMS still needs
    // ADMIN_ORIGINS=http://localhost:5173 for its Origin check.
    proxy: {
      "/api": { target: API_TARGET, changeOrigin: false },
      "/media": { target: API_TARGET, changeOrigin: false },
    },
  },
});
