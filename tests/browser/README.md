# Automated browser test

[Playwright](https://playwright.dev) drives the editor UI in Chromium. There
are two configurations:

- `playwright.config.ts`: the self-hosted editor, against the
  [OIDC test stack](../oidc/README.md): the real Mica image behind Dex,
  publishing to a Forgejo Git host. It needs Docker. CI runs it on every pull
  request that can change the image, in
  [`image.yml`](../../.github/workflows/image.yml), after the OIDC test.
- `local-editor.config.ts`: the local editor, `mica start`, from the local
  build. It needs no Docker. CI does not run it yet.

The OIDC test proves the protocol with `fetch`. These tests prove that an
editor can do the same by clicking.

## What the self-hosted test checks

`alice@gmail.com`, in one browser:

- signs in through Mica's login view and Dex's login form;
- opens the Website settings from the sidebar and changes the tagline;
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

[`local-editor/rich-text.spec.ts`](local-editor/rich-text.spec.ts):

- copies the starter's content (`examples/starter/content`) into a temporary
  Git repository;
- starts `apps/local-editor/dist/cli.js start` on it, on a free port;
- opens the post, and types a heading, a paragraph with bold text and a list
  into its rich text field, with the Markdown shortcuts;
- saves at once, without a pause, so the save must take the text that the
  field still holds back;
- compares the written `body.mdoc` with the expected Markdoc, and checks that
  the repository did not move.

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

- **Conflicts.** Two editors on one entry are covered by the API tests and by
  the editor's unit tests (#139).
- **Sign-in in the local editor.** It has no sign-in.
- **Other browsers.** Chromium only.
