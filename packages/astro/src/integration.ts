/**
 * The dev-server half of the integration.
 *
 *   // astro.config.mjs
 *   import { mica } from "@micacms/astro";
 *   import site from "./mica.config";
 *
 *   export default defineConfig({
 *     integrations: [mica({ site, root: "./content" })],
 *   });
 *
 * Two jobs, neither of which the loaders can do for themselves.
 *
 * The first is reload. Astro's watcher follows the module graph, and content
 * files are not in it — no page imports `projects/haus-a/index.json`. Without
 * this, editing content while `astro dev` runs changes nothing on the page and
 * nothing says why. So the content root is watched, and a change asks Astro to
 * re-run the loaders.
 *
 * The second is the protocol manifest, which the loaders have no reason to
 * emit. It is written on every build, because it is how a Mica deployment
 * learns what this project's editor should look like.
 */

import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import type { Site } from "@micacms/model";
import type { AstroIntegration } from "astro";

import { manifestFor } from "./manifest.js";

export interface MicaIntegrationOptions {
  /** The content model, the same object `micaCollections` is given. */
  site: Site;
  /** The content root. Must match what `micaCollections` was given. */
  root?: string;
  /**
   * Where to write the protocol manifest, relative to the project root.
   *
   * Inside the build output by default, so that a static host serves it and a
   * Mica deployment can fetch it from the site it is editing — no separate
   * publication step, and no way for the two to fall out of step.
   */
  manifest?: string | false;
  /**
   * How long to wait after a content change before reloading.
   *
   * Saving one entry touches several files — `index.json` and every `.mdoc`
   * beside it — and a Git checkout touches all of them at once. One reload
   * after the burst is both faster and less confusing than one per file.
   */
  debounceMs?: number;
}

export function mica(options: MicaIntegrationOptions): AstroIntegration {
  const root = options.root ?? "./content";
  const debounceMs = options.debounceMs ?? 100;
  let stop = () => {};

  return {
    name: "@micacms/astro",
    hooks: {
      "astro:config:setup": ({ addWatchFile, logger }) => {
        // Tells Astro to restart the dev server when the *model* changes, which
        // is a different thing from a content change: a new field alters every
        // form and every generated type, so re-running the loaders would not be
        // enough.
        try {
          addWatchFile(resolve(root));
        } catch {
          logger.debug("This version of Astro cannot watch the content root from config setup.");
        }
      },

      "astro:server:setup": ({ server, logger, refreshContent }) => {
        // Bound to a constant so the check below still counts inside `reload`,
        // which runs long after this hook has returned.
        const refresh = refreshContent;

        if (!refresh) {
          logger.warn(
            "This version of Astro cannot reload content while the dev server is running. " +
              "Restart it to pick up content changes.",
          );
          return;
        }

        const watched = resolve(root);
        server.watcher.add(watched);

        let timer: ReturnType<typeof setTimeout> | undefined;
        let running = true;

        const reload = async (): Promise<void> => {
          try {
            // No `loaders` filter: a change anywhere under the content root may
            // touch any collection, and re-reading a directory is cheap.
            await refresh({ context: {} });
          } catch (error) {
            // Content that fails its own collection schema lands here. The dev
            // server has to survive it — the next save is very likely the fix.
            logger.error(`Could not reload content: ${describe(error)}`);
          }
        };

        const onChange = (path: string): void => {
          if (!running || !path.startsWith(watched)) return;

          if (timer) clearTimeout(timer);
          timer = setTimeout(() => void reload(), debounceMs);
          // A pending reload is never a reason to keep the process alive.
          timer.unref?.();
        };

        server.watcher.on("all", (_event, path: string) => onChange(path));

        stop = () => {
          running = false;
          if (timer) clearTimeout(timer);
        };

        // Two ways in, because a dev server can also go down without the
        // `astro:server:done` hook running. Both are safe to call twice.
        server.httpServer?.once("close", () => stop());
      },

      "astro:server:done": () => stop(),

      "astro:build:done": async ({ dir, logger }) => {
        if (options.manifest === false) return;

        const target = options.manifest
          ? resolve(options.manifest)
          : resolve(dir.pathname, "mica-manifest.json");

        try {
          await mkdir(dirname(target), { recursive: true });
          await writeFile(target, `${JSON.stringify(manifestFor(options.site), null, 2)}\n`, "utf8");
          logger.info(`Wrote the Mica manifest to ${target}`);
        } catch (error) {
          // A site that built correctly should not fail over the manifest. Mica
          // reports a missing manifest itself, and far more usefully.
          logger.warn(`Could not write the Mica manifest: ${describe(error)}`);
        }
      },
    },
  };
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
