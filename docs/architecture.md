# Architecture

What Mica is, and why it is shaped this way.

This describes the system as it stands. It is not a specification to build
against — the code is that — but the reasoning behind the shape, which the code
cannot state for itself.

---

## The one constraint

> Losing Mica's database must never mean losing website content.

Everything below follows from that sentence. Content lives in a Git repository;
Mica's own SQLite file holds accounts, memberships and sessions. Delete it and
three editors sign in again. Delete the repository and you have lost the
website — which is why the repository is the thing under version control,
replication and review, and the database is not.

---

## The pieces

```
┌─────────────────────────────────────────────┐
│                mica.config.ts               │
│        the content model — one file         │
└───────────────────┬─────────────────────────┘
                    │
     as JSON        │        imported directly
   (build:schema)   │        (types, no codegen)
          ┌─────────┴─────────┐
          ▼                   ▼
┌───────────────────┐  ┌───────────────────┐
│     apps/cms      │  │     apps/web      │
│  Hono + Vue 3     │  │  Astro SSG        │
└─────────┬─────────┘  └─────────▲─────────┘
          │  commits             │  reads
          ▼                      │
    ┌───────────────────────────────────┐
    │      the content repository       │
    └───────────────────┬───────────────┘
                        │ push → CI → astro build
                        ▼
                  static files → any static host
```

The CMS never learns where the website is hosted. The website never contacts
the CMS. They meet in the repository, and neither has to be running for the
other to work.

| Package | What it is |
| --- | --- |
| `@micacms/model` | The field DSL, the content model, and the authoring format — serialise, parse, layout |
| `@micacms/connectors` | Repository access, and the content store built on it |
| `@micacms/astro` | Content Layer loader, dev integration, Markdoc rendering |
| `apps/cms` | Hono API and the Vue admin it serves |
| `apps/web` | An example Astro site: a starter to copy, not a dependency |

### Why the model package is not inside the Astro package

The editor, the server and the build all need the model, and a Hono server
depending on an Astro integration is the wrong direction. `@micacms/model` has
no framework in it at all. Its `./node` subpath holds the one thing that cannot
run in a browser — a filesystem `ContentSource` — so the admin bundle stays free
of `node:` imports.

---

## The content model

One file, `mica.config.ts`, defines collections and singletons over a shared
field system.

```ts
export const site = defineSite({
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
  singletons: {
    theme: singleton({ label: "Theme", fields: { primaryColor: color() } }),
  },
});
```

Five things are derived from it, and none of them can drift:

- TypeScript types for the Astro site;
- Zod validators the server checks writes against;
- the admin's navigation, list columns and forms;
- Astro collection schemas;
- **the layout on disk** (below).

The DSL is not Zod with extra steps. `text({ label: "Title", maxLength: 120 })`
carries editorial meaning that `z.string().max(120)` cannot — a label, a width,
a group. Zod is generated from the DSL, never the reverse.

### The model is plain data

A `Site` is JSON-serialisable and survives a round trip. That is what lets the
CMS image ship without a content model and be handed one at startup: one
published image serves any project, and changing the model is a rebuild of a
JSON file plus a restart.

---

## The authoring format

An entry's layout follows from its fields. Rich text and media need files
beside the entry; without them, an entry is one file.

```
content/
├── projects/
│   ├── _order.json                    ["haus-a", "haus-b"]
│   ├── haus-a/                        ← a directory: it has rich text and media
│   │   ├── index.json
│   │   ├── summary.mdoc
│   │   └── media/exterior.jpg
│   └── haus-b/
├── theme.json                         ← a file: plain fields only
└── site/
    └── index.json
```

**JSON for structure, Markdoc for prose.** A field's value is JSON unless it is
rich text, in which case it is a sibling `.mdoc` and *absent* from the JSON.
Keys are written in model order, so the file is byte-identical for the same
input and a diff shows only what changed.

**Markdoc, not HTML.** A `.mdoc` file is readable in a diff, carries no styling
decisions that belong to the website, and cannot inject script into a build:
Markdoc escapes raw HTML and renders an undeclared `{% tag %}` as nothing.

**Media is colocated.** `media/exterior.jpg` beside the entry that uses it, so
an entry is self-contained and renaming it is a directory move.

**Order is a file.** `_order.json` lists slugs, so dragging one entry is a
one-line diff rather than a rewrite of every entry in the collection.

### There are no drafts

An entry is saved or it is not, and saved means committed. Unfinished work
stays in the editor's form and never reaches the server.

A status column was always a weak imitation of a branch. Point a second Mica at
`REPOSITORY_BRANCH=staging` and editors have a staging site that is reviewed and
merged like any other change — strictly more capable than draft/published ever
was, and free.

---

## Repository access

```ts
interface RepositoryConnector extends ContentSource {
  readBinary(path): Promise<Uint8Array | null>;
  revision(path): Promise<string | null>;   // opaque; equality only
  commit(input: CommitInput): Promise<CommitResult>;
}
```

