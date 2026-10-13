# Mica reference for setup

The guides link here. Read the section that a step names.

## Commands

| Command | What it does |
| --- | --- |
| `npx mica init` | Writes a starter `src/mica.ts` and `src/content.config.ts`. Never overwrites a file |
| `npx astro sync` | Runs the Mica loaders, which write the model to `content/.mica/schema.json` |
| `npx mica check` | Checks every entry against `content/.mica/schema.json`. Exit code 1 on an error |
| `npx mica import` | Moves Astro collections into Mica, from Astro's data store. See [content-collections.md](./content-collections.md#6-convert-the-entries) |
| `npx mica migrate-layout` | Moves entries into the layout of the model, after the first or the last rich-text or media field of a collection was added or removed |
| `npx mica` | Opens the editor in the browser. Only for the user; do not run it yourself |

`mica check` reads the model from `content/.mica/schema.json`. After every
change to `src/mica.ts`, run `npx astro sync` before `npx mica check`.

## The content model

`src/mica.ts` exports one `defineSite(...)`:

```ts
import { collection, defineSite, singleton, slug, text } from "@micacms/core";

export const site = defineSite({
  root: "./content",
  collections: {
    news: collection({
      label: "News",
      labelSingular: "Article",
      fields: { title: text({ required: true }), slug: slug({ from: "title" }) },
    }),
  },
  singletons: {
    settings: singleton({ label: "Website", fields: { siteName: text({ required: true }) } }),
  },
});
```

Rules that `defineSite` enforces:

- Collection, singleton and field names are lowerCamelCase and start with a
  letter: `news`, `teamMembers`, `publishedOn`. Not `team-members`.
- A name is a collection or a singleton, not both.
- Every collection has a `slug()` field. Its value is the name of the entry's
  file or folder, and the entry's address on the website. Use one; with more,
  the first is the slug unless `slugField` names another.
- A `relation()` names a collection of the same model.
- A `select()` has at least one option.

Collection options: `label` (required), `labelSingular`, `description`,
`titleField` (the field the editor shows as the entry's title; default
`title`, else the first `text()` field), `slugField`, `sortable` (editors can
order the entries by hand) and `defaultSort: { field, direction }` (a field
name or `"position"`). Without `defaultSort`, the editor lists the entries by
position: the manual order, or the slugs in alphabetical order before anybody
ordered them. Singleton options: `label`, `description`, `fields`.

Options of every field: `label`, `description`, `required`, `listed` (a column
in the entry list), `readonly`, `hidden`, `group`, `width` (`"full"`, `"half"`,
`"third"`).

| Field | Stored as | Other options |
| --- | --- | --- |
| `text()` | string | `minLength`, `maxLength`, `pattern` (must match the whole value), `placeholder`, `default` |
| `textarea()` | string | `minLength`, `maxLength`, `rows`, `placeholder`, `default` |
| `richText()` | Markdoc in its own `.mdoc` file | `toolbar`, `maxLength`, `default` |
| `number()` | number | `min`, `max`, `step`, `integer`, `unit`, `default` |
| `boolean()` | boolean | `default` |
| `date()` | `"YYYY-MM-DD"`, or an ISO timestamp with `includeTime: true` | `includeTime`, `min`, `max`, `default` |
| `email()` | string | `placeholder`, `default` |
| `url()` | string | `placeholder`, `default` |
| `slug()` | string | `from` (the field to make it from), `maxLength` |
| `select()` | string, or string[] with `multiple` | `options: [{ label, value }]` (required), `multiple`, `default` |
| `object()` | object | `fields` (required), `collapsible`, `collapsed` |
| `repeater()` | array of objects | `fields` (required), `min`, `max`, `itemLabel`, `addLabel` |
| `relation()` | the slug of an entry | `collection` (required), `multiple` |
| `media()` | a file path, or `{ path, alt }` with `alt` | `accept: "image" \| "document" \| "any"`, `multiple`, `max`, `alt: "required" \| "optional"` |
| `color()` | `"#rrggbb"` | `presets`, `default` |
| `coordinates()` | `{ "lat": 47.37, "lng": 8.54 }` | `defaultCenter`, `defaultZoom` |

There is no field for a free list of strings, such as free tags. Use
`select({ multiple: true, options })` for a fixed list, or a `repeater()` with
one `text()` field. Ask the user which one.

## The files on disk

A collection whose fields include `richText()` or `media()` stores each entry
as a folder. Any other collection stores each entry as one JSON file.

```
content/
├── .mica/schema.json            the model; written by `astro sync`, commit it
├── news/                        has rich text or media: a folder per entry
│   ├── _order.json              optional: the manual order of a sortable collection
│   └── hello-world/             the folder name is the slug
│       ├── index.json           all fields except rich text
│       ├── body.mdoc            one file per rich-text field, named after it
│       └── media/cover.jpg      the entry's own files
├── team/                        plain fields: one file per entry
│   └── anna-vogt.json           the file name is the slug
└── settings.json                a singleton (a folder with index.json if it has rich text or media)
```

- A slug has lowercase letters, digits and single hyphens: `hello-world`. The
  slug field in the JSON has the same value as the folder or file name.
- A media path in the JSON is relative to the entry's folder (`media/cover.jpg`),
  or starts with `/` and is relative to the content root (`/shared/logo.png`).
