# 37. A live preview beside the form; a link to the published page

**Status:** Accepted. Replaces [26](0026-preview.md).

## Context

An editor wants to see a change on its page at once, and to go from a text on the page to its field. The drafts of a self-hosted Mica are uncommitted files in its clone, so a host's deploy preview cannot see them. Mica must not call the website or start a build ([1](0001-git-is-the-source-of-truth.md)).

## Decision

- The model option `url` names the page of an entry (`/news/{slug}`) or of a singleton (`/about`). With `MICA_SITE_URL`, the editor shows "Open on website" for a published entry, and the Publish page links to each page that it published.
- The local editor shows the page beside the form while `astro dev` runs, for each form with a page. The dev server reads the drafts and loads the page again after each save. The loader writes the dev server's address to a file in the system's temp folder, never in the repository. The editor allows frames only from `localhost` in the local editor.
- `@micacms/astro/preview` (`micaPreview()`) is public. With `MICA_PREVIEW=1 astro dev`, the loaders append invisible markers to the values of text and textarea fields, except values that look like an address or a phone number, to rich text, and to the alt text of images. `renderRichText` takes the marker off and marks each top-level block with its field and its place, which is also its place in the editor's text. An image in a gallery has its place in its marker. Each page gets the preview script. A build and a plain `astro dev` do not change.
- A value that reaches the page formatted, looked up or compared, such as a date, a number or an option, cannot carry a marker. In the same mode, a Vite step reads each `.astro` template with Astro's own parser (`@astrojs/compiler-rs`, a peer dependency) before Astro compiles it, and writes the fields that each element's expressions read into `data-mica-fields`. A component's root element also gets the fields that its call site reads, such as `<TagList tags={tags} />`. The page gives such an element to the nearest document around it whose model has the field. The templates do not change for Mica.
- The script and the editor talk with `postMessage`. The script answers only an editor on the same computer, or an origin in `MICA_PREVIEW_EDITOR`.
- A click on a marked text opens its field: in the form of its document when the document has a page, else in a form over the main form. A click on a block of rich text puts the cursor in that block, and the block of the cursor comes into view in the preview. A related entry, such as the author of an article, shows with its own markers: the editor finds the relation field of the form's document that links to it, in the document's data. A click goes to that field; the hover label also offers to edit the entry in the overlay form, as "Edit" in the field does. In Edit mode the form follows the page that the preview shows. Fields with unpublished changes get another outline; in a rich text, the changed blocks get it, not the whole text. An element that shows fields of several documents opens the field of the form's document; the others, such as a word from the labels, are buttons in its label. A rich text is one outline and one field. The rest of the page dims around the hovered or focused field.
- The self-hosted Mica has no draft preview in 1.0. A staging branch with a second Mica gives a reviewed preview.

## Consequences

- In the preview only, text values carry invisible characters: a template that compares a text, or builds an address from it, can act differently there.
- The reading of the templates follows the common forms: member paths, destructuring, computed values, loops and fetched documents. A value that another module reads and formats by itself, or an element that shows fields of two documents, can go to the wrong field or to none.
- `@micacms/astro/preview` is in the public surface of [30](0030-semver-covers-the-public-surface.md).
- If Astro takes another port, set `server.port` to make the preview exact.
- Change this decision when: editors of a self-hosted Mica need a preview. The next step is a preview container that runs `astro dev` on the clone, behind the editor's sign-in.
