# Changelog

Notable changes to Mica. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); the version numbers
follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

Everything in this repository is released together and carries one version: the
published packages and the CMS image.

While the major version is `0`, a minor bump may break something. Read the
release note before upgrading.

## [0.14.0] — 2026-10-25

This version names the website in the editor, says how its preview is, and
shows what went wrong, without a shell on the server.

### Added

- **The website's name.** `defineSite({ label })` names the website for its
  editors, with 60 characters at most. The top of the editor's menu shows it,
  with the address of the published website from `MICA_SITE_URL`, and a click
  on it opens the Overview. An older Mica ignores the label.
- **The state of the preview** at the top of the menu: Preview live, starting,
  stopped or off. While it is live, a click opens it. A form with a page says
  why the page is not there yet.
- **Recent problems on the System page.** It lists the last warnings and
  errors since Mica started, kept in memory only, with email addresses hidden,
  and a Preview section with the state of the preview and its last lines.
  "Copy report" adds them.
- **The preview image reports its state** on port 4380 inside the network, so
  that the self-hosted editor knows when the preview copies, installs, starts
  or failed, and why. An image of your own does not need it.
- **Ready to run on demand.** Before the self-hosted Mica stops, it tries once
  more to push a publication that waits, and after a start of both, the
  preview waits for Mica's first sync (ADR 39).

### Changed

- The whole first cell of an entry list opens the entry.

### Fixed

- The local editor reads `MICA_SITE_URL`, as the docs say.
- The local editor keeps its preview when a second dev server of the same
  content root stops.

## [0.13.0] — 2026-10-24

This version adds the live preview: the real page of the website beside the
form, with the drafts in it, in the local and in the self-hosted editor. The
editor also saves by itself.

### Added

- **The live preview.** The editor shows the page of an entry beside its form,
  with the drafts in it, about a second after you stop typing. A click on a
  text, a paragraph, an image, a date or an option in the page opens its field,
  and a related entry, such as the author of an article, opens over the current
  form. Unpublished changes have an outline. Add `micaPreview()` from
  `@micacms/astro/preview` to `astro.config`; the templates do not change.
- **`mica start --preview`** starts the editor and the website's
  `astro dev` with one command, also on Windows. The dev server stops with the
  editor.
- **The live preview in the self-hosted editor.** The image
  `ghcr.io/micacms/preview` runs the website's dev server on the drafts of
  Mica's clone, in a container of its own. Mica lets only signed-in editors in,
  on the name `preview.<the editor's name>`. `MICA_PREVIEW_UPSTREAM` turns it
  on. See "Add the live preview" in the self-hosting guide.
- **The editor saves by itself:** after a short pause in typing, when you leave
  a field, and when a form closes. A new entry has a Create button. A new URL
  waits for Change URL, which can also update the links in other entries.

### Changed

- `@micacms/astro` has a new peer dependency, `@astrojs/compiler-rs`, which
  Astro 7 installs. The preview uses it to find dates, numbers and options in
  the templates.
- The sidebar and the page header stay in place while the page scrolls.
  Settings show their description below the title.
- The editor's Content-Security-Policy allows frames from the origins of the
  live preview, and from no other.

### Fixed

- The local editor finds the dev server also when Astro takes another port,
  with `micaPreview()`. The dev server deletes its note for the editor also on
  Ctrl+C.
- A content root that cannot be written, such as the one of the self-hosted
  preview, gets a warning for the index of a reference set, and the site builds.

## [0.12.0] — 2026-10-19

This version adds no features. It tightens sign-in, makes failures clear, and
tests much more: Windows, macOS and Node.js 26, the packed packages in a new
Astro project, and the local editor in a browser.

### Breaking

- **A domain rule with Google needs the Workspace domain.** With
  `MICA_ADMIT_DOMAINS` and Google, the account's `hd` claim must be an admitted
  domain. A personal Google account with a company address is no longer
  admitted: add it to `MICA_ADMIT_EMAILS`. Put the primary domain of your
  Workspace in `MICA_ADMIT_DOMAINS`. Editors who sign in with Google through a
  domain rule must sign in again after the upgrade.

### Changed

- **The consent page for an agent** accepts Allow only one second after it
  opens, so that a click hidden behind a pop-up window cannot allow an agent.
  The check of a client document refuses more private IPv6 ranges, and a
  loopback redirect address must not have a fragment or a user name.
- **A broken entry file no longer hides its collection.** The list shows the
  other entries and names each file that Mica cannot read.
- **A full or read-only disk** gives a clear message that asks the person who
  runs Mica to act, and an error in the log, also for an MCP tool.
- **A server failure shows its reference** in the editor, which the log names
  too.
- The page "Versions and support" on micacms.com states what semantic
  versioning covers from 1.0, and which versions Mica supports.

### Fixed

- **Windows:** the content root can be given in any spelling, such as
  `D:/site/content`.

## 0.x — 2026-08-14 to 2026-10-18

The 0.x releases built Mica up to 0.11.0. Mica is experimental and not ready for
production. The notes of each 0.x release are in the
[GitHub releases](https://github.com/micacms/mica/releases). At 0.11.0, Mica has:

- **The model and the website.** A content model in TypeScript, with
  collections, singletons and field kinds for text, rich text (Markdoc), media,
  relations, tags and places on a map. `@micacms/astro` turns the model into
  Astro collections with types, Astro images and helpers, and writes
  `.mica/schema.json` for the editor.
- **Two editors.** The local editor (`npx @micacms/editor start`) has no sign-in
  and listens only on loopback. The self-hosted editor is the image
  `ghcr.io/micacms/mica`, behind any OpenID Connect provider.
- **Drafts and Publish.** A save is an uncommitted file in a Git working tree.
  Publish makes one commit of the changes that the editor chooses, and pushes it
  over HTTPS. The self-hosted Mica keeps its own clone, syncs it, and shows a
  conflict when a draft and the website changed the same entry.
- **Content in Git.** JSON, Markdoc and media files, with no database and no
  content API. Media can be in Git LFS, and the content can be in a Git
  submodule. Reference data links entries to items that Mica does not edit.
- **Agents.** An MCP server in both editors. Agents save drafts, and publish
  only when the operator allows it.
- **Tools.** `mica check`, `mica init`, `mica import` and a starter template.

The design decisions are in [docs/adr/](./docs/adr/README.md).
