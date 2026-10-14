/**
 * @micacms/astro — a Git repository as an Astro content source.
 *
 *   // src/content.config.ts — the model is in src/mica.ts
 *   import { micaCollections } from "@micacms/astro";
 *   import { site } from "./mica";
 *
 *   export const collections = micaCollections(site);
 *
 * From there the website uses ordinary Astro APIs — `getCollection("projects")`
 * — and knows nothing about how the content arrived.
 *
 * There is no CMS in this path. The loaders read files that are already in the
 * working tree, so a build needs a checkout and nothing else: no running
 * server, no token, no network. That is the point of the Git-native design.
 * Publishing is a commit, and CI builds the commit.
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, posix, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

import {
  createReferenceCheck,
  entryDataPath,
  entryFolder,
  fieldsSchema,
  unknownFieldParts,
  resolveSlugField,
  MANIFEST_PATH,
  readCollection,
  readSingleton,
  type Collection,
  type ContentSource,
  type FieldMap,
  type InferCollection,
  type InferSingleton,
  type Singleton,
  type Site,
} from "@micacms/core";
import { fileSystemSource } from "@micacms/core/node";
import type { ImageMetadata } from "astro";
import { z } from "zod";

import { imagePathsFromEntry, richTextImageSources } from "./images.js";
import { manifestFor } from "./manifest.js";
import { DEFAULT_CONTENT_ROOT, resolveContentRoot } from "./root.js";

export interface MicaCollectionsOptions {
  /**
   * Overrides `defineSite({ root })`, which is where the content root belongs.
   *
   * Relative paths resolve against the Astro project root, like Astro's own
   * `glob({ base })`. An absolute path is used as given — which is what a
   * project whose content is a separate repository, checked out by CI
   * somewhere else, wants.
   */
  root?: string;
  /** Overrides `root` entirely. Used by tests, and by a non-filesystem source. */
  source?: ContentSource;
  /**
   * Turns off publishing the model to `<root>/.mica/schema.json`.
   *
   * Only for a project that is not edited through Mica at all: without that
   * file in the repository, Mica has no model and refuses to start.
   */
  publishModel?: false;
  /**
   * How long to wait after a content change before reloading, in dev.
   *
   * Saving one entry touches several files — `index.json` and every `.mdoc`
   * beside it — and a Git checkout touches all of them at once. One reload
   * after the burst is both faster and less confusing than one per file.
   */
  debounceMs?: number;
  /**
   * Fails the build on a relation to a missing entry or a missing media file.
   * Without it, the build logs a warning for each and goes on; a missing image
   * file fails the build either way, because Astro cannot import it.
   */
  strict?: boolean;
}

/**
 * Entry metadata attached to every collection document.
 *
 * No timestamps: in Git they are commit metadata, which a static build cannot
 * read cheaply. A date an editor cares about belongs in the model as a `date()` field.
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
  /** The images in the entry's rich text, for `renderRichText(text, { images })`. */
  images: RichTextImage[];
}

/** An image in rich text: the path as Markdoc writes it, and the image that Astro made of it. */
export interface RichTextImage {
  path: string;
  src: ImageMetadata;
}

/** Astro's `image()` resolves each `src`, as it does for an image field. */
const imagesSchema = (image: () => z.ZodType) => z.array(z.object({ path: z.string(), src: image() }));

const metaSchema = (image: () => z.ZodType) =>
  z.object({
    id: z.string(),
    slug: z.string(),
    collection: z.string(),
    position: z.number(),
    images: imagesSchema(image),
  });

type ReferenceCheck = ReturnType<typeof createReferenceCheck>;

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
   * A function, so that Astro hands in its `image()`. Its result is typed as
   * `ZodType<T>` because Astro derives `CollectionEntry<"projects">["data"]`
   * from it: left generic, every field in every template would degrade to
   * `any`, and the point of the shared model is that renaming a field breaks
   * the build.
   */
  schema: (context: { image: () => z.ZodType }) => z.ZodType<T>;
}

/** The subset of Astro's `Loader` contract this package uses. */
export interface ContentLoader {
  name: string;
  load(context: LoaderContext): Promise<void>;
}

