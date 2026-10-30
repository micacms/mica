# Change Log - @micacms/editor

This log was last generated on Fri, 30 Oct 2026 14:29:32 GMT and should not be manually modified.

## 0.16.1
Fri, 30 Oct 2026 14:29:32 GMT

### Patches

- mica check: a `<` with a backslash before it, such as `\<tag>`, is text and no longer gives a raw HTML warning.
- When Mica stops or cannot be reached, an open editor tab shows a cover that says so, and continues by itself when Mica is back. The editor's messages name Mica, not a server.
- The Publish page warns about saved content that `.gitignore` hides from every publication, and names the paths for the developer.
- The save status of a form is green when it is saved, grey while it saves, yellow when a field needs a check and red when the save failed. Saved changes that are not published keep the yellow dot.
- The website and the documentation moved to mica.build: the CLI, the setup guides and the editor's Help for editors link point there. The editor shows the mica wordmark.
- One status for an entry or settings: its colour and word say whether the work is saved, and its dot says whether there is something to publish. Select it for when it was saved, what stops its publication, and "Discard changes". The editor no longer says "Published" for an entry.
- The preview status in the menu opens its details like the status of an entry: why the preview starts, stopped or is missing and what to do, and, while it is live, its address and "Open in a new tab". "Preview off" is now "No preview".

## 0.16.0
Tue, 27 Oct 2026 16:53:31 GMT

### Minor changes

- The editor edits localized fields in one language at a time. The language switcher is in the page header, with the number of missing translations. A button beside each localized field shows its other languages and can use one of them, and marks a missing translation. The page header is tidier: the status is below the title, and the entry's folder is below the form. The preview, Open on website and the URL under the ID field show the page of the form's language, and the live preview's page changes the form's language. mica check reports a localized ID that two entries have. The list of a collection shows the missing translations of each entry, and filters the entries that miss one language. The dashboard lists them for each language, and mica check lists them as information.

## 0.15.0
Mon, 26 Oct 2026 14:15:44 GMT

### Minor changes

