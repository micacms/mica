# @micacms/model

> **Experimental.** Pre-1.0: the API and the content format can still change
> without notice. Use it at your own risk.

The content model for Mica — a Git-native content editor for static Astro
websites — and the format its entries take on disk.

One model file is the single source of truth for TypeScript types, runtime
validation, the CMS's forms, the layout on disk and the Astro collection
schemas. Nothing is generated; everything is derived.

```ts
import { defineSite, collection, singleton, text, slug, richText } from "@micacms/model";

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

- **The layout on disk.** A collection with rich text or media stores each
  entry as a directory (`index.json`, one `.mdoc` per rich-text field,
  `media/`); one with neither stores each entry as a single `.json` file.
  `serializeEntry` and `parseEntry` are the round trip, and they are
  byte-stable: equal content produces equal bytes, whatever order the keys
  arrived in.
- **How content is read.** A `ContentSource` is the small interface everything
  reads through. `@micacms/model/node` provides `fileSystemSource(root)` for a
  working tree; `@micacms/connectors` provides the ones backed by a provider.
- **How a project describes itself to Mica.** `createManifest(site, by)` wraps
  the model in a versioned envelope, which `@micacms/astro` writes to
  `MANIFEST_PATH` (`.mica/schema.json`) inside the content root. Mica reads it
  from there; nothing else passes between the two.

## Install

```bash
npm install @micacms/model
```

Requires Node 22.5 or newer. Licence: MIT.
