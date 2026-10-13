# Automated browser test

[Playwright](https://playwright.dev) drives the editor UI in Chromium against
the [OIDC test stack](../oidc/README.md): the real Mica image behind Dex,
publishing to a Forgejo Git host. CI runs it on
every pull request, in the `docker` job of
[`ci.yml`](../../.github/workflows/ci.yml), after the OIDC test.

The OIDC test proves the protocol with `fetch`. This test proves that an editor
can do the same by clicking.

## What it checks

`alice@gmail.com`, in one browser:

- signs in through Mica's login view and Dex's login form;
- opens the Website settings from the sidebar and changes the tagline;
- saves, and the repository does not move;
- sees the edit on the Publish page and publishes it as one commit on top of
  the old head, by the editor who pressed Publish;
- signs out, and the admin API refuses the browser.

A second test runs [axe](https://github.com/dequelabs/axe-core) on every view
of the editor, and on the open relation picker and link dialog. A serious or
critical finding fails it (#108). A third test ends a session while a form has
changes, and checks that the changes come back after the next sign-in.

## Run it

```bash
rush install
cd tests/browser
./node_modules/.bin/playwright install chromium

docker compose -f ../oidc/compose.yml up -d --build --wait
./node_modules/.bin/playwright test
docker compose -f ../oidc/compose.yml down
```

It has no `test` script, so `rush test` does not run it: it needs the stack.
A failed run keeps a screenshot and a trace in `test-results/`; open the trace
with `./node_modules/.bin/playwright show-trace`.

Each run uses four of the 10 sign-in attempts per 15 minutes. The
[OIDC test](../oidc/README.md#run-it) says when to restart the `mica` service.

## What it does not check

- **Other paths.** Collections, media, discard and conflicts are covered by the
  API tests. `docs/decisions.md` records this gap.
- **The local editor.** It has no sign-in; this test runs the self-hosted
  image.
- **Other browsers.** Chromium only.
