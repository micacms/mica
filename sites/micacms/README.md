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
build them first, so the project builds from the **repository root**, not from
this directory. Everything it needs is in [`vercel.json`](../../vercel.json):

| Setting | Value |
| --- | --- |
| Root Directory | repository root (leave empty) |
| Install Command | `pnpm install --frozen-lockfile` |
| Build Command | `pnpm --filter @micacms/site... build` |
| Output Directory | `sites/micacms/dist` |

The trailing `...` in the build command is pnpm's "and its dependencies" filter:
it builds `@micacms/model`, then `@micacms/astro`, then this site, in that order.
The CMS and the examples are not built.

### The build runs in GitHub Actions, not on Vercel

[`deploy-site.yml`](../../.github/workflows/deploy-site.yml) owns the deployment.
Vercel's own Git integration is switched off (`git.deploymentEnabled: false`), so
a push produces exactly one deployment, from CI:

```bash
vercel pull --yes --environment=production   # fetch project settings
vercel build --prod                          # compile into .vercel/output
vercel deploy --prebuilt --prod              # upload that output as-is
```

`vercel build` reads the same `vercel.json`, so routes, headers and redirects are
still defined in one place — CI only moves *where* the build happens. Pull
requests run the same three commands without `--prod` and get a preview URL.

This needs one secret, `VERCEL_TOKEN`, under **Settings → Secrets and variables →
Actions**. The org and project ids are in the workflow in plain text; they are
identifiers, not credentials.

To deploy by hand — a first deployment, or when Actions is unavailable:

```bash
vercel link --yes --scope muedespacher --project micacms
vercel build --prod && vercel deploy --prebuilt --prod
```

Prefer `--prebuilt` over a plain `vercel --prod`: it uploads the same output CI
would, and it can be inspected under `.vercel/output` before it ships.

The CLI attaches the local git metadata to a deployment, and Vercel rejects one
whose commit author it cannot match to a GitHub account — the failure surfaces as
a deployment stuck at status `UNKNOWN` with a zero-millisecond build. Commit from
this repository with the address your GitHub account carries:

```bash
git config --local user.email alexander@muedespacher.ch
```

Repository-local, because a global address that belongs to another forge is
usually the right default everywhere else.

### Notes

- **Node and pnpm.** The root `package.json` pins `node >=22.5.0` and
  `pnpm@11.3.0`. Since the build runs in Actions, the runner's `setup-node` and
  `pnpm/action-setup` decide the versions, not Vercel's builder.
- **`SITE_URL`.** Unset, the canonical URL is `https://micacms.com`, which is
  what production wants. Preview deployments will also claim that canonical, but
  Vercel serves previews with `X-Robots-Tag: noindex`, so they stay unindexed.
- **Trailing slashes.** Astro builds directory-style URLs and every internal link
  ends in `/`, so `vercel.json` sets `trailingSlash: true` to match. Changing one
  without the other creates a redirect on every link.
- **No CSP header.** Astro inlines small scripts into the HTML, so a policy
  without per-build hashes would either break the page or need `unsafe-inline`
  and prove nothing. The other standard security headers are set.
