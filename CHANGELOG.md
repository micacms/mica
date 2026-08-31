# Changelog

Notable changes to Mica. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); the version numbers
follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

Everything in this repository is released together and carries one version: the
eight published packages and the CMS image.

While the major version is `0`, a minor bump may break something. Read the
release note before upgrading.

## [0.2.0] — 2026-08-31

A larger refactor: publishing became explicit, and the CMS became packages you
compose. Two package names change — `@micacms/cms` and `@micacms/model` are
replaced — so read Breaking before upgrading.

### Changed

- **Saving no longer commits; Publish does.** A save lands in a draft
  workspace, and an explicit Publish writes everything pending to the
  repository as one commit — a working tree under the local connector, a draft
  store behind the provider connectors. The first release's "saving is
  committing" is gone: edits accumulate where only the editor sees them, and
  the repository moves once, when someone decides it should.
- **The Publish page can show what a pending change does**, as a before/after
  comparison rather than a diff: each changed field is one row with the stored
  value beside the staged one, worded by the field type — Yes/No for booleans,
  option labels for selects, file names for media, breadcrumbs into sections.
  The server gained `GET /api/admin/changes/compare`, which reads the same
  document from the repository and from the pending workspace — HEAD versus
  the working tree locally, the repository versus the draft overlay when
  deployed.
- **`defaultSort` now orders the entry list, and its field is checked.** It
  described an order for a long time without producing one: nothing read the
  option, so a collection opened in whatever order its directory happened to be
  read in. Now the admin lists entries the way the model asks — by a field, or
  by the position editors arranged by hand — with the manual order as the
  tiebreak, so a list is stable between requests.
- **`SortField` is `"position"` or a field the collection declares**, in place
  of the fixed set `createdAt | updatedAt | publishedAt | title | position`.
  Three of those were columns in a database Mica no longer has: they
  type-checked and meant nothing, which is how both projects in this repository
  came to sort by a `publishedAt` that no collection declared. `defineSite` now
  refuses a sort field the collection does not have, and names the ones it has.

  A model already committed with such a value keeps working: Mica drops the
  option when it reads the manifest and falls back to the manual order, rather
  than refusing to serve a site over the order of a list. The project's next
  build reports it properly.

### Breaking

- **The editor split into composable packages, and `MICA_MODE` is gone.** The
  mode is now which app you run: `npx @micacms/editor` is the local one —
  loopback, and no authentication code at all — and `@micacms/self-hosted` is
  the Docker image, behind OIDC. Under both sit an authentication-neutral
  runtime (`@micacms/runtime`), the admin SPA as built assets
  (`@micacms/editor-ui`) and a server-only OIDC gate (`@micacms/auth-oidc`).
  `npx @micacms/cms` and `MICA_MODE=local` stop working; the two apps above
  replace them.
- **`@micacms/model` is renamed to `@micacms/core`.** Update the dependency
  and the imports in your model module; the module itself is what it was.

### Fixed

- **A saved entry no longer warns about unsaved changes when leaving.** The
  rich text editor fires transactions that change nothing stored — normalising
  the parsed document on mount, and re-parsing after a save reloads the
  entry — and its serialization differs from the server's stored form by a
  trailing newline, so each of those emits marked a clean form dirty. The
  field now emits only when the value it would emit actually differs from the
  one it holds (`@micacms/editor-ui`).
- **Saving an entry no longer rewrites its media paths.** Reading an entry
  resolves a media reference against the content root, so the editor holds an
  unambiguous path; nothing did the inverse on the way back, so the path the
  editor returned was stored verbatim and the entry's own directory ended up
  named twice — once in the stored value and once by the next read. It
  compounded with every save, and the reference stopped resolving after the
  first one, in the admin and in the built site alike. Media paths now go back
  to the form the repository stores: `media/photo.jpg` for a file beside the
  entry, `/media/logo.svg` for one the whole site shares
  (`@micacms/core`, `@micacms/connectors`).

  An entry saved by an earlier version has the wrong path on disk and will not
  repair itself. `git log -p` over the content directory shows which, and the
  fix is to restore the path the entry had before that save.

## [0.1.1] — 2026-08-16

### Fixed

- The first start in a new project put a database line above the banner:
  `info  Applied database migrations`. Migrations run before there is anything
  to put in a banner, so it won the race — on the one start where the first
  line a person reads matters most. The CLI now asks for that announcement at
  debug; a container's output still gets it at info.

## [0.1.0] — 2026-08-16

The local experience, which is how almost everybody meets Mica first: one
command, one address, and the editor. Three things in it break — read the
second half before upgrading.

### Changed

- **`npx @micacms/cms` talks to a person.** One banner with the address, the
  content directory and what a save does, in place of the startup log lines and
  the warnings that were aimed at whoever reads a container's output. It opens
  a browser on the editor when it is run from a terminal (`--no-open` to stop
  it), says what to do about a port that is already in use, and explains a
  missing content directory or content model instead of only naming it.
- **Local mode has no sign-in screen.** There was never anything to sign in
  to — no identity provider, no password, one implicit developer — so opening
  the editor now _is_ the sign-in: the admin page issues the session as it is
  served. No screen announcing that authentication is disabled, and no 401 on
  the SPA's first request. The API is unchanged: a request without a session is
  still refused, and every other mode still goes through the provider.
