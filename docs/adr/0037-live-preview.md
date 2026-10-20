# 37. A live preview beside the form; a link to the published page

**Status:** Accepted. Replaces [26](0026-preview.md).

## Context

An editor wants to see a change on its page at once, and to go from a text on the page to its field. The drafts of a self-hosted Mica are uncommitted files in its clone, so a host's deploy preview cannot see them. Mica must not call the website or start a build ([1](0001-git-is-the-source-of-truth.md)).

## Decision

- The model option `url` names the page of an entry (`/news/{slug}`) or of a singleton (`/about`). With `MICA_SITE_URL`, the editor shows "Open on website" for a published entry, and the Publish page links to each page that it published.
- The local editor shows the page beside the form while `astro dev` runs, for each form with a page. The dev server reads the drafts and loads the page again after each save. The loader writes the dev server's address to a file in the system's temp folder, never in the repository. The editor allows frames only from `localhost` in the local editor.
- `@micacms/astro/preview` (`micaPreview()`) is public. With `MICA_PREVIEW=1 astro dev`, the loaders append invisible markers to the values of text and textarea fields, except values that look like an address or a phone number, and each page gets the preview script. A build and a plain `astro dev` do not change.
- The script and the editor talk with `postMessage`. The script answers only an editor on the same computer, or an origin in `MICA_PREVIEW_EDITOR`.
- A click on a marked text opens its field: in the form of its document when the document has a page, else in a form over the main form. In Edit mode the form follows the page that the preview shows. Fields with unpublished changes get another outline.
- The self-hosted Mica has no draft preview in 1.0. A staging branch with a second Mica gives a reviewed preview.

## Consequences

- In the preview only, text values carry invisible characters: a template that compares a text, or builds an address from it, can act differently there.
- Only text and textarea fields can be clicked. Rich text, media and relations need their own markers.
- `@micacms/astro/preview` is in the public surface of [30](0030-semver-covers-the-public-surface.md).
- If Astro takes another port, set `server.port` to make the preview exact.
- Change this decision when: editors of a self-hosted Mica need a preview. The next step is a preview container that runs `astro dev` on the clone, behind the editor's sign-in.
