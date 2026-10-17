/**
 * The Astro collections this project has, from two different places.
 *
 * `micaCollections` turns the content model into one Content Layer collection
 * per collection and singleton, and returns a plain object — so a collection
 * Mica knows nothing about spreads in beside them. Pages then use ordinary
 * `getCollection` / `getEntry` and never learn which of the two wrote what.
 *
 * The Mica loaders also publish the model to `content/.mica/schema.json` and,
 * in dev, reload when an editor saves. Nothing of Mica is in `astro.config.mjs`
 * — which is what lets this file import `astro:content`, a virtual module that
 * exists only inside the app's own module graph.
 */

import { micaCollections } from "@micacms/astro";
import { file, glob } from "astro/loaders";
import { defineCollection } from "astro:content";
import { z } from "astro/zod";

import { site } from "./mica";

/**
 * A collection Mica does not know about.
 *
 * Not everything on a website is the client's to edit. These definitions are
 * maintained by whoever maintains the templates: Markdown in the repository,
 * changed in a pull request. Mica neither shows them nor can write them.
 */
const glossary = defineCollection({
  loader: glob({ pattern: "**/*.md", base: "./src/glossary" }),
  schema: z.object({
    term: z.string(),
    order: z.number().default(99),
  }),
});

/**
 * Reference data: a file of the website that Mica does not edit. The model
 * names it under the same name, so that a relation in the editor can point to
 * an item of it.
 */
const sectors = defineCollection({
  loader: file("src/reference/sectors.json"),
  schema: z.object({ name: z.string() }),
});

export const collections = { ...micaCollections(site), glossary, sectors };