export interface LoaderContext {
  store: {
    clear(): void;
    set(entry: { id: string; data: Record<string, unknown>; digest?: string; filePath?: string }): boolean;
    keys(): string[];
  };
  logger: {
    info(message: string): void;
    warn(message: string): void;
    error(message: string): void;
    debug(message: string): void;
  };
  meta: { get(key: string): string | undefined; set(key: string, value: string): void };
  /**
   * Astro's resolved config. Optional because this interface is a hand-written
   * subset and the tests build a context by hand; `config.root` is what turns a
   * relative content root into a path.
   */
  config?: { root: URL };
  /**
   * Present only while `astro dev` runs. Astro's watcher follows the module
   * graph, and content files are not in it — no page imports
   * `projects/haus-a/index.json` — so each loader watches its own directory
   * here, exactly as Astro's own `glob` loader does.
   */
  watcher?: {
    add(path: string): void;
    on(event: "add" | "change" | "unlink", handler: (path: string) => void): void;
  };
  parseData(input: {
    id: string;
    data: Record<string, unknown>;
    /** The entry's file, from the project root: Astro's `image()` resolves paths against it. */
    filePath?: string;
  }): Promise<Record<string, unknown>>;
  generateDigest(data: Record<string, unknown> | string): string;
}

export type MicaCollections<S extends Site> = {
  [K in keyof S["collections"]]: AstroCollectionConfig<CollectionDocument<S, K>>;
} & {
  [K in keyof S["singletons"]]: AstroCollectionConfig<SingletonDocument<S, K>>;
};

