# Architecture

What Mica is, and why it is shaped this way. Not a specification — the code is
that — but the reasoning behind the shape, which the code cannot state for
itself.

---

## The one constraint

> Losing Mica's data volume must never mean losing website content.

Everything below follows from that sentence. Content lives in a Git repository.
Mica keeps no database: the pending drafts are uncommitted files in a working
tree — the developer's checkout, or the clone a self-hosted Mica keeps on its
volume. A browser session is an encrypted cookie, not a row. Delete the
repository and you have lost the website — which is why the repository is the
thing under version control, replication and review, and Mica's volume is not.

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
| `@micacms/core`           | The field DSL, the content model, the authoring format, and how content is read |
| `@micacms/astro`          | Content Layer loader, dev integration, Markdoc rendering                              |
| `@micacms/runtime`        | The single-site Hono API and services, the working tree's files and Git, authentication-neutral |
| `@micacms/mcp`            | The tools for agents over MCP, on the runtime's services: stdio and `/mcp`, without a gate of its own |
| `@micacms/editor-ui`      | The Vue admin SPA; not published: `@micacms/editor` and the image ship its build |
| `@micacms/auth-oidc`      | The server-only OIDC gate: sign-in, cookie sessions, admission, and the OAuth server for agents; not published, part of the image |
| `@micacms/editor`         | `apps/local-editor` — the `npx` composition: loopback, no auth, no database           |
| `@micacms/self-hosted`    | `apps/self-hosted` — the Docker composition: runtime + UI behind OIDC, on its own clone |
| `examples/company-site` | A complete Astro site that uses every field kind: an example to read, not a dependency |
| `examples/starter`      | The minimal starter for `npm create astro -- --template micacms/mica/examples/starter` |

Five packages are published: `@micacms/core`, `@micacms/astro`, `@micacms/editor`,
`@micacms/runtime` and `@micacms/mcp`. Semver covers the first three, and the
names and inputs of the MCP tools; `@micacms/runtime` and `@micacms/mcp` are
published because `@micacms/editor` depends on them, and are internal.

**Why the core package is not inside the Astro package.** The editor, the
server and the build all need the model, and a Hono server depending on an
Astro integration is the wrong direction. `@micacms/core` has no framework in
it at all — a boundary test asserts it. Its `./node` subpath holds the one
thing that cannot run in a browser — a filesystem `ContentSource` — so the
admin bundle stays free of `node:` imports.

---

## The content model

One module defines collections and singletons over a shared field system. Five
things are derived from it, and none of them can drift: TypeScript types for the
website, Zod validators the server checks writes against, the admin's navigation
and forms, the Astro collections, and the files on disk. Details in
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
commits it. Mica reads it back from the same working tree it reads entries from.
The file also marks the content root: the CLI and the image find the root as the
directory that holds it.

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
re-validated as if hand-written. A newer `protocolVersion` stops the start. A
field kind that this build does not know makes only its collection or
singleton read-only, with the reason in the editor and in the startup log, so
an image that is older than the site's `@micacms/astro` still serves the rest.

