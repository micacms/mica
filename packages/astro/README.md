# @micacms/astro

> **Public.** From 1.0, semver covers this package. Pre-1.0: the API and the
> content format can still change in a minor release.

Reads a Mica content repository as Astro Content Collections, through the
Content Layer API — and publishes the content model for Mica to read back.

The build needs no CMS running, no URL and no token. Content is files in the
checkout the build is already in, so the website cannot be broken by the CMS
being down, slow, or mid-deploy.

```ts
// src/mica.ts
import { collection, defineSite, slug, text } from "@micacms/core";

export const site = defineSite({
  root: "./content",
  collections: {
    news: collection({
      label: "News",
      fields: { title: text({ required: true }), slug: slug({ from: "title" }) },
    }),
  },
});
```

```ts
// src/content.config.ts
import { micaCollections } from "@micacms/astro";

import { site } from "./mica";

export const collections = micaCollections(site);
```

That is the whole setup. **Nothing goes in `astro.config`** — which is also what
lets `content.config.ts` import `astro:content`, a virtual module that only
exists inside the app's own module graph.

Pages then use ordinary Astro:

```astro
---
import { getCollection } from "astro:content";
const news = await getCollection("news");
---
```

`getCollection("news")` is fully typed from the model, with no code generation
step — so renaming a field breaks the build rather than the page.

## What `micaCollections` does

One loader and one Zod schema per collection and singleton. Each document
carries a `_mica` field with what the model knows about it; a singleton becomes
a one-entry collection, reachable with the same `getEntry` as everything else.

The loaders also do the two things that used to need an integration, because
Astro hands a loader exactly what they require:

- **Publish the model** to `<root>/.mica/schema.json`, once per build or
  dev-server start. Commit that file: it is how a Mica deployment learns what
  this project defines. `publishModel: false` turns it off, for a project that
  is not edited through Mica.
- **Reload in dev.** Astro's watcher follows the module graph and content files
  are not in it, because no page imports `projects/haus-a/index.json`. Each
  loader watches its own directory and coalesces the burst of writes that saving
  one entry produces (`debounceMs`, 100 ms by default).

Image fields reach Astro as Astro images: a `media({ accept: "image" })` field
is `ImageMetadata`, optimised like Astro's own `image()`, and with `alt` it is
`{ src, alt }` — `<Image {...entry.data.cover} />` needs no helper. Other media
stay paths from the content root.

The loaders also check references: a relation to a missing entry, or a media
path to a missing file, is a warning in the build log. `strict: true` makes it
fail the build. An entry in the other layout always fails the build, with the
files and `npx mica migrate-layout`.

## Mixing with your own collections

The return value is a plain object:

```ts
export const collections = {
  ...micaCollections(site),
  docs: defineCollection({ loader: glob({ pattern: "**/*.md", base: "./src/docs" }) }),
};
```

Mica edits what is in the model and does not know the rest exists. A save in one
of its collections reloads that collection only — never a foreign loader.

## Rich text

`renderRichText(source)` turns a Markdoc field into an HTML string;
`transformRichText(source)` returns the renderable tree instead, for a project
that wants to render with its own components.

## Setup guides for coding agents

`setup/` holds the guides that https://micacms.com/setup.md sends a coding
agent to: a new or empty Astro project, and a project with content
collections. They ship with the package, so they match the installed version.

## Install

```bash
npm install @micacms/astro @micacms/core
```

Astro 7, `@micacms/core` and zod 4 are peer dependencies. npm installs zod. ESM only. Requires Node 24 or newer.
Licence: MIT.
