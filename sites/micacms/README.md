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

## Deploy to Vercel

The site depends on `@micacms/model` and `@micacms/astro`, which are workspace
packages compiled to `dist/` and never committed. A deployment therefore has to
build them first, so Vercel deploys from the **repository root**, not from this
directory. Everything it needs is in [`vercel.json`](../../vercel.json):

| Setting | Value |
| --- | --- |
| Root Directory | repository root (leave empty) |
| Install Command | `pnpm install --frozen-lockfile` |
| Build Command | `pnpm --filter @micacms/site... build` |
| Output Directory | `sites/micacms/dist` |

The trailing `...` in the build command is pnpm's "and its dependencies" filter:
it builds `@micacms/model`, then `@micacms/astro`, then this site, in that order.
The CMS and the examples are not built.

### First deployment

```bash
vercel link          # create or attach the project, from the repository root
vercel --prod        # or push to the default branch once Git is connected
```

Connecting the Git repository is the better long-term option: `vercel.json` has
an ignore command that skips builds for commits touching neither this site, the
packages, the lockfile, nor the Vercel config.

### Notes

- **Node and pnpm.** The root `package.json` pins `node >=22.5.0` and
  `pnpm@11.3.0`. If Vercel's builder does not pick up the `packageManager` field,
  set `ENABLE_EXPERIMENTAL_COREPACK=1` in the project's environment variables.
- **`SITE_URL`.** Unset, the canonical URL is `https://micacms.com`, which is
  what production wants. Preview deployments will also claim that canonical, but
  Vercel serves previews with `X-Robots-Tag: noindex`, so they stay unindexed.
- **Trailing slashes.** Astro builds directory-style URLs and every internal link
  ends in `/`, so `vercel.json` sets `trailingSlash: true` to match. Changing one
  without the other creates a redirect on every link.
- **No CSP header.** Astro inlines small scripts into the HTML, so a policy
  without per-build hashes would either break the page or need `unsafe-inline`
  and prove nothing. The other standard security headers are set.
