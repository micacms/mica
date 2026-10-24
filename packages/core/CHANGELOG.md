# Change Log - @micacms/core

This log was last generated on Sat, 24 Oct 2026 13:39:21 GMT and should not be manually modified.

## 0.13.0
Sat, 24 Oct 2026 13:39:21 GMT

_Version update only_

## 0.12.0
Mon, 19 Oct 2026 07:02:35 GMT

### Patches

- The content root can be given in any spelling, such as D:/site/content on Windows: Mica resolves it before it checks that a path stays inside.

## 0.11.0
Sun, 18 Oct 2026 06:05:29 GMT

### Minor changes

- A coordinates field can show a map in the editor: `coordinates({ map: "liberty" })` uses an OpenFreeMap style ("liberty", "bright" or "positron"), and `{ style, hosts }` uses a style of your own. The style address and the hosts must use https, and each host is an origin.
- collection({ url: "/news/{slug}" }) and singleton({ url: "/about" }) name the page of an entry on the website.
- devServerMarkerPath in @micacms/core/node names the file in which astro dev tells the local editor its address.
- A media field's `accept` takes a list of file types, such as ["gpx", "kml"]. Mica knows images, PDF, GPX, KML, GeoJSON, ZIP and CSV.
- Reference sets: defineSite({ references }) with referenceSet() declares data of the website that Mica never edits, and a relation can point to it. The reference check reads its index in .mica/references/.
- A coordinates value can store the zoom of the map, from 0 to 22: { lat, lng, zoom }.

### Patches

- The links of a document (relations, media, and the images and links in rich text) are read by one rule, which Mica, the website build and mica check share.

### Updates

- Run the tests on the source of the package, so a test run builds nothing first.

## 0.10.0
Thu, 15 Oct 2026 04:37:22 GMT

_Version update only_

## 0.9.0
Wed, 14 Oct 2026 11:51:45 GMT

### Minor changes

- Rich text in a repeater row is stored in a file named by the row's key, such as `sections.k3f9a2.body.mdoc`, not by its number, so a new order of the rows changes only `index.json`. Rows with rich text have a `_key` in the JSON.
- A save keeps the keys and the `.mdoc` files that the model does not declare, so content for a newer field is not lost. A `default` fills a field only in a new entry; a read fills a missing value with its empty value. `withDefaults` is now `withEmptyValues`, `emptyValue` and `declaresDocument` are new, and `serializeEntry` takes the stored JSON. New recipe `remove-field.mjs`.
- The model refuses two names that differ only in case, a `slugField` that is not a slug, a lower bound above an upper one, and a default that is not a valid value. `readManifest` reads a manifest for every reader: an unknown field option makes its collection read-only, and a manifest without the protocol envelope is refused. Slugs without `_order.json` are in code-unit order; text sorts in one fixed collation; date bounds and sorts compare dates. Option types are the field types without `kind`, an object is never null, and `multiple` is `true` or absent.
- The main entry point exports only the public API: the model and its types, validation, the content format, the readers and the model file. Mica's own packages use the new `@micacms/core/internal`, which semver does not cover. Removed: `getCollection`, `getSingleton`, `uniqueSlug`, `toIssues` and the export of `HEX_COLOR`.
- Keep every entry and every singleton in its own folder with `index.json`; a singleton is `content/<name>/index.json`. `media` is a reserved name for a collection or a singleton, because the shared media folder sits beside their folders. The manifest records no layout. `entryFolder` and `entryDataPath` are new. Removed: `collectionEntryPath`, `singletonPath`, `entryLayout`, `deriveLayout`, `recordLayout`, `misplacedFiles`, `LayoutError`, `RowNumberError`, `keyRepeaterRows`, `numberedDocuments`, `EntryLayout` and `ManifestLayout`. Changed: `entryFiles(folder, serialized)` and `collectionSlugs(source, name)`.

### Patches

- Refuse a text pattern that repeats a group with a repeat inside, such as (a+)+: it can take very long on a short value.
- `contentPath` refuses `.git` as a path segment, and a `media()` value must stay inside the content root.

### Updates

- Conformance fixtures for the content format specification.

## 0.8.0
Tue, 13 Oct 2026 19:37:59 GMT

### Minor changes

