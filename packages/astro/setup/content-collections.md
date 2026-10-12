# Move Astro content collections to Mica

For an Astro project whose content is in Astro content collections, usually
Markdown or MDX files with frontmatter. `SETUP.md` has already installed the
packages. The commands are in [reference.md](./reference.md#commands).

Mica stores content in its own format (JSON and Markdoc in `content/`), so the
entries are converted once. The website then reads them through
`micaCollections()`. Collections that Mica does not manage stay as they are.

## 1. Prepare

- The Git working tree must be clean (`git status`). If it is not, ask the
  user to commit or stash first.
- Ask the user whether to work on a new branch, and make it if they agree.
- Build the website once, and copy the result to a temporary directory
  outside the project. Step 8 compares with it.

  ```bash
  npx astro build
  cp -r dist <temporary directory>/dist-before
  ```

## 2. Make an inventory

Read `src/content.config.*` (or `src/content/config.*`), every page, layout and
endpoint that calls `getCollection`, `getEntry`, `render` or `reference`, and
the integrations in `astro.config.*`. For each collection, find:

- the loader and the files: `glob()` with `.md`, `.mdx`, `.json` or `.yaml`, or
  something else;
- the schema, field by field;
- the number of entries, and whether the ids have folders (`2024/hello`);
- what the bodies contain: plain Markdown, raw HTML, footnotes, MDX imports and
  components, images with relative paths;
- the pages and URLs that use the collection.

## 3. Ask the user

Show the inventory as a short table, and ask:

1. Which collections should Mica manage? Content that only developers change,
   such as documentation in the repository, can stay an Astro collection.
2. The model you propose for each collection, mapped as in step 4.
3. Every case where content cannot move without a change:
   - MDX components in a body. Markdoc does not run them. Options: a Markdoc
     tag that the website declares and renders, a field, or keep that
     collection in Astro. Remove the `import` lines too, and the text that
     refers to a component you drop.
   - Raw HTML in a body. Markdoc does not render it. Options: Markdown (`<b>`
     becomes `**`), a Unicode character, a Markdoc tag, or remove it. Some tags
     have no Markdown form (`<sub>`, `<sup>`, `<kbd>`, `<mark>`). Do not change
     HTML inside code blocks or inline code: that is text.
   - Footnotes (`[^1]`). Markdoc shows them as text. Options: a normal
     paragraph or a link. Remove the `[^1]` markers from the text too.
   - Images in a body (`![](./photo.jpg)`). The rich-text editor has no images.
     Options: a `media()` field or a `repeater()` with images, or files in
     `public/` with absolute URLs, which Astro does not optimize.
   - Ids with folders, or ids that are not slugs. They become flat slugs, so
     the URL can change. Options: keep the URL with Astro `redirects`, or
     accept the new URL.
   - A free list of strings, such as tags. See
     [reference.md](./reference.md#the-content-model).
   - Headings lose their `id` and code blocks lose their highlighting, unless
     the website adds them. See
     [reference.md](./reference.md#what-markdoc-renders-differently-from-astros-markdown).
4. Should editors put a collection in a manual order?

Wait for the answers.

## 4. Map the schema to the model

| Astro schema | Mica field |
| --- | --- |
| `z.string()` | `text()`, or `textarea()` for long plain text |
| `z.string().url()` / `.email()` | `url()` / `email()` |
| `z.number()` | `number()` |
| `z.boolean()` | `boolean()` |
| `z.date()`, `z.coerce.date()` | `date()` (stored as `"YYYY-MM-DD"`) |
| `z.enum([...])` | `select({ options })` |
| `z.array(z.enum([...]))` | `select({ multiple: true, options })` |
| `image()` | `media({ accept: "image" })` |
| `reference("authors")` | `relation({ collection: "authors" })` |
| `z.object({...})` | `object({ fields })` |
| `z.array(z.object({...}))` | `repeater({ fields })` |
| `.optional()` | the field without `required: true` |
| the Markdown body | `richText()`, usually named `body` |
| the entry id | a `slug()` field |

Give the Mica collection the same name as the Astro collection, so that
`getCollection("blog")` in the pages keeps working. The names must be
lowerCamelCase.

## 5. Add the model

1. Run `npx mica init`. It keeps your `src/content.config.ts` and prints the
   lines to add.
2. Replace the starter model in `src/mica.ts` (`news` and `settings`) with the
   model the user agreed to.
3. In `src/content.config.ts`, remove the definitions of the collections that
   Mica now manages, and add `...micaCollections(site)`. Keep the others.
4. Run `npx astro sync`. It writes `content/.mica/schema.json`, which the
   conversion script reads. The pages can fail now; step 7 fixes them.

## 6. Convert the entries

Write a conversion script inside the project, for example
`scripts/convert-to-mica.mjs`. Use `writeEntry` from
[reference.md](./reference.md#write-entries-with-a-script). For each entry,
the script:

1. Reads the file and its frontmatter. For YAML, use a parser that the project
   can already import (Astro depends on `yaml`), or install one for the
   conversion only and remove it in step 9.
2. Makes the slug from the id: lowercase, folders and other characters turned
   into single hyphens. Two ids must not give the same slug.
3. Builds `data` with every field of the model, in the stored form:
   - a date from the text in the frontmatter, as `"YYYY-MM-DD"`. Take an ISO
     date as it is written. Parse any other text in UTC, for example
     `` new Date(`${text} UTC`).toISOString().slice(0, 10) ``, and compare a few
     results with the source. Never format a local-time `Date`: in a time zone
     east of UTC, that gives the day before.
   - a relation as the slug of the other entry;
   - the body as a Markdoc string, changed as the user decided in step 3;
   - the slug field equal to the slug.
4. Copies the image of each `image()` field to
   `content/<collection>/<slug>/media/<file>`, and stores `media/<file>` in the
   field. The path in the frontmatter is relative to the source entry's file.
   Body images go where the user decided in step 3.
5. Calls `writeEntry(collection, slug, data)`.
6. Prints a line for each entry, and a list of everything it changed or could
   not convert.

Keep the source files. Do not delete anything in this step.

Run the script, then:

```bash
npx mica check
```

Fix the script, not the output, until `mica check` reports 0 errors. Before
each run, delete the converted collection's directory in `content/` (not
`content/.mica/`), so that no file from an earlier run stays. Read every warning: "Not read" means that an
entry or a file is lost, and a Markdoc warning means that some text does not
render as before. If you cannot fix a warning, list it in the report with the
reason.

## 7. Change the pages

Look at every file from the inventory: pages, layouts, components and
endpoints such as `rss.xml.js`. See
[reference.md](./reference.md#render-the-content-in-astro).

- `render(entry)` and `<Content />` become
  `<div set:html={renderRichText(entry.data.body)} />`.
- A date was a `Date` and is now a `"YYYY-MM-DD"` string:
  - Format it in UTC. If a formatter is shared, check its other callers: a
    `Date` made in local time now shows the day before.
  - Sort with `b.data.pubDate.localeCompare(a.data.pubDate)`. Subtracting
    strings gives `NaN`, and the list is then not sorted, with no error.
  - Where an API needs a `Date`, such as the RSS `pubDate`, pass
    `new Date(entry.data.pubDate)`.
- An image was `ImageMetadata` and is now a path from the content root. Create
  `src/lib/media.ts` from [reference.md](./reference.md#images), and use
  `mediaImage()`.
- A reference was `{ collection, id }` and is now a slug:
  `getEntry("authors", entry.data.author)`.
- `entry.id` is the slug. If ids had folders, update the links, and add
  `redirects` in `astro.config` if the user wants the old URLs to keep working.
- A spread such as `{...post.data}` now also passes `_mica` and the new types.
  Pass the fields one by one.
- A layout or component typed with `CollectionEntry<"blog">["data"]` can also
  be used by a page that is not an entry, with the old types. Give it its own
  props type.

## 8. Compare the website

```bash
npx astro build
```

Compare `dist` with `dist-before` from step 1: the list of HTML files, and two
or three converted pages. Every page that is missing or new must have a
reason: a changed URL with a redirect, or a decision of the user. Expect these
differences, and tell the user about them:

- headings without `id`, and code blocks without highlighting;
- body images from `public/`, which Astro does not optimize;
- dates that showed the local day and now show the stored day, and times in
  `<time datetime>` and the RSS feed that are now midnight UTC.

## 9. Clean up

Ask the user before each of these:

- Delete the source files of the converted collections, and the images that
  are now copies in `content/`, unless another file still imports them.
- Remove integrations and dependencies that only the old collections needed,
  such as `@astrojs/mdx` when no MDX is left, and those that only the
  conversion needed. Change text in the content that describes what you
  removed.
- Delete the conversion script, or keep it for the record.

Then run `npx mica check` and `npx astro build` once more.

## 10. Finish

Follow [finish.md](./finish.md). In the report, list each collection, the
number of entries before and after, and everything that changed or was not
converted.
