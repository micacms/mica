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
- Build the website once, and copy two results to a temporary directory
  outside the project: the website, which step 8 compares with, and Astro's
  data store, which `mica import` reads in step 6. Astro writes the store
  again when the collections change, so this copy is the only one.

  ```bash
  npx astro build
  cp -r dist <temporary directory>/dist-before
  cp node_modules/.astro/data-store.json <temporary directory>/data-store-before.json
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
4. Should editors put a collection in a manual order? If a collection has a
   number field that only sorts it, such as `order`, give the user the choice
   and the reason:
   - Keep it as a `number()` field. No page changes. Editors type numbers,
     and two entries can get the same one.
   - Make the collection `sortable: true`. Editors drag the entries into
     order, which is easier and cannot give two entries the same place. The
     import turns the numbers into `_order.json` (`--order`), the field goes, and each
     page that sorts by it sorts by `entry.data._mica.position` instead: one
     changed line per page.

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
| `image()` | `media({ accept: "image", alt: "required" })`, or `media({ accept: "image" })` for a decorative image |
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
   import reads. The pages can fail now; step 7 fixes them.

## 6. Convert the entries

`mica import` reads the copy of the data store from step 1, where Astro keeps
every entry after its own loader and schema. Each field of the Mica model takes
the value with the same name. The command converts it to the stored form: a
date to `"YYYY-MM-DD"` in UTC, a reference to a slug, an `image()` path to a
copy in the entry's `media/` folder, and the Markdown body to the rich-text
field `body`. It makes each slug from the entry id, and writes the files the
way the editor does.

```bash
npx mica import --from <temporary directory>/data-store-before.json \
  --map blog.cover.alt=coverAlt --order team=order
```

- `--map <collection>.<field>=<key>` takes a field from another key. Use it
  when a name changed, for the alt text of an image (`blog.cover.alt=coverAlt`),
  and for a body that goes to a rich-text field with another name
  (`blog.content=@body`). `--map` does not reach into the rows of a repeater.
- `--order <collection>=<field>` writes the manual order of a `sortable`
  collection from a number field, if the user chose that in step 3.
- Names after the options import only those collections.

The command lists every key it did not import, every id that gives the same
slug as another, and every image it did not find. Fix the model or add a
`--map`, delete the collection's directory in `content/`, and run it again.
Then make the changes to the bodies that the user decided in step 3 directly
in the `.mdoc` files, and run:

```bash
npx mica check
```

Read every warning: "Not read" means that an entry or a file is lost, and a
Markdoc warning means that some text does not render as before. If you cannot
fix a warning, list it in the report with the reason. Keep the source files.
Do not delete anything in this step.

If the import cannot express a conversion, for example a value that the model
splits into two fields, write a script for that part only, with `writeEntry`
from [reference.md](./reference.md#write-entries-with-a-script).

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
- An `image()` field is still `ImageMetadata` with `media({ accept: "image" })`,
  so its pages do not change. With `alt`, the value is `{ src, alt }`: use
  `entry.data.cover.src` where the page used `entry.data.cover`, and
  `entry.data.cover.alt` in place of the old alt-text field, or spread it:
  `<Image {...entry.data.cover} />`. See
  [reference.md](./reference.md#images).
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
- Delete the temporary directory with `dist-before` and the data store copy,
  and a conversion script if you wrote one.

Then run `npx mica check` and `npx astro build` once more.

## 10. Finish

Follow [finish.md](./finish.md). In the report, list each collection, the
number of entries before and after, and everything that changed or was not
converted.
