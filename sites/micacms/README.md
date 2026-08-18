# micacms.com

The public MicaCMS website. It is an Astro 7 static site and uses Mica for its own content.

## Run the website

From the repository root:

```bash
pnpm dev:micacms-site
```

The site opens at `http://localhost:4321`.

## Edit with Mica

Build the CMS once, then point its local command at this site's content root:

```bash
pnpm --filter @micacms/editor build
node packages/editor/dist/server/cli.js --content sites/micacms/content
```

Open `http://localhost:6422/admin/`. Local mode has no authentication and listens only on the local computer.

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

### Vercel's Git integration owns the deployment

A push to `main` builds and deploys; a pull request gets a preview URL. There is
no workflow and no token: the GitHub repository is connected to the Vercel
project, and `vercel.json` is the whole configuration.

The `ignoreCommand` skips the build for commits that touch neither this site, the
packages, the lockfile, nor the Vercel config, so unrelated work on the CMS does
not redeploy the website.

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

- **Node and pnpm.** The root `package.json` pins `node >=22.12.0` and
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
