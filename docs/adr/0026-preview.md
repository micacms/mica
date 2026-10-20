# 26. Preview in the local editor only; a link to the published page

**Status:** Replaced by [37](0037-live-preview.md)

## Context

The drafts of a self-hosted Mica are uncommitted files in its clone, so a host's deploy preview cannot see them. Mica must not call the website or start a build ([1](0001-git-is-the-source-of-truth.md)).

## Decision

- The model option `url` names the page of an entry (`/news/{slug}`) or of a singleton (`/about`). With `MICA_SITE_URL`, the editor shows "Open on website" for a published entry, and the Publish panel links to each page that it published.
- The local editor shows "Preview" while `astro dev` runs, because the dev server reads the drafts. The loader writes the dev server's address and process id to a file in the system's temp folder, never in the repository.
- The self-hosted Mica has no draft preview in 1.0. A staging branch with a second Mica gives a reviewed preview.

## Consequences

- A self-hosted editor sees a change on the website only after Publish, or on a staging site.
- If Astro takes another port, set `server.port` to make the preview exact.
- Change this decision when: editors publish to check their work. The next step is a push of the drafts to a branch such as `mica/preview`, for the host to build.
