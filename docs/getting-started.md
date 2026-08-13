# Getting started

A first install, from nothing to a live website. Budget twenty minutes for the
local part and an hour for the deployed one.

> **Mica is not on npm or Docker Hub yet.** Installing means cloning the
> repository and building it yourself. Everything below reflects that. When the
> packages are published, steps 1 and 2 collapse into `npm create mica` and the
> rest is unchanged.

---

## What you are installing

Two things get deployed, and keeping them apart is the whole design:

| | What it is | Where it runs |
| --- | --- | --- |
| **CMS** | one Node process, one SQLite file, one media directory | a small server you control |
| **Website** | static HTML, CSS, JS and images | any static host |

Visitors never touch the CMS. The CMS never learns where the website is hosted.
They meet once, during a build.

Binding them together is a single file — `mica.config.ts` — that describes your
content. The Astro site imports it directly; the CMS is handed a compiled copy.
The CMS image itself contains no content model, which is why one image can serve
any project.

```
                     mica.config.ts
                            │
        compiled to JSON    │    imported directly
              ┌─────────────┴─────────────┐
              ▼                           ▼
        ┌───────────┐               ┌───────────┐
        │    CMS    │──── API ─────▶│   Astro   │──▶ static files
        └───────────┘   at build    └───────────┘
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

`build:packages` compiles the three libraries the apps import. You only repeat it
when you change code inside `packages/`.

## 2. Configure the CMS

```bash
cd apps/cms
cp .env.example .env
```

Open `.env` and set **one** value — a read token, which is the password the
website build uses to read content:

```bash
CMS_READ_TOKEN=any-long-random-string-will-do-locally
```

Leave `SESSION_SECRET` blank for now. Locally the CMS generates an ephemeral one
and warns you; the only consequence is being signed out when it restarts.

> **The most common first-run mistake:** the website has its own `.env` with its
> own `CMS_READ_TOKEN`, and the two must match exactly. If they differ, the site
> build fails with `A valid read token is required`.

## 3. Add demo content and start it

```bash
pnpm seed     # example content + a demo account
pnpm dev      # API on :4000, admin on :5173
```

Open <http://localhost:5173/admin/> and sign in with
`demo@example.com` / `mica-demo-password`.

You should see Pages, Projects, News and Team in the sidebar. None of that is
hard-coded — the admin asks the server for the content model and builds its
navigation, list columns and forms from the answer.

> `pnpm seed` writes content shaped for the *example* model in `mica.config.ts`.
> Once you have replaced that model with your own, the seed script no longer
> applies — adapt it or delete it.

## 4. Start the website

In a second terminal:

```bash
cd apps/web
cp .env.example .env      # set CMS_READ_TOKEN to the same value as the CMS
pnpm dev                  # http://localhost:4321
```

The site fetches everything from the CMS at build time. While `pnpm dev` is
running it also watches for publishes: edit something in the admin, publish it,
and the page reloads on its own a moment later. That is the `mica()` integration
in `astro.config.mjs` — a build needs nothing from it.

---

# Part 2 — Make it yours

## Edit the content model

Everything you saw comes from [`mica.config.ts`](../mica.config.ts) in the
repository root. Replace the example collections with your own:

```ts
import { collection, defineSite, media, richText, slug, text } from "@micacms/model";

export const site = defineSite({
  collections: {
    articles: collection({
      label: "Articles",
      fields: {
        title: text({ label: "Title", required: true, maxLength: 120, listed: true }),
        slug: slug({ label: "URL", from: "title" }),
        cover: media({ label: "Cover image", accept: "image" }),
        body: richText({ label: "Article" }),
      },
    }),
  },
});

