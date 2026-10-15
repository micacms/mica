# Changelog

Notable changes to Mica. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); the version numbers
follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

Everything in this repository is released together and carries one version: the
published packages and the CMS image.

While the major version is `0`, a minor bump may break something. Read the
release note before upgrading.

## [0.10.0] — 2026-10-15

Coding agents can edit the content. Claude Code, Cursor, VS Code and other
clients of the Model Context Protocol (MCP) read the content model and save
content through a fixed set of tools. They follow the rules of the editor: Mica
checks every value, every save sends the revision that the agent read, and a
save is a draft. A person publishes the drafts, unless you let agents publish
too. On your own machine, `npx mica start` serves the tools at `/mcp`, and
`npx mica mcp` serves them over stdio. A self-hosted Mica serves them with
`MICA_MCP=true`: each person signs in as for the editor and allows each agent.

Nothing to do before upgrading from 0.9.

### Added

- **The Mica tools for agents.** `describe_model`, `list_entries`,
  `get_entry`, `get_singleton`, `find_references`, `list_media`,
  `save_entry`, `save_singleton`, `delete_entry`, `reorder_entries`,
  `upload_media`, `get_changes`, `discard_changes`, and `publish` only when it
  is allowed. Their names and inputs are public from 1.0 (`@micacms/mcp`,
  `@micacms/editor`, `@micacms/runtime`).
- **`npx mica mcp [content dir]`** serves the tools over stdio, for an agent
  that starts Mica itself. `npx mica start` serves them at `/mcp`, and its
  banner shows how to add Mica to an agent. `--allow-publish` and
  `MICA_MCP_PUBLISH=true` give agents `publish` (`@micacms/editor`).
- **Agents on a self-hosted Mica.** `MICA_MCP=true` serves `/mcp` in the
  image. Mica is the OAuth server of the endpoint: the person signs in with
  the editor's OIDC flow, the `MICA_ADMIT_*` rules apply, and a consent page
  allows one agent. Mica stores no clients and no tokens; access ends after
  `MICA_SESSION_TTL_HOURS`. With `MICA_MCP_PUBLISH=true`, a person can also
  allow an agent to publish (`@micacms/runtime`, the image).
- **`@micacms/mcp`**, a new internal package. It is published because
  `@micacms/editor` installs it, and it is pinned exactly (`@micacms/mcp`).

### Changed

- **Internal: one publish and one upload for every client.** The editor's
  routes and the agent tools use the same services, so they refuse and
  validate in the same way (`@micacms/runtime`).

A review of the whole project, and the changes that came from it. The content
format is simpler: one folder for each entry and each singleton, rich text in a
repeater row named by the row's key, and a save that keeps what the model does
not declare. A specification describes the format, and tests check it against
fixtures. `@micacms/core` exports a smaller public API, and four packages are
published. Publish, Discard, Delete and Reorder check the revision that the
editor saw, so a colleague's later save shows as a conflict. The self-hosted
image finds its content root, repairs its clone after a force push, and reports
problems in `/ready`. The budget tests use the 1.0 target: 1,000 entries in a
collection, 5,000 files and 5 editors. The editor has a new look with a dark
mode.

Read Breaking before upgrading from 0.8. This release has no migration: move
the content files to the new layout by hand, or start again from your Git
history.

### Breaking

- **One folder for each entry and each singleton.** An entry is
  `<collection>/<slug>/index.json`, a singleton is `<name>/index.json`, and
  `media` is a reserved name. The manifest records no layout.
  `mica migrate-layout` is removed. Removed: `collectionEntryPath`,
  `singletonPath`, `entryLayout`, `deriveLayout`, `recordLayout`,
  `misplacedFiles` and `LayoutError`. New: `entryFolder` and
  `entryDataPath` (`@micacms/core`, `@micacms/astro`, `@micacms/editor`,
  `@micacms/runtime`).
- **Rich text in a repeater row** is stored in a file named by the row's key,
  such as `sections.k3f9a2.body.mdoc`, and a row with rich text has a `_key`
  in the JSON. A new order of the rows changes only `index.json`
  (`@micacms/core`).
- **A save keeps what the model does not declare**, the keys and the `.mdoc`
  files. A `default` fills a field only in a new entry; a read fills a missing
  value with its empty value. `withDefaults` is now `withEmptyValues`, and
  `serializeEntry` takes the stored JSON (`@micacms/core`, `@micacms/runtime`).
- **Stricter model rules.** The model refuses two names that differ only in
  case, a `slugField` that is not a slug, a lower bound above an upper one, a
  default that is not a valid value, and a text `pattern` that repeats a group
  with a repeat inside, such as `(a+)+`. An unknown field option stops the
  build, and makes its collection read-only in an older editor
  (`@micacms/core`, `@micacms/astro`).
- **The public API of `@micacms/core` is smaller.** The main entry point has
  the model, validation, the content format, the readers and the model file.
  Removed: `getCollection`, `getSingleton`, `uniqueSlug` and `toIssues`.
- **Four published packages:** `@micacms/core`, `@micacms/astro`,
  `@micacms/editor` (with the built editor UI) and `@micacms/runtime`.
  `@micacms/editor-ui` and `@micacms/auth-oidc` are no longer published.
- **The content root is set in one place**, `defineSite({ root })`.
  `micaCollections` has no `root` option (`@micacms/astro`).
- **Self-hosted configuration:**
  - `MICA_REPOSITORY_ROOT` is removed. The image finds the content root by its
    `.mica/schema.json`; `MICA_CONTENT_PATH` names it only when the repository
    has more than one. The top of the repository cannot be the content root.
  - `MICA_PUBLIC_URL` and `MICA_SESSION_SECRET` are always required.
    `MICA_PUBLIC_URL` must be an origin without a path.
  - `NODE_ENV` changes nothing. Plain HTTP is allowed only for an address on
    this machine.
  - `MICA_SIGNIN_WINDOW_MS` is now `MICA_SIGNIN_WINDOW_MINUTES`.
  - `MICA_ADMIN_ORIGINS` and `MICA_ADMIN_DIR` are local-editor settings only.
