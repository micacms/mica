# mica.build

The public Mica website. It is an Astro 7 static site and uses Mica for its own content.

## Run the website

From this directory:

```bash
rushx dev
```

The site opens at `http://localhost:4321`.

## Edit with Mica

Build the CMS once, then point its local command at this site's content root:

```bash
rush build --to @micacms/editor
node apps/local-editor/dist/cli.js --content sites/website/content
```

Open `http://localhost:6422/admin/`. Local mode has no authentication and listens only on the local computer.

The content model is in `src/mica.ts`. Mica-managed content is in `content/`. An Astro build writes `content/.mica/schema.json`; commit that file after each model change.

## Build

```bash
rush typecheck --to @micacms/site
rush build --to @micacms/site
```

Set `SITE_URL` in CI when the canonical production URL is not `https://mica.build`.

## Deploy to Vercel

The site depends on `@micacms/core` and `@micacms/astro`, which are workspace
packages compiled to `dist/` and never committed. A deployment therefore has to
build them first, so the project builds from the **repository root**, not from
this directory. Everything it needs is in [`vercel.json`](../../vercel.json):

| Setting | Value |
| --- | --- |
| Root Directory | repository root (leave empty) |
| Install Command | `node common/scripts/install-run-rush.js install --to @micacms/site` |
| Build Command | `node common/scripts/install-run-rush.js build --to @micacms/site` |
| Output Directory | `sites/website/dist` |

`--to @micacms/site` is Rush's "and its dependencies" filter: it builds the
packages the site imports, then the site, in dependency order. The CMS and the
examples are not built. `install-run-rush` bootstraps Rush itself, so Vercel's
builder needs nothing preinstalled.

### Vercel's Git integration owns the deployment

A push to `main` builds and deploys; a pull request gets a preview URL. There is
no workflow and no token: the GitHub repository is connected to the Vercel
project, and `vercel.json` is the whole configuration.

The `ignoreCommand` skips the build when nothing in this site, the packages, the
lockfile or the Vercel config changed since the last successful deployment
(`VERCEL_GIT_PREVIOUS_SHA`), so unrelated work on the CMS does not redeploy the
website. It compares with that deployment, not with the previous commit, so a
site change followed by unrelated commits still deploys. If that commit is not
in the clone, the diff fails and the build runs.

Nothing here gates the deployment on CI. Protect `main` and require the `CI`
check to pass before merge, and every commit that reaches `main` — and so every
deployment — is one that already passed.

To deploy by hand:

```bash
vercel link --yes --scope muedespacher --project micacms
vercel --prod
```

Vercel rejects a deployment whose commit author it cannot match to a GitHub
account, and reports it as a deployment stuck at status `UNKNOWN` with a
zero-millisecond build rather than as an authorship error. Commit from this
repository with the address your GitHub account carries:

```bash
git config --local user.email alexander@muedespacher.ch
```

Repository-local, because a global address that belongs to another forge is
usually the right default everywhere else.

### Notes

- **Node and pnpm.** `rush.json` pins both — `nodeSupportedVersionRange` and
  `pnpmVersion` — and Rush fetches its own pnpm copy wherever it runs, so the
  same versions apply on a laptop, in Actions, and on Vercel's builder.
- **`SITE_URL`.** Unset, the canonical URL is `https://mica.build`, which is
  what production wants. Preview deployments will also claim that canonical, but
  Vercel serves previews with `X-Robots-Tag: noindex`, so they stay unindexed.
- **Trailing slashes.** Astro builds directory-style URLs and every internal link
  ends in `/`, so `vercel.json` sets `trailingSlash: true` to match. Changing one
  without the other creates a redirect on every link.
- **No CSP header.** Astro inlines small scripts into the HTML, so a policy
  without per-build hashes would either break the page or need `unsafe-inline`
  and prove nothing. The other standard security headers are set.
