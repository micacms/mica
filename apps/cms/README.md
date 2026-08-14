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
pnpm create-user                       # in a second terminal
```

`REPOSITORY=local` and `CONTENT_ROOT=../../content` are the defaults, so the
server edits the `content/` directory in this repository. There is nothing to
seed: the content is already there, in Git.

The server has no content model of its own; it loads one at startup. In
development that is `mica.config.ts` in the repository root, read directly by
`tsx`. In production `MICA_SCHEMA` names a compiled model — see
[deployment](../../docs/deployment.md).

Then open <http://localhost:5173/admin/> and sign in.

`pnpm dev` runs the API and the Vite dev server together. Vite proxies `/api` to
the API so the session cookie stays same-origin; the API still needs
`ADMIN_ORIGINS=http://localhost:5173` for its Origin check, which
`.env.example` already sets.

To run the production shape instead — one process serving both:

```bash
pnpm build && pnpm start               # everything on :4000
```

## Creating accounts

There is no public registration and no password-reset email. The first account
is created from the command line; after that, administrators manage accounts in
the UI.

```bash
pnpm create-user                                   # prompts
pnpm create-user -- --email a@b.ch --role admin    # non-interactive
```

The first account created is always an administrator.

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
│   ├── repositories/       the only files that write SQL (users, sessions)
│   ├── services/           media validation and sessions
│   ├── middleware/         auth, CSRF, rate limiting, errors, logging
│   ├── routes/             thin: parse, delegate, serialise
│   └── scripts/            create-user, build-schema, export-content
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

Note what is *not* here any more: no `services/content.ts`, no `publisher.ts`,
no entry, revision or media repositories. The content store moved to
`@micacms/connectors`, where the Astro build can use the same code.

## How the schema drives everything

The project's `mica.config.ts` is the single source of truth. From the same
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

The model reaches the server as plain data — `src/server/schema.ts` loads and
re-validates it, so a model built against a newer `@micacms/model` than the
server is running fails at startup naming the field, rather than at an editor's
screen.

## Saving, and what replaced publishing

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

There is none here. Git is the history: every save is a commit, with the
editor's name as the author. Nothing prunes it, and no version of Mica has to be
running to read it.

## API surface

| Method | Path | Auth |
| --- | --- | --- |
| `GET` | `/health` | none |
| `POST` | `/api/auth/login` · `/logout` · `/password` | session |
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

Every route is behind a session. There is no public content API and no public
media route: the website is built from the repository, so nothing outside this
session needs to read anything here.

Admin writes need a session cookie **and** a matching `X-CSRF-Token` header.

An entry is addressed by `collection/slug` — the path in the API is the path in
the repository.

## Security notes

- **Passwords** — scrypt (N=32768, r=8, p=1) via Node's OpenSSL binding, random
  per-password salt, constant-time comparison. Parameters are stored with the
  hash and upgraded transparently on next sign-in.
- **Sessions** — 256-bit random token, HMAC-signed in the cookie, stored only as
  its SHA-256. Rotated at sign-in (session fixation), revoked on password
  change. Idle and absolute expiry both apply.
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
- **Rate limiting** — per-IP and per-account buckets on sign-in, plus a coarse
  per-IP limit across the API. In-memory, so counters reset on restart; scrypt's
  cost is the backstop.
- **No public routes.** There is no content API and no public media route; the
  build reads the repository. Media is served to the editor at
  `/api/admin/media/file/*`, behind the session, and nothing else needs it.
- **`TRUST_PROXY`** must stay `false` unless a reverse proxy sets
  `X-Forwarded-For`, or clients can spoof their address and evade rate limiting.

## Backups

Your content repository is the backup, and Git is keeping it. This server's
SQLite file holds accounts and sessions; losing it signs everyone out and costs
nothing else.

See [backup-and-restore.md](../../docs/backup-and-restore.md).

## Tests

```bash
pnpm test          # 91 tests: API, config, and the Markdoc bridge
pnpm typecheck     # server (tsc) and admin (vue-tsc)
```

The suite builds a complete application over an in-memory SQLite database and a
temporary content directory, then drives it through `app.request()` — no
network and no shared state between tests. Assertions are made on the files
that end up on disk, because the files are the product.
