import { fileURLToPath } from "node:url";
import { defineConfig } from "astro/config";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  output: "static",
  // `||`, not `??`: an undefined CI variable arrives as an empty string.
  site: process.env.SITE_URL || "https://mica.build",
  build: { format: "directory" },
  vite: {
    plugins: [tailwindcss()],
    // Rush keeps the packages in common/temp, outside this site. In dev, MapLibre's worker imports its shared file from there.
    server: { fs: { allow: [fileURLToPath(new URL("../..", import.meta.url))] } },
  },
});