- **`/ready`** has the status `degraded` (still HTTP 200) when something needs
  a person, one reason for each problem, and `lastSyncAt`.
  `restart_required` is removed; `lfs_refused`, `model_unreadable`,
  `pending_push`, `conflict` and others are new (`@micacms/runtime`).
- **The CLI.** Each command takes only its own options, and a path is always
  the content root. `mica import` takes `--collection <name>` in place of names.
  `check` and `import` exit with 78 without a readable model
  (`@micacms/editor`).
- **Uploads** are one file for each request, sent as the request body.
  Internal: `ContentFiles` has `readHead`, `readStream` and `receive` in place
  of `readBinary` (`@micacms/runtime`, `@micacms/editor`).

### Added

- **A specification of the content format** in `docs/content-format.md`, with
  fixtures that a test reads and writes back byte for byte (`@micacms/core`).
- **A new look for the editor:** green actions, a light sidebar, the
  Instrument Sans and IBM Plex Mono fonts, status labels with a coloured dot,
  and a dark mode. Under Appearance, an editor chooses light, dark or the mode
  of the system (`@micacms/editor`).
- **One way to change an order** for the entries of a collection, the items of
  a list, the chosen entries of a relation and the files of a media field: a
  handle drags an item or moves it with the keyboard, and arrow buttons move it
  one step (`@micacms/editor`).
- **The self-hosted image:**
  - finds its content root in the clone;
  - follows a rewritten branch (a force push or a reset) and a new repository
    URL, and keeps the drafts as conflicts until an editor chooses;
  - starts with the model in its clone and syncs in the background, and holds
    a new version that it cannot use (LFS under the content root, or a model
    that it cannot read);
  - runs only once for each data volume, with a lease, and finishes the work
    that a stop or a crash interrupted;
  - reads `MICA_SESSION_SECRET_FILE`, `MICA_OIDC_CLIENT_SECRET_FILE` and
    `MICA_REPOSITORY_TOKEN_FILE`; the token file is read for each Git call;
  - has a `compact` command that makes the clone small again;
  - `check` also tests the identity provider, shows the redirect URI, and
    checks the data volume and the clone.
- **The CLI finds the content root** by its `.mica/schema.json` when no path
  is given (`@micacms/editor`).
- **In `astro dev`**, a change to `src/mica.ts` logs how to load the new model
  (`@micacms/astro`).
- **New recipe** `remove-field.mjs` (`@micacms/core`).

### Changed

- **Publish, Discard, Delete and Reorder check the revision that the editor
  saw.** A colleague's later save is a conflict, not lost or published unseen
  (`@micacms/runtime`, `@micacms/editor`).
- **Faster at the 1.0 target.** Publish with a deletion reads the unchanged
  files from the working tree, not one Git process for each file. The budget
  tests use 1,000 entries in one collection, 5,000 files and five editors at
  the same time (`@micacms/runtime`).
- **No whole media file in memory.** An upload streams to disk, the file route
  streams, a revision is a cached, streamed hash, and a URL change copies the
  media on disk (`@micacms/runtime`).
- **A slow network does not block** the start, the sync or Publish: a sync
  skips its turn while one runs, a stalled transfer stops, and Git has
  settings for large repositories with many images.
- **`mica init` writes the starter's model**, the same one as
  `examples/starter` and the getting-started page (`@micacms/editor`).
- **The release workflow** builds without write rights and publishes from a
  separate job; dependencies are audited every week and updated every month.

### Fixed

- **Security:** the content files refuse a symbolic link out of the content
  root and the `.git` folder; a route slug is one folder name; a `media()`
  value stays inside the content root; a name such as `constructor` is not a
  collection; sign-out removes the unsaved form values that the tab kept
  (`@micacms/core`, `@micacms/runtime`, `@micacms/editor`, `@micacms/astro`).
- **The first Publish of a new project** names `git push -u origin HEAD`
  when the branch has no upstream (`@micacms/runtime`).
- **`astro add`** no longer writes a broken configuration: the package has no
  `astro-integration` keyword (`@micacms/astro`).
- A missing value reaches templates empty, never with its default, and
  templates do not get the `_key` of repeater rows (`@micacms/astro`).

## [0.8.0] — 2026-10-13

Ready for others. Rich text edits tables and images, and a toolbar takes a
preset. The editor works with the keyboard and a screen reader on every view,
and CI checks each view with axe. A relation field finds entries as you type,
and entries move by drag, by the keyboard or to a typed position. A new
`tags()` field holds a free list of words, and `@micacms/astro/relations`
resolves relations on your pages. Each view of the editor reads only what it
shows. A minimal starter, a general example site, and the documentation on
micacms.com (reference pages, recipes, model changes, a guide for editors)
help a new team to start.

Read Breaking before upgrading from 0.7. `mica check` and Publish now report a
missing image in rich text. An unknown rich-text toolbar stops the model from
loading.

### Breaking

- **Images in rich text are checked.** `mica check` reports an image whose
  file is missing, and Publish refuses it. A missing image with a `/path` is a
  warning only, because it can be in Astro's `public/` folder
  (`@micacms/editor`, `@micacms/runtime`).
- **An unknown rich-text toolbar stops the model from loading.** `toolbar` is
  a preset (`"minimal"`, `"default"`, `"full"`) or a list of known features;
  before, an unknown feature was ignored. An older editor ignores a feature
  from a newer model (`@micacms/core`).
- **Internal: the runtime reads less.** `ContentFiles` has `stat()`; the media
  list has no dimensions, which `/admin/media/info` gives for one file; a
  single entry's response has no `position` (`@micacms/runtime`).

### Added

- **Tables and images in rich text.** A table has a header row and one line of
  text in each cell, stored as a Markdown pipe table. An image comes from the
  media library with its alt text, which is required. The toolbar options
  `"table"` and `"image"` add the buttons (`@micacms/editor-ui`,
  `@micacms/core`).
- **Toolbar presets:** `toolbar: "minimal" | "default" | "full"`, or a list of
  features (`@micacms/core`).
- **Images in rich text on the website.** Each entry has its rich-text images
  in `_mica.images`, made by Astro's `image()`, and
  `renderRichText(text, { images })` writes their address, width and height
  (`@micacms/astro`).
