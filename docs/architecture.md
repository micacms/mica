# Architecture

What Mica is, and why it is shaped this way. Not a specification — the code is
that — but the reasoning behind the shape, which the code cannot state for
itself.

---

## The one constraint

> Losing Mica's database must never mean losing website content.

Everything below follows from that sentence. Content lives in a Git repository;
Mica's own SQLite file holds browser sessions. Delete it and three editors sign
in again. Delete the repository and you have lost the
website — which is why the repository is the thing under version control,
replication and review, and the database is not.

---

## The pieces

```
        ┌──────────────────────────────────┐
        │            src/mica.ts           │
        │  the content model — one file    │
        └───────┬──────────────────┬───────┘
   imported     │                  │  written as data
   directly     │                  │  (.mica/schema.json)
   (types, no   ▼                  │
    codegen) ┌──────────┐          │       ┌───────────┐
             │  Astro   │          └──────▶│   Mica    │
             │  build   │                  │ Hono + Vue│
             └────▲─────┘                  └─────┬─────┘
                  │  reads                       │  commits
                  │                              ▼
            ┌─────┴──────────────────────────────────┐
            │         the content repository         │
            └────────────────────┬───────────────────┘
                                 │ push → CI → astro build
                                 ▼
                          static files → any static host
```

Mica never learns where the website is hosted. The website never contacts Mica.
They meet in the repository, and neither has to be running for the other to
work.

| Package                   | What it is                                                                            |
| ------------------------- | ------------------------------------------------------------------------------------- |
| `@micacms/model`          | The field DSL, the content model, and the authoring format — serialise, parse, layout |
| `@micacms/connectors`     | Repository access, and the content store built on it                                  |
| `@micacms/astro`          | Content Layer loader, dev integration, Markdoc rendering                              |
| `@micacms/editor`         | Hono API and the Vue admin it serves                                                  |
| `sites/muster-consulting` | A complete Astro site: a starter to copy, not a dependency                            |

**Why the model package is not inside the Astro package.** The editor, the
server and the build all need the model, and a Hono server depending on an
Astro integration is the wrong direction. `@micacms/model` has no framework in
it at all. Its `./node` subpath holds the one thing that cannot run in a
browser — a filesystem `ContentSource` — so the admin bundle stays free of
`node:` imports.

---

## The content model

One module defines collections and singletons over a shared field system. Five
things are derived from it, and none of them can drift: TypeScript types for the
website, Zod validators the server checks writes against, the admin's navigation
and forms, the Astro collections, and the layout on disk. Details in
[content-model.md](./content-model.md).

It imports nothing from Astro, and `src/content.config.ts` is the only file that
imports _it_ — six lines turning it into collections. That separation is not
bookkeeping: `content.config.ts` may import `astro:content`, a virtual module
that resolves only inside the app's module graph, so anything that also has to
be read from outside that graph cannot live there.

### The model is plain data

A `Site` is JSON-serialisable and survives a round trip. Field descriptors hold
no functions, so `JSON.stringify(site)` is lossless. That is what lets the Mica
image ship without a content model and be handed one at startup.

### How it reaches Mica

The loaders write `<content root>/.mica/schema.json` — the model wrapped in a
small protocol envelope — on every build and dev-server start, and the developer
commits it. Mica reads it back through the same connector it reads entries with.

Written from a loader rather than from an Astro integration, because that is the
moment both facts are in hand: the model, and the project root that turns
`./content` into a directory. Watching the content root in dev moved there for
the same reason — Astro gives a loader its file watcher. What that buys is a
project where **nothing of Mica appears in `astro.config`**, which is what makes
Mica collections and ordinary Astro collections mix in one `content.config.ts`.

The alternatives were mounting a compiled artifact into the container, and
fetching one over HTTP from the deployed website. Both add a second channel
between the project and Mica, with its own failure mode when the two fall out
of step. Sending the model the way content already travels means there is one
channel, one place to look, and a model change that is reviewable in a diff.

The envelope carries a `protocolVersion`, bumped only when an older reader
would _misinterpret_ a newer manifest. A Mica deployment and the
`@micacms/astro` in a project are upgraded by different people at different
times, so they are not required to move together. Whatever arrives is
re-validated as if hand-written: an unknown field kind is reported by name at
startup rather than surfacing later on an editor's screen.

