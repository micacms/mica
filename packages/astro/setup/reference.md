# Mica reference for setup

The guides link here. Read the section that a step names.

## Commands

| Command | What it does |
| --- | --- |
| `npx mica init` | Writes a starter `src/mica.ts` and `src/content.config.ts`. Never overwrites a file |
| `npx astro sync` | Runs the Mica loaders, which write the model to `content/.mica/schema.json` |
| `npx mica check` | Checks every entry against `content/.mica/schema.json`. Exit code 1 on an error |
| `npx mica import` | Moves Astro collections into Mica, from Astro's data store. See [content-collections.md](./content-collections.md#6-convert-the-entries) |
| `npx mica start` | Opens the editor in the browser. Only for the user; do not run it yourself |

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
- Every collection has one `slug()` field among its own fields. Its value is
  the name of the entry's file or folder, and the entry's address on the
  website. A second one there stops the build; a slug in an object (such as one
  per language) is fine and can be empty.
- A `relation()` names a collection of the same model.
- A `select()` has at least one option.

Collection options: `label` (required), `labelSingular`, `description`,
`titleField` (the field the editor shows as the entry's title; default
`title`, else the first `text()` field), `slugField`, `sortable` (editors can
order the entries by hand), `defaultSort: { field, direction }` (a field
name or `"position"`) and `url` (the page of an entry on the website, such as
`/news/{slug}`; with `MICA_SITE_URL`, the editor links to it). Without `defaultSort`, the editor lists the entries by
position: the manual order, or the slugs in alphabetical order before anybody
ordered them. Singleton options: `label`, `description`, `fields`, `url`
(such as `/about`).

Options of every field: `label`, `description`, `required`, `listed` (a column
in the entry list), `readonly`, `hidden`, `group`, `width` (`"full"`, `"half"`,
`"third"`).

| Field | Stored as | Other options |
| --- | --- | --- |
| `text()` | string | `minLength`, `maxLength`, `pattern` (must match the whole value), `patternMessage` (what the editor reads when it does not), `placeholder`, `default` |
| `textarea()` | string | `minLength`, `maxLength`, `rows`, `placeholder`, `default` |
| `richText()` | Markdoc in its own `.mdoc` file | `toolbar`: `"minimal"`, `"default"`, `"full"` (with tables and images), or a list of features; `maxLength`, `default` |
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
| `coordinates()` | `{ "lat": 47.37, "lng": 8.54 }` | `map`: a map in the editor to pick the place. `"liberty"`, `"bright"` or `"positron"` (OpenFreeMap styles), or `{ style, hosts }` with `https` addresses. Without `map`, there is no map |
| `tags()` | `["design", "web"]` | `max`, `maxLength`, `suggestions`, `default` |

For a free list of strings, such as tags or keywords, use `tags()`. For a fixed
list of choices, use `select({ multiple: true, options })`.

## The files on disk

Each entry and each singleton is a folder with `index.json`.

```
content/
├── .mica/schema.json            the model; written by `astro sync`, commit it
├── news/                        a collection: a folder per entry
│   ├── _order.json              optional: the manual order of a sortable collection
│   └── hello-world/             the folder name is the slug
│       ├── index.json           all fields except rich text
│       ├── body.mdoc            one file per rich-text field, named after it
│       └── media/cover.jpg      the entry's own files
├── settings/                    a singleton
│   └── index.json
└── media/                       shared media, such as a logo
```

- A slug has lowercase letters, digits and single hyphens: `hello-world`. The
  slug field in the JSON has the same value as the folder or file name. Where
  they differ, Mica uses the name.
- A media path in the JSON is relative to the entry's folder (`media/cover.jpg`),
  or starts with `/` and is relative to the content root (`/shared/logo.png`).
- A rich-text field in an object gets a dotted file name: `seo.intro.mdoc`. In
  a repeater, each row with rich text has a key, `"_key"`, as its first value: a
  letter, then 3 to 15 letters or digits, different for each row of the list.
  The file names the row by its key: `sections.k3f9a2.body.mdoc`.
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

