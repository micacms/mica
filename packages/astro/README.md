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
import { collection, defineSite, id, text } from "@micacms/core";

export const site = defineSite({
  root: "./content",
  collections: {
    news: collection({
      label: "News",
      fields: { title: text({ required: true }), id: id({ label: "ID", from: "title" }) },
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
step — so renaming a field makes `astro check` fail at each page that uses the
old name. `astro build` alone does not check types.

## What `micaCollections` does

One loader and one Zod schema per collection and singleton. Each document
carries a `_mica` field: `position`, its place in the editor's order, and
`images`, the images of its rich text. A singleton becomes a one-entry
collection; `getSingleton(site, "settings")` reads it with its type, and fails
the build while it has no content. `getCollection("team").sort(inEditorOrder)`
gives a collection in the order that the editor shows, `defaultSort` included.

The loaders also do two things without an Astro integration, because Astro
hands a loader exactly what they require:

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
`{ src, alt }` — `<Image {...entry.data.cover} />` needs no helper. Other media,
such as PDF, GPX or ZIP files, stay paths from the content root. To read one at
build time, `mediaFile(site, path)` gives the file on disk:

```ts
import { readFile } from "node:fs/promises";
import { mediaFile } from "@micacms/astro";

const track = await readFile(mediaFile(site, tour.data.track), "utf8");
```

## Components

`@micacms/astro/components` has components without styles of their own, for
the values of a model. `<LocationMap>` shows a `coordinates()` value on a map.
It needs `maplibre-gl` in the site's dependencies, and a size from the site:

```astro
---
import { LocationMap } from "@micacms/astro/components";
---

<LocationMap place={office.data.location} map="liberty" class="h-72 w-full" />
```

The zoom is the one that the editor stored, else the `zoom` prop, else 14.
MapLibre loads when the map comes near the screen. Until then, and without
JavaScript, the element holds a link to the place on OpenStreetMap. The
visitor's browser loads the style and the tiles from the tile host.

The loaders also check references: a relation to a missing entry, or a missing
file of a media field that is not an image, is a warning in the build log.
`strict: true` makes it fail the build. A missing image file always fails the
build, as with Astro's own `image()`.

## Relations

A relation field stores the target's ID, which is also its `entry.id` in Astro.
`@micacms/astro/relations` resolves it, typed by the site's collections:

```astro
---
import { related, relatedAll } from "@micacms/astro/relations";

const author = await related("team", article.data.author);
const team = await relatedAll("team", project.data.team);
---
```

A missing target is left out, and `astro dev` warns about it. To show a relation
from the other side, filter the other collection:
`(await getCollection("projects")).filter((project) => project.data.team.includes(person.id))`.

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

`await renderRichText(entry.data.body, entry.data)` turns a Markdoc field into
an HTML string. `transformRichText` returns the renderable tree instead, for a
project that wants to render with its own components. Both are async.

The second argument is the entry's or the singleton's data: its `_mica.images`
give each image in the text its file. Astro's image service optimizes it, as
`<Image>` does: `srcset` and `sizes` in 480, 800, 1200 and 1600 px, as WebP, up
to the width of the original. `{ optimize: { widths, sizes, format } }` in the
third argument changes that, `{ optimize: false }` keeps the original, and
`{ config }` adds Markdoc tags and nodes. An image with a `/path` that is not in
the content, for example one in `public/`, keeps its path. A relative path that
has no file gives a warning in the build log.

Without `await`, `set:html` still renders, because Astro waits for a Promise
there. But a check such as `{html && …}` is then always true.

## Setup guides for coding agents

`setup/` holds the guides that https://mica.build/setup.md sends a coding
agent to: a new or empty Astro project, and a project with content
collections. They ship with the package, so they match the installed version.

## Install

```bash
npm install @micacms/astro @micacms/core
```

Astro 7, `@micacms/core` and zod 4 are peer dependencies. npm installs zod. ESM only. Requires Node 24 or newer.
Licence: MIT.
