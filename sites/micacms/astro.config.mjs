import { defineConfig } from "astro/config";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  output: "static",
  site: process.env.SITE_URL ?? "https://micacms.com",
  build: { format: "directory" },
  vite: { plugins: [tailwindcss()] },
});
