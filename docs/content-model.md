# The content model

One definition — a plain module, `src/mica.ts` by convention — decides five
things at once:

- the TypeScript types the website renders against;
- the Zod validators Mica checks writes with;
- the admin's navigation, list columns and forms;
- the Astro collections;
- **the layout on disk.**

None of them can drift, because there is only one statement of the model. The
DSL is not Zod with extra steps: `text({ label: "Title", maxLength: 120 })`
carries editorial meaning that `z.string().max(120)` cannot — a label, a width,
a group. Zod is generated from the DSL, never the reverse.

```ts
// src/mica.ts
import { collection, defineSite, singleton, slug, text } from "@micacms/core";

export const site = defineSite({
  root: "./content",
  collections: { projects: collection({ label: "Projects", fields: { … } }) },
  singletons: { theme: singleton({ label: "Theme", fields: { … } }) },
});
```

**Collections** have many entries, each with a slug. **Singletons** are one
document — site settings, a theme, navigation — with no slug and no list.

**`root`** is where the content lives, relative to the Astro project root — like
Astro's own `glob({ base })`, and not relative to the file it is written in or
to the directory the build was started from. It defaults to `./content`. An
absolute path is left alone, which is what a project whose content is a separate
repository, checked out elsewhere by CI, needs.

The model imports nothing from Astro, which is why it is its own module: a
script, a test or a second consumer can read it without pulling a build system
in behind it.

## Becoming Astro collections

```ts
// src/content.config.ts
import { micaCollections } from "@micacms/astro";

import { site } from "./mica";

export const collections = micaCollections(site);
```

Nothing goes in `astro.config`. The loaders are handed Astro's project root and,
in dev, its file watcher, so they resolve `root`, publish the model to
`content/.mica/schema.json` for Mica, and reload when an entry is saved.

### Collections Mica does not own

`micaCollections` returns a plain object, so ordinary Astro collections spread
in beside it:

```ts
import { defineCollection, z } from "astro:content";
import { glob } from "astro/loaders";

const glossary = defineCollection({
  loader: glob({ pattern: "**/*.md", base: "./src/glossary" }),
  schema: z.object({ term: z.string() }),
});

export const collections = { ...micaCollections(site), glossary };
```

Only what is in the model reaches Mica, so an editor sees the collections that
are theirs to edit and nothing else — while Markdown that belongs to whoever
maintains the templates stays in the repository, reviewed in a pull request.
Pages read both with the same `getCollection`. Keep the names distinct: a clash
is resolved by whichever spread comes last, silently.

`examples/muster-consulting` does exactly this, with a `glossary` collection
beside four Mica ones.

---

## Collections

```ts
projects: collection({
  label: "Projects",
  labelSingular: "Project",
  description: "Reference work, newest first.",
  defaultSort: { field: "position", direction: "asc" },
  sortable: true,
  fields: { … },
});
```

| Option          | Meaning                                                                                  |
| --------------- | ---------------------------------------------------------------------------------------- |
| `label`         | Plural name in the navigation. Required                                                  |
| `labelSingular` | Used for buttons like "New project"                                                      |
| `description`   | Shown above the list                                                                     |
| `titleField`    | Field key used as the entry title. Defaults to `title`                                   |
| `slugField`     | Field key holding the slug. Defaults to the first `slug()` field                         |
| `defaultSort`   | `{ field, direction }` over `title`, `position`, `createdAt`, `updatedAt`, `publishedAt` |
| `sortable`      | Lets editors drag entries into an order, kept in `_order.json`                           |

Every collection needs a slug field: it is the entry's identity in the
repository and its address on the website. That is the field that `slugField`
names. If there is none, it is the first `slug()` field.

Singletons take `label`, `description` and `fields`, and nothing else.

---

## Options every field has

| Option        | Meaning                                       |
| ------------- | --------------------------------------------- |
| `label`       | Falls back to the field key                   |
| `description` | Help text under the input                     |
| `required`    | Empty values are rejected                     |
| `listed`      | Show this field as a column in the entry list |
| `readonly`    | Rendered, not editable                        |
| `hidden`      | Kept in the payload, hidden from the editor   |
| `group`       | Fields sharing a group are boxed together     |
| `width`       | `"full"` (default), `"half"`, `"third"`       |

---

## Field types

| Field           | Stored as                           | Options beyond the shared ones                                  |
| --------------- | ----------------------------------- | --------------------------------------------------------------- |
| `text()`        | string                              | `minLength`, `maxLength`, `pattern`, `placeholder`, `default`   |
| `textarea()`    | string                              | `minLength`, `maxLength`, `rows`, `placeholder`, `default`      |
| `richText()`    | **a `.mdoc` file beside the entry** | `toolbar`, `maxLength`, `default`                               |
| `number()`      | number                              | `min`, `max`, `step`, `integer`, `unit`, `default`              |
| `boolean()`     | boolean                             | `default`                                                       |
| `date()`        | ISO string                          | `includeTime`, `min`, `max`, `default`                          |
| `email()`       | string                              | `placeholder`, `default`                                        |
| `url()`         | string                              | `placeholder`, `default`                                        |
| `slug()`        | string                              | `from` (field key to derive from), `maxLength`                  |
| `select()`      | string, or string[]                 | `options: [{ label, value }]` (required), `multiple`, `default` |
| `object()`      | nested object                       | `fields` (required), `collapsible`, `collapsed`                 |
| `repeater()`    | array of objects                    | `fields` (required), `min`, `max`, `itemLabel`, `addLabel`      |
| `relation()`    | the target's slug                   | `collection` (required), `multiple`                             |
| `media()`       | repository path, or `{ path, alt }` | `accept: "image" \| "document" \| "any"`, `multiple`, `max`, `alt` |
| `color()`       | hex string                          | `presets`, `default`                                            |
| `coordinates()` | `{ lat, lng }`                      | `defaultCenter`, `defaultZoom`                                  |

