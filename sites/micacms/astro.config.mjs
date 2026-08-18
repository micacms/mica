import { defineConfig } from "astro/config";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  output: "static",
  // `||`, not `??`: an undefined CI variable arrives as an empty string.
  site: process.env.SITE_URL || "https://micacms.com",
  build: { format: "directory" },
  vite: { plugins: [tailwindcss()] },
});
