# Changelog

Notable changes to Mica. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); the version numbers
follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

Everything in this repository is released together and carries one version: the
published packages and the CMS image.

While the major version is `0`, a minor bump may break something. Read the
release note before upgrading.

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