- tags(): a field kind for a free list of short words, with max, maxLength, suggestions and default
- collectionSlugs lists a collection's URLs without reading entries, and readCollection reads eight entries at a time
- The rich-text toolbar takes a preset, "minimal", "default" or "full", or a list of features, which now include "table" and "image"; an unknown toolbar stops the model from loading. Shared rules for paths in rich text (markdocImages, markdocTargets, resolveMarkdocTarget, richTextValues)

### Updates

- Migration recipes and their tests, not in the package

## 0.7.0
Tue, 13 Oct 2026 14:06:11 GMT

### Minor changes

- Breaking: a collection's own slug field is read from the entry's file name and typed as string, never null; defaultSort.field must be a field key or 'position'; the coordinates options defaultCenter and defaultZoom are removed
- Breaking: validation messages name the field and the limit, such as 'Title can have at most 120 characters (now 134).', and the unused coordinatesSchema export is removed; text fields take an optional patternMessage
- relinkReferences points the relations to an entry at its new URL, nested fields included
- mapMedia applies a function to every media path in a payload, nested fields included

### Patches

- required accepts false; every builder option has a description

## 0.6.0
Tue, 13 Oct 2026 11:14:11 GMT

### Minor changes

- Add `media({ alt: "required" | "optional" })`: the field stores `{ path, alt }`, and `"required"` refuses an image without alt text. A `media()` without the option still stores a path. A stored path reads as one without alt text; with `"required"`, the build fails until each such image has alt text.
- Breaking: an entry in the other layout is now an error (`LayoutError`), not hidden. A model change that adds the first, or removes the last, rich-text or media field changes where entries are stored; until the files move, the reader names them. `misplacedFiles` lists them.
- Add `collectReferences` (every relation and media path in a document, nested fields included) and `createReferenceCheck` (the ones that point at nothing).
- Breaking: a text field's `pattern` must now match the whole value, and is compiled with the `u` flag. An invalid pattern stops the model from loading. For "contains", write `.*x.*`.
- Breaking: zod 4 is now a peer dependency, so a site has one zod, shared with Astro. Requires Node 24 or newer. The package ships its `src/`, so the declaration maps resolve.
- Breaking: removed exports that nothing used: `collectMediaIds`, `walkFields`, `mediaRefSchema`, `collectionSchema`, `singletonSchema` and the `SchemaMode` type. `fieldsSchema` and `validateFields` no longer take a mode: pass the options as the second or third argument.
- `fieldsSchema` and `validateFields` take an `image` resolver for `media({ accept: "image" })`, and the inference types take the image type as a second parameter.

## 0.5.0
Tue, 13 Oct 2026 04:44:02 GMT

### Minor changes

- The manifest records the `layout` of each collection and singleton, and `ProtocolManifest` types it.
- Keep the value of a field kind that this build does not know when validating, instead of failing.
- Remove the draft-store and repository-port types (`DraftStore`, `memoryDraftStore`, `RepositoryConnector`, `CommitInput`, `Change`, `checkCommitPaths`, `ConnectorError`, `ConflictError`). The working tree's files and their errors are in `@micacms/runtime` now.

## 0.4.0
Sun, 11 Oct 2026 15:57:57 GMT

### Updates

- Security: refuse every content path that could leave the content root, in every connector and in the media routes; no write or delete can name the root itself

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

- The Publish page can show what a pending change does, as a before/after comparison rather than a diff: each changed field is one row with the stored value beside the staged one, worded by the field type — Yes/No for booleans, option labels for selects, file names for media, breadcrumbs into sections. The server gained `GET /api/admin/changes/compare`, which reads the same document from the repository and from the pending workspace — HEAD versus the working tree locally, the repository versus the draft overlay when deployed.
- A larger refactor. Saves now land in a draft workspace and an explicit Publish writes them to the repository as one commit — a working tree under the local connector, a draft store behind the provider connectors. The editor split into composable packages: an authentication-neutral runtime, the admin SPA as built assets, a server-only OIDC gate, and two composition roots — `@micacms/editor` (`npx`, loopback, no authentication code at all) and `@micacms/self-hosted` (Docker, behind OIDC). `MICA_MODE` is gone: the mode is which app you run. `@micacms/model` was renamed to `@micacms/core`.

### Updates

- Migrated the repository tooling from pnpm workspaces to Rush.