- **`tags()`**, a field for a free list of short words, with `max`,
  `maxLength`, `suggestions` and `default`. The editor adds a tag with Enter or
  a comma and offers the suggestions; `mica import` fills a tags field
  (`@micacms/core`, `@micacms/editor-ui`, `@micacms/editor`).
- **`@micacms/astro/relations`:** `related()` and `relatedAll()` resolve
  relation fields with the site's types and warn in `astro dev` about a
  missing target (`@micacms/astro`).
- **A searchable relation picker.** A relation field finds entries as you
  type, and the chosen entries can be put in a new order (`@micacms/editor-ui`).
- **Ordering by drag, by the keyboard, or to a position**, with one save for
  each move (`@micacms/editor-ui`).
- **Accessibility.** Each page has its own title, a skip link, and the focus on
  its heading after navigation. The menu drawer, the dialogs and the upload
  controls work with the keyboard; read-only fields stay focusable; the
  Publish page labels Before and After. A browser test runs axe on every view
  (`@micacms/editor-ui`).
- **A "Help for editors" link** in the menu opens the guide for editors on
  micacms.com (`@micacms/editor-ui`).
- **A minimal starter** in `examples/starter`, for
  `npm create astro -- --template micacms/mica/examples/starter`, with a CI
  workflow that runs `mica check` and checks the committed model.
- **`collectionSlugs`**, and shared rules for paths in rich text, in
  `@micacms/core`.

### Changed

- **Each view reads what it shows.** Opening an entry, the free-URL check, the
  overview, the System page and the change list read only what they show; the
  media file route answers 304 with an ETag; a collection is read eight
  entries at a time (`@micacms/runtime`, `@micacms/core`).
- **The editor uses Tiptap 3** (`@micacms/editor-ui`).
- **Fields stay readable while a form saves.** They are read-only, not
  disabled, so the focus stays where it was (`@micacms/editor-ui`).
- **The example is a general company site**, Harbor Lane Consulting in
  `examples/company-site`, with every field kind, tables and images in rich
  text, and imaginary places.
- **One source of user documentation.** The guides are on micacms.com, with
  new reference pages (command line, `@micacms/astro`, fields, health
  endpoints), recipes, a guide to model changes with tested scripts, a guide
  for an existing site, a guide for editors, the scope with a comparison, a
  pattern for several languages, and an accessibility statement.
- **Contributing:** `CONTRIBUTING.md`, a code of conduct, `GOVERNANCE.md`,
  issue forms and a pull-request template.

### Fixed

- Saving a form no longer logs a Content-Security-Policy violation
  (`@micacms/editor-ui`).
- The media details load the dimensions of the selected file, and the change
  list refreshes after a write and when the window gets the focus, not at each
  navigation (`@micacms/editor-ui`).

## [0.7.0] — 2026-10-13

The editor's daily work. Editors choose what to publish, read editing words
instead of Git words, and see on every entry whether it is published. A form
checks its fields while the editor types, keeps unsaved changes when the
session ends, and shows both versions when two editors save the same entry.
When an entry's URL changes, the links to it can follow. Files can be deleted
from the Media view, uploads stay with their entry, and a new content model is
used without a restart.

Read Breaking before upgrading from 0.6. A save no longer checks required
fields; Publish does. Each publication's commit ends with a
`Published-with: Mica` line. In the local editor, Publish waits while the
branch holds other commits that are not pushed yet.

### Breaking

- **Publish takes the chosen changes.** The Publish page has a checkbox for
  each change; a change comes with the new entries and files it uses, and the
  rest stays saved. The staging status reports `unpushed: { mica, other }`
  instead of `ahead` (`@micacms/runtime`, `@micacms/editor-ui`).
- **Required fields are checked at Publish, not at Save.** A half-finished
  entry can be saved; the entry page says "Not ready to publish" and names the
  empty fields. A new entry needs a title or a URL (`@micacms/runtime`).
- **Mica marks its commits.** Each publication's commit ends with the trailer
  `Published-with: Mica`. In the local editor, Publish and its retry refuse
  while the branch holds commits that its upstream does not have and that
  Mica did not make: push them, or move them to another branch
  (`@micacms/runtime`).
- **Uploads go into the entry's folder.** A file uploaded in an entry or
  settings form goes into its own `media/` folder; the picker offers that
  folder's files and the shared ones. Files already in the shared folder stay
  there. Videos are refused (`@micacms/runtime`, `@micacms/editor-ui`).
- **Slugs and sorting are typed.** A collection's own slug field is read from
  the entry's file name and typed as `string`, never `null`; a second slug
  field among a collection's own fields stops the build. `defaultSort.field`
  must be a field of the collection or `"position"`. The `coordinates` options
  `defaultCenter` and `defaultZoom` are removed (`@micacms/core`,
  `@micacms/astro`).
- **Validation messages name the field and the limit**, such as "Title can have
  at most 120 characters (now 134)." The unused `coordinatesSchema` export is
  removed (`@micacms/core`).
- **`findReferences` also returns settings pages**, as
  `{ kind: "entry" | "singleton", … }` (`@micacms/runtime`).
- **`restart_required` means only a `.gitattributes` change.** A new content
  model needs no restart (`@micacms/self-hosted`).

### Added

- **Delete in the Media view.** A file, or a selection, is deleted when no
  field and no rich text uses it; the view shows where a file is used. The
  delete waits on the Publish page, and Discard brings the file back
  (`@micacms/runtime`, `@micacms/editor-ui`).
- **Links follow a URL change.** The entry page names the entries and settings
  pages that link to the entry and offers to update their links in the same
  save (`@micacms/core`, `@micacms/runtime`, `@micacms/editor-ui`).
- **Save conflicts show both versions**, with "Keep mine" (logged with the
  editor) and "Use theirs" (`@micacms/runtime`, `@micacms/editor-ui`).
- **A new content model without a restart.** Mica loads it as soon as the
  manifest changes, in both apps; an open page asks the editor to save and
  load it again. A model that cannot be read leaves the old one in use, and
  the System and Publish pages say why (`@micacms/runtime`,
  `@micacms/editor-ui`).
