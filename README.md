# Mica

> **Experimental.** Pre-1.0: APIs, the CLI and the content format can still
> change without notice. Use it at your own risk. Mica is a hobby project of
> one maintainer: see [GOVERNANCE.md](./GOVERNANCE.md).

A Git-native content editor for Astro websites.

Editors get forms. What comes out when they publish is a commit: JSON, Markdoc
and images in your repository, which your normal build turns into a static
site. Saves accumulate in a draft workspace until then, so the history reads
as publications, not keystrokes.

Not a general-purpose CMS. It is the specific case of a content-driven business
website — a handful of editors, a few hundred entries, a static frontend, and
somebody who would rather not run four services to keep a brochure site
current.

```
   editor
     │  fills in a form, presses Publish
     ▼
┌──────────┐  one commit  ┌────────────────────┐   push    ┌────┐  astro build
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
deployed copy keeps its own Git clone on its data volume, and the pending
drafts between Save and Publish are uncommitted files in it. There is no
database, and Mica calls no provider API: it commits and pushes over HTTPS.
Nothing published is ever only in there.

---

## Add it to an Astro site

```bash
npm install @micacms/astro @micacms/core
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
} from "@micacms/core";

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

Full walkthrough: **[micacms.com/docs/getting-started](https://micacms.com/docs/getting-started/)**.

---

## How Mica learns your model

The Mica loaders write the model to `content/.mica/schema.json` on every build
and dev-server start. You commit it. Mica reads it out of the repository it is
already connected to, and generates its navigation, tables and forms from it.

That is the entire coupling. The Mica image contains no content model — only
the field types that interpret one — so one image serves every project, and
changing the model is a commit, which Mica loads by itself, rather than a rebuild.

---

## What an entry looks like

```
content/projects/haus-am-zuerichsee/
├── index.json          the fields
├── summary.mdoc        rich text, one file per field
└── media/
    └── exterior.jpg    referenced as media/exterior.jpg
```

Each entry and each singleton is a folder with `index.json`, its `.mdoc`
files and its media. Keys are written in model order, so a diff shows only what
changed. Collection order is a `_order.json` listing slugs, so dragging one
entry is a one-line diff rather than a rewrite of every entry.

Rich text is [Markdoc](https://markdoc.dev), not HTML: readable in a diff, and
it cannot inject a script into the built site.

---

## Running it

```bash
npx @micacms/editor start # reads ./content, opens the editor on localhost:6422/admin/
```

|                 |                                                                                                                                                                                               |
| --------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Locally**     | The command above. Loopback only, no identity provider, no account, no user at all, no sign-in screen, nothing written into your repository — see [getting started](https://micacms.com/docs/getting-started/) |
| **On a server** | One container, an OIDC provider, a token for the repository, and a Git clone on its volume — see [self-hosting](https://micacms.com/docs/self-hosting/). [`deploy/demo-identity/`](./deploy/demo-identity/README.md) runs that whole shape on your machine |

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
├── core/        the field DSL, the content model, the authoring format, and the content-source contract
├── astro/       Content Layer loader and the dev integration
├── runtime/     the single-site Hono API and services, the content files and the Git working-tree code, authentication-neutral
├── editor-ui/   the Vue 3 admin SPA, shipped as built assets
└── auth/oidc/   the server-only OIDC gate
apps/
├── local-editor/  @micacms/editor — the npx composition: loopback, no auth, no database
└── self-hosted/   @micacms/self-hosted — the Docker composition, behind OIDC
sites/
└── micacms/             the public micacms.com website
examples/
├── company-site/       a complete site to read: every field kind, content, templates
└── starter/            the minimal starter for `npm create astro --template`
docs/                    for contributors; the user guides are on micacms.com/docs
├── architecture.md      what Mica is, and why it is shaped this way
└── decisions.md         accepted trade-offs and known gaps
deploy/
├── self-hosted/         the reference deployment: compose.yml + .env.example
└── demo-identity/       the deployed shape on your machine: Mica + ZITADEL
tests/
├── e2e/                 a fast sign-in rig: Mica + Keycloak + Forgejo
├── oidc/                the automated OIDC round trip: the real image + Dex + Forgejo
└── browser/             an automated browser test of the editor UI
```

`packages/*` are reusable libraries and `apps/*` are the two things you run;
all of them are published under one lockstep version.
`examples/company-site` is a site to copy and redesign, not a dependency —
the design is the part that should differ between projects.

---

## What is deliberately absent

**No content API.** The website reads files. Nothing to secure, rate limit,
cache or keep available at build time.

**No build webhook.** A push is the trigger, which every CI system already
understands.

**No media server.** Images are files in the repository, processed by Astro at
build time.

**No status column on entries.** Saved means durable in the draft workspace;
Published means committed — one shared pending change set per site, and
nothing more. Release-level staging is a branch: point a second Mica at a
`staging` branch and editors have a staging site, reviewed and merged like any
other change — strictly more capable than a status column, and free.

No GraphQL, no plugin architecture, no page builder, no approval workflows, no
mandatory cloud services.

---

## Development

|                         |                                                                  |
| ----------------------- | ---------------------------------------------------------------- |
| `rush update`           | install — Rush fetches its own pinned pnpm, nothing global       |
| `rush dev`              | build the packages, then run the CMS against the example project |
| `rushx dev`             | the example website, from `examples/company-site`           |
| `rush test`             | the tests of every package, with real Git on temporary repos     |
| `rush typecheck`        | every package, including `.vue` and `.astro`                     |

### Updating dependencies

Dependabot opens pull requests for the GitHub Actions and the image's base
(`.github/dependabot.yml`). It cannot update the Rush lockfile, so
`.github/workflows/dependencies.yml` does: on the 3rd of each month it runs
`rush update --full` and opens a pull request. Close and reopen that pull
request to start CI. Every Monday the same workflow audits what Mica ships,
the editor's bundled libraries included, and opens an issue on a high or
critical finding. By hand:

```bash
rush update --full     # newest versions inside the ranges in each package.json
rush build && rush typecheck && rush test
```

A new major version is a change to the range in `package.json`, then
`rush update`. Commit the lockfile with it.

### Releasing

Everything here ships together under one version. A pull request that changes
a published package carries a change file — `rush change` records one, CI
verifies it, and its comment becomes the package's changelog entry (bump type
`none` for changes the release notes should not mention).

```bash
rush version-bump                 # consume the change files: bump every
                                  # manifest, write the package changelogs
git commit -am "Release 0.2.0"
git tag -a v0.2.0 -m "Release 0.2.0"  # annotated: --follow-tags pushes it
git push origin main --follow-tags
```

The tag is the trigger and the only one — a merge to `main` publishes nothing.
[`.github/workflows/release.yml`](./.github/workflows/release.yml) checks the
tag against the manifests, runs the build, the typecheck and the tests again,
publishes the six packages to npm — with provenance once this repository is
public, which is the only condition npm will verify one under — and opens a
GitHub release
whose notes are the `CHANGELOG.md` section for that version. Write that section
first: the release fails without it.

The same workflow builds the container image and pushes it to GHCR
(`ghcr.io/<owner>/<repo>`). It uses `GITHUB_TOKEN`, so no other secret or
variable is needed.

Accepted trade-offs and known gaps are in [docs/decisions.md](./docs/decisions.md),
each with what was decided, why, and what would change it. What each release
contains is in [CHANGELOG.md](./CHANGELOG.md); everything here is released
together under one version, and while that version starts with `0`, a minor
bump may break something.

## Contributing

Read [CONTRIBUTING.md](./CONTRIBUTING.md) before you open a pull request, and
the [code of conduct](./CODE_OF_CONDUCT.md). Report a vulnerability privately,
as [SECURITY.md](./SECURITY.md) says. How the project is run, and what to
expect from it, is in [GOVERNANCE.md](./GOVERNANCE.md).

Licence: [MIT](./LICENSE).
