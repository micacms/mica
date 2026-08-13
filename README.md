# Mica

A small, schema-driven content backend for static business websites built with
Astro.

Not a general-purpose CMS. It is a starter for the specific case of a
content-driven SME website: a handful of editors, a few hundred entries, a
static frontend, and an operator who would rather not run four services to keep
a brochure site up to date.

```
┌─────────────────────────────────────────────┐
│                mica.config.ts               │
│        the content model — one file         │
│                                             │
│   ├── TypeScript types                      │
│   ├── runtime validation                    │
│   ├── CMS form definitions                  │
│   └── Astro collection schemas              │
└───────────────────┬─────────────────────────┘
                    │
     as data        │        imported directly
   (build:schema)   │        (types, no codegen)
          ┌─────────┴─────────┐
          ▼                   ▼
┌───────────────────┐  ┌───────────────────┐
│     apps/cms      │  │     apps/web      │
│                   │  │                   │
│  Vue 3 SPA        │  │  Astro SSG        │
│  Hono API         │  │  Content Layer    │
│  SQLite + media   │──┼─▶ Tailwind        │
└─────────┬─────────┘  └─────────┬─────────┘
          │                      │
   publish webhook          astro build
          ▼                      ▼
      any CI                static files
                                 ▼
                          any static host
```

The website never contacts the CMS. The CMS never learns where the website is
hosted. They meet once, during a build.

The CMS carries no content model of its own — it knows the field types and is
handed a schema at startup. One published image serves any project.

---

## Quick start

```bash
pnpm install
pnpm --filter "./packages/**" build

# CMS: API on :4000, admin on :5173
cd apps/cms
cp .env.example .env
pnpm seed        # demo content + demo@example.com / mica-demo-password
pnpm dev
```

In development the CMS reads `mica.config.ts` from the repository root directly.
A production container is given the compiled `mica.config.json` instead — see
[Deploying](#deploying).

Installing for the first time, or deploying it properly? Start at
[docs/getting-started.md](./docs/getting-started.md).

Open <http://localhost:5173/admin/> and sign in.

Then, in a second terminal, the website:

```bash
cd apps/web
cp .env.example .env      # CMS_READ_TOKEN must match the CMS's
pnpm dev                  # http://localhost:4321
```

---

## Layout

```
apps/
├── cms/        Hono API + Vue 3 admin SPA        → apps/cms/README.md
└── web/        Astro static site
packages/
├── model/      the content model and its DSL
├── astro/      Content Layer loader and dev integration for Astro
└── cms-client/ typed read-only API client
docs/
├── deployment.md
├── backup-and-restore.md
└── webhook-receiver.md
```

---

## The one idea

Content structures are defined once, in `mica.config.ts`:

```ts
export const site = defineSite({
  collections: {
    projects: collection({
      label: "Projects",
      fields: {
        title: text({ label: "Title", required: true, maxLength: 120 }),
        slug: slug({ from: "title" }),
        year: number({ integer: true, min: 1900 }),
        gallery: media({ multiple: true, accept: "image" }),
        location: object({
          fields: { city: text(), position: coordinates() },
        }),
      },
    }),
  },
  globals: {
    theme: singleton({
      label: "Theme",
      fields: { primaryColor: color(), accentColor: color() },
    }),
  },
});
```

Everything else is derived from it:

- the API validates writes against it, strictly on publish and leniently on
  draft, so unfinished work is never lost;
- the admin fetches it over HTTP and **generates its own navigation, tables and
  forms** — the Vue app contains no knowledge of any particular collection;
- the public content API validates responses against it;
- Astro collections are generated from it, so `getCollection("projects")` is
  fully typed and renaming a field breaks the website build.

Adding a field is a change to that one file. No SQL migration: entry payloads
are JSON validated against whatever the model currently says.

That is why the DSL is not just Zod. `text({ label: "Title", maxLength: 120 })`
carries editorial meaning that `z.string().max(120)` cannot — a label, a width,
a group. Zod is generated from the DSL, not the other way round.

---

## What is deliberately absent

No GraphQL. No plugin architecture. No page builder. No approval workflows. No
multi-tenancy. No mandatory cloud services. The
[Technical Requirements Document](./Technical%20Requirements%20Document.md) §23
lists the full boundary, and it exists to stop this becoming another
general-purpose CMS.

The default deployment is one container, one SQLite file, one media directory.

---

## Commands

| | |
| --- | --- |
| `pnpm dev` | build packages, then run the CMS |
| `pnpm build` | build everything (the website needs a reachable CMS) |
| `pnpm build:schema` | compile `mica.config.ts` into the JSON the container is given |
| `pnpm test` | 82 tests across the model and the CMS API |
| `pnpm typecheck` | every package, including `.vue` and `.astro` |
| `pnpm cms:seed` | demo content |
| `pnpm cms:create-user` | create or update an account |
| `pnpm cms:backup` | consistent snapshot of database + media |

## Deploying

```bash
cp .env.example .env      # fill in CMS_BASE_URL and the two secrets
pnpm build:schema         # mica.config.ts -> mica.config.json
docker compose up -d
docker compose exec cms node dist/server/scripts/create-user.js
```

Changing the content model afterwards is `pnpm build:schema` and
`docker compose restart cms`. The image does not need rebuilding — it holds no
model, only the field types that interpret one.

The website is built by CI and uploaded wherever you like — Vercel, Netlify,
Cloudflare Pages, S3, nginx, a USB stick. There is no adapter and no serverless
runtime.

See [docs/deployment.md](./docs/deployment.md).

## Backups

A complete backup is the SQLite file plus the media directory. `pnpm cms:backup`
uses `VACUUM INTO`, which takes a read lock only — safe to run from cron against
a live server.

See [docs/backup-and-restore.md](./docs/backup-and-restore.md).

## Open decisions

Accepted trade-offs and known gaps are tracked with priorities in
[TODO.md](./TODO.md), each with what was decided, why, and what would change it.

---

## Reusing this

A project is a `mica.config.ts` plus an Astro site. The CMS is given the model;
it does not contain one, so it does not have to be forked to be used:

```bash
pnpm build:schema     # mica.config.ts -> mica.config.json
docker compose up -d  # the image mounts that file at /app/schema.json
```

The three packages under `packages/` (`@micacms/model`, `@micacms/cms-client`,
`@micacms/astro`) are the published surface. `apps/web` is a starter to copy
and redesign rather than a dependency — the design is the part that should
differ between projects.

TRD §26 still describes the older copy-the-whole-repository stance; the schema
loading described above supersedes it, and that section needs rewriting.

Licence: MIT.
