# Change Log - @micacms/astro

This log was last generated on Mon, 26 Oct 2026 14:15:44 GMT and should not be manually modified.

## 0.15.0
Mon, 26 Oct 2026 14:15:44 GMT

### Minor changes

- Breaking: the model uses id() and {id} in place of slug() and {slug}; related() and relatedAll() take IDs.

### Patches

- The live preview takes the parser that the site's Astro brings, and checks at the start that it places the fields right: @astrojs/compiler-rs is no longer a peer dependency. With the parser of Astro 7.0 to 7.2, dates, numbers and options cannot be clicked, and the dev server says so. The marker of the dev server says whether its port is confirmed.

## 0.14.0
Sun, 25 Oct 2026 18:05:04 GMT

### Patches

- When two dev servers of one content root run and one of them stops, the other one writes its note for the local editor again within two seconds, so that the editor keeps its preview.

## 0.13.0
Sat, 24 Oct 2026 13:39:21 GMT

### Minor changes

- @micacms/astro/preview: micaPreview() marks the text fields of each page in MICA_PREVIEW=1 astro dev, so that the editor's live preview can open a field from its text.
- In the live preview, renderRichText and transformRichText mark each block of a rich text, so that a click on a paragraph opens the field with the cursor in that paragraph.
- In the live preview, an image of a media field with alt text is marked too, with its place in a gallery.
- The hover label of the live preview can offer a second action, such as editing the related entry that a text comes from.
- In the live preview, dates, numbers, options, tags, maps and images without alt text can be clicked too: the preview's dev server reads the templates with Astro's parser and finds the fields that each element shows, also through components, with no change to the templates. A field of the page's own entry comes first; the others are buttons in its label. A rich text has one outline, and the rest of the page dims around the field. New peer dependency: @astrojs/compiler-rs, which Astro 7 installs.

### Patches

- The local editor's preview finds the dev server also when Astro takes another port, with micaPreview() in the config. The dev server deletes its note for the editor also on Ctrl+C, and never the note of another dev server.
- A content root that cannot be written, such as the read-only one of a self-hosted preview, gets a warning for the index of a reference set, as for the model, and the site builds.

### Updates

- The setup guides for coding agents use `mica start --preview` for the live preview, in place of a separate dev:preview script.
- The setup guides for coding agents add the live preview: micaPreview() in the Astro config and a dev:preview script.
- In the live preview, a rich text with unpublished changes has the outline around each changed paragraph, not around the whole text.
- In the live preview, a link also offers its address, and a section or a list offers its own fields, such as a layout, in the space around the elements inside it.
- In the live preview, a click on a field in a row of a list goes to that row: the dev server gives the template's map callback an index when it has none.

## 0.12.0
Mon, 19 Oct 2026 07:02:35 GMT

_Version update only_

## 0.11.0
Sun, 18 Oct 2026 06:05:29 GMT

### Minor changes

- renderRichText(text, entry.data) is async, finds the entry's images itself and optimizes them with Astro's getImage. getSingleton(site, name) reads a singleton with its type, inEditorOrder sorts in the editor's order, and _mica holds only position and images. In CI, the build fails when the committed .mica/schema.json is not the model in the code.
- In astro dev, the loader tells the local editor the dev server's address, for its Preview.
- mediaFile(site, path) gives the file on disk for a media path, to read a GPX track or another file at build time.
- The loader writes the index of each reference set from its JSON or CSV file to .mica/references/<name>.json, writes it again when the file changes in dev, and checks it in CI.
- The new @micacms/astro/components has <LocationMap>, a map of a coordinates value without styles of its own. mapView() gives the same view for a site's own map.

### Updates

- Run the tests on the source of the package, so a test run builds nothing first.
- Image fields are read with the shared field walker of @micacms/core.

## 0.10.0
Thu, 15 Oct 2026 04:37:22 GMT

_Version update only_

## 0.9.0
Wed, 14 Oct 2026 11:51:45 GMT

### Minor changes

- The build stops on a field option that @micacms/core does not know, such as a typo.
- Remove the root option of micaCollections: the content root is set only in defineSite({ root }).
- Read every entry and singleton from its own folder.

### Patches

