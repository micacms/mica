# Mica

> **Experimental.** Pre-1.0: APIs, the CLI and the content format can still
> change without notice. Use it at your own risk.

A Git-native content editor for Astro websites.

Editors get forms. What comes out is a commit: JSON, Markdoc and images in your
repository, which your normal build turns into a static site.

Not a general-purpose CMS. It is the specific case of a content-driven business
website — a handful of editors, a few hundred entries, a static frontend, and
somebody who would rather not run four services to keep a brochure site
current.

```
   editor
     │  fills in a form
     ▼
┌──────────┐   commits    ┌────────────────────┐   push    ┌────┐  astro build
│   Mica   │ ───────────▶ │  your repository   │ ────────▶ │ CI │ ─────────────▶ static host
└──────────┘              │  content/…         │           └────┘
                          │  .mica/schema.json │
                          └────────────────────┘
```

The website never contacts Mica. Mica never learns where the website is hosted.
They meet in the repository.

**Content lives in your Git repository, not in Mica's database.** Everything
that follows from a commit follows for free: history, review, rollback,
branching, and a website that can be rebuilt from the repository alone. Mica's
own SQLite file holds accounts and sessions — losing it signs everyone out and
costs nothing else.

---

## Add it to an Astro site

```bash
npm install @micacms/astro @micacms/model
```

Describe your content as a plain module:

```ts
// src/mica.ts
import { collection, defineSite, media, richText, slug, text } from "@micacms/model";

export const site = defineSite({
  root: "./content",
  collections: {
    projects: collection({
      label: "Projects",
      fields: {
        title: text({ label: "Title", required: true, maxLength: 120 }),
        slug: slug({ from: "title" }),
        summary: richText(),
        gallery: media({ multiple: true, accept: "image" }),
      },
    }),
  },
});
```

Turn it into collections. This is the only wiring there is — **nothing goes in
`astro.config`**:

```ts
// src/content.config.ts
import { micaCollections } from "@micacms/astro";

import { site } from "./mica";

export const collections = micaCollections(site);
```

Pages then use ordinary Astro — `getCollection("projects")`, fully typed, no
code generation. Renaming a field breaks the build rather than the page.

`micaCollections` returns a plain object, so Mica's collections and your own sit
side by side:

```ts
export const collections = {
  ...micaCollections(site),
  docs: defineCollection({ loader: glob({ pattern: "**/*.md", base: "./src/docs" }) }),
};
```

Mica edits the ones in the model and does not know the others exist.

Full walkthrough: **[docs/getting-started.md](./docs/getting-started.md)**.

---

## How Mica learns your model

The Mica loaders write the model to `content/.mica/schema.json` on every build
and dev-server start. You commit it. Mica reads it out of the repository it is
already connected to, and generates its navigation, tables and forms from it.

That is the entire coupling. The Mica image contains no content model — only
the field types that interpret one — so one image serves every project, and
changing the model is a commit plus a restart rather than a rebuild.

---

## What an entry looks like

```
content/projects/haus-am-zuerichsee/
├── index.json          the fields
├── summary.mdoc        rich text, one file per field
└── media/
    └── exterior.jpg    referenced as media/exterior.jpg
```

The layout is derived from the model: a collection with rich text or media
stores each entry as a directory, one without stores each entry as a single
`.json` file. Keys are written in model order, so a diff shows only what
changed. Collection order is a `_order.json` listing slugs, so dragging one
entry is a one-line diff rather than a rewrite of every entry.

Rich text is [Markdoc](https://markdoc.dev), not HTML: readable in a diff, and
it cannot inject a script into the built site.

---

## Running it

```bash
npx @micacms/cms          # reads ./content, opens the editor on localhost:6422/admin/
```

| | |
| --- | --- |
| **Locally** | The command above. Loopback only, no identity provider, no accounts, no passwords, no sign-in screen, nothing written into your repository — see [getting-started](./docs/getting-started.md) |
| **On a server** | One container, an OIDC provider, a token for the repository — see [self-hosting](./docs/self-hosting.md) |

Deployed, Mica authenticates with **OpenID Connect** and nothing else. No
passwords, no reset flow, no MFA enrolment, no passkeys, and no breach
notification to write. An identity provider does all of it better. What Mica
keeps is the part that is genuinely its own: a *membership* saying who may edit
which site.

---

## Layout

```
packages/
├── model/       the field DSL, the content model, and the authoring format
├── connectors/  repository access: local working tree, GitHub, GitLab
└── astro/       Content Layer loader and the dev integration
apps/
└── cms/         Hono API + Vue 3 admin SPA
examples/
└── muster-consulting/   a complete site to read: model, content, templates
docs/
├── getting-started.md   add Mica to an Astro project, and run it locally
├── content-model.md     every field type, and the layout it produces on disk
├── self-hosting.md      deploy it: Docker, OIDC, repository, CI, backups
├── architecture.md      what Mica is, and why it is shaped this way
└── decisions.md         accepted trade-offs and known gaps
e2e/                     a runnable Mica + Keycloak, for the deployed shape
```

`packages/*` are the published surface. `examples/muster-consulting` is a site
to copy and redesign, not a dependency — the design is the part that should
differ between projects.

---

## What is deliberately absent

**No content API.** The website reads files. Nothing to secure, rate limit,
cache or keep available at build time.

**No build webhook.** A push is the trigger, which every CI system already
understands.

**No media server.** Images are files in the repository, processed by Astro at
build time.

**No draft/published states.** An entry is saved or it is not, and saved means
committed. Point a second Mica at a `staging` branch and editors have a staging
site, reviewed and merged like any other change — strictly more capable than a
status column, and free.

No GraphQL, no plugin architecture, no page builder, no approval workflows, no
mandatory cloud services.

---

## Development

| | |
| --- | --- |
| `pnpm dev` | build the packages, then run the CMS against the example project |
| `pnpm dev:site` | the example website, in a second terminal |
| `pnpm test` | 268 tests across the model, connectors, Astro loader and CMS API |
| `pnpm typecheck` | every package, including `.vue` and `.astro` |
| `pnpm cms:grant-access` | let an email address edit a site |

Accepted trade-offs and known gaps are in [docs/decisions.md](./docs/decisions.md),
each with what was decided, why, and what would change it. What each release
contains is in [CHANGELOG.md](./CHANGELOG.md); everything here is released
together under one version, and while that version starts with `0`, a minor
bump may break something.

Licence: [MIT](./LICENSE).
