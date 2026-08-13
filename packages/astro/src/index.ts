/**
 * @micacms/astro — a Git repository as an Astro content source.
 *
 *   // src/content.config.ts
 *   import { micaCollections } from "@micacms/astro";
 *   import site from "../../mica.config";
 *
 *   export const collections = micaCollections(site, { root: "./content" });
 *
 * From there the website uses ordinary Astro APIs — `getCollection("projects")`
 * — and knows nothing about how the content arrived.
 *
 * There is no CMS in this path. The loaders read files that are already in the
 * working tree, so a build needs a checkout and nothing else: no running
 * server, no token, no network. That is the point of the Git-native design.
 * Publishing is a commit, and CI builds the commit.
 */

import {
  fieldsSchema,
  readCollection,
  readSingleton,
  type Collection,
  type ContentSource,
  type InferCollection,
  type InferSingleton,
  type Singleton,
  type Site,
} from "@micacms/model";
import { fileSystemSource } from "@micacms/model/node";
import { z } from "zod";

export interface MicaCollectionsOptions {
  /**
   * The content root, relative to the working directory of the build.
   *
   * In a single-repository project this is a directory inside the Astro
   * project. When the content lives in its own repository, it is wherever CI
   * put the checkout — `@micacms/astro` only needs a resolved local path.
   */
  root?: string;
  /** Overrides `root`. Used by tests and, later, by repository connectors. */
  source?: ContentSource;
}

/**
 * Entry metadata attached to every collection document.
 *
 * Much smaller than it was when a database backed the CMS. Timestamps and
 * version numbers came from table columns that no longer exist; in Git the
 * equivalents are commit metadata, which a static build has no cheap way to
 * read and no strong reason to need. A date an editor cares about belongs in
 * the model as a `date()` field, where it is editorial rather than incidental.
 *
 * Namespaced because these keys share a namespace with the customer's own
 * fields, and `position` is a plausible field name.
 */
export interface MicaMeta {
  /** The entry slug, which is its identity in the repository. */
  id: string;
  slug: string;
  collection: string;
  /** Index in the collection's order, manual when `_order.json` says so. */
  position: number;
}

const metaSchema = z.object({
  id: z.string(),
  slug: z.string(),
  collection: z.string(),
  position: z.number(),
});

/** What a document looks like inside Astro: the payload plus `_mica`. */
export type AstroDocument<T> = T & { _mica: MicaMeta };

/**
 * The shape Astro's config loader expects.
 *
 * Deliberately not built with `defineCollection` from `astro:content`: that is a
 * virtual module, resolvable only inside an Astro app's module graph, and this
 * package is pre-compiled. `defineCollection` does nothing more than stamp this
 * `type`, so producing the object directly keeps the package importable
 * anywhere — including from a plain unit test.
 */
export interface AstroCollectionConfig<T = unknown> {
  type: "content_layer";
  loader: ContentLoader;
  /**
   * Typed as `ZodType<T>` rather than a bare `ZodObject`, because Astro derives
   * `CollectionEntry<"projects">["data"]` from `z.infer` of whatever this is.
   * Left generic, every field in every template would degrade to `any` — and
   * the point of the shared model is that renaming a field breaks the build.
   */
  schema: z.ZodType<T>;
}

/** The subset of Astro's `Loader` contract this package uses. */
export interface ContentLoader {
  name: string;
  load(context: LoaderContext): Promise<void>;
}

export interface LoaderContext {
  store: {
    clear(): void;
    set(entry: { id: string; data: Record<string, unknown>; digest?: string }): boolean;
    keys(): string[];
  };
  logger: {
    info(message: string): void;
    warn(message: string): void;
    error(message: string): void;
    debug(message: string): void;
  };
  meta: { get(key: string): string | undefined; set(key: string, value: string): void };
  parseData(input: {
    id: string;
    data: Record<string, unknown>;
  }): Promise<Record<string, unknown>>;
  generateDigest(data: Record<string, unknown> | string): string;
}

export type MicaCollections<S extends Site> = {
  [K in keyof S["collections"]]: AstroCollectionConfig<
    AstroDocument<InferCollection<S["collections"][K]>>
  >;
} & {
  [K in keyof S["singletons"]]: AstroCollectionConfig<InferSingleton<S["singletons"][K]>>;
};