- The setup guide pushes the branch once before the first Publish.
- An image path outside the content root never reaches Astro's `image()`. The package no longer has the keyword `astro-integration`, so `astro add` does not write a broken configuration.
- In astro dev, a change to src/mica.ts logs how to load the new model: Astro does not reload it by itself.
- Templates do not get the `_key` of repeater rows.
- A missing value reaches templates empty, never with its default.

### Updates

- A test of the loader at 1,000 entries.
- Import the internals of @micacms/core from @micacms/core/internal.

## 0.8.0
Tue, 13 Oct 2026 19:37:59 GMT

### Minor changes

- @micacms/astro/relations: related() and relatedAll() resolve relation fields with the site's types and warn in dev about a missing target; the setup reference names tags()
- Each entry has the images of its rich text in _mica.images, and renderRichText(text, { images }) gives them their Astro address, width and height

### Updates

- Comments only

## 0.7.0
Tue, 13 Oct 2026 14:06:11 GMT

### Minor changes

- Breaking: a second slug field among a collection's own fields stops the build; the setup reference says so, and names no coordinates options
- In dev, an entry that fails its schema is left out with a warning, so that an unfinished draft does not stop the collection; a build still fails

### Patches

- The setup reference names the patternMessage option of text fields

## 0.6.0
Tue, 13 Oct 2026 11:14:11 GMT

### Minor changes

- The build fails when an entry is in the other layout, and names the files and `npx mica migrate-layout`; before, the entries were missing from the site without an error.
- The loaders warn about a relation to a missing entry and a missing media file. `micaCollections(site, { strict: true })` fails the build instead.
- Breaking: requires Astro 7 and Node 24 or newer. `@micacms/core` and zod 4 are now peer dependencies: install `@micacms/core` beside `@micacms/astro`.
- Breaking: no longer re-exports `readCollection`, `readSingleton`, `memorySource`, `fileSystemSource`, `ContentReadError`, `ContentSourceError`, `ORDER_FILE` and their types. Import them from `@micacms/core` (and `fileSystemSource` from `@micacms/core/node`).
- Breaking: a `media({ accept: "image" })` field reaches Astro as an Astro image (`ImageMetadata`, optimized like `image()`), and with `alt` as `{ src, alt }`, so `<Image {...entry.data.cover} />` needs no helper. Other media stay paths. `CollectionDocument` and `SingletonDocument` have the image types. `AstroCollectionConfig.schema` is now a function that takes Astro's `image()`.

### Patches

- The setup guides add the `mica` and `check` scripts to the project's package.json.
- The setup guides show the proposed model and every change to the website's files in plain words, with recommendations, and wait for approval before they convert anything; they ask where alt text goes, exclude the model and the content from Tailwind CSS 4, and end with a report that holds the commit and push commands.

### Updates

- The setup guides use `media({ alt: "required" })` for images that carry meaning.
- The content-collections guide uses `mica import`, gives the commit and push commands, and lets the user choose how to keep an order field.

## 0.5.0
Tue, 13 Oct 2026 04:44:02 GMT

### Minor changes

- Ship setup guides for coding agents in `setup/`: a new or empty Astro project, and a project with content collections. https://micacms.com/setup.md sends an agent to them.
- The published manifest names `@micacms/astro` without a version, so a package update no longer changes it, and it records each collection's layout.
- `micaCollections()` refuses a field kind it does not know, so a typo in the model fails the build instead of making the collection read-only in Mica.

## 0.4.0
Sun, 11 Oct 2026 15:57:57 GMT

_Version update only_

## 0.3.0
Sat, 10 Oct 2026 18:31:39 GMT

_Version update only_

## 0.2.2
Sat, 10 Oct 2026 15:31:13 GMT

_Version update only_

## 0.2.1
Sat, 10 Oct 2026 14:58:49 GMT

_Version update only_

## 0.2.0
Mon, 31 Aug 2026 06:07:50 GMT

### Minor changes

- A larger refactor. Saves now land in a draft workspace and an explicit Publish writes them to the repository as one commit — a working tree under the local connector, a draft store behind the provider connectors. The editor split into composable packages: an authentication-neutral runtime, the admin SPA as built assets, a server-only OIDC gate, and two composition roots — `@micacms/editor` (`npx`, loopback, no authentication code at all) and `@micacms/self-hosted` (Docker, behind OIDC). `MICA_MODE` is gone: the mode is which app you run. `@micacms/model` was renamed to `@micacms/core`.