---

## The authoring format

```
content/
├── .mica/schema.json                   the model
├── projects/
│   ├── _order.json                     ["haus-a", "haus-b"]
│   └── haus-a/
│       ├── index.json
│       ├── summary.mdoc
│       └── media/exterior.jpg
└── theme.json
```

**JSON for structure, Markdoc for prose.** A field's value is JSON unless it is
rich text, in which case it is a sibling `.mdoc` and _absent_ from the JSON.
Keys are written in model order, so the file is byte-identical for the same
input and a diff shows only what changed.

**Markdoc, not HTML.** A `.mdoc` file is readable in a diff, carries no styling
decisions that belong to the website, and cannot inject script into a build:
Markdoc escapes raw HTML and renders an undeclared `{% tag %}` as nothing.

**Media is colocated**, so an entry is self-contained and renaming it is a
directory move. **Order is a file**, so dragging one entry is a one-line diff
rather than a rewrite of every entry in the collection.

### Saved and Published are different words

A save lands in the site's draft workspace; an explicit **Publish** turns the
accumulated changes into one commit. The two must never blur: Saved means the
work is durable in Mica, and only Published means it is in Git and on its way
to a deployment.

There is one shared pending change set per site — not one per editor, and no
approval queue. The draft workspace differs by deployment shape, because the
two shapes genuinely differ:

- **A working tree** (`REPOSITORY=local`): autosave writes the checkout, which
  is what lets the Astro dev server hot-reload it. Recent changes is `git
  status` over the content root; Publish commits exactly the reviewed paths
  and pushes with the developer's own Git.
- **A draft store** (`github` / `gitlab`): writing through a provider API is
  already a commit, so saves accumulate in SQLite behind a connector overlay,
  and Publish sends the whole set as one provider-side commit.

There is still no status column on an entry. Release-level staging is a
branch: point a second Mica at `REPOSITORY_BRANCH=staging` and editors have a
staging site that is reviewed and merged like any other change.

---

## Repository access

```ts
interface RepositoryConnector extends ContentSource {
  readBinary(path): Promise<Uint8Array | null>;
  revision(path): Promise<string | null>; // opaque; equality only
  head(): Promise<string | null>; // the branch head, for display
  commit(input: CommitInput): Promise<CommitResult>;
}
```

