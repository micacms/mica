# Mica CMS

The CMS application: a Hono API and the Vue administration SPA it serves. It
holds no content — content is committed to a Git repository through a connector,
and the SQLite file next to this process holds accounts and sessions only.

```
cms.example.com
       │
       ▼
      Hono
  ┌────┼──────────┬─────────┐
  │    │          │         │
/api/* /admin/*  /health    │
  │      │                  │
  │    Vue SPA              │
  │                         │
connector ──▶ content repository
  │
SQLite: accounts, sessions
```

## Running it locally

```bash
pnpm install
pnpm build:packages

cd apps/cms
cp .env.example .env

pnpm dev                               # API on :4000, admin on :5173
```

`REPOSITORY=local` and `CONTENT_ROOT=../../examples/muster-consulting/content`
are the defaults, so the server edits the example project's content. There is
nothing to seed: the content is already there, in Git.

`MICA_MODE=local` is also the default, which **disables authentication** — you
are signed in as a developer account with no password and no identity provider.
Mica refuses to start that way in production or on any host but this one, and
says so at every start.

The server has no content model of its own. It reads one from the content
repository at `.mica/schema.json`, which the Astro project publishes and the
developer commits — identically in development and in production. If it is not
there, the server says so and exits.

Then open <http://localhost:5173/admin/> and sign in.

`pnpm dev` runs the API and the Vite dev server together. Vite proxies `/api` to
the API so the session cookie stays same-origin; the API still needs
`ADMIN_ORIGINS=http://localhost:5173` for its Origin check, which
`.env.example` already sets.

To run the production shape instead — one process serving both:

```bash
pnpm build && pnpm start               # everything on :4000
```

## Giving somebody access

Mica does not create people; an identity provider does. Access is a *membership*
saying that whoever holds an email address may edit a site.

An empty deployment has no members, so nobody can invite anyone — one shell
command breaks the circle:

```bash
pnpm grant-access -- --email a@b.ch --role admin
```

(`OIDC_BOOTSTRAP_ADMIN` does the same declaratively.) After that, administrators
add people on the **People** screen. There is nothing to send them: they sign in
with that address and they are in.

## Layout

```
src/
├── server/
│   ├── app.ts              route assembly and middleware order
│   ├── config.ts           environment parsing, validated at startup
│   ├── context.ts          composition root — everything is built here
│   ├── db/
│   │   ├── driver.ts       the only file that imports node:sqlite
│   │   └── migrations.ts   append-only, numbered, deterministic
│   ├── repositories/       the only files that write SQL — users, sessions,
│   │                       sites, memberships, oidc identities
│   ├── services/           oidc, sessions, media validation
│   ├── middleware/         auth, CSRF, rate limiting, errors, logging
│   ├── routes/             thin: parse, delegate, serialise
│   └── scripts/            grant-access
└── admin/
    ├── api.ts              typed client for the admin API
    ├── router.ts           routes and the auth guard
    ├── stores/             auth, schema, toasts (plain composables)
    ├── lib/markdoc.ts      ProseMirror JSON <-> Markdoc, at the boundary
    ├── components/fields/  one component per field kind + the registry
    └── views/              dashboard, collection, entry, singleton, media, users
```

Three rules keep this navigable: only `repositories/` writes SQL, only
`db/driver.ts` knows which SQLite library is in use, and nothing outside
`@micacms/connectors` knows how the repository is reached.

The content store is not here at all — it lives in `@micacms/connectors`, so
that the Astro build runs the same discovery and parsing code the server does.

## How the schema drives everything

The project's content model is the single source of truth. From the same
definition:

- the server derives Zod validators for storage and for API output;
- `GET /api/admin/schema` serves the model to the SPA, which generates its
  navigation, list columns and forms from it — the admin contains no knowledge
  of any particular collection;
- the same model decides the layout on disk: an entry with rich text or media
  is a directory, one without is a single `.json` file.

Adding a field therefore needs no change here and no SQL migration: entry
payloads are JSON validated against whatever the model currently says. Adding a
new *field kind* means a builder in the model package, an entry in `FIELD_KINDS`
(the compiler enforces this), and one line in
`src/admin/components/fields/registry.ts`.

The model reaches the server as plain data, read out of the repository by
`src/server/schema.ts` and re-validated there — so a model built against a
newer `@micacms/model` than the server is running fails at startup naming the
field, rather than at an editor's screen. Because the model is in the
repository, `src/server/index.ts` opens the database and builds the connector
*before* composing the application: there is no context to hold until the model
has been read.

## Authentication

There is none in this codebase, and that is the design. `services/oidc.ts` runs
the authorization code flow against a provider; `repositories/identities.ts`
maps the resulting subject to a user; `repositories/memberships.ts` decides what
that user may do here. Nothing hashes, resets or challenges anything.

`MICA_MODE=local` skips the provider entirely and signs every request in as one
developer account. The config layer refuses that mode in production and on any
host but localhost — see the P1 entry in [docs/decisions.md](../../docs/decisions.md).

## Saving

A save is a commit. There is no draft state and no publish button: unfinished
work stays in the editor's form and never reaches the server, and what does
reach the server is validated in full before it becomes a file.