- **The end of a session keeps the work.** The page offers "Sign in again" and
  returns to the same place; forms keep unsaved changes in the browser tab and
  offer to restore them. A warning comes five minutes before the end. Each
  response names the session's end in `x-mica-session-expires`
  (`@micacms/editor-ui`, `@micacms/auth-oidc`).
- **`patternMessage`** on text fields, and a description for every builder
  option (`@micacms/core`).
- **`relinkReferences` and `mapMedia`** in `@micacms/core`.
- **The log names the editor** for Publish, Discard, conflict choices, media
  deletes and "Keep mine" (`@micacms/runtime`).

### Changed

- **Editing words, not Git words.** "Say what changed" instead of "commit
  message"; Git details are only on the System page and in a closed "Details
  for developers" section (`@micacms/editor-ui`).
- **Publish state everywhere.** Entries and settings show "Saved · not
  published" with Publish and Discard, lists mark new and changed entries,
  and each change shows when it was saved (`@micacms/editor-ui`).
- **The form checks fields in the browser** when the editor leaves them and
  before a save; each problem links to its field, also from the Publish page
  (`@micacms/editor-ui`).
- **In `astro dev`, an unfinished draft is left out** with a warning, and the
  rest of the collection loads; a build still fails (`@micacms/astro`).
- **Dependencies refreshed**; the example site uses MapLibre 6 and sharp 0.35.

### Fixed

- "Today" in a date field uses the local date; a half-typed coordinate is
  named as missing instead of 0; the list search no longer matches field
  names; list cells show dates, choices, rich text and files readably; a
  settings page that fails to load no longer shows an empty form
  (`@micacms/editor-ui`).
- `mica check` reads the slug as the file has it (`@micacms/editor`).

## [0.6.0] — 2026-10-13

New configuration names, a new package shape, a new CLI and a smaller public
API. Mica also stops losing content without an error: an entry in the wrong
layout, rich text that the editor cannot show, and a broken link or image at
Publish are now named. Images carry alt text and reach Astro as Astro images, so pages need no
helper. Astro collections move to Mica with `mica import`, and a coding agent
shows its plan before it changes the site. The image runs on arm64.

Read Breaking before upgrading from 0.5. A self-hosted Mica needs its `.env`
renamed. A site needs Node 24, Astro 7 and `@micacms/core` installed beside
`@micacms/astro`, a `"mica": "mica start"` script, and the image fields read as
images.

### Breaking

- **Every configuration variable starts with `MICA_`.** Rename in `.env`:
  `SESSION_SECRET`, `SESSION_TTL_HOURS` and `SESSION_IDLE_HOURS` to
  `MICA_SESSION_*`; `LOGIN_MAX_ATTEMPTS` and `LOGIN_WINDOW_MS` to
  `MICA_SIGNIN_MAX_ATTEMPTS` and `MICA_SIGNIN_WINDOW_MS`; `TRUST_PROXY`,
  `MAX_UPLOAD_BYTES`, `LOG_LEVEL`, `ADMIN_ORIGINS` and `ADMIN_DIR` to their
  `MICA_` names; `MICA_ADMIT_GROUP` and `MICA_ADMIT_DOMAIN` to
  `MICA_ADMIT_GROUPS` and `MICA_ADMIT_DOMAINS`. The old names are not read.
  Every variable is at https://micacms.com/docs/configuration/
  (`@micacms/runtime`, `@micacms/auth-oidc`, `@micacms/self-hosted`).
- **The editor starts with `mica start`.** `mica` alone prints the help, and
  the first word is always a command. Change a `"mica": "mica"` script to
  `"mica": "mica start"`. The local editor reads no `.env` file, and a flag
  wins over the environment (`@micacms/editor`).
- **Image fields are Astro images.** A `media({ accept: "image" })` field
  reaches the pages as `ImageMetadata`, optimized like Astro's `image()`; with
  `alt`, it is `{ src, alt }`, so `<Image {...entry.data.cover} />` is enough.
  Remove a glob helper such as `src/lib/media.ts`. Other media stay paths
  (`@micacms/astro`, `@micacms/core`).
- **Node 24 and Astro 7.** Every package requires Node 24 or newer;
  `@micacms/astro` requires Astro 7.
- **`@micacms/core` and zod are peer dependencies** of `@micacms/astro`, and zod
  of `@micacms/core`: install `@micacms/astro @micacms/core`
  (`@micacms/astro`, `@micacms/core`).
- **A text `pattern` must match the whole value**, with the `u` flag. An
  invalid pattern stops the model from loading (`@micacms/core`).
- **An entry in the other layout is an error, not hidden.** After the first
  rich-text or media field of a collection is added, or the last is removed,
  the build fails and the local editor refuses to start until the files move;
  `npx mica migrate-layout` moves them (`@micacms/core`, `@micacms/astro`,
  `@micacms/runtime`, `@micacms/editor`).
- **Smaller public API.** `@micacms/astro` no longer re-exports the readers of
  `@micacms/core`; core no longer exports `collectMediaIds`, `walkFields`,
  `mediaRefSchema`, `collectionSchema`, `singletonSchema` and `SchemaMode`,
  and `fieldsSchema` and `validateFields` take no mode. Each package README
  says whether it is public or internal.
- **No HEIC images.** An image field refuses HEIC files, which Astro cannot
  process (`@micacms/runtime`).
- **`@micacms/self-hosted` is no longer on npm.** It ships only as the image
  `ghcr.io/micacms/mica`.

### Added

- **Alt text on media fields.** `media({ alt: "required" | "optional" })`
  stores `{ path, alt }`, with an alt-text input under each image
  (`@micacms/core`, `@micacms/editor-ui`).
- **`mica import`** moves Astro content collections into Mica from Astro's data
  store, field by field, with `--map` and `--order`, and lists what it did not
  import (`@micacms/editor`).
- **`mica migrate-layout`** moves the entries that a layout change left behind
  (`@micacms/editor`).
- **References are checked.** Publish refuses a change that would leave a
  broken relation or a missing file on the site, also for a deleted or renamed
  entry. The Astro loaders warn about each one; `strict: true` fails the build
  (`@micacms/runtime`, `@micacms/astro`).