export function micaCollections<S extends Site>(
  site: S,
  options: MicaCollectionsOptions = {},
): MicaCollections<S> {
  assertKnownFields(site);
  assertOneUrl(site);

  /**
   * Everything below is resolved on first load rather than here, because the
   * Astro project root is something only a loader is told — and it is what
   * turns `./content` into a directory. Memoised: one root and one source,
   * however many collections and however many reloads.
   */
  let root: string | undefined;
  let source: ContentSource | undefined;

  const rootFor = (context: LoaderContext): string =>
    (root ??= resolveContentRoot(options.root ?? site.root, context.config?.root));

  const sourceFor = (context: LoaderContext): ContentSource =>
    (source ??= options.source ?? fileSystemSource(rootFor(context)));

  /** Published once per process; a model change restarts the dev server. */
  let publishing: Promise<void> | undefined;

  const publish = (context: LoaderContext): Promise<void> =>
    (publishing ??=
      options.publishModel === false || options.source
        ? Promise.resolve()
        : publishModel(site, rootFor(context), context.logger));

  /** An entry's data file, from the content root and, outside tests, from the project root. */
  const entryFile = (context: LoaderContext, name: string, slug?: string) => {
    const inContent = entryDataPath(name, slug);
    const project = context.config?.root;
    const inProject =
      project && !options.source
        ? relative(fileURLToPath(project), join(rootFor(context), inContent)).split(sep).join("/")
        : undefined;
    return { inContent, inProject };
  };

  /** Warns about broken relations and missing files, or fails the build with `strict`. */
  /** The images of a document's rich text whose files exist, for `image()`. */
  const imagesOf = async (check: ReferenceCheck, fields: FieldMap, data: Record<string, unknown>, dataFile: string) =>
    richTextImageSources((await check.richTextImages(fields, data, posix.dirname(dataFile))).found, dataFile);

  const checkReferences = async (
    context: LoaderContext,
    check: ReferenceCheck,
    documents: Array<{ label: string; fields: FieldMap; data: Record<string, unknown>; folder: string }>,
  ): Promise<void> => {
    const problems: string[] = [];
    for (const { label, fields, data, folder } of documents) {
      for (const issue of await check.issues(fields, data, folder)) problems.push(`${label}: ${issue.path}: ${issue.message}`);
    }
    if (problems.length === 0) return;
    if (options.strict) throw new Error(`Broken references:\n  ${problems.join("\n  ")}`);
    for (const problem of problems) context.logger.warn(problem);
  };

  /** Collections whose watcher is already registered, so a reload adds none. */
  const watching = new Set<string>();

  const watch = (context: LoaderContext, name: string, reload: () => Promise<void>): void => {
    const watcher = context.watcher;
    if (!watcher || options.source || watching.has(name)) return;
    watching.add(name);

    const base = rootFor(context);
    watcher.add(base);

    // A collection or a singleton lives in `<root>/<name>/`. Nothing outside
    // it can concern this loader — which is what keeps one collection's save
    // from re-reading every other one.
    const prefix = join(base, name);
    const mine = (path: string): boolean => path.startsWith(prefix + sep);

    let timer: ReturnType<typeof setTimeout> | undefined;

    const onChange = (path: string): void => {
      // The manifest is this package's own output; reloading content because
      // the model was written is a loop waiting to happen.
      if (path.endsWith(MANIFEST_PATH) || !mine(path)) return;

      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        // Content that fails its own schema lands here. The dev server has to
        // survive it: the next save is very likely the fix.
        void reload().catch((error: unknown) => {
          context.logger.error(`Could not reload content: ${describe(error)}`);
        });
      }, options.debounceMs ?? 100);
      // A pending reload is never a reason to keep the process alive.
      timer.unref?.();
    };

    watcher.on("change", onChange);
    watcher.on("add", onChange);
    watcher.on("unlink", onChange);
  };

  const collections = {} as Record<string, AstroCollectionConfig<unknown>>;

  for (const [name, def] of Object.entries(site.collections) as [string, Collection][]) {
    collections[name] = {
      type: "content_layer",
      schema: ({ image }) => fieldsSchema(def.fields, { image, rowKeys: false }).extend({ _mica: metaSchema(image) }),
      loader: {
        name: `mica:${name}`,
        load: async (context) => {
          const read = async (): Promise<void> => {
            const source = sourceFor(context);
            const check = createReferenceCheck(site, source);
            const entries = await guard(context, source, () => readCollection(source, def, name));

            // A full replace, not a merge: an entry deleted from the repository
            // has to disappear from the build.
            context.store.clear();

            for (const entry of entries) {
              const file = entryFile(context, name, entry.slug);
              // `images` holds paths here; the schema's `image()` makes them images.
              const meta = {
                id: entry.slug,
                slug: entry.slug,
                collection: name,
                position: entry.position,
                images: await imagesOf(check, def.fields, entry.data, file.inContent),
              };

              const data = await draftTolerant(context, `${name}/${entry.slug}`, () =>
                context.parseData({
                  id: entry.slug,
                  data: { ...imagePathsFromEntry(def.fields, entry.data, file.inContent), _mica: meta },
                  ...(file.inProject ? { filePath: file.inProject } : {}),
                }),
              );
              if (data === undefined) continue;
              context.store.set({
                id: entry.slug,
                data,
                digest: context.generateDigest(data),
                ...(file.inProject ? { filePath: file.inProject } : {}),
              });
            }

            await checkReferences(
              context,
              check,
              entries.map((entry) => ({
                label: `${name}/${entry.slug}`,
                fields: def.fields,
                data: entry.data,
                folder: entryFolder(name, entry.slug),
              })),
            );
            context.logger.info(`Loaded ${entries.length} ${entries.length === 1 ? "entry" : "entries"} of "${def.label}"`);
          };

          await publish(context);
          await read();
          watch(context, name, read);
        },
      },
    };
  }

  // A singleton becomes a one-entry collection whose id is its name, so the
  // website reaches it with the same `getEntry` it uses for everything else.
  for (const [name, def] of Object.entries(site.singletons) as [string, Singleton][]) {
    collections[name] = {
      type: "content_layer",
      schema: ({ image }) => fieldsSchema(def.fields, { image, rowKeys: false }).extend({ _mica: z.object({ images: imagesSchema(image) }) }),
      loader: {
        name: `mica:${name}`,
        load: async (context) => {
          const read = async (): Promise<void> => {
            const source = sourceFor(context);
            const check = createReferenceCheck(site, source);
            const data = await guard(context, source, () => readSingleton(source, def, name));

            context.store.clear();
            if (data === null) {
              // Not fatal. A site is normally deployed before every settings
              // form has been filled in, and the page that reads this singleton
              // reports the absence far better than the loader can.
              context.logger.warn(`No content for "${def.label}" yet.`);
              return;
            }

            const file = entryFile(context, name);
            await checkReferences(context, check, [{ label: name, fields: def.fields, data, folder: entryFolder(name) }]);
            const images = await imagesOf(check, def.fields, data, file.inContent);
            const parsed = await draftTolerant(context, name, () =>
              context.parseData({
                id: name,
                data: {
                  ...imagePathsFromEntry(def.fields, data, file.inContent),
                  _mica: { images },
                },
                ...(file.inProject ? { filePath: file.inProject } : {}),
              }),
            );
            if (parsed === undefined) return;
            context.store.set({
              id: name,
              data: parsed,
              digest: context.generateDigest(parsed),
              ...(file.inProject ? { filePath: file.inProject } : {}),
            });
          };

          await publish(context);
          await read();
          watch(context, name, read);
        },
      },
    };
  }

  return collections as MicaCollections<S>;
}

