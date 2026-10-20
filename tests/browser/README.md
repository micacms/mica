# Automated browser test

[Playwright](https://playwright.dev) drives the editor UI in Chromium. There
are two configurations:

- `playwright.config.ts`: the self-hosted editor, against the
  [OIDC test stack](../oidc/README.md): the real Mica image behind Dex,
  publishing to a Forgejo Git host. It needs Docker. CI runs it on every pull
  request that can change the image, in
  [`image.yml`](../../.github/workflows/image.yml), after the OIDC test.
- `local-editor.config.ts`: the local editor, `mica start`, from the local
  build. It needs no Docker. CI runs it on every pull request, in the job
  `local-editor-browser` of `ci.yml`.

The OIDC test proves the protocol with `fetch`. These tests prove that an
editor can do the same by clicking.

## What the self-hosted test checks

`alice@gmail.com`, in one browser:

- signs in through Mica's login view and Dex's login form;
- opens the General settings from the sidebar and changes the tagline;
- saves, and the repository does not move;
- sees the edit on the Publish page and publishes it as one commit on top of
  the old head, by the editor who pressed Publish;
- signs out, and the admin API refuses the browser.

Two more tests run [axe](https://github.com/dequelabs/axe-core) on every view
of the editor, and on the open relation picker and link dialog: one in the
light mode and one in the dark mode. A serious or critical finding fails them
(#108). A fourth test orders the entries of a collection and the items of a list with
the same controls, and puts both orders back. A fifth test chooses the dark
appearance and checks that the browser keeps it. A sixth test ends a session
while a form has changes, and checks that the changes come back after the next sign-in.

[`collections.spec.ts`](collections.spec.ts) takes one entry of a collection
from start to end (#138): it creates a team member, uploads a portrait with alt
text, changes the URL, discards another edit on the Publish page, publishes, and
checks the files on the Git host. Then it deletes the entry and publishes the
deletion, and the files are gone from the Git host.

## What the local editor test checks

Each spec starts `apps/local-editor/dist/cli.js start` on a free port, on a
temporary Git repository, with [`local-editor/editor.ts`](local-editor/editor.ts).
The repository has the starter's content (`examples/starter/content`), except
for the live preview's spec.

[`local-editor/rich-text.spec.ts`](local-editor/rich-text.spec.ts):

- opens the post, and types a heading, a paragraph with bold text and a list
  into its rich text field, with the Markdown shortcuts;
- saves at once, without a pause, so the save must take the text that the
  field still holds back;
- compares the written `body.mdoc` with the expected Markdoc, and checks that
  the repository did not move.

[`local-editor/publish.spec.ts`](local-editor/publish.spec.ts), with a bare
remote (#139):

- two pages open the same post, and both save: the second page shows the save
  conflict, and "Keep mine" writes its version;
- Publish makes one commit and pushes it to the remote;
- with the remote out of reach, Publish keeps the commit and says so; "Try
  again" sends the same commit, and makes no new one.

[`local-editor/preview.spec.ts`](local-editor/preview.spec.ts) uses the
example site, not the starter. [`local-editor/preview-site.ts`](local-editor/preview-site.ts)
copies it to the repository's ignored `.tmp/`, starts `MICA_PREVIEW=1 astro dev`
on the copy, and starts the editor on its content. The test:

- opens a page, and a click on its heading in the preview puts the cursor in
  the Title field;
- clicks a link of the footer menu: the Navigation form opens over the page's
  form, and "Back to page" closes it;
- types a new introduction: the form saves by itself, the preview shows the
  new text and marks it as not published, and the repository does not move;
- in Browse mode, follows the link to another page: back in Edit mode, the
  form is the form of that page.

## Run it

Once, after `rush install`:

```bash
cd tests/browser
./node_modules/.bin/playwright install chromium
```

The self-hosted test:

```bash
docker compose -f ../oidc/compose.yml up -d --build --wait
./node_modules/.bin/playwright test
docker compose -f ../oidc/compose.yml down
```

The local editor test. Run `rush build` first: the test starts the built CLI.

```bash
npm run test:local
```

The package has no `test` script, so `rush test` runs neither test.
A failed run keeps a screenshot and a trace in `test-results/`; open the trace
with `./node_modules/.bin/playwright show-trace`.

Each run of the self-hosted test uses seven of the 50 sign-in attempts per 15
minutes. The [OIDC test](../oidc/README.md#run-it) says when to restart the
`mica` service.

## What it does not check

- **Conflicts in the self-hosted editor.** The local editor test covers the
  save conflict. A conflict between a draft and a change at the Git host is
  covered by the API tests of the managed clone.
- **Sign-in in the local editor.** It has no sign-in.
- **Other browsers.** Chromium only.