Concurrency is handled with an opaque **revision** token. The editor is given
one when it opens an entry and sends it back with the save; if the file changed
in the meantime the server answers 409 and the editor is offered the current
version rather than being overwritten. A `null` revision asserts the entry does
not exist, which is what stops two people creating the same slug.

Rich text is Markdoc. The admin's Tiptap editor converts at the boundary — see
`src/admin/lib/markdoc.ts` — and never emits HTML, because a `.mdoc` file has to
be readable in a diff and safe to render into a static build.

## History

Git is the history. Every save is a commit with the editor's name as the author;
nothing prunes it, and no version of Mica has to be running to read it.

## API surface

| Method | Path | Auth |
| --- | --- | --- |
| `GET` | `/health` | none |
| `GET` | `/api/auth/config` | none |
| `GET` | `/api/auth/login` · `/callback` | none — starts and ends the OIDC flow |
| `POST` | `/api/auth/logout` | session |
| `GET` | `/api/auth/me` | session |
| `GET` | `/api/admin/schema` · `/overview` · `/system` | session |
| `GET/POST` | `/api/admin/collections/:collection/entries` | session |
| `GET/PUT/DELETE` | `/api/admin/collections/:collection/entries/:slug` | session |
| `GET` | `/api/admin/collections/:collection/entries/:slug/references` | session |
| `POST` | `/api/admin/collections/:collection/reorder` | session |
| `GET` | `/api/admin/collections/:collection/slug` | session |
| `GET/PUT` | `/api/admin/singletons/:name` | session |
| `GET/POST` | `/api/admin/media` | session |
| `GET` | `/api/admin/media/file/*` | session |
| `GET/POST/PATCH/DELETE` | `/api/admin/users[/:id]` | session + admin |

`/api/auth/login` and `/callback` are redirects, not JSON: the browser has to
*visit* the identity provider, which an XHR cannot do. A failed callback
redirects to the sign-in page with a readable reason rather than returning an
error envelope a browser would render as raw braces.

Every route is behind a session. There is no public content API and no public
media route: the website is built from the repository, so nothing outside this
session needs to read anything here.

Admin writes need a session cookie **and** a matching `X-CSRF-Token` header.

An entry is addressed by `collection/slug` — the path in the API is the path in
the repository.

## Security notes

- **No passwords.** Mica authenticates with OpenID Connect and stores no
  credential of any kind. There is no hash to leak, no reset flow to abuse and
  no MFA to bypass — the identity provider owns all of it.
- **Identities** are keyed by `(issuer, subject)`, never by email. A provider
  that lets someone change their address therefore cannot be used to take over
  an existing account.
- **Authorization** is a membership on a site, re-read on every request. Removing
  someone takes effect immediately rather than when their cookie expires.
- **Sessions** — 256-bit random token, HMAC-signed in the cookie, stored only as
  its SHA-256. Rotated at sign-in (session fixation), revoked when a membership
  is withdrawn. Idle and absolute expiry both apply.
- **The OIDC flow** uses PKCE, `state` and `nonce`, all verified. The
  transaction is carried in a short-lived signed cookie scoped to `/api/auth`,
  so a callback that Mica did not start is refused.
- **CSRF** — two independent layers: an Origin check on every write, plus a
  double-submit token bound to the session. The session cookie is
  `SameSite=Lax`.
- **Uploads** — the content type is derived from the bytes, never the browser's
  claim; the filename is slugified from what the editor uploaded, so a traversal
  or a double extension cannot reach the repository. The connector refuses any
  path that leaves the content root.
- **Rich text** — stored as Markdoc, never HTML. Markdoc escapes raw markup and
  renders an undeclared `{% tag %}` as nothing, so content committed to the
  repository cannot inject script into a build.
- **Repository tokens** — a provider connector reads and writes only below
  `REPOSITORY_ROOT`. A token with repository-wide write access still cannot be
  used through Mica to touch the website's source or its CI configuration.
- **Rate limiting** — a per-IP bucket on starting a sign-in, plus a coarse
  per-IP limit across the API. In-memory, so counters reset on restart.
  Credential guessing happens at the identity provider now, not here.
- **No public routes.** There is no content API and no public media route; the
  build reads the repository. Media is served to the editor at
  `/api/admin/media/file/*`, behind the session, and nothing else needs it.
- **`TRUST_PROXY`** must stay `false` unless a reverse proxy sets
  `X-Forwarded-For`, or clients can spoof their address and evade rate limiting.

## Backups

Your content repository is the backup, and Git is keeping it. This server's
SQLite file holds accounts and sessions; losing it signs everyone out and costs
nothing else.

See [self-hosting.md](../../docs/self-hosting.md#backups).

## Tests

```bash
pnpm test          # 103 tests: API, config, schema and the Markdoc bridge
pnpm typecheck     # server (tsc) and admin (vue-tsc)
```

The suite builds a complete application over an in-memory SQLite database and a
temporary content directory, then drives it through `app.request()` — no
network and no shared state between tests. Assertions are made on the files
that end up on disk, because the files are the product.
