# @micacms/core

> **Public.** From 1.0, semver covers what `@micacms/core` and
> `@micacms/core/node` export. `@micacms/core/internal` is for Mica's own
> packages and can change in any release. Pre-1.0: the API and the content
> format can still change in a minor release.

The core of Mica — a Git-native content editor for static Astro websites: the
content model, the format its entries take on disk, and the `ContentSource`
contract that everything reads through.

One model file is the single source of truth for TypeScript types, runtime
validation, the CMS's forms, the layout on disk and the Astro collection
schemas. Nothing is generated; everything is derived.

```ts
import { defineSite, collection, singleton, text, slug, richText } from "@micacms/core";

export const site = defineSite({
  collections: {
    news: collection({
      label: "News",
      fields: {
        title: text({ label: "Title", required: true, maxLength: 120 }),
        slug: slug({ from: "title" }),
        body: richText({ label: "Body" }),
      },
    }),
  },
  singletons: {
    theme: singleton({ label: "Theme", fields: { /* … */ } }),
  },
});
```

The DSL is not Zod with different spelling. `text({ label: "Title", maxLength: 120 })`
carries editorial meaning that `z.string().max(120)` cannot — a label, a width, a
group. Zod is generated from the DSL, not the other way round.

## What it also decides

- **The files on disk.** Each entry and each singleton is a folder:
  `index.json`, one `.mdoc` per rich-text field, and `media/`.
  `serializeEntry` and `parseEntry` are the round trip, and they are
  byte-stable: equal content produces equal bytes, whatever order the keys
  arrived in.
- **How content is read.** A `ContentSource` is the small interface everything
  reads through. `@micacms/core/node` provides `fileSystemSource(root)` for a
  working tree.
- **How a project describes itself to Mica.** `createManifest(site, by)` wraps
  the model in a versioned envelope, which `@micacms/astro` writes to
  `MANIFEST_PATH` (`.mica/schema.json`) inside the content root. Mica reads it
  from there; nothing else passes between the two.

## Install

```bash
npm install @micacms/core
```

zod 4 is a peer dependency. ESM only. Requires Node 24 or newer. Licence: MIT.
