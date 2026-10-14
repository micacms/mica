# Set up Mica in a new or empty Astro project

For an Astro project that has no content collections yet. `SETUP.md` has
already created the project if there was none, and installed the packages.
The commands are in [reference.md](./reference.md#commands).

## 1. Ask the user about the content

Ask these questions, and wait for the answers:

1. What is the website for, and which pages does it need?
2. Which content do editors change? For each kind, ask:
   - Are there many of them (a collection: articles, projects, team members)
     or one (a singleton: site settings, the home page, the navigation)?
   - Which fields does it have? Which are required?
   - Does it have long formatted text (rich text) or images?
3. Do entries refer to other entries? For example, an article has an author
   from the team.
4. Should editors put a collection in a manual order?
5. Which images carry meaning, and which are decorative? An image that
   carries meaning gets `media({ accept: "image", alt: "required" })`, so that
   editors write its alt text. A decorative image gets
   `media({ accept: "image" })`. `accept: "image"` makes the field an Astro
   image on the pages; without it, the field is a path, for a PDF or another
   file.
6. Do they want example content, so that the pages show something at once?

Then show one proposal, and wait for a short approval or correction before
you write a file. Write for a reader who is new to Mica and may know little
about Astro: plain words, no code.

- **What editors will manage:** each collection and singleton, one line on
  what it is, and its fields in plain words ("Title — text, required",
  "Cover — an image, with its alt text under it").
- **The pages:** each page you will make, with its URL and what it shows.
- **Existing files that change:** in an empty Astro project, for example
  `src/pages/index.astro` or a layout: what changes, and why. Nothing else
  changes.
- Your recommendation where there is a choice, and the other option: manual
  order by dragging, or sorting by a field; alt text required for images that
  carry meaning.

End with: "Shall I go ahead like this? You can change any point." Change the
proposal until the user agrees, and later make no change that it did not
list without asking first.

## 2. Add Mica to the project

```bash
npx mica init
```

It writes `src/mica.ts` (a starter model) and `src/content.config.ts`. It
never overwrites a file. If `src/content.config.ts` already exists, it prints
the lines to add. Add them so that the existing collections stay.

## 3. Write the model

Replace the starter model in `src/mica.ts` (`posts` and `site`) with the
model the user agreed to. See
[reference.md](./reference.md#the-content-model) for the field types and the
rules. Then publish it and check it:

```bash
npx astro sync
npx mica check
```

`astro sync` fails with a clear message when the model breaks a rule. Fix
`src/mica.ts` and run it again. Before there is content, `mica check` warns
"No content for … yet" for each singleton. That is expected until step 4.

## 4. Add content (if the user wants examples)

Write one or two entries per collection, and fill in each singleton, as files
in `content/`. See [reference.md](./reference.md#the-files-on-disk). Use the
script in [reference.md](./reference.md#write-entries-with-a-script) for
entries, singletons and the manual order.

Then run `npx mica check` and fix every error.

## 5. Make the pages

Make the pages that the user asked for. For each collection, usually a list
page and a page per entry. Use the singletons in the layout, for example the
site name. See [reference.md](./reference.md#render-the-content-in-astro) for
rich text, images, relations and dates.

Keep the design simple unless the user asked for more.

## 6. Finish

Follow [finish.md](./finish.md).
