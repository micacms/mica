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
 *
 * Values that cannot carry a marker, such as a date or an option, are found in
 * the templates instead (`fields.ts`), with Astro's own parser,
 * `@astrojs/compiler-rs`, a peer dependency.
 */

import { readFile } from "node:fs/promises";

import type { AstroIntegration } from "astro";

import { devServerListening } from "../dev-server.js";
import { annotateFields, type ParseAstro } from "./fields.js";
import { previewMarkersEnabled } from "./mark.js";

export type { FieldMarker } from "./markers.js";

/** Adds the preview script to each page, in `astro dev` with `MICA_PREVIEW` only. In each `astro dev`, it gives the editor the port that the server listens on. */
export function micaPreview(): AstroIntegration {
  return {
    name: "@micacms/astro/preview",
    hooks: {
      "astro:config:setup": async ({ command, injectScript, logger, updateConfig }) => {
        if (!previewMarkersEnabled(command === "dev")) return;
        const parse = await loadParser();
        if (parse) updateConfig({ vite: { plugins: [fieldsPlugin(parse)] } });
        else logger.warn("Live preview: @astrojs/compiler-rs is missing, so dates, numbers and options cannot be clicked. Install it beside astro.");
        const editors = (process.env["MICA_PREVIEW_EDITOR"] ?? "")
          .split(",")
          .map((origin) => origin.trim())
          .filter(Boolean);
        injectScript("page", `import { startPreview } from "@micacms/astro/preview/client";\nstartPreview(${JSON.stringify(editors)});`);
        logger.info("Live preview: text fields are marked, and each page gets the preview script.");
      },
      // Also without MICA_PREVIEW: the editor's Preview must find the port that Astro took.
      "astro:server:start": ({ address, logger }) => {
        try {
          devServerListening(address.port);
        } catch (error) {
          logger.warn(`The local editor cannot find the dev server: ${error instanceof Error ? error.message : String(error)}`);
        }
      },
    },
  };
}

/** Astro's parser, which Astro 7 installs. Null when the site's package manager does not give it to this package. */
async function loadParser(): Promise<ParseAstro | null> {
  try {
    return (await import("@astrojs/compiler-rs")).parse as ParseAstro;
  } catch {
    return null;
  }
}

/** A template of the site, not one of a package, and not one of Astro's sub-requests (`Page.astro?astro&type=style`). */
const isSiteTemplate = (id: string): boolean => id.endsWith(".astro") && !id.includes("/node_modules/");

/**
 * Before Astro compiles a template of the site: the fields that its elements
 * read (`data-mica-fields`). In `load`, so that Astro's own reads of the file go
 * through it too: its compile again after a hot update, and its check whether
 * only the styles changed, which reads the file and compares it with what it compiled.
 */
function fieldsPlugin(parse: ParseAstro) {
  return {
    name: "mica:preview-fields",
    enforce: "pre" as const,
    async load(id: string) {
      if (!isSiteTemplate(id)) return null;
      return annotateFields(await readFile(id, "utf8"), parse);
    },
    handleHotUpdate: {
      order: "pre" as const,
      handler(context: { file: string; read: () => string | Promise<string> }) {
        if (!isSiteTemplate(context.file)) return;
        const read = context.read;
        context.read = async () => annotateFields(await read(), parse);
      },
    },
  };
}
