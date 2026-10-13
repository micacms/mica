# Change Log - @micacms/astro

This log was last generated on Tue, 13 Oct 2026 11:14:11 GMT and should not be manually modified.

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