Beside the model, the manifest records `generatedBy` (the package, without a
version). It holds nothing that
changes without a model change, because Mica loads the model again whenever the
file changes.

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
├── theme/
│   └── index.json                      a singleton
└── media/                              shared media
```

**One folder for each entry and each singleton**: its structured fields are
in `index.json`, and its rich text and media are beside it. The normative
rules, with tested examples, are in [content-format.md](./content-format.md).

**JSON for structure, Markdoc for prose.** A field's value is JSON unless it is
rich text, in which case it is a sibling `.mdoc` and _absent_ from the JSON.
Keys are written in model order, so the file is byte-identical for the same
input and a diff shows only what changed. In a repeater, a row with rich text
has a key, `_key`, that names its `.mdoc` files (`sections.k3f9a2.body.mdoc`),
so a new order of the rows changes only the JSON. A row without a key gets a
new one when it is first written, and keeps it after that.

**Markdoc, not HTML.** A `.mdoc` file is readable in a diff, carries no styling
decisions that belong to the website, and cannot inject script into a build:
Markdoc escapes raw HTML and renders an undeclared `{% tag %}` as nothing.
The website's templates still decide: a field that holds a script address, or
content written unescaped into a `<script>` element, lets an editor run script.

**Media is colocated**, so an entry is self-contained and renaming it is a
folder move. **Order is a file**, so moving one entry, however far, is one
save and a one-line diff rather than a rewrite of every entry in the collection.

### Saved and Published are different words

A save lands in the site's draft workspace; an explicit **Publish** turns the
reviewed changes into one commit. The two must never blur: Saved means the
work is durable in Mica, and only Published means it is in Git and on its way
to a deployment.

There is one shared pending change set per site — not one per editor, and no
approval queue. In both apps the draft workspace is a **Git working tree**, and
a save writes its files. What differs is who owns the tree:

- **The developer's checkout** (the local editor). Save writes it, which is
  what lets the Astro dev server hot-reload it. Publish commits exactly the
  reviewed paths and pushes with the developer's own Git. Mica never fetches or
  merges there. When the content is in a Git submodule, the checkout is the
  submodule, and Mica never commits in the website repository.
- **Mica's own clone** (self-hosted). Mica clones the repository into its data
  volume, keeps it up to date (fetch and fast-forward, never a merge), commits
  each publication with the editor as author, and pushes it over HTTPS. A
  change on the website to an entry with a draft is a conflict the editor
  resolves: keep their version, or take the website's.

Publish sends the reviewed paths with the revision each had, so a file saved
again since — or another file of the same entry — is never published unseen,
and a colleague's draft of another entry stays a draft. The editor chooses
which edits to publish; an edit comes with the new entries and files it uses.
An entry's state ("New" or "Changed", not published) is not stored in the
entry: the editor reads it from the pending changes. Release-level staging is a branch: point a second
Mica at `MICA_REPOSITORY_BRANCH=staging` and editors have a staging site that
is reviewed and merged like any other change.

---

## Repository access

```
ContentFiles (the working tree's files)       GitTree (Git on that tree)
  read, list, readBinary, revision, apply       status, commit, push, discard, HEAD reads
                      \                           /
                       owner policy: developer | managed
```

`ContentFiles` is four operations over the content root — read, list, ask
whether a file changed, and apply a set of changes as one unit. It is not Git:
applying changes writes files. Because it extends `ContentSource`, the Astro
build reading a checkout and the server reading its working tree run **the
same** discovery and parsing code, and cannot disagree about what a content
directory means.

**One write, or none.** An entry is an `index.json`, its sidecars and its
media, and a half-written entry is content corruption — so `apply()` writes
every file beside its target, renames it into place, and undoes the whole set
on any failure.

**Git is the binary, never a library.** In the local editor that brings the
developer's credentials and remotes along. On the server, Mica runs `git` with
an allowlisted environment and its settings from `GIT_CONFIG_*`: no hooks, no
filter but Git LFS, no symlinks, HTTPS only, and a credential helper that gives the token
to the configured host alone. Nothing of the repository can make Git run code,
and the token is never on disk.

**Locks.** Saves, commits, discards and fast-forwards share one tree, so they
take a read/write lock; fetch and push take a separate queue, and no network
call happens while the tree is locked. A slow push never blocks a save.

**Concurrency.** Every read carries an opaque `revision` (a content hash);
every save sends back the one it was based on. A mismatch is a 409, and the
editor's work stays in the form. Per entry, not per repository head — two
editors on different entries never block each other. A `null` revision asserts
absence, which is how two people creating the same slug produce a conflict
rather than a silent overwrite. On the server, a push is never forced: a
rejected one is undone, the clone catches up, and the same commit is made
again on top.

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
rules say whether you are in     MICA_ADMIT_GROUPS
        │                        MICA_ADMIT_DOMAINS
        │                        MICA_ADMIT_EMAILS
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

- Identities are keyed by `(issuer, subject)`. An address may be admitted
  (`MICA_ADMIT_EMAILS`), because Google sends no groups — the cost is that an
  organisation that reuses an address passes the access on with it.
- The email and domain rules require the provider's `email_verified`. Without
  it, an open self-registration would let anybody claim an admitted address. A
  domain rule for a public provider such as `gmail.com` is refused at startup.
- The rules are checked on every request, never decided at sign-in and kept.
  Mica reads them at start, so a configuration change takes effect after a
  restart.
- A **group** change at the provider does not. Mica sees the claims it was
  given at sign-in, and learns better at the next one, so the session lifetime
  is the upper bound. The cookie keeps only the groups that `MICA_ADMIT_GROUPS`
  names, to stay under the 4 KB cookie limit, so a group added to the rules
  counts from the next sign-in — hours, not weeks. That trade is in
  [decision record 3](adr/0003-admission-by-provider-claims.md).

**Multi-site is not here.** One runtime serves one site, named by an explicit
`SiteContext` rather than assumed. There are no tenant, site or membership
tables: several sites means several processes, and a control plane that runs
them is a separate, private product — see [GOVERNANCE.md](../GOVERNANCE.md).

---

## The two apps

One runtime, two composition roots. The mode is which app you run.

|                        | Identity             | Working tree                         | Database |
| ---------------------- | -------------------- | ------------------------------------ | -------- |
| `@micacms/editor`      | **None** — see below | The developer's checkout             | **None** |
| `@micacms/self-hosted` | OIDC                 | Mica's own clone, on its data volume | **None** |

Both compose `@micacms/runtime` — neither forks it — and hand it an
`AuthSurface`: routes for `/api/auth` plus the gate in front of the admin API.
The self-hosted app passes the OIDC surface from `@micacms/auth-oidc`; the
local editor passes nothing and gets the unauthenticated surface, which is a
statement of fact rather than a bypass.

### Agents are a second interface, not a second app

`@micacms/mcp` puts a fixed set of tools on the same services as the editor:
read the model and the content, save, delete, reorder, upload, list and discard
the drafts, and publish when `MICA_MCP_PUBLISH` allows it. A save is a draft, as
in the editor, and every write sends the revision that the agent read.

```
            createMcpServer(ctx): the tools
            /            |              \
   stdio: mica mcp   /mcp in mica start   /mcp in the image
   no gate           no gate: loopback,   OAuth bearer gate,
                     Host + Origin        MICA_MCP=true
```

The tools know nothing of the transport or of the caller's authentication: the
composing app puts its gate in front of `/mcp`, as it does in front of
`/api/admin`. In the image, Mica is the OAuth authorization server of its own
`/mcp`: the person signs in with the editor's flow, the admission rules decide,
a consent page allows one agent, and Mica issues sealed tokens. It stores none
of them, as it stores no session. The reasons are in
[decision record 29](adr/0029-mica-is-the-authorization-server-for-mcp.md).

### The local editor has no authentication, no user, and no database

`npx @micacms/editor` has no provider, no credential and nobody to be. It does
not invent a developer account: there is no name, no avatar, no account menu
and no sign-out, because there is nothing behind any of them. There is no
session either, and no database — the content directory is the only place the
process writes.

This is the honest resolution of two requirements that genuinely conflict: Mica
ships no passwords, and a developer cannot be asked to stand up Keycloak before
running `rush dev`. The third option — a built-in dev identity provider — is
auth code, which is the thing being avoided. The package boundary makes it
structural: `@micacms/editor` has no dependency path to `openid-client`, and a
test walks the graph to keep it that way.

It is the most dangerous state the software has, so it is contained: refused
when `MICA_PUBLIC_URL` is any host but localhost; refused when `HOST` is anything but the loopback address; and a
**Host allowlist** in front of everything, so a DNS-rebound name gets a 403.
The Origin check refuses cross-site writes.

---

## Mica's state

Mica keeps no database. A self-hosted Mica has one data volume, which holds its
clone of the content repository and, in it, the drafts that are saved and not
yet published. No content history, no media library, no revisions, no
accounts, no sessions: Git is the history. Losing the volume loses unpublished
work and nothing else; it signs nobody out. A clone that holds no draft and no
unpushed commit can be thrown away and cloned again.

### Sessions are cookies

There is no session table. The session is the `mica_session` cookie: JSON that
holds the identity (issuer, subject, email, `emailVerified`, name, groups), a
CSRF token and three times, encrypted with AES-256-GCM under a key that HKDF
derives from `MICA_SESSION_SECRET`. The gate re-issues the cookie every five minutes
while it is in use, so the idle window slides, and `MICA_SESSION_TTL_HOURS` caps it.

Sign-out clears the cookies in the browser. Mica cannot revoke one session on
the server: a copied cookie stays valid until it expires. Rotating
`MICA_SESSION_SECRET` and restarting ends every session at once. Removing somebody
from the `MICA_ADMIT_*` rules and restarting refuses them on their next request.

Note the startup order this implies. The content model is _in_ the repository,
so the self-hosted entry point first answers `/health`, then clones or
recovers its clone, brings it up to date, reads the model from it, and only
then composes the application — explicitly, rather than hiding it in the
composition root. The local editor reads the model from the checkout.

---

## What Mica deliberately does not do

- **No content API.** The website reads files. Nothing to secure, rate limit,
  cache or keep available at build time. The MCP tools are not one: they are an
  authoring interface, behind the same rules as the editor, and no build reads
  them.
- **No build webhook.** A push is the trigger, which every CI system already
  understands.
- **No media server.** Images are repository files, processed by Astro at build
  time.
- **No passwords, no GraphQL, no plugin architecture, no page builder, no
  approval workflows.**

The test for any future feature:

> Does this help Mica make Git-backed Astro sites easier to author, or does it
> move Mica back toward being a general-purpose CMS?
