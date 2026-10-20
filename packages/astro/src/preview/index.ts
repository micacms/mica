/**
 * @micacms/astro/preview — the live preview in the editor.
 *
 *   // astro.config.mjs
 *   import { micaPreview } from "@micacms/astro/preview";
 *   export default defineConfig({ integrations: [micaPreview()] });
 *
 * Then `MICA_PREVIEW=1 astro dev`. Only then do the loaders mark the text
 * fields, and only then does each page get the preview script. A build and a
 * plain `astro dev` stay as they are. The script answers an editor on this
 * computer, or one of the origins in `MICA_PREVIEW_EDITOR` (comma-separated).
 */

import type { AstroIntegration } from "astro";

import { previewMarkersEnabled } from "./mark.js";

export type { FieldMarker } from "./markers.js";

/** Adds the preview script to each page, in `astro dev` with `MICA_PREVIEW` only. */
export function micaPreview(): AstroIntegration {
  return {
    name: "@micacms/astro/preview",
    hooks: {
      "astro:config:setup": ({ command, injectScript, logger }) => {
        if (!previewMarkersEnabled(command === "dev")) return;
        const editors = (process.env["MICA_PREVIEW_EDITOR"] ?? "")
          .split(",")
          .map((origin) => origin.trim())
          .filter(Boolean);
        injectScript("page", `import { startPreview } from "@micacms/astro/preview/client";\nstartPreview(${JSON.stringify(editors)});`);
        logger.info("Live preview: text fields are marked, and each page gets the preview script.");
      },
    },
  };
}
