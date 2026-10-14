# Change Log - @micacms/editor

This log was last generated on Wed, 14 Oct 2026 11:51:45 GMT and should not be manually modified.

## 0.9.0
Wed, 14 Oct 2026 11:51:45 GMT

### Minor changes

- Each command takes only its own options, and a path is always the content root: import takes --collection for the collections to import. check and import exit with 78 without a readable model. The help says npx mica, and mica init writes the starter's model.
- `@micacms/editor` ships the built editor UI in `dist/admin`, and no longer depends on `@micacms/editor-ui`, which is not published any more. `@micacms/auth-oidc` is not published either.
- The editor has the new Mica look: green actions, a light sidebar, the Instrument Sans and IBM Plex Mono fonts, status labels with a coloured dot, and a dark theme that follows the system setting.
- `mica check` reads files named by row keys, and warns about a file whose row does not exist.
- Every list changes its order in the same way: the entries of a collection, the items of a list, the chosen entries of a relation, and the files of a media field. A handle drags an item or moves it with the keyboard, and arrow buttons move it one step. The "Move to position" dialog is gone.
- Under Appearance at the end of the menu, an editor chooses the light or the dark mode, or the mode of the system. The browser keeps the choice.
- Without a path, the CLI finds the content root by its .mica/schema.json; with more than one, it asks for the path.
- The local editor ignores `NODE_ENV`; it stays limited to this machine by its address and its host. `MICA_ADMIN_ORIGINS` and `MICA_ADMIN_DIR` are local-editor settings now.
- Remove `mica migrate-layout`. `mica check` reads every entry and singleton from its own folder.

### Patches

- Publish and Discard send the revisions of the comparison on the page, and Delete and Reorder send the revision the editor saw. A colleague's later save shows as a conflict instead of being published, discarded or overwritten unseen.
- Sign-out removes the unsaved form values that the tab kept, and an upload goes in batches of 4 files.
- `mica init` names `npm run check` for the content check.
- No restart notice: Mica brings in a .gitattributes change without a restart.
- A singleton field that is new in the model opens empty, not with its default.
- `mica check` says that Mica keeps a key or a `.mdoc` file that the model does not declare.
- `mica check` reports what the manifest reader leaves out, and an unknown field option.
- The System page shows whether Mica runs self-hosted or as the local editor, instead of `NODE_ENV`.
- The Media view and the media field upload one file for each request.

### Updates

- Build with Vite 8, the major that Astro uses.
- Import the internals of @micacms/core from @micacms/core/internal.
- Import the internals of @micacms/core from @micacms/core/internal.
- Describe the entry path as the entry folder.

## 0.8.0
Tue, 13 Oct 2026 19:37:59 GMT

### Minor changes

- mica check reports an image in rich text whose file is missing

### Patches

- mica import fills a tags field from a list or a comma-separated string

### Updates

- A test that the command-line reference names every command and option

## 0.7.0
Tue, 13 Oct 2026 14:06:11 GMT

### Patches

- mica check reads the slug as the file has it, and says that Mica uses the entry's name

## 0.6.0
Tue, 13 Oct 2026 11:14:11 GMT

### Minor changes

- `mica check` reads the path of a media value with alt text, and the `mica init` starter model asks for alt text on the cover image.
- Add `mica migrate-layout`: it moves the entries that a layout change left behind, and lists the rich-text and media files that it removes because no field reads them any more. The editor refuses to start while an entry is in the other layout.
- Breaking: the local editor no longer reads the `.env` file of the project, and a flag now wins over the environment (`PORT=3000 npx @micacms/editor --port 7000` listens on 7000). `MICA_CONTENT_ROOT` sets the content root when no path is given. Messages link to micacms.com, not to repository files.
- Breaking: requires Node 24 or newer.
- Add `mica import`: it moves Astro content collections into Mica from Astro's data store, field by field, with `--map` for changed names and alt text and `--order` for the manual order; it converts dates, references, images and the Markdown body, and lists what it did not import.
- Breaking: `mica start [content directory]` opens the editor, and `mica` alone prints the help. The first word is always a command, so that a directory named like a command cannot run it. Update a `"mica": "mica"` script to `"mica": "mica start"`.

### Patches

- `mica init` names the `mica` and `check` scripts that package.json lacks, and suggests `mica check` in front of an existing `check` script; `check` runs `astro check` too when `@astrojs/check` is installed.

## 0.5.0
Tue, 13 Oct 2026 04:44:02 GMT

### Minor changes

- Add `mica init`, which adds Mica to an Astro project without overwriting a file, and `mica check`, which checks every entry against the model and exits with 1 on an error.
- `mica check` reports a field kind from a newer `@micacms/astro` as an error, and checks the rest of the content.
- Publish only the changes the developer reviewed, and refuse a file that was saved again after the review. Saves, commits and discards no longer interleave.

## 0.4.0
Sun, 11 Oct 2026 15:57:57 GMT

### Updates

- Security: /health checks only the process; the new /ready checks the database and the repository, cached for 30 s; neither shows the repository or the uptime
- Point the Host-check message to the repository at micacms/mica
- Require hono 4.13.7 and image-size 2.0.3, which fix published security advisories

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

### Updates

- Migrated the repository tooling from pnpm workspaces to Rush.

