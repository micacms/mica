# micacms.com

The public MicaCMS website. It is an Astro 5 static site and uses Mica for its own content.

## Run the website

From the repository root:

```bash
pnpm dev:micacms-site
```

The site opens at `http://localhost:4321`.

## Edit with Mica

Build the CMS once, then point its local command at this site's content root:

```bash
pnpm --filter @micacms/cms build
node apps/cms/dist/server/cli.js --content sites/micacms/content
```

Open `http://localhost:4000/admin/`. Local mode has no authentication and listens only on the local computer.

The content model is in `src/mica.ts`. Mica-managed content is in `content/`. An Astro build writes `content/.mica/schema.json`; commit that file after each model change.

## Build

```bash
pnpm --filter @micacms/site typecheck
pnpm --filter @micacms/site build
```

Set `SITE_URL` in CI when the canonical production URL is not `https://micacms.com`.