A few that repay a closer look:

**`text({ pattern })`** must match the whole value, like the HTML `pattern`
attribute: `"[A-Z]{2}"` accepts `CH` and refuses `CHE`. Mica compiles it with
the `u` flag, so an emoji is one character. For "contains", write `.*x.*`. An
invalid pattern stops the model from loading.

**`richText()`** is [Markdoc](https://markdoc.dev), stored in its own file and
_absent_ from `index.json`. Readable in a diff, and it cannot inject a script
into the built site: Markdoc escapes raw HTML and renders an undeclared
`{% tag %}` as nothing. `toolbar` limits what an editor can add, with the
buttons and with the shortcuts while typing — `bold`, `italic`, `strike`,
`heading`, `bulletList`, `orderedList`, `blockquote`, `link`, `horizontalRule`.
Stored text with other nodes still loads. Text with something the editor cannot
show — an image, a table, a `{% tag %}`, front matter — opens read-only, with
the reason.

**`media()`** holds a path. In the file it is relative to the entry's
directory, like `media/exterior.jpg`, or it starts with `/` for a file elsewhere
in the content root. The website and the editor read it relative to the content
root: `projects/haus-a/media/exterior.jpg`. The file is uploaded into the entry's
own directory, so an entry is self-contained and renaming it is a directory move.
In Astro, a `media({ accept: "image" })` field is an image, as with Astro's
`image()`: `ImageMetadata`, optimised at build time and emitted into `_astro/`,
with nothing fetched at runtime. With `alt` it is `{ src, alt }`, so
`<Image {...entry.data.cover} />` is enough. Other media stay paths from the
content root.

**`media({ alt: "required" })`** stores `{ path, alt }` and shows an alt-text
input under the preview. `"required"` refuses an image without alt text;
`"optional"` allows one. Use it for every image that carries meaning, because
a path alone leads to images with `alt=""`. A `media()` without the option
stores a plain path, for a decorative image or a document. A field with content
can get the option: a stored path reads as one without alt text. With
`"optional"` nothing else changes; with `"required"` the build fails until each
of those images has alt text. Removing the option drops the stored alt texts at
the next save.

**`relation()`** stores the target entry's slug. Pointing at a collection that
does not exist is caught when the model is defined, not when a page renders.

**`coordinates()`** is two numeric inputs with paste-parsing for
`47.3769, 8.5417`. There is no map in the admin — that would mean a tile
provider the editor has to reach. Maps belong on the website.

---

## What it produces on disk

The layout follows from the fields, and is therefore the same for every entry
in a collection. Rich text and media need files beside the entry; a collection
with neither stores each entry as one JSON file.

```
content/
├── .mica/schema.json                   the model, published for Mica
├── projects/                           rich text and media → a directory each
│   ├── _order.json                     ["haus-a", "haus-b"]
│   ├── haus-a/
│   │   ├── index.json                  the structured fields
│   │   ├── summary.mdoc                one file per rich-text field
│   │   └── media/exterior.jpg          colocated with the entry that uses it
│   └── haus-b/
├── team/                               plain fields → one file each
│   └── anna-vogt.json
└── theme.json                          a singleton, plain fields
```

JSON for structure, Markdoc for prose. Keys are written in model order, so the
same input produces byte-identical output and a diff shows only what changed.

---

## Changing the model

Edit the model, run the build, commit both:

```bash
npx astro build            # rewrites content/.mica/schema.json
git commit -am "Add an architect field to projects"
```

The website picks it up immediately — a typo in a template is a build error.
Mica picks it up when it restarts.

Adding a **required** field to a collection that already has entries makes
those entries invalid until they are edited. The website build is where you
find out, which is the right place. For most changes there is no migration to
write: entries are JSON files validated against whatever the model currently
says.

The exception is a change of layout. The first `richText()` or `media()` field
in a collection changes where Mica and the website look for its entries: in
`<slug>/index.json`, not in `<slug>.json`. Removing the last such field changes
it back. A singleton changes the same way. The files do not move, so the build
fails and the local editor refuses to start, and both name the files. Run
`npx mica migrate-layout`: it moves each entry, and lists the rich-text and
media files that it removes because no field reads them any more. Run
`npx mica check`, and commit the result with the model change.

Removing a field leaves its value in the files until each entry is saved again.
Nothing reads it, and the next save drops it.