- **A configuration reference** at https://micacms.com/docs/configuration/.
- **`npm run mica` and `npm run check`.** The setup guides and `mica init` add
  the scripts (`@micacms/editor`, `@micacms/astro`).
- **The image runs on amd64 and arm64**, and carries third-party license
  notices; the editor bundle ships them too (`@micacms/editor-ui`,
  `@micacms/self-hosted`).

### Changed

- **The setup agent shows its plan first.** Before it changes the site, it
  presents the model and each change to the website's files in plain words,
  with its recommendation, and waits for approval. Its report ends with the
  commands to commit and push (`@micacms/astro`).
- **Rich text never opens empty and never drops Markdoc.** Text with something
  the editor cannot show opens read-only, with the reason and the source
  (`@micacms/editor-ui`).
- **Publish on a new branch** pushes it to `origin` and sets the upstream
  (`@micacms/runtime`).
- **A missing branch has its own message**, and `/ready` reports
  `branch_not_found` (`@micacms/self-hosted`).
- **The image is smaller:** npm, npx, corepack and yarn are gone, and the base
  image is pinned by digest. A failed release can run again.

## [0.6.0-rc.2] — 2026-10-13

The changes after the first test of rc.1 on a real site. Images need no helper
on the pages any more, Astro collections move to Mica with one command, and the
editor starts with `mica start`.

### Breaking

- **The editor starts with `mica start`.** `mica` alone prints the help, and
  the first word is always a command, so that a directory named like a command
  cannot run one. Change a `"mica": "mica"` script to `"mica": "mica start"`
  (`@micacms/editor`).
- **Image fields are Astro images.** A `media({ accept: "image" })` field
  reaches the pages as `ImageMetadata`, optimized like Astro's own `image()`;
  with `alt`, it is `{ src, alt }`, so `<Image {...entry.data.cover} />` is
  enough. Remove a glob helper such as `src/lib/media.ts`. Other media stay
  paths (`@micacms/astro`, `@micacms/core`).
- **No HEIC images.** An image field refuses HEIC files, because Astro cannot
  process them (`@micacms/runtime`).

### Added

- **`mica import`** moves Astro content collections into Mica, from Astro's
  data store: field by field, with `--map` for changed names, alt text and the
  Markdown body (`@body`), and `--order` for the manual order. It converts
  dates, references, images and the body, and lists what it did not import
  (`@micacms/editor`).

### Changed

- **Publish on a new branch.** The local editor pushes a branch without an
  upstream to `origin` and sets the upstream (`@micacms/runtime`).
- **The setup guides** give the commands for two commits (the setup, then the
  content) and for pushing a new branch, use `mica import`, and let the user
  choose how to keep an existing order field (`@micacms/astro`).

## [0.6.0-rc.1] — 2026-10-13

New configuration names, a new package shape and a smaller public API. Mica
also stops losing content without an error: an entry in the wrong layout, rich text that
the editor cannot show, and a broken link or image at Publish are all named
now. Images can carry alt text, and the image runs on arm64.

Read Breaking before upgrading. A self-hosted Mica needs its `.env` renamed; a
site needs Node 24, Astro 7 and `@micacms/core` installed beside
`@micacms/astro`.

### Breaking

- **Every configuration variable starts with `MICA_`.** Rename in `.env`:
  `SESSION_SECRET`, `SESSION_TTL_HOURS` and `SESSION_IDLE_HOURS` to
  `MICA_SESSION_*`; `LOGIN_MAX_ATTEMPTS` and `LOGIN_WINDOW_MS` to
  `MICA_SIGNIN_MAX_ATTEMPTS` and `MICA_SIGNIN_WINDOW_MS`; `TRUST_PROXY`,
  `MAX_UPLOAD_BYTES`, `LOG_LEVEL`, `ADMIN_ORIGINS` and `ADMIN_DIR` to their
  `MICA_` names; `MICA_ADMIT_GROUP` and `MICA_ADMIT_DOMAIN` to
  `MICA_ADMIT_GROUPS` and `MICA_ADMIT_DOMAINS`. The old names are not read.
  Every variable is at https://micacms.com/docs/configuration/
  (`@micacms/runtime`, `@micacms/auth-oidc`, `@micacms/self-hosted`).
- **The local editor reads no `.env` file**, and a flag wins over the
  environment. `MICA_CONTENT_ROOT` sets the content root when no path is given
  (`@micacms/editor`).
- **Node 24 and Astro 7.** Every package requires Node 24 or newer;
  `@micacms/astro` requires Astro 7.
- **`@micacms/core` and zod are peer dependencies** of `@micacms/astro`, and zod
  of `@micacms/core`: install `@micacms/astro @micacms/core`, and npm installs
  zod (`@micacms/astro`, `@micacms/core`).
- **A text `pattern` must match the whole value**, with the `u` flag. An
  invalid pattern stops the model from loading. For "contains", write `.*x.*`
  (`@micacms/core`).
- **An entry in the other layout is an error, not hidden.** The first rich-text
  or media field of a collection, or the removal of the last one, changes where
  its entries are stored. Until the files move, the build fails, the local
  editor refuses to start, and both name the files. `npx mica migrate-layout`
  moves them (`@micacms/core`, `@micacms/astro`, `@micacms/runtime`,
  `@micacms/editor`).
- **Smaller public API.** `@micacms/astro` no longer re-exports the readers of
  `@micacms/core`; import them from `@micacms/core`. Core no longer exports
  `collectMediaIds`, `walkFields`, `mediaRefSchema`, `collectionSchema`,
  `singletonSchema` and `SchemaMode`, and `fieldsSchema` and `validateFields`
  take no mode. Each package README says whether it is public or internal
  (`@micacms/core`, `@micacms/astro`, `@micacms/runtime`).
- **`@micacms/self-hosted` is no longer on npm.** It ships only as the image
  `ghcr.io/micacms/mica`.

### Added