export default site;
```

Every collection needs a `slug` field — that is how entries are addressed. The
available field types are:

```
text  textarea  richText  number  boolean  date  email  url  slug
select  object  repeater  relation  media  color  coordinates
```

One edit to this file changes, with no further work:

- the admin forms, list columns and navigation;
- validation on write and on publish;
- the public API's output;
- your Astro collection types, so `getCollection("articles")` autocompletes.

There is no database migration. Entries are stored as JSON and validated against
whatever the model currently says.

## What a change requires

| You changed | Local | Deployed |
| --- | --- | --- |
| `mica.config.ts` | restart `pnpm dev`, and the website's `astro dev` | `pnpm build:schema` + `docker compose restart cms` |
| content, in the admin | nothing — `pnpm dev` picks it up | rebuild the website |
| code in `packages/` | `pnpm build:packages` | rebuild the image |

`pnpm build:schema` is a deploy step, not a local one: in development both the
CMS and the website read `mica.config.ts` directly, and nothing reads the
compiled JSON. Both dev servers do have to be restarted, though — neither
watches a file outside its own project.

**Removing a field does not delete the data under it**, and adding a `required`
field will make existing entries fail to publish until they are filled in. Make
changes like that deliberately.

---

# Part 3 — Deploy the CMS

## 1. Compile the content model

```bash
pnpm build:schema     # mica.config.ts -> mica.config.json
```

This is the artifact the container consumes. It is plain JSON with no imports,
so it can be mounted anywhere. `docker-compose.yml` already mounts it read-only
at `/app/schema.json`, which is where `MICA_SCHEMA` points.

## 2. Configure

```bash
cd <repository root>
cp .env.example .env
```

Three values are mandatory in production:

```bash
CMS_BASE_URL=https://cms.example.com   # the exact public origin, including https
SESSION_SECRET=                        # generate below
CMS_READ_TOKEN=                        # generate below
```

Generate the two secrets separately — do not reuse one for both:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

`CMS_BASE_URL` has to match the address editors actually type. Cookies, the CSRF
origin check and the media URLs in the API all derive from it.

## 3. Start it

```bash
docker compose up -d
docker compose exec cms node dist/server/scripts/create-user.js
```

The first account created is an administrator. The command prompts for a
password rather than taking it as an argument, so it stays out of your shell
history.

> If you ran `pnpm seed` against this database, delete the `demo@example.com`
> account before going live — its password is in the documentation.

## 4. Put TLS in front of it

The container binds to `127.0.0.1:4000` and speaks plain HTTP. Terminate TLS in
a reverse proxy. The CMS sets `Secure` cookies as soon as `CMS_BASE_URL` starts
with `https://`, so **without TLS in front, nobody can sign in.**

Full nginx and Caddy examples are in [deployment.md](./deployment.md).

---

# Part 4 — Deploy the website

The site is built by CI and uploaded wherever you like. There is no adapter and
no serverless runtime — the output is a directory of files.

Your build needs three variables:

```bash
CMS_URL=https://cms.example.com
CMS_READ_TOKEN=<the same token as the CMS>
SITE_URL=https://www.example.com
```

Then `pnpm build` in `apps/web` and publish `dist/`.

To rebuild automatically when an editor publishes, point the CMS at your CI:

```bash
BUILD_WEBHOOK_URL=https://api.github.com/repos/you/site/dispatches
BUILD_WEBHOOK_SECRET=<shared secret>
```

Editors can also trigger a rebuild by hand from the dashboard. See
[webhook-receiver.md](./webhook-receiver.md).

---

# When something goes wrong

The CMS tries to fail at startup with a sentence that says what to do. The ones
you are most likely to meet:

**`No content model at /app/schema.json`**
The schema was never built or never mounted. Run `pnpm build:schema` and check
the volume line in `docker-compose.yml`.

**`MICA_SCHEMA is not set`**
Running in production outside the provided compose file. Point the variable at a
compiled model.

**`field "collections.x.y" has unknown kind "z"`**
The model was built against a newer `@micacms/model` than the server is running.
Rebuild the image, or rebuild the schema with the matching version.

**`Missing required production secrets`**
`SESSION_SECRET` or `CMS_READ_TOKEN` is empty. There is no default in
production, deliberately.

**`A valid read token is required`**
The website's `CMS_READ_TOKEN` does not match the CMS's. This is almost always
the cause of a failing site build.

**Signing in does nothing, with no error**
`CMS_BASE_URL` does not match the address you are using, or you are on plain
HTTP with an `https://` base URL, so the session cookie is being dropped.

---

# Backups

A complete backup is the SQLite file plus the media directory — one Docker
volume. `pnpm cms:backup` uses `VACUUM INTO`, which takes a read lock only and
is safe to run from cron against a live server. See
[backup-and-restore.md](./backup-and-restore.md).

# Not there yet

So you know what you are adopting:

- the packages are not published, so a project is a clone rather than a
  dependency;
- there is no `mica push` — a hosted CMS would need one, self-hosting does not;
- nothing detects a website built against an older model than the CMS is
  serving. The pieces exist (the server logs a schema fingerprint at startup)
  but nothing compares them yet.
