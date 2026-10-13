# Change Log - @micacms/core

This log was last generated on Tue, 13 Oct 2026 14:06:11 GMT and should not be manually modified.

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