- **Alt text on media fields.** `media({ alt: "required" | "optional" })`
  stores `{ path, alt }`, with an alt-text input under each image. A stored
  plain path reads as one without alt text; with `"required"`, the build fails
  until each such image has it (`@micacms/core`, `@micacms/editor-ui`).
- **`mica migrate-layout`** moves the entries that a layout change left behind,
  and removes only the rich-text and media files that nothing uses any more
  (`@micacms/editor`).
- **References are checked.** Publish refuses a change that would leave a
  broken relation or a missing file on the site, including a deleted or
  renamed entry that other entries still link to. The Astro loaders warn about
  each broken reference; `micaCollections(site, { strict: true })` fails the
  build instead (`@micacms/runtime`, `@micacms/astro`).
- **A configuration reference** at https://micacms.com/docs/configuration/.
- **`npm run mica` and `npm run check`.** The setup guides and `mica init` add
  the scripts; `check` runs `astro check` too when `@astrojs/check` is
  installed (`@micacms/editor`, `@micacms/astro`).
- **The image runs on amd64 and arm64.** It carries third-party license
  notices, and the editor bundle ships them too (`@micacms/editor-ui`,
  `@micacms/self-hosted`).

### Changed

- **Rich text never opens empty and never drops Markdoc.** Text with something
  the editor cannot show — an image, a table, a `{% tag %}`, front matter, a
  variable — opens read-only with the reason and the source. The `toolbar`
  option limits what an editor can add, not what loads (`@micacms/editor-ui`).
- **A missing branch has its own message**, and `/ready` reports
  `branch_not_found` (`@micacms/self-hosted`).
- **The image is smaller:** npm, npx, corepack and yarn are gone, and the base
  image is pinned by digest (`@micacms/self-hosted`).
- **A release that failed part of the way can run again.**

## [0.5.0] — 2026-10-13

The self-hosted Mica keeps its own Git clone of the content repository. It no
longer uses a SQLite database or the GitHub and GitLab APIs. Both apps now
work the same way: a draft is an uncommitted file in a Git working tree, and
Publish commits the reviewed files. Any Git host over HTTPS should work. A
coding agent can now set Mica up from one prompt.

A self-hosted Mica needs a new configuration, so read Breaking before
upgrading. There is no upgrade path from 0.4: publish or discard every draft
on 0.4 first, then set up 0.5 from the new `deploy/self-hosted/compose.yml`
and `.env.example`.

### Breaking

- **New repository configuration.** Set `MICA_REPOSITORY_URL` (the HTTPS clone
  URL) and `MICA_REPOSITORY_TOKEN`. Optional: `MICA_REPOSITORY_USERNAME`,
  `_BRANCH`, `_ROOT` and `_SYNC_SECONDS`. `MICA_DATA_DIR` replaces `DATA_DIR`.
  `REPOSITORY`, `REPOSITORY_*` and `DATABASE_PATH` are not read any more
  (`@micacms/self-hosted`).
- **No upgrade from 0.4.** Mica 0.5 does not read the 0.4 draft database.
- **A narrower token.** GitLab needs only `read_repository` and
  `write_repository`, not `api`. GitHub needs Contents: read and write.
- **`@micacms/connectors` is removed.** Its file layer is in `@micacms/runtime`
  as `contentFiles` and `ContentFiles`. Core no longer exports the draft-store
  and repository-port types (`@micacms/core`, `@micacms/runtime`).
- **The manifest changes once.** `.mica/schema.json` now names
  `@micacms/astro` without a version and records each collection's `layout`.
  Build the site and commit the file; a self-hosted Mica restarts once for it.
  After that, a package update no longer changes the file (`@micacms/astro`,
  `@micacms/core`).

### Added

- **Set up Mica with a coding agent.** Give the agent the prompt "Read
  https://micacms.com/setup.md and set up Mica in this project." The guides it
  follows ship in `@micacms/astro/setup/`: a new or empty Astro project, and a
  project with Astro content collections (`@micacms/astro`).
- **`mica check`** checks every entry against the model and exits with 1 on an
  error: fields that do not validate, missing media, relations to entries that
  do not exist, entries in the wrong layout, and files that Mica does not read.
  Run it in CI with `npx mica check` (`@micacms/editor`).
- **`mica init`** writes a starter `src/mica.ts` and `src/content.config.ts`,
  and never overwrites a file (`@micacms/editor`).
- **Conflicts with the website.** When a change on the website touches an
  entry that has a draft, the editor sees a conflict and chooses "Keep my
  version" or "Use the website's version", with a comparison of the two
  (`@micacms/editor-ui`, `@micacms/self-hosted`).
- **The `check` command of the image** tests a configuration, the token and
  the push rights in a temporary clone: `docker compose run --rm mica check`
  (`@micacms/self-hosted`).
- **Sync state** on the Publish, Dashboard and System pages, and reason codes
  on `/ready` (`@micacms/editor-ui`, `@micacms/runtime`).

### Changed

- **A field type from a newer `@micacms/astro` no longer stops Mica.** Only
  the collection or singleton that uses it is read-only, with a message that
  names the upgrade; everything else stays editable. In the site's own model,
  an unknown field type fails the build (`@micacms/runtime`,
  `@micacms/editor-ui`, `@micacms/astro`).
- **Publish commits only the reviewed files**, with the editor as author, and
  refuses a file that changed after the review (`@micacms/runtime`).
- **A refused push turns back into drafts** and shows the host's reason. A
  push that fails on the network or on authentication stays committed and is
  pushed again later (`@micacms/self-hosted`).
- **Git on the server is isolated**: no hooks, filters or symlinks, HTTPS
  only, and the token goes only to the configured host. The image now
  contains `git` and `tini` (`@micacms/self-hosted`).
- The loader logs name any collection or singleton correctly, and the source
  maps contain their sources, so an Astro build no longer warns about missing
  source files (`@micacms/astro`).

### Fixed

- A save that failed between writing its temporary file and renaming it left
  the temporary file in the content directory (`@micacms/runtime`).

### Known gaps

- Git LFS under the content root is refused, and SSH remotes are not
  supported yet.
- A file that `.gitignore` hides under the content root is not shown and not
  published.

## [0.5.0-rc.2] — 2026-10-12