- The editor links to a page such as /{activity}/{id} with the entry's saved values, in Open on website, the preview and after Publish, and finds the entry of such a page in the preview.
- A relation to one entry shows only the chosen entry, with Edit, Change and Remove; Change opens a dialog to find another entry (#351). The list of a relation field is no longer cut off in a list row or a group (#350). A row of a list can take its title from a relation: it shows the title of the entry, not its ID.
- The editor calls an entry's identity its ID: the ID field, Change ID and Keep the old ID. For a collection with a url, the editor shows the page's URL under the ID field, in the list of the collection and in the relation pickers, and Change ID names the page's old and new URL. mica init writes id() with the label ID.

### Patches

- mica start --preview reads the address that its astro dev prints, so the preview no longer shows another website or waits for ever when the port of the config is busy. A preview whose address Mica cannot confirm (a dev server without micaPreview()) shows Preview not confirmed, with the reason above the page. The preview no longer stays "starting" when the home page takes more than a second to render.
- The Publish page loads a comparison when its row comes near the screen, in batches, so that a change set of thousands of entries no longer gets "Too many requests". A change whose comparison did not load yet is published with the revisions of the list.

## 0.14.0
Sun, 25 Oct 2026 18:05:04 GMT

### Minor changes

- The System page has a Preview section with its state, the reason and its last lines; "Copy report" adds them. The local editor keeps the last 50 lines of the astro dev that --preview started, and still writes them to the terminal.
- The System page lists the last warnings and errors since Mica started, with email addresses hidden, and "Copy report" adds the newest 20 of them.
- The top of the menu shows the website's name from `label`, with its address from `MICA_SITE_URL`, and the state of the preview: live, starting, stopped or off. A click on the name opens the Overview. While a form waits for the preview, the place of the page says why. The local editor now reads `MICA_SITE_URL`, as the docs say.

## 0.13.0
Sat, 24 Oct 2026 13:39:21 GMT

### Minor changes

- `mica start --preview` also starts the project's `astro dev` with `MICA_PREVIEW=1`, so one command gives the editor and its live preview. The dev server stops with the editor.
- The editor saves by itself: after a short pause in typing, when you leave a field, and when a form closes. A new entry has a Create button, and a new URL waits for Change URL, with the choice to update the links in other entries. The header shows the status, with Publish and Discard.
- The live preview: the local editor shows the page beside the form while astro dev runs. A click on a text in the page opens its field, a page without its own form opens in a form over the current one, and the form follows the page that the preview shows.
- The sidebar and the page header stay in place while the page scrolls. Settings show their description below the title.
- The live preview also works for rich text: a click on a paragraph puts the cursor there, and the paragraph of the cursor comes into view in the preview.
- The live preview also works for images: a click on an image opens its media field, and in a gallery it goes to that image.
- The live preview knows relations: a click on the name of a related entry, such as the author of an article, goes to the relation field, and the label also offers to edit that entry. A relation field has Edit for each chosen entry, which opens it over the current form. The focus on a relation field shows the related entry in the preview.
- The live preview gives the page the field paths of each model, so that it can find the fields of dates, numbers and options, and names a field of another document with that document, such as "Labels: Map".

### Updates

- The header of a form keeps its title and its buttons readable when a wide preview makes the form narrow.
- In the live preview, a rich text with unpublished changes has the outline around each changed paragraph, not around the whole text.
- The editor signs in to a live preview on an origin of its own.

## 0.12.0
Mon, 19 Oct 2026 07:02:35 GMT

### Minor changes

- A collection list shows the entries that Mica can read and names the files of the others, instead of failing as a whole. A server failure shows its reference, which the log also names.

## 0.11.0
Sun, 18 Oct 2026 06:05:29 GMT

### Minor changes

- Support content in a Git submodule of the website repository: when the submodule is on a detached HEAD, the start banner and the Publish page give the command that checks out its branch, and Publish waits until it is on one.
- A coordinates field with `map` shows a map below the inputs. Click to set the place, or drag the pin; zoom with Ctrl or Cmd and the scroll wheel. The map loads only for such a field, and the inputs still work when it cannot load.
- "Open on website" in the header of an entry or a settings page, and links to the published pages after Publish, with MICA_SITE_URL and a url in the model.
- Files can be dropped on a media field. Uploads of many files show their progress, go on after a file fails, and can try the failed files again.
- Support Git LFS under the content root: the editor and mica mcp stop at start, and say how to fix it, when the content root uses Git LFS and Git LFS is not installed or not set up.
- The local editor shows Preview beside an entry or a settings page while astro dev runs: the page with the saved changes, before Publish.
- The media picker takes the file types of the field, and the Media view shows all files, images or other files.
- A relation to a reference set chooses from its items. mica check checks the ids against the index.
- The map of a coordinates field stores its zoom with the place.
- The editor says beside Save and Publish when they wait for a restart or an upgrade of Mica, because the content model changed. A page that could not load says so, with Try again, and never shows an empty list instead. An answer from a proxy, such as a page for a file that is too large, gives a clear message. A failed load of the content model no longer locks the editor until a reload.
- At start, the local editor removes the temporary files that an earlier Mica left behind, for example after a crash. mica check names the item of a list field whose file or entry is missing.
- Rich text is lighter. A field decides when it opens whether it is read-only, and an edit never makes it read-only: the editor refuses an image dropped into a list, or `{% … %}` in a code block, and says why. A `{%` typed in other text stays text. Typing converts the text when you pause, and Save always sends the current text. Tiptap and Markdoc load only for a form with a rich-text field: the chunk that every form loads goes from 232 kB to 42 kB gzip.

### Patches

- mica check names the new renderRichText(source, entry.data, { config }) for Markdoc tags.
- Entries and settings share one form, so a save, a conflict, "Keep mine" and "Use theirs" work the same in both. The editor no longer says that a save failed when the save worked and only reading the saved version back failed. Two dialogs on one page no longer share their IDs, and the media picker moves the focus to its search at once and keeps it inside, like the other dialogs.

### Updates

- Run the tests without a typecheck first; `rush typecheck` does it once.

## 0.10.0
Thu, 15 Oct 2026 04:37:22 GMT

### Minor changes

- Agents can edit the content: `npx mica mcp` serves the MCP tools over stdio, and `npx mica start` serves them at /mcp. Agents save drafts; `--allow-publish` or MICA_MCP_PUBLISH=true also gives them publish.

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

