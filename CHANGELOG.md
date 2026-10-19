# Changelog

Notable changes to Mica. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); the version numbers
follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

Everything in this repository is released together and carries one version: the
published packages and the CMS image.

While the major version is `0`, a minor bump may break something. Read the
release note before upgrading.

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
