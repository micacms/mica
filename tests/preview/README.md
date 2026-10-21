# Live preview of the self-hosted Mica

The test stack for [ADR 38](../../docs/adr/0038-self-hosted-live-preview.md),
on top of the [OIDC test stack](../oidc/README.md):

- `preview` is Mica's preview image (`apps/preview`), set up as the
  self-hosting guide tells a user to. The seed puts the example website into
  the repository, with the packed `@micacms/core` and `@micacms/astro` in its
  `vendor/` folder and a lock file:
  [`prepare-site.mjs`](prepare-site.mjs) makes it in `tests/preview/site/`.
- Mica answers at `http://cms.localhost:6422`. Its gate answers on the same
  port for `http://preview.cms.localhost:6422`, the derived name, and forwards
  to `http://preview:4321`. Browsers send every `*.localhost` name to this
  computer.

[`preview-self-hosted.spec.ts`](../browser/preview-self-hosted.spec.ts) signs
in, checks that the gate refuses a browser without its cookie, clicks a text in
the preview, types, and waits for the preview to show the draft. Then it changes
a template on the Git host: Mica syncs every five seconds here, and the preview
shows the change, with the draft still in it. CI runs it in
`image.yml`, after the OIDC and browser tests.

## Run it

```bash
node tests/preview/prepare-site.mjs
docker compose -f tests/oidc/compose.yml -f tests/preview/compose.yml up -d --build --wait
cd tests/browser && MICA_PREVIEW_STACK=1 ./node_modules/.bin/playwright test preview-self-hosted
docker compose -f tests/oidc/compose.yml -f tests/preview/compose.yml down -v
```

When port 3000 is in use, set `FORGEJO_PORT=3001` for the compose and the test
commands. `prepare-site.mjs` builds and packs the packages, and needs the npm
registry.