import { entryFiles, entryFolder, serializeEntry } from "@micacms/core";

const ROOT = "content";
const model = JSON.parse(await readFile(join(ROOT, ".mica/schema.json"), "utf8"));

async function write(folder, fields, data) {
  for (const [path, contents] of Object.entries(entryFiles(folder, serializeEntry(fields, data)))) {
    await mkdir(dirname(join(ROOT, path)), { recursive: true });
    await writeFile(join(ROOT, path), contents);
  }
}

// An entry: `content/<collection>/<slug>/index.json`, and a `.mdoc` file for each rich-text field.
export async function writeEntry(collection, slug, data) {
  await write(entryFolder(collection, slug), model.collections[collection].fields, data);
}

// A singleton: `content/<name>/index.json`.
export async function writeSingleton(name, data) {
  await write(entryFolder(name), model.singletons[name].fields, data);
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

`serializeEntry` gives each repeater row with rich text a new key when the row
has none. If the script writes an entry a second time, keep the keys: read the
`_key` of each row from the entry's `index.json` and put it into the data.
Otherwise the old `.mdoc` files of those rows stay behind.

The script does not copy media files. Copy each file to
`content/<collection>/<slug>/media/<file>` yourself. Delete the script when the
content is written, unless the user wants to keep it.

## Render the content in Astro

`micaCollections(site)` makes one Astro collection per collection and per
singleton. Pages use the normal Astro API.

```astro
---
// src/pages/news/[slug].astro
import { getCollection } from "astro:content";
import { getSingleton, renderRichText } from "@micacms/astro";
import { site } from "../../mica";

export async function getStaticPaths() {
  const news = await getCollection("news");
  return news.map((article) => ({ params: { slug: article.id }, props: { article } }));
}

const { article } = Astro.props;
const settings = await getSingleton(site, "settings");
const body = await renderRichText(article.data.body, article.data);
---
<h1>{article.data.title}</h1>
<div set:html={body} />
<footer>{settings.siteName}</footer>
```

- `entry.id` is the slug.
- A singleton is a collection with one entry. Its id is the singleton's name.
  `getSingleton(site, "settings")` returns its data with its type, and fails the
  build while it has no content.
- Rich text is a Markdoc string. `await renderRichText(text, entry.data)`
  returns HTML in an `<article>` element. It is async: use `await`. There is no
  `render(entry)` and no `<Content />` for Mica collections.
- A date is a `"YYYY-MM-DD"` string. `new Date()` reads it as UTC midnight,
  so format it in UTC, or it shows the day before west of UTC:
  `new Date(value).toLocaleDateString("en-GB", { timeZone: "UTC" })`.
- A relation is a slug. `related` from `@micacms/astro/relations` returns the
  entry, typed, and leaves out a missing one with a warning in `astro dev`:
  `await related("team", article.data.author)`. `relatedAll` does the same for
  a list.
- Do not depend on the order of `getCollection()`. Sort by a date field, or
  in the editor's order: `entries.sort(inEditorOrder)` (from `@micacms/astro`).
  It follows the collection's `defaultSort`, else the manual order.

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
- An image in rich text (`![Alt](media/plan.png)`, from the entry's folder, or
  `/media/logo.png` from the content root) gets its file from the entry's data:
  `await renderRichText(entry.data.body, entry.data)`. Astro optimizes it.
  The site needs Astro's image service, `sharp`, as for `<Image>`.
- A `media()` without `accept: "image"`, for example a PDF, is a path from the
  content root: `news/hello-world/media/plan.pdf`. To link to it, use
  `import.meta.glob("../../content/**/*.pdf", { query: "?url", import: "default", eager: true })`.

### What Markdoc renders differently from Astro's Markdown

- Headings have no `id`, and code blocks are not highlighted. To add them,
  pass Markdoc nodes in `renderRichText(source, entry.data, { config })`; see
  https://markdoc.dev/docs/nodes. Ask the user first.
- Raw HTML, MDX components and footnotes are not rendered. `mica check` warns
  about them.
- A `{% tag %}` renders only if `config.tags` declares it.
