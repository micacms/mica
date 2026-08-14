# Getting started

A first install, from nothing to a live website. Budget twenty minutes for the
local part and an hour for the deployed one.

> **Mica is not on npm or Docker Hub yet.** Installing means cloning the
> repository and building it yourself. Everything below reflects that. When the
> packages are published, steps 1 and 2 collapse into `npm create mica` and the
> rest is unchanged.

---

## What you are installing

Three things, and keeping them apart is the whole design:

| | What it is | Where it lives |
| --- | --- | --- |
| **Content repository** | Your entries, as JSON and Markdoc files | Git — GitHub, GitLab, or a checkout |
| **CMS** | One Node process; a SQLite file of accounts and sessions | A small server you control |
| **Website** | Static HTML, CSS, JS and images | Any static host |

Visitors never touch the CMS. The CMS never learns where the website is hosted.
They meet in the repository: Mica commits to it, and the website is built from
it.

The consequence worth understanding before you install anything: **the CMS is
not where your content lives.** You can turn it off, lose its disk, or throw it
away, and your website is unaffected — it is in Git, in a format a text editor
can read.

Binding it all together is a single file — `mica.config.ts` — that describes
your content. The Astro site imports it directly; the CMS is handed a compiled
copy. The CMS image itself contains no content model, which is why one image can
serve any project.

```
                     mica.config.ts
                            │
        compiled to JSON    │    imported directly
              ┌─────────────┴─────────────┐
              ▼                           ▼
        ┌───────────┐               ┌───────────┐
        │    CMS    │               │   Astro   │──▶ static files
        └─────┬─────┘               └─────▲─────┘
              │      content repository   │
              └──────────▶ (Git) ─────────┘
```

## Before you start

- **Node 22.5 or newer.** `node --version`
- **pnpm 11.** `corepack enable` is enough; the repository pins the version.
- **Docker**, for the deployed CMS. Not needed to run locally.

For production you will also want a small server (1 GB RAM is plenty), a domain
for the CMS, and somewhere to host static files.

---

# Part 1 — Run it locally

## 1. Install and build

```bash
git clone <the-repository> mica
cd mica
pnpm install
pnpm build:packages
```

## 2. Start the CMS

```bash
cd apps/cms
cp .env.example .env
pnpm dev
```

The defaults are enough. `REPOSITORY=local` and `CONTENT_ROOT=../../content`
mean the CMS edits the `content/` directory in this repository, which already
has content in it — there is nothing to seed.

`pnpm dev` runs two processes: the API on `:4000` and the admin's Vite server on
`:5173`.

> The `.env` you copied leaves `SESSION_SECRET` blank. Locally the server
> generates an ephemeral one and warns about it, which means everyone is signed
> out whenever it restarts. That is the right trade-off for development and the
> wrong one for production, where it is mandatory.

## 3. Create an account

In a second terminal:

```bash
pnpm --filter @micacms/cms create-user
```

Then open <http://localhost:5173/admin/> and sign in.

## 4. Edit something, and look at the result

Change an entry and press Save. Then:

```bash
git status
git diff
```

That is the whole idea. Your edit is a change to files:

```
content/projects/haus-am-zuerichsee/
├── index.json          the fields
├── summary.mdoc        rich text, one file per field
└── media/
    └── exterior.jpg
```

Commit it with your normal tools. In a deployed setup Mica does the committing
itself, but the files are identical either way.

## 5. Start the website

```bash
cd apps/web
pnpm dev                 # http://localhost:4321
```

No token, no CMS URL, no configuration. The site reads the same files, and the
dev server reloads when Mica writes to them.

Stop the CMS and the website still builds. That is worth doing once, because it
is the property everything else is designed around.

---

# Part 2 — Make it yours

## Change the content model

`mica.config.ts` in the repository root is the whole model. Add a field:

```ts
projects: collection({
  label: "Projects",
  fields: {
    title: text({ label: "Title", required: true, maxLength: 120 }),
    architect: text({ label: "Architect" }),   // ← new
  },
}),
```

Both processes pick it up. The admin grows a field; `getCollection("projects")`
grows a property; a typo in a template becomes a build error.

Adding a **required** field to a collection that already has entries makes those
entries invalid until they are edited. The website build is where you find out,
which is the right place — better a red build than a quietly empty page.

## Redesign the website

`apps/web` is a starter to copy and change, not a dependency. The design is the
part that should differ between projects; the loader, the model and the CMS are
the parts that should not.

---

# Part 3 — Deploy it

## 1. Put the content repository somewhere

If the content lives in the same repository as the website — the normal case —
push it to GitHub or GitLab and you are done. Mica will commit into the
`content/` directory of that repository.

## 2. Create a token for Mica

**GitHub:** a fine-grained personal access token scoped to that one repository,
with **Contents: read and write**. Nothing else.

**GitLab:** a project access token with the `write_repository` scope.

## 3. Configure the CMS

```env
NODE_ENV=production
CMS_BASE_URL=https://cms.example.com
TRUST_PROXY=true

SESSION_SECRET=<32+ random bytes, generated below>

REPOSITORY=github
REPOSITORY_PROJECT=acme/website
REPOSITORY_TOKEN=github_pat_…
REPOSITORY_ROOT=content
REPOSITORY_BRANCH=main
```

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

## 4. Start it

```bash
pnpm build:schema         # mica.config.ts -> mica.config.json
docker compose up -d
docker compose exec cms node dist/server/scripts/create-user.js
```

Check it came up:

```bash
curl -s https://cms.example.com/health
# {"status":"ok","database":"ok","repository":"github:acme/website/content@main"}
```

Put a reverse proxy in front for TLS — the container binds to loopback.

## 5. Build the website from the repository

Any CI that reacts to a push will do:

```yaml
name: Build website
on:
  push:
    branches: [main]

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with: { node-version: 22, cache: pnpm }
      - run: pnpm install --frozen-lockfile
      - run: pnpm build:packages
      - run: pnpm --filter @micacms/web build
      # …then upload apps/web/dist.
```

An editor pressing Save produces a commit, which triggers this. There is nothing
to configure on Mica's side — no webhook, no secret, no queue.

If your host builds from the repository directly — Vercel, Netlify, Cloudflare
Pages — you do not need the workflow at all.

Full detail, including branch-per-environment and keeping editorial commits out
of your other CI jobs, is in [deployment.md](./deployment.md).

---

## When something is wrong

**The container exits immediately with a `ConfigError`.**
Read it — it names the variable. The usual causes are an unset `SESSION_SECRET`
in production, or `REPOSITORY=github` without a project and a token.

**`/health` returns 503 with `repository: unavailable`.**
The token is expired, revoked, or lacks write access to contents. Reissue it.

**The admin loads but has no collections.**
`mica.config.json` is not mounted, or `pnpm build:schema` was never run.

**Saving returns 409.**
Someone else changed that entry, or a push landed while the editor was working.
Nothing is lost: the editor's changes are still in the form, and the message
offers to load the current version.

**Saving returns 422.**
The entry does not satisfy the model. The response names the offending fields
and the admin puts the messages next to them.

**Everyone was signed out after a restart.**
`SESSION_SECRET` is unset, so the server generated an ephemeral one.

---

## Backups

Your content repository is the backup, and Git is keeping it. Mica's SQLite file
holds accounts and sessions; losing it signs everyone out and costs nothing
else.

See [backup-and-restore.md](./backup-and-restore.md), which is mostly an
explanation of why there is so little to do.
