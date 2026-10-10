# Change Log - @micacms/editor-ui

This log was last generated on Sat, 10 Oct 2026 14:58:49 GMT and should not be manually modified.

## 0.2.1
Sat, 10 Oct 2026 14:58:49 GMT

### Patches

- Show a URL change on the Publish page as one renamed entry, with only the changed fields.

### Updates

- Preserve fenced code blocks when rich-text content opens in the editor.

## 0.2.0
Mon, 31 Aug 2026 06:07:50 GMT

### Minor changes

- The Publish page can show what a pending change does, as a before/after comparison rather than a diff: each changed field is one row with the stored value beside the staged one, worded by the field type — Yes/No for booleans, option labels for selects, file names for media, breadcrumbs into sections. The server gained `GET /api/admin/changes/compare`, which reads the same document from the repository and from the pending workspace — HEAD versus the working tree locally, the repository versus the draft overlay when deployed.
- A larger refactor. Saves now land in a draft workspace and an explicit Publish writes them to the repository as one commit — a working tree under the local connector, a draft store behind the provider connectors. The editor split into composable packages: an authentication-neutral runtime, the admin SPA as built assets, a server-only OIDC gate, and two composition roots — `@micacms/editor` (`npx`, loopback, no authentication code at all) and `@micacms/self-hosted` (Docker, behind OIDC). `MICA_MODE` is gone: the mode is which app you run. `@micacms/model` was renamed to `@micacms/core`.

### Patches

- A saved entry no longer warns about unsaved changes when leaving. The rich text editor fires transactions that change nothing stored — normalising the parsed document on mount, and re-parsing after a save reloads the entry — and its serialization differs from the server's stored form by a trailing newline, so each of those emits marked a clean form dirty. The field now emits only when the value it would emit actually differs from the one it holds.

### Updates

- The build no longer warns about zod's Rollup-confusing comments or the admin bundle's deliberate size.