The second release candidate, published under the npm tag `next` and as the
image `ghcr.io/micacms/mica:0.5.0-rc.2`. `latest` stays at 0.4.1. It contains
everything in 0.5.0-rc.1, and the additions below.

### Added

- **Set up Mica with a coding agent.** Give the agent the prompt "Read
  https://micacms.com/setup.md and set up Mica in this project." The guides it
  follows ship in `@micacms/astro/setup/`: a new or empty Astro project, and a
  project with Astro content collections (`@micacms/astro`).
- **`mica check`** checks every entry against the model and exits with 1 on an
  error. It finds fields that do not validate, missing media, relations to
  entries that do not exist, entries in the wrong layout, and files that Mica
  does not read. Run it in CI with `npx mica check` (`@micacms/editor`).
- **`mica init`** writes a starter `src/mica.ts` and `src/content.config.ts`,
  and never overwrites a file (`@micacms/editor`).

### Changed

- The loader logs name any collection or singleton correctly, and show the
  path of the written model from the project (`@micacms/astro`).
- The source maps contain their sources, so an Astro build no longer warns
  about missing source files.

## [0.5.0-rc.1] — 2026-10-12

A release candidate, published under the npm tag `next` and as the image
`ghcr.io/micacms/mica:0.5.0-rc.1`. `latest` stays at 0.4.1.

The self-hosted Mica keeps its own Git clone of the content repository. It no
longer uses a SQLite database or the GitHub and GitLab APIs. Both apps now
work the same way: a draft is an uncommitted file in a Git working tree, and
Publish commits the reviewed files. Any Git host over HTTPS should work.

### Breaking

- **New repository configuration.** Set `MICA_REPOSITORY_URL` (the HTTPS clone
  URL) and `MICA_REPOSITORY_TOKEN`. Optional: `MICA_REPOSITORY_USERNAME`,
  `_BRANCH`, `_ROOT` and `_SYNC_SECONDS`. `MICA_DATA_DIR` replaces `DATA_DIR`.
  `REPOSITORY`, `REPOSITORY_*` and `DATABASE_PATH` are not read any more. Start
  from the new `deploy/self-hosted/compose.yml` and `.env.example`
  (`@micacms/self-hosted`).
- **No upgrade from 0.4.** Mica 0.5 does not read the 0.4 draft database.
  Publish or discard every draft on 0.4 before you change the image.
- **A narrower token.** GitLab needs only `read_repository` and
  `write_repository`, not `api`. GitHub needs Contents: read and write.
- **`@micacms/connectors` is removed.** Its file layer is in
  `@micacms/runtime` as `contentFiles` and `ContentFiles`. Core no longer
  exports the draft-store and repository-port types (`@micacms/core`,
  `@micacms/runtime`).

### Added

- **Conflicts with the website.** When a change on the website touches an
  entry that has a draft, the editor sees a conflict and chooses "Keep my
  version" or "Use the website's version", with a comparison of the two
  (`@micacms/editor-ui`, `@micacms/self-hosted`).
- **The `check` command** tests a configuration, the token and the push
  rights in a temporary clone: `docker compose run --rm mica check`
  (`@micacms/self-hosted`).
- **Sync state** on the Publish, Dashboard and System pages, and reason codes
  on `/ready` (`@micacms/editor-ui`, `@micacms/runtime`).

### Changed

- **Publish commits only the reviewed files**, with the editor as author, and
  refuses a file that changed after the review (`@micacms/runtime`).
- **A refused push turns back into drafts** and shows the host's reason. A
  push that fails on the network or on authentication stays committed and is
  pushed again later (`@micacms/self-hosted`).
- **Git on the server is isolated**: no hooks, filters or symlinks, HTTPS
  only, and the token goes only to the configured host. The image now
  contains `git` and `tini` (`@micacms/self-hosted`).

### Known gaps

- Git LFS under the content root is refused, and SSH remotes are not
  supported yet.
- A file that `.gitignore` hides under the content root is not shown and not
  published.

## [0.4.1] — 2026-10-11

Publishes the image that 0.4.0 is missing. The packages are the same as in
0.4.0.

### Fixed