export function micaCollections<S extends Site>(
  site: S,
  options: MicaCollectionsOptions = {},
): MicaCollections<S> {
  const source = options.source ?? fileSystemSource(options.root ?? "./content");
  const collections = {} as Record<string, AstroCollectionConfig<unknown>>;

  for (const [name, def] of Object.entries(site.collections) as [string, Collection][]) {
    collections[name] = {
      type: "content_layer",
      // `storage` rather than `output`: a media reference is a path into the
      // repository at rest and a path into the repository once loaded. There
      // is no expansion step left to tell the two apart.
      schema: fieldsSchema(def.fields, "storage").extend({ _mica: metaSchema }),
      loader: {
        name: `mica:${name}`,
        load: async (context) => {
          const entries = await guard(context, source, () => readCollection(source, def, name));

          // A full replace, not a merge: an entry deleted from the repository
          // has to disappear from the build.
          context.store.clear();

          for (const entry of entries) {
            const meta: MicaMeta = {
              id: entry.slug,
              slug: entry.slug,
              collection: name,
              position: entry.position,
            };

            const data = await context.parseData({
              id: entry.slug,
              data: { ...entry.data, _mica: meta },
            });
            context.store.set({ id: entry.slug, data, digest: context.generateDigest(data) });
          }

          context.logger.info(`Loaded ${entries.length} ${def.label.toLowerCase()}`);
        },
      },
    };
  }

  // A singleton becomes a one-entry collection whose id is its name, so the
  // website reaches it with the same `getEntry` it uses for everything else.
  for (const [name, def] of Object.entries(site.singletons) as [string, Singleton][]) {
    collections[name] = {
      type: "content_layer",
      schema: fieldsSchema(def.fields, "storage"),
      loader: {
        name: `mica:${name}`,
        load: async (context) => {
          const data = await guard(context, source, () => readSingleton(source, def, name));

          context.store.clear();
          if (data === null) {
            // Not fatal. A site is normally deployed before every settings form
            // has been filled in, and the page that reads this singleton
            // reports the absence far better than the loader can.
            context.logger.warn(`No content for the "${def.label}" settings yet.`);
            return;
          }

          const parsed = await context.parseData({ id: name, data });
          context.store.set({ id: name, data: parsed, digest: context.generateDigest(parsed) });
        },
      },
    };
  }

  return collections as MicaCollections<S>;
}

/**
 * Reports a read failure against the content root that produced it.
 *
 * A build failing on unreadable content is correct — publishing a half-empty
 * site would be worse — but the message has to name the directory that was
 * read, because the usual cause is a content root pointing at the wrong place.
 */
async function guard<T>(
  context: LoaderContext,
  source: ContentSource,
  read: () => Promise<T>,
): Promise<T> {
  try {
    return await read();
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    context.logger.error(detail);

    throw new Error(`Could not read content from ${source.origin}.\n  ${detail}`, { cause: error });
  }
}

/* ------------------------------------------------------------------ *
 * Types for the website
 * ------------------------------------------------------------------ */

/** The document type for one collection, as it appears in Astro. */
export type CollectionDocument<
  S extends Site,
  K extends keyof S["collections"],
> = AstroDocument<InferCollection<S["collections"][K]>>;

/** The document type for one singleton. */
export type SingletonDocument<
  S extends Site,
  K extends keyof S["singletons"],
> = InferSingleton<S["singletons"][K]>;

export { mica, type MicaIntegrationOptions } from "./integration.js";
export { manifestFor } from "./manifest.js";
export {
  renderRichText,
  transformRichText,
  validateRichText,
  type RichTextOptions,
} from "./richtext.js";

/**
 * Re-exported for convenience, so a project that only depends on this package
 * can still build a source or read a collection. They are defined in
 * `@micacms/model`, where the Mica server can reach them too.
 */
export {
  ContentReadError,
  ContentSourceError,
  ORDER_FILE,
  memorySource,
  readCollection,
  readSingleton,
  type ContentSource,
  type DirectoryEntry,
} from "@micacms/model";
export { fileSystemSource } from "@micacms/model/node";
