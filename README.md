# Mica

A Git-native content editor for static business websites built with Astro.

Not a general-purpose CMS. It is the specific case of a content-driven SME
website: a handful of editors, a few hundred entries, a static frontend, and an
operator who would rather not run four services to keep a brochure site up to
date.

**Content lives in your Git repository, not in Mica's database.** An entry is a
JSON file with its rich text beside it as Markdoc and its images in the same
directory. Editors never see this — they see a form — but the result is a
commit, and everything that follows from a commit follows for free: history,
review, rollback, branching, and a website that can be rebuilt from the
repository alone.

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
│  SQLite: accounts │  │  Tailwind         │
└─────────┬─────────┘  └─────────▲─────────┘
          │                      │
       commits                 reads
          ▼                      │
    ┌───────────────────────────────────┐
    │      the content repository       │
    │  content/projects/haus-a/…        │
    └───────────────────┬───────────────┘
                        │  astro build
                        ▼
                  static files → any static host
```

The website never contacts the CMS. The CMS never learns where the website is
hosted. They meet in the repository.

Mica's own SQLite database holds accounts and sessions. **Losing it must never
mean losing website content** — that constraint is why the architecture looks
like this.

---

## Quick start

```bash
pnpm install
pnpm build:packages

cd apps/cms
cp .env.example .env
pnpm dev                     # API on :4000, admin on :5173
```

The default `REPOSITORY=local` writes into `content/` in this repository, so
there is nothing to configure and nothing to seed — the repository already has
content in it.

Create an account, then open <http://localhost:5173/admin/>:

```bash
pnpm --filter @micacms/cms create-user
```

In a second terminal, the website:

```bash
cd apps/web
pnpm dev                     # http://localhost:4321
```

No token and no CMS URL: the website reads the same files.

Installing for the first time, or deploying it properly? Start at
[docs/getting-started.md](./docs/getting-started.md).

---

## Layout

```
content/        the content repository — this is the website's content
apps/
├── cms/        Hono API + Vue 3 admin SPA        → apps/cms/README.md
└── web/        Astro static site
packages/
├── model/      the content model, its DSL, and the authoring format
├── connectors/ repository access: local working tree, GitHub, GitLab
└── astro/      Content Layer loader and dev integration for Astro
docs/
├── getting-started.md
├── deployment.md
└── backup-and-restore.md
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
  singletons: {
    theme: singleton({
      label: "Theme",
      fields: { primaryColor: color(), accentColor: color() },
    }),
  },
});
```

Everything else is derived from it:

- the API validates writes against it before they reach the repository;
- the admin fetches it over HTTP and **generates its own navigation, tables and
  forms** — the Vue app contains no knowledge of any particular collection;
- the same model decides the layout on disk: an entry with rich text or media is
  a directory, one without is a single `.json` file;
- Astro collections are generated from it, so `getCollection("projects")` is
  fully typed and renaming a field breaks the website build.

Adding a field is a change to that one file. No SQL migration: entries are JSON
files validated against whatever the model currently says.

That is why the DSL is not just Zod. `text({ label: "Title", maxLength: 120 })`
carries editorial meaning that `z.string().max(120)` cannot — a label, a width,
a group. Zod is generated from the DSL, not the other way round.

---

## What an entry looks like

```
content/projects/haus-am-zuerichsee/
├── index.json          the fields
├── summary.mdoc        rich text, one file per field
└── media/
    └── exterior.jpg    referenced as media/exterior.jpg
```

Rich text is [Markdoc](https://markdoc.dev), not HTML. A `.mdoc` file is
readable and reviewable in a diff, and it cannot inject a script into the built
website: Markdoc escapes raw HTML and renders an undeclared `{% tag %}` as
nothing.

Collection order is a `_order.json` listing slugs, so dragging one entry is a
one-line diff rather than a rewrite of every entry.

---

## What is deliberately absent

No GraphQL. No plugin architecture. No page builder. No approval workflows. No
multi-tenancy. No mandatory cloud services.

No draft/published states either: an entry is saved or it is not, and saved
means committed. Branches do this better than a status column ever did.

---

## Commands

| | |
| --- | --- |
| `pnpm dev` | build packages, then run the CMS |
| `pnpm build` | build everything |
| `pnpm build:schema` | compile `mica.config.ts` into the JSON the container is given |
| `pnpm test` | 229 tests across the model, connectors, Astro loader and CMS API |
| `pnpm typecheck` | every package, including `.vue` and `.astro` |
| `pnpm cms:create-user` | create or update an account |

## Deploying

```bash
cp apps/cms/.env.example .env   # secrets, and which repository to commit to
pnpm build:schema               # mica.config.ts -> mica.config.json
docker compose up -d
docker compose exec cms node dist/server/scripts/create-user.js
```

Set `REPOSITORY=github` or `REPOSITORY=gitlab` with a project and a token, and
the container commits through the provider's API — no clone, no deploy key on
disk. `REPOSITORY=local` writes into a mounted checkout instead.

Changing the content model afterwards is `pnpm build:schema` and
`docker compose restart cms`. The image does not need rebuilding — it holds no
model, only the field types that interpret one.

The website is built by CI from the repository and uploaded wherever you like —
Vercel, Netlify, Cloudflare Pages, S3, nginx, a USB stick. There is no adapter
and no serverless runtime, and the build does not need Mica to be running.

See [docs/deployment.md](./docs/deployment.md).

## Backups

Your content repository is the backup, and Git is already keeping it.

Mica's own database holds accounts and sessions. Copy it if you like; losing it
signs everyone out and costs nothing else. See
[docs/backup-and-restore.md](./docs/backup-and-restore.md).

## Open decisions

Accepted trade-offs and known gaps are tracked with priorities in
[TODO.md](./TODO.md), each with what was decided, why, and what would change it.

---

## Reusing this

A project is a `mica.config.ts`, a content repository and an Astro site. The CMS
is given the model; it does not contain one, so it does not have to be forked to
be used:

```bash
pnpm build:schema     # mica.config.ts -> mica.config.json
docker compose up -d  # the image mounts that file at /app/schema.json
```

The three packages under `packages/` (`@micacms/model`, `@micacms/connectors`,
`@micacms/astro`) are the published surface. `apps/web` is a starter to copy and
redesign rather than a dependency — the design is the part that should differ
between projects.

Licence: MIT.