- Getting started is five minutes rather than twenty, and says each thing once.

### Breaking

- **The default port is 6422, not 4000.** `MICA` on a telephone keypad, and
  unassigned by IANA — 4000 is one of the numbers every other development
  server also reaches for. A deployment that sets `PORT` is unaffected; one
  that relied on the default must republish the port and update
  `CMS_BASE_URL`, the OIDC redirect URI, and any reverse proxy.
- **Astro 6 or 7 is required; Astro 5 is no longer supported.** Astro 6 moved
  content-collection schemas from Zod 3 to Zod 4 (`BaseSchema` became
  `$ZodType`), and Mica hands Astro the schemas it derives from your model. The
  loader contract itself did not change, so 6 and 7 are one code path — the
  break is at 5. Stay on `@micacms/astro@0.0.4` if you are on Astro 5; your
  content is files either way.
- **Zod 4** in `@micacms/model`, `@micacms/astro` and the CMS, to match what
  Astro now bundles.
- **Node 22.12 or newer**, which is Astro 6's floor.

### Fixed

- The Astro package's tests hung on Linux. `mkdir` with `recursive: true` never
  settles under `/proc`, and a test used a path there to stand for a content
  root it could not write to — so `pnpm -r test` ran until CI's timeout, on
  every branch, while passing on macOS.

## [0.0.4] — 2026-08-14

### Fixed

- `npx @micacms/cms` did nothing. npm and npx run a package's binary through a
  symlink in `node_modules/.bin`, and Node resolves `import.meta.url` to the
  symlink's real target — so the check for "is this file the command" never
  matched, and the CLI silently exited without starting the server.

## [0.0.2] — 2026-08-14

The first release. Everything below is new, so this entry describes what Mica
_is_ rather than what changed.

### The content repository

- Content is files in a Git repository, not rows in Mica's database. An entry is
  an `index.json` with its rich text beside it as `.mdoc` and its images in the
  same directory; an entry that needs neither is a single `.json` file.
- Saving is committing. There is no publish step, no draft column and no
  revision table — Git is the history, and a push is what triggers a rebuild.
- Collection order is a `_order.json` of slugs, so reordering one entry is a
  one-line diff.
- Concurrent edits are caught by an opaque per-path revision token; a save
  against a stale token is refused rather than merged.

### The content model

- A plain module defines the collections and singletons. TypeScript types,
  runtime validation, the admin's forms, the on-disk layout and the Astro
  collection schemas are all derived from it. There is no Mica config file, no
  code generation step and no SQL migration when a field is added.
- `micaCollections(site)` in `src/content.config.ts` is the whole setup, and
  `astro.config` gets nothing. The loaders publish the model and reload the dev
  server themselves, so Mica collections and ordinary Astro collections mix in
  one `collections` export.
- The loaders write the model to `content/.mica/schema.json` and the developer
  commits it; Mica reads it back through the repository connector it already
  has. That is why one published image serves any project, and why changing the
  model is a commit plus a restart rather than a rebuild.

### Repository connectors

- `local` writes into a working tree. `github` and `gitlab` commit through the
  provider's API — no clone, and no deploy key on disk.
- Both provider connectors write one commit per save, however many files the
  save touches, and refuse a content tree too large to list completely rather
  than deleting part of one.

### Authentication and authorization

- OpenID Connect and nothing else. Mica implements no password, no reset flow
  and no second factor, and stores no credential.
- Identities are keyed by `(issuer, subject)`. An email address links an
  invitation to an identity once, at first sign-in, and never re-binds after.
- A role belongs to a person _on a site_, held in a membership and re-read on
  every request. Removing someone takes effect on their next request.
- `MICA_MODE=local` disables authentication for development. Mica refuses to
  start that way with `NODE_ENV=production`, or on any host but localhost.

### Rich text

- Markdoc, from the file through the API to the editor. The editor converts at
  the boundary and never emits HTML, so a `.mdoc` file stays readable in a diff
  and cannot carry a script into the built website.

### The admin

- A Vue 3 SPA that fetches the model over HTTP and generates its own navigation,
  tables and forms from it. It contains no knowledge of any particular
  collection.

### The website

- `@micacms/astro` reads the content repository through Astro's Content Layer
  API. The build needs no CMS running, no token and no URL: `getCollection()` is
  fully typed, and renaming a field breaks the build.

### Running it

- `npx @micacms/cms` runs Mica against a project on your machine: it reads the
  content directory, serves the admin, binds to loopback and writes nothing
  into the repository. Adopting Mica does not mean adopting its repository.

### Deployment

- One container. No database server, no cache, no queue and no object storage.
  SQLite holds accounts, memberships and sessions; losing it signs everyone out
  and costs nothing else.

### Known limitations

Recorded with the reasoning in [docs/decisions.md](./docs/decisions.md). The ones most likely to
matter:

- A save commits straight onto the configured branch. There is no review step
  and no pull request.
- Site management has a data model but no screen. One site per deployment, in
  practice.
- A Markdoc tag written by hand survives an editor round trip as its inner text,
  not as a tag.
- No end-to-end browser test, and nothing re-runs the OpenID Connect round trip
  automatically. `e2e/compose.yml` runs it by hand against a real Keycloak.