/**
 * In dev, an entry that fails its schema is left out with a warning: the editor
 * saves a draft before every required field is filled in, and Publish refuses it
 * until then. A build has no watcher, and fails as before.
 */
async function draftTolerant<T>(context: LoaderContext, label: string, parse: () => Promise<T>): Promise<T | undefined> {
  try {
    return await parse();
  } catch (error) {
    if (!context.watcher) throw error;
    context.logger.warn(`Left out "${label}" until it is valid: ${describe(error)}`);
    return undefined;
  }
}

/**
 * The site's own model must use only kinds this package knows. Mica reads an
 * unknown kind as one from a newer version and makes its collection read-only,
 * so a typo would otherwise pass the build and lock the collection.
 */
/** A field kind or option that core does not know is a typo here; the editor would make its collection read-only. */
function assertKnownFields(site: Site): void {
  const unknown = [
    ...Object.entries(site.collections).map(([name, def]) => [`collections.${name}`, unknownFieldParts(def.fields)] as const),
    ...Object.entries(site.singletons).map(([name, def]) => [`singletons.${name}`, unknownFieldParts(def.fields)] as const),
  ].filter(([, parts]) => parts.length > 0);
  if (unknown.length > 0) {
    throw new Error(
      `${unknown.map(([at, parts]) => `${at}: ${parts.join(", ")}`).join("\n")}\n` +
        "@micacms/core does not know these field kinds or options. Use the field functions and their options from @micacms/core.",
    );
  }
}

/**
 * A collection's own slug fields are typed as never null, because Mica fills
 * the URL field from the file name. A second one would be typed the same and
 * could still be null, so the site's model refuses it. (A slug in an object,
 * such as one per language, is nullable and fine.) Mica itself still reads a
 * manifest with two, so an older site keeps working with a newer Mica.
 */
function assertOneUrl(site: Site): void {
  for (const [name, def] of Object.entries(site.collections)) {
    const url = resolveSlugField(def);
    const others = Object.entries(def.fields).filter(([key, field]) => field.kind === "slug" && key !== url).map(([key]) => key);
    if (others.length > 0) {
      throw new Error(
        `Collection "${name}" has slug fields that are not its URL (${others.join(", ")}); its URL is "${url}". ` +
          "An entry has one URL: use text() for the others, or put them in an object, such as one per language.",
      );
    }
  }
}

/**
 * Writes the model into the content root, for Mica to read back.
 *
 * Mica holds no content model: the Astro project is the only place a collection
 * is defined, and this is how it says so. The file goes *inside the content
 * root* so that it travels to Mica the way content does — through Git and the
 * repository — with nothing to mount and no second channel to keep in
 * step. Commit it.
 *
 * Done from a loader rather than an integration because this is the moment both
 * facts are in hand: the model, and the project root that turns `./content`
 * into a directory. It also means `astro.config` needs no Mica in it, which is
 * what lets a project define Mica collections and ordinary Astro ones in the
 * same `content.config.ts`.
 */
async function publishModel(
  site: Site,
  root: string,
  logger: LoaderContext["logger"],
): Promise<void> {
  const target = join(root, MANIFEST_PATH);
  const contents = `${JSON.stringify(manifestFor(site), null, 2)}\n`;

  try {
    // Only when it differs. The content root is watched in dev, and rewriting
    // an identical file on every start would ask for a reload for no reason.
    if ((await readFile(target, "utf8").catch(() => null)) === contents) return;

    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, contents, "utf8");
    logger.info(`Wrote the content model to ${relative(process.cwd(), target)} — commit it for Mica to read.`);
  } catch (error) {
    // A site that builds correctly should not fail over this, and a read-only
    // checkout is a normal way to build one in CI. Mica reports a missing model
    // itself, and far more usefully.
    logger.warn(`Could not write the content model: ${describe(error)}`);
  }
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
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
> = AstroDocument<InferCollection<S["collections"][K], ImageMetadata>>;

/** The document type for one singleton. */
export type SingletonDocument<
  S extends Site,
  K extends keyof S["singletons"],
> = InferSingleton<S["singletons"][K], ImageMetadata> & { _mica: { images: RichTextImage[] } };

export { manifestFor } from "./manifest.js";
export { DEFAULT_CONTENT_ROOT, resolveContentRoot };
export {
  renderRichText,
  transformRichText,
  validateRichText,
  type RichTextOptions,
} from "./richtext.js";