Five operations. Mica does not implement Git: a Git client inside a server
would be a working tree to keep in sync, a credential on disk and a merge to
resolve. (Local publishing does spawn the developer's own `git` binary — the
one place Git itself is the right tool, precisely because it brings the
developer's credentials and remotes with it.)

Because the interface extends `ContentSource`, the Astro build reading a
checkout and the server reading a remote repository run **the same** discovery
and parsing code. They cannot disagree about what a content directory means.

| Connector | What it does                                                                         |
| --------- | ------------------------------------------------------------------------------------ |
| `local`   | A working tree on disk. Not a Git client: the developer commits with their own tools |
| `github`  | Git Data API — blob, tree, commit, ref                                               |
| `gitlab`  | The commits API, which takes a whole change set                                      |
| `staged`  | A decorator: a draft store overlaid on any of the above. Reads see the repository as it will be once published; `commit()` records into the draft instead of writing |

**One commit, or none.** An entry is an `index.json`, its sidecars and its
media, and a half-written entry is content corruption — so `commit()` applies
everything or nothing. GitHub's Contents API writes one file per commit, which
is why the GitHub connector goes the longer way round through the Git Data API.
The local connector earns the same guarantee the hard way: staged writes beside
their target, renamed into place, with a full rollback on any failure.

**Concurrency.** Every read carries an opaque `revision`; every write sends
back the one it was based on. A mismatch is a 409, and the editor's work stays
in the form. Per path, not per repository head — two editors on different
entries must never block each other. A `null` revision asserts absence, which is
how two people creating the same slug produce a conflict rather than a silent
overwrite. GitHub adds a second layer for free: the ref update is never forced,
so a push that lands mid-publication is rejected rather than overwritten. The
draft store records, for every staged path, the repository revision it had
when first staged — that map is the publish gate, so a branch that moved on
*other* paths never blocks a publication.

---

## Authentication and authorization

Mica authenticates nobody. It asks an OpenID Connect provider who you are and
records the answer. There are no passwords in the codebase — no hashing, no
reset flow, no MFA, no passkeys, no breach notification to write.

It stores no users either. Who may edit is configuration:

```
provider says who you are        MICA_OIDC_*
        │
        ▼
rules say whether you are in     MICA_ADMIT_GROUP
        │                        MICA_ADMIT_DOMAIN
        ▼                        MICA_ADMIT_SUBJECTS
everybody admitted is an editor of this site
```

**Authentication and admission are separate questions.** A provider vouches for
an entire company; the rules say this person may edit this site. Someone who
authenticates perfectly and matches no rule is turned away, and Mica refuses to
start outside local mode until at least one rule exists — admitting everybody
the issuer knows is a misconfiguration, not a default.

There are no roles, because there are no accounts to hang them on. The set of
people who get in is exactly the set the operator named, and all of them can
edit everything.

Four details that matter:

- Identities are keyed by `(issuer, subject)`, never by email. An email is a
  display attribute a provider may let someone change; admitting an address
  means admitting whoever holds it next.
- The domain rule requires the provider's `email_verified`. Without it, an open
  self-registration would let anybody claim an admitted domain.
- The rules are re-read on every request, never copied into the session. A
  configuration change takes effect now.
- A **group** change at the provider does not. Mica sees the claims it was
  given at sign-in, and learns better at the next one, so the session lifetime
  is the upper bound — hours, not weeks. That trade is recorded as a P1
  decision in [`decisions.md`](decisions.md).

**Multi-site is not here.** One runtime serves one site, named by an explicit
`SiteContext` rather than assumed. There are no tenant, site or membership
tables: several sites means several processes, and a control plane that runs
them is a separate, private product — see [`v3-arch.md`](v3-arch.md) §14.

---

## Deployment modes

One implementation, two shapes, selected by `MICA_MODE`.

|               | Identity             | Repository                   |
| ------------- | -------------------- | ---------------------------- |
| `local`       | **None** — see below | A working tree               |
| `self-hosted` | OIDC                 | Usually a provider connector |

Both serve one site. The variable is temporary: the mode becomes which
application you run once the packages split — see [`v3-plan.md`](v3-plan.md),
Phase C.

### Local mode has no authentication, and no user

`MICA_MODE=local` has no provider, no credential and nobody to be. It does not
invent a developer account: there is no name, no avatar, no account menu and no
sign-out, because there is nothing behind any of them. A session still exists,
carrying the CSRF token and nothing else.

This is the honest resolution of two requirements that genuinely conflict: Mica
ships no passwords, and a developer cannot be asked to stand up Keycloak before
running `pnpm dev`. The third option — a built-in dev identity provider — is
auth code, which is the thing being avoided.

It is the most dangerous state the software has, so it is contained: refused
when `NODE_ENV=production`; refused when `MICA_PUBLIC_URL` is any host but
localhost; refused when `HOST` is anything but the loopback address; and a
warning on every start.

---

## The operational database

SQLite, holding:

```
sessions                a browser session, and the claims it was opened with
drafts                  the pending change set, where saves are staged (provider repositories only)
draft_base              the branch head that pending set began from
```

No content history, no media library, no revisions, no accounts — the claims
are copied onto the session row because the rules are re-checked per request,
and asking the provider each time is not something a provider would thank us
for. The draft tables hold exactly the current pending change set and are
cleared by publication; Git stays the history. Losing this database signs
everyone out — and, where saves are staged in it, loses work that was saved
and not yet published, which the self-hosted backup guidance says out loud.
Two rules keep it navigable: only `repositories/` writes SQL, and only
`db/driver.ts` knows which SQLite library is in use.

Note the startup order this implies. The content model is _in_ the repository,
so the database opens first, the connector is built from it, the model is read
through the connector, and only then is the application composed. The entry
point does that explicitly rather than hiding it in the composition root.

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
