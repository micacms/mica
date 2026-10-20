# Live preview of the self-hosted Mica

The test stack for [ADR 38](../../docs/adr/0038-self-hosted-live-preview.md),
on top of the [OIDC test stack](../oidc/README.md):

- `preview` is the example website's `MICA_PREVIEW=1 astro dev`, built from
  this repository with [`Dockerfile`](Dockerfile). It mounts Mica's volume
  read-only, waits for the clone, and links the clone's `content/` in place of
  the site's own, as the self-hosting guide tells a user to do.
- Mica answers at `http://cms.localhost:6422`. Its gate answers at
  `http://preview.cms.localhost:6423` and forwards to `http://preview:4321`.
  Browsers send every `*.localhost` name to this computer.

[`preview-self-hosted.spec.ts`](../browser/preview-self-hosted.spec.ts) signs
in, checks that the gate refuses a browser without its cookie, clicks a text in
the preview, types, and waits for the preview to show the draft. CI runs it in
`image.yml`, after the OIDC and browser tests.

## Run it

```bash
docker compose -f tests/oidc/compose.yml -f tests/preview/compose.yml up -d --build --wait
cd tests/browser && MICA_PREVIEW_STACK=1 ./node_modules/.bin/playwright test preview-self-hosted
docker compose -f tests/oidc/compose.yml -f tests/preview/compose.yml down -v
```

When port 3000 is in use, set `FORGEJO_PORT=3001` for both commands. The first
build of the preview image installs the example's packages and takes some
minutes.
