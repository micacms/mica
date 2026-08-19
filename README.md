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
own SQLite file holds browser sessions and nothing else — losing it signs
everyone out and costs nothing more.

---

## Add it to an Astro site

```bash
npm install @micacms/astro @micacms/model
```

Describe your content as a plain module:

```ts
// src/mica.ts
import {
  collection,
  defineSite,
  media,
  richText,
  slug,
  text,
} from "@micacms/model";

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
  docs: defineCollection({
    loader: glob({ pattern: "**/*.md", base: "./src/docs" }),
  }),
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
npx @micacms/editor       # reads ./content, opens the editor on localhost:6422/admin/
```

|                 |                                                                                                                                                                                               |
| --------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Locally**     | The command above. Loopback only, no identity provider, no account, no user at all, no sign-in screen, nothing written into your repository — see [getting-started](./docs/getting-started.md) |
| **On a server** | One container, an OIDC provider, a token for the repository — see [self-hosting](./docs/self-hosting.md). [`demo/`](./demo/README.md) runs that whole shape on your machine                    |

Deployed, Mica authenticates with **OpenID Connect** and nothing else. No
passwords, no reset flow, no MFA enrolment, no passkeys, and no breach
notification to write. An identity provider does all of it better.

It stores no users either. Who may edit is one line of configuration — a group
your provider already manages, a verified domain, or an explicit list of
subjects — so adding an editor happens where you already handle joiners and
leavers, and Mica has nothing to administer.

---

## Layout

```
packages/
├── model/       the field DSL, the content model, and the authoring format
├── connectors/  repository access: local working tree, GitHub, GitLab
├── astro/       Content Layer loader and the dev integration
└── editor/      Hono API + Vue 3 admin SPA
sites/
├── micacms/             the public micacms.com website
└── muster-consulting/   a complete site to read: model, content, templates
docs/
├── getting-started.md   add Mica to an Astro project, and run it locally
├── content-model.md     every field type, and the layout it produces on disk
├── self-hosting.md      deploy it: Docker, OIDC, repository, CI, backups
├── architecture.md      what Mica is, and why it is shaped this way
└── decisions.md         accepted trade-offs and known gaps
demo/                    the deployed shape on your machine: Mica + ZITADEL
e2e/                     a fast sign-in rig: Mica + Keycloak + a checkout
```

`packages/*` are the published surface. `sites/muster-consulting` is a site
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

|                         |                                                                  |
| ----------------------- | ---------------------------------------------------------------- |
| `pnpm dev`              | build the packages, then run the CMS against the example project |
| `pnpm dev:site`         | the example website, in a second terminal                        |
| `pnpm test`             | 313 tests across the model, connectors, Astro loader and editor  |
| `pnpm typecheck`        | every package, including `.vue` and `.astro`                     |

### Releasing

Everything here ships together under one version.

```bash
pnpm release:version 0.2.0        # writes it into all five manifests
git commit -am "Release 0.2.0"
git tag v0.2.0
git push origin main --follow-tags
```

The tag is the trigger and the only one — a merge to `main` publishes nothing.
[`.github/workflows/release.yml`](./.github/workflows/release.yml) checks the
tag against the manifests, runs the build, the typecheck and the tests again,
publishes the four packages to npm — with provenance once this repository is
public, which is the only condition npm will verify one under — and opens a
GitHub release
whose notes are the `CHANGELOG.md` section for that version. Write that section
first: the release fails without it.

The container image is built and pushed by the same workflow once the
repository variable `PUBLISH_IMAGE` is `true` and `DOCKERHUB_USERNAME` /
`DOCKERHUB_TOKEN` exist.

Accepted trade-offs and known gaps are in [docs/decisions.md](./docs/decisions.md),
each with what was decided, why, and what would change it. What each release
contains is in [CHANGELOG.md](./CHANGELOG.md); everything here is released
together under one version, and while that version starts with `0`, a minor
bump may break something.

Licence: [MIT](./LICENSE).