Four operations. Mica does not implement Git, and a Git client inside a server
would be a working tree to keep in sync, a credential on disk and a merge to
resolve.

Because the interface extends `ContentSource`, the Astro build reading a
checkout and the server reading a remote repository run **the same** discovery
and parsing code. They cannot disagree about what a content directory means.

| Connector | What it does |
| --- | --- |
| `local` | A working tree on disk. Not a Git client: the developer commits with their own tools |
| `github` | Git Data API — blob, tree, commit, ref |
| `gitlab` | The commits API, which takes a whole change set |

### One commit, or none

An entry is an `index.json`, its sidecars and its media. A half-written entry is
content corruption, so `commit()` applies everything or nothing. GitHub's
Contents API writes one file per commit, which is why the GitHub connector goes
the longer way round through the Git Data API.

The local connector earns the same guarantee the hard way: staged writes beside
their target, renamed into place, with a full rollback on any failure.

### Concurrency

Every read carries an opaque `revision`; every write sends back the one it was
based on. A mismatch is a 409, and the editor's work stays in the form.

Per path, not per repository head — two editors on different entries must never
block each other. A `null` revision asserts absence, which is how two people
creating the same slug produce a conflict rather than a silent overwrite.

GitHub adds a second layer for free: the ref update is never forced, so a push
that lands mid-save is rejected rather than overwritten.

---

## Authentication and authorization

Mica authenticates nobody. It asks an OpenID Connect provider who you are and
records the answer.

There are no passwords in the codebase — no hashing, no reset flow, no MFA, no
passkeys, no breach notification to write. Every one of those is a thing to get
wrong, and an identity provider does all of them better.

```
Tenant
  └── Site
        └── Membership
              ├── administrator
              └── editor
```

**Authentication and authorization are separate questions.** A provider may
vouch for an entire company; a *membership* says this person may edit this site.
Someone who authenticates perfectly and has no membership is turned away with a
message telling them to ask an administrator.

Two details that matter:

- Identities are keyed by `(issuer, subject)`, never by email. An email is a
  display attribute a provider may let someone change; binding an account to
  whoever holds an address today is a well-trodden route to account takeover.
- Authorization is re-read on every request, never copied into the session.
  Removing someone takes effect now, not when their cookie expires.

### Multi-tenancy

The schema is `tenants → sites → memberships`, with a repository connection per
site. A single-site deployment gets an implicit default and never meets the
concept.

The structure exists before it is needed because retrofitting a site id onto
every membership and connection query is expensive, and doing it now costs one
column. What does not exist is a UI for it.

---

## Deployment modes

One implementation, three shapes, selected by `MICA_MODE`.

| | Identity | Repository | Sites |
| --- | --- | --- | --- |
| `local` | **None** — see below | A working tree | One |
| `self-hosted` | OIDC | Usually a provider connector | One |
| `cloud` | OIDC | Provider connectors | Many |

### Local mode disables authentication

`MICA_MODE=local` signs every request in as one developer account. There is no
provider and no credential.

This is the honest resolution of two requirements that genuinely conflict:
Mica ships no passwords, and a developer cannot be asked to stand up Keycloak
before running `pnpm dev`. The third option — a built-in dev identity provider —
is auth code, which is the thing being avoided.

It is the most dangerous state the software has, so it is contained four ways:

1. refused when `NODE_ENV=production`;
2. refused when `CMS_BASE_URL` is any host but localhost;
3. a warning on every start;
4. a banner on the sign-in page.

---

## The operational database

SQLite, holding:

```
users                 who someone is (no credential)
oidc_identities       (issuer, subject) → user
tenants / sites       the deployment's shape
memberships           who may edit what
repository_connections  how a site reaches its repository
sessions
```

No content, no media, no revisions. Two rules keep it navigable: only
`repositories/` writes SQL, and only `db/driver.ts` knows which SQLite library
is in use.

---

## What Mica deliberately does not do

- **No content API.** The website reads files. Nothing to secure, rate limit,
  cache or keep available at build time.
- **No build webhook.** A push is the trigger, which every CI system already
  understands.
- **No media server.** Images are repository files, processed by Astro at build
  time.
- **No passwords, no GraphQL, no plugin architecture, no page builder, no
  approval workflows.**

The test for any future feature:

> Does this help Mica make Git-backed Astro sites easier to author, or does it
> move Mica back toward being a general-purpose CMS?

---

## What success looks like

Setting up a project:

1. Install `@micacms/astro`.
2. Define collections and singletons.
3. Put content in Git.
4. Connect the repository to Mica.
5. Invite the client.
6. Deploy Astro as a normal static site.

Using it:

1. Sign in.
2. Edit.
3. Save.

Git, OIDC, credentials, repository APIs and CI are all implementation details,
and an editor should never meet any of them.
