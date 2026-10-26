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
 * `@astrojs/compiler-rs`: the one that the site's Astro brings.
 */

import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";

import type { AstroIntegration } from "astro";

import { devServerListening } from "../dev-server.js";
import { annotateFields, placesFields, type ParseAstro } from "./fields.js";
import { previewMarkersEnabled } from "./mark.js";

export type { FieldMarker } from "./markers.js";

/** Adds the preview script to each page, in `astro dev` with `MICA_PREVIEW` only. In each `astro dev`, it gives the editor the port that the server listens on. */
export function micaPreview(): AstroIntegration {
  return {
    name: "@micacms/astro/preview",
    hooks: {
      "astro:config:setup": async ({ command, injectScript, logger, updateConfig }) => {
        if (!previewMarkersEnabled(command === "dev")) return;
        const parser = await loadParser();
        if (parser === "missing") logger.warn("Live preview: Astro's parser, @astrojs/compiler-rs, is missing, so dates, numbers and options cannot be clicked.");
        else if (parser === "wrong") {
          logger.warn(
            "Live preview: the parser of this Astro version places fields wrong, so dates, numbers and options cannot be clicked. Astro 7.3 or newer has a parser that works, or install @astrojs/compiler-rs@^0.5 beside astro.",
          );
        } else updateConfig({ vite: { plugins: [fieldsPlugin(parser)] } });
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

/**
 * Astro's parser: the one that the site's Astro brings, so that its version
 * follows Astro's; else one beside this package. The first that places the
 * fields right; "wrong" when there are only others, "missing" when none.
 */
async function loadParser(): Promise<ParseAstro | "wrong" | "missing"> {
  const require = createRequire(import.meta.url);
  const sources = [
    () => createRequire(require.resolve("astro/package.json")).resolve("@astrojs/compiler-rs"),
    () => require.resolve("@astrojs/compiler-rs"),
  ];
  let found = false;
  for (const source of sources) {
    try {
      const { parse } = (await import(pathToFileURL(source()).href)) as { parse?: ParseAstro };
      if (typeof parse !== "function") continue;
      found = true;
      if (placesFields(parse)) return parse;
    } catch {
      // Not there: try the next one.
    }
  }
  return found ? "wrong" : "missing";
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