- A rich-text field in a repeater or an object gets a dotted file name:
  `sections.0.body.mdoc`.
- An empty field is `null` in the JSON. An empty list is `[]`, an unset
  boolean is `false`, and an `object()` holds its empty fields.
- Markdoc is Markdown plus `{% tags %}`. Raw HTML is not rendered: Markdoc
  escapes it.

### Write entries with a script

To write many entries, use the functions Mica itself uses. Then the files are
byte for byte what the editor writes. Run `npx astro sync` first, so that the
model is in `content/.mica/schema.json`. Put the script inside the project, so
that `@micacms/core` resolves from its `node_modules`.

```js
// scripts/write-entries.mjs — run with `node scripts/write-entries.mjs`
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import { collectionEntryPath, entryFiles, serializeEntry, singletonPath } from "@micacms/core";

const ROOT = "content";
const model = JSON.parse(await readFile(join(ROOT, ".mica/schema.json"), "utf8"));

export async function writeEntry(collection, slug, data) {
  const fields = model.collections[collection].fields;
  const base = collectionEntryPath(fields, collection, slug);
  for (const [path, contents] of Object.entries(entryFiles(fields, base, serializeEntry(fields, data)))) {
    await mkdir(dirname(join(ROOT, path)), { recursive: true });
    await writeFile(join(ROOT, path), contents);
  }
}

// A singleton: `content/<name>.json`, or `content/<name>/index.json` with rich text or media.
export async function writeSingleton(name, data) {
  const fields = model.singletons[name].fields;
  for (const [path, contents] of Object.entries(entryFiles(fields, singletonPath(fields, name), serializeEntry(fields, data)))) {
    await mkdir(dirname(join(ROOT, path)), { recursive: true });
    await writeFile(join(ROOT, path), contents);
  }
}

// The manual order of a sortable collection. Slugs that it does not name come after.
export async function writeOrder(collection, slugs) {
  await writeFile(join(ROOT, collection, "_order.json"), `${JSON.stringify(slugs, null, 2)}\n`);
}

// Example: `data` has every field, rich text as a Markdoc string, and media as
// `media/<file>`, or `{ path, alt }` for a `media({ alt })` field.
// await writeEntry("news", "hello-world", {
//   title: "Hello, world",
//   slug: "hello-world",
//   publishedOn: "2026-01-15",
//   cover: { path: "media/cover.jpg", alt: "The team at the opening" },
//   body: "The first article.",
// });
```

The script does not copy media files. Copy each file to
`content/<collection>/<slug>/media/<file>` yourself. Delete the script when the
content is written, unless the user wants to keep it.

## Render the content in Astro

`micaCollections(site)` makes one Astro collection per collection and per
singleton. Pages use the normal Astro API.

```astro
---
// src/pages/news/[slug].astro
import { getCollection, getEntry } from "astro:content";
import { renderRichText } from "@micacms/astro";

export async function getStaticPaths() {
  const news = await getCollection("news");
  return news.map((article) => ({ params: { slug: article.id }, props: { article } }));
}

const { article } = Astro.props;
const settings = await getEntry("settings", "settings");
---
<h1>{article.data.title}</h1>
<div set:html={renderRichText(article.data.body)} />
<footer>{settings?.data.siteName}</footer>
```

- `entry.id` is the slug.
- A singleton is a collection with one entry. Its id is the singleton's name:
  `getEntry("settings", "settings")`. It is `undefined` until it has content.
- Rich text is a Markdoc string. `renderRichText()` returns HTML in an
  `<article>` element. There is no `render(entry)` and no `<Content />` for
  Mica collections.
- A date is a `"YYYY-MM-DD"` string. `new Date()` reads it as UTC midnight,
  so format it in UTC, or it shows the day before west of UTC:
  `new Date(value).toLocaleDateString("en-GB", { timeZone: "UTC" })`.
- A relation is a slug: `await getEntry("team", article.data.author)`.
- Do not depend on the order of `getCollection()`. Sort by a date field, or
  by position for a `sortable` collection:
  `entries.sort((a, b) => a.data._mica.position - b.data._mica.position)`.

### Images

A `media({ accept: "image" })` field reaches Astro as an image that Astro
optimizes, the same as `image()` in an Astro collection: `ImageMetadata`. With
`alt`, it is `{ src, alt }`. No helper is needed:

```astro
---
import { Image } from "astro:assets";
const { cover } = article.data; // media({ accept: "image", alt: "required" })
---
{cover && <Image {...cover} />}
```

- Without `alt`, the field is the image itself: `<Image src={logo} alt="" />`.
- A `media({ accept: "image", multiple: true })` field is an array of them.
- On disk, the field still holds `media/cover.jpg`, or `{ path, alt }`.
- A `media()` without `accept: "image"`, for example a PDF, is a path from the
  content root: `news/hello-world/media/plan.pdf`. To link to it, use
  `import.meta.glob("../../content/**/*.pdf", { query: "?url", import: "default", eager: true })`.

### What Markdoc renders differently from Astro's Markdown

- Headings have no `id`, and code blocks are not highlighted. To add them,
  pass Markdoc nodes in `renderRichText(source, { config })`; see
  https://markdoc.dev/docs/nodes. Ask the user first.
- Raw HTML, MDX components and footnotes are not rendered. `mica check` warns
  about them.
- A `{% tag %}` renders only if `config.tags` declares it.
