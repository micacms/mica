# Change Log - @micacms/editor

This log was last generated on Tue, 13 Oct 2026 14:06:11 GMT and should not be manually modified.

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