- **0.4.0 has no image.** Its release published the npm packages, but the
  image build stopped, so `ghcr.io/micacms/mica:0.4.0` does not exist. Use
  `ghcr.io/micacms/mica:0.4.1`, the first signed image with an SBOM and build
  provenance. Read the Breaking section of 0.4.0 before upgrading from 0.3.0
  (#165).

## [0.4.0] — 2026-10-11

Security hardening, after a review of the whole self-hosted surface and an
OWASP ASVS level 1 self-review (`docs/security-review.md`). The project moved
to the `micacms` organization, and so did the image. A self-hosted Mica needs
changes to its compose file and `.env`, so read Breaking before upgrading. The
local editor needs no change.

### Breaking

- **The image is `ghcr.io/micacms/mica`.** The repository moved to
  `micacms/mica`. Change `image:` in your compose file;
  `ghcr.io/amuedespacher/micacms` gets no new versions (`@micacms/self-hosted`).
- **Production needs an `https://` `MICA_PUBLIC_URL`.** With
  `NODE_ENV=production`, the self-hosted Mica refuses to start when
  `MICA_PUBLIC_URL` is missing, or when it is `http://` on anything but
  loopback. Put Mica behind a proxy that terminates TLS
  (`@micacms/self-hosted`).
- **Editors sign in once more.** Over https, the session and CSRF cookies are
  now named `__Host-mica_session` and `__Host-mica_csrf`
  (`@micacms/auth-oidc`).
- **`/health` checks only the process.** It does no I/O any more, so a
  provider outage no longer restarts the container. The new `/ready` checks
  the database and the repository, cached for 30 seconds: point a monitor that
  must notice a repository outage at it. Neither answer shows the repository's
  origin or the uptime; the System view shows both (`@micacms/runtime`).
- **SVG is refused.** Mica does not accept SVG uploads, and does not list or
  show SVG files that are in the repository, because an SVG can carry a
  script. The website build is not affected. Use PNG or WebP in the editor
  (`@micacms/runtime`, `@micacms/editor-ui`).
- **`within()` from `@micacms/core/node` refuses the content root** unless it
  is called with `{ allowRoot: true }` (`@micacms/core`).

### Security

- A content path can no longer leave the content root. Before, a signed-in
  editor of a GitHub- or GitLab-backed Mica could read any file in the
  repository, and call other GitHub API read endpoints with the server's token,
  through the media file route. Every connector now refuses `..`, `.`, empty
  segments, backslashes and control characters, an upload goes only into a
  `media/` folder, and no write or delete can name the content root itself
  (#85).
- A crafted JXL, HEIF or ICNS upload can no longer block the server in an
  infinite loop: `image-size` 2.0.3 (#145).
- Every response carries a same-origin Content-Security-Policy, and the editor
  loads its font from Mica instead of Google Fonts (#146).
- Mica neither stores nor shows SVG files any more. Before, an SVG served from
  the admin origin could run a script with the editor's session. Every media
  file is now served in a sandbox, and a file that is not an image is sent as a
  download (#86).
- The sign-in can no longer send a browser to another site afterwards. Before,
  a return path such as `/\evil.example` passed the check; now the path is
  parsed like a browser does and must be a page of the editor (#87).
- Anonymous health checks can no longer spend the repository token's API quota,
  and they no longer show the repository or the uptime (#79).
- Over https, the session and CSRF cookies have a `__Host-` name, and every
  response carries `Strict-Transport-Security`. In production, the self-hosted
  Mica refuses to start with an `http://` public address, except on loopback
  (#147).
- An oversized request is refused before it is read into memory: at most
  2 MiB for JSON, and at most 10 files of `MAX_UPLOAD_BYTES` per upload. The
  editor uploads a larger selection in batches (#148).
- With `TRUST_PROXY=true`, Mica takes the client address from the right-most
  `X-Forwarded-For` entry, so a client can no longer choose its own address to
  avoid the sign-in rate limit. The sign-in callback is rate limited too
  (#149).
- A refused sign-in no longer puts the person's email address in the URL: the
  login page gets a code and shows the message. A client's `x-request-id` is
  kept only when it is short and plain, and text media are sent as UTF-8
  (#150).
- In production, the self-hosted Mica refuses to start without
  `MICA_PUBLIC_URL`, whose default is a localhost address. At startup it warns
  about `MICA_*` and `REPOSITORY_*` variables that it does not read (#90).
- The sign-in transaction cookie is signed with a key derived from
  `SESSION_SECRET`, not with the secret itself. An email address counts as
  verified only when the flag came with that same address (#91).
- The image is signed with a keyless cosign signature and carries an SBOM and
  build provenance. CI scans it for critical vulnerabilities. The compose file
  runs it with a read-only root file system, no capabilities and a memory
  limit (#133).
- Every workflow has read-only default permissions, every action is pinned by
  commit SHA, and the release runs in a `release` environment that can require
  an approval (#135).

## [0.3.0] — 2026-10-10

Simpler self-hosting and the v1.5 brand. A self-hosted Mica now keeps sessions
in a cookie and publishes only through GitHub or GitLab, so read Breaking
before upgrading. The local editor needs no change.

### Added

- **Admit editors by verified email address.** `MICA_ADMIT_EMAILS` lists the
  addresses that may sign in, for providers that send no groups claim, such as
  Google (`@micacms/auth-oidc`).

### Changed

- **The v1.5 brand.** The editor shows the lowercase `micacms` wordmark and the
  new favicon, an aubergine sidebar and creme surfaces, and uses Inter as its
  only font. The sidebar text and the Publish badge have more contrast
  (`@micacms/editor-ui`).
- **The System page no longer shows a session count**, because the database no
  longer holds sessions (`@micacms/editor-ui`, `@micacms/runtime`).

### Breaking

- **Sessions are an encrypted cookie, not a database table.** Migration 3 drops
  the `sessions` table: the database now holds only unpublished drafts. Set
  `SESSION_SECRET` in production; changing it signs everybody out. Everyone
  signs in once more after the upgrade. `createOidcAuth` no longer takes a
  database, the session repository exports are removed, and
  `OperationalInfo.database` has no `sessions` field
  (`@micacms/auth-oidc`, `@micacms/runtime`, `@micacms/self-hosted`).
- **A self-hosted Mica requires `REPOSITORY=github` or `gitlab`.**
  `REPOSITORY=local`, the old default, now stops startup. To edit a checkout,
  use `npx @micacms/editor` (`@micacms/self-hosted`).
- **A `MICA_ADMIT_DOMAIN` that names a public provider stops startup**, for
  example `gmail.com`, because it would admit every account at that provider.
  Use `MICA_ADMIT_EMAILS` for single addresses (`@micacms/auth-oidc`).

## [0.2.2] — 2026-10-10

One fix to how pending work is counted. Nothing breaks; upgrade at any time.

### Fixed

- **The Publish badge and the dashboard count edits, not files.** A URL change
  of a page showed as five pending changes — the deleted and the created files
  and the order file — while the Publish page showed one. Every count in the
  editor now uses the same unit as the Publish page: one edit per entry,
  singleton, collection order or shared media (`@micacms/editor-ui`).

## [0.2.1] — 2026-10-10

Fixes for changing the URL of an entry. Nothing breaks; upgrade at any time.

### Changed

- **The Publish page shows a URL change as one renamed entry.** It used to
  show one removed and one added entry, with every field marked as changed.
  Now the comparison lists only the fields that changed — usually only the
  URL. A rename is recognised by its content, as Git recognises one: the old
  and the new version must agree on at least half of their non-empty fields,
  the URL aside. "Discard" on the row puts the entry back at its old URL
  (`@micacms/runtime`, `@micacms/editor-ui`).

### Fixed

- **A URL change no longer breaks the entry's own images.** The rename moved
  the files in the entry's `media/` folder to the new folder, but the media
  fields still pointed into the old folder, which the rename deleted. The
  references now move with the files (`@micacms/connectors`).
- **A renamed entry keeps its place in a manually ordered collection.** The
  rename did not update `_order.json`, so the entry dropped to the end of the
  list. The new slug now takes the old slug's place (`@micacms/connectors`).

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
