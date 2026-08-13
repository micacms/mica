# Mica CMS

The CMS application: a Hono API and the Vue administration SPA it serves, backed
by one SQLite file and one media directory.

```
cms.example.com
       │
       ▼
      Hono
  ┌────┼──────────┬─────────┐
  │    │          │         │
/api/* /media/*  /admin/*  /health
  │    │          │
SQLite files    Vue SPA
```

## Running it locally

```bash
pnpm install
pnpm --filter @micacms/model build     # the field types the server validates with

cd apps/cms
cp .env.example .env

pnpm seed                              # demo content + a demo account
pnpm dev                               # API on :4000, admin on :5173
```

The server has no content model of its own; it loads one at startup. In
development that is `mica.config.ts` in the repository root, read directly by
`tsx`. In production `MICA_SCHEMA` names a compiled model — see
[deployment](../../docs/deployment.md).

Then open <http://localhost:5173/admin/> and sign in as
`demo@example.com` / `mica-demo-password`.

`pnpm dev` runs the API and the Vite dev server together. Vite proxies `/api`
and `/media` to the API so the session cookie stays same-origin; the API still
needs `ADMIN_ORIGINS=http://localhost:5173` for its Origin check, which
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
│   ├── repositories/       the only files that write SQL
│   ├── services/           business rules: content, media, sessions, publishing
│   ├── middleware/         auth, CSRF, rate limiting, errors, logging
│   ├── routes/             thin: parse, delegate, serialise
│   └── scripts/            create-user, seed, backup
└── admin/
    ├── api.ts              typed client for the admin API
    ├── router.ts           routes and the auth guard
    ├── stores/             auth, schema, toasts (plain composables)
    ├── components/fields/  one component per field kind + the registry
    └── views/              dashboard, collection, entry, global, media, users
```

Two rules keep this navigable: only `repositories/` writes SQL, and only
`db/driver.ts` knows which SQLite library is in use.

## How the schema drives everything

The project's `mica.config.ts` is the single source of truth. From the same
definition:

- the server derives Zod validators for storage and for API output;
- `GET /api/admin/schema` serves the model to the SPA, which generates its
  navigation, list columns and forms from it — the admin contains no knowledge
  of any particular collection;
- the public API validates content on the way out.

Adding a field therefore needs no change here and no SQL migration: entry
payloads are JSON validated against whatever the model currently says. Adding a
new *field kind* means a builder in the model package, an entry in `FIELD_KINDS`
(the compiler enforces this), and one line in
`src/admin/components/fields/registry.ts`.

The model reaches the server as plain data — `src/server/schema.ts` loads and
re-validates it, so a model built against a newer `@micacms/model` than the
server is running fails at startup naming the field, rather than at an editor's
screen.

## Drafts and publishing

Draft saves are validated leniently — types and ranges apply, `required` does
not — so an editor can save unfinished work and come back to it. Publishing
re-validates strictly. Only published entries are visible through the public
content API.

Publishing emits a signed webhook and stops there; the CMS never learns where
the website is hosted. Deliveries are coalesced over `PUBLISH_DEBOUNCE_MS` so a
burst of edits triggers one build.

## Revisions

Every modification snapshots the *previous* payload first, so the newest
revision is the version before the current one. Restoring writes an older
snapshot — and snapshots the current state first, so a restore is itself
reversible. The 30 most recent revisions per entry are kept.

## API surface

| Method | Path | Auth |
| --- | --- | --- |
| `GET` | `/health` | none |
| `GET` | `/media/:key` | none — see below |
| `POST` | `/api/auth/login` · `/logout` · `/password` | session |
| `GET` | `/api/auth/me` | session |
| `GET` | `/api/admin/schema` · `/overview` | session |
| `POST` | `/api/admin/publish` | session |
| `GET/POST` | `/api/admin/collections/:collection/entries` | session |
| `GET/PUT/DELETE` | `/api/admin/entries/:id` | session |
| `POST` | `/api/admin/entries/:id/status` | session |
| `GET/POST` | `/api/admin/entries/:id/revisions[/:id/restore]` | session |
| `GET/PUT` | `/api/admin/globals/:name` | session |
| `GET/POST/PATCH/DELETE` | `/api/admin/media[/:id]` | session |
| `GET/POST/PATCH/DELETE` | `/api/admin/users[/:id]` | session + admin |
| `GET` | `/api/content/:collection[/:slug]` | read token |
| `GET` | `/api/globals/:name` | read token |
| `GET` | `/api/manifest` · `/api/version` | read token |

Admin writes need a session cookie **and** a matching `X-CSRF-Token` header.
The public read endpoints take `Authorization: Bearer $CMS_READ_TOKEN`.

`/api/manifest` returns every collection and global in one response — a build
would otherwise make one request per collection.

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
  claim; the stored filename is regenerated from the detected type, so a
  traversal or a double extension cannot reach the filesystem. SVG is served
  under a sandbox CSP.
- **Rate limiting** — per-IP and per-account buckets on sign-in, plus a coarse
  per-IP limit across the API. In-memory, so counters reset on restart; scrypt's
  cost is the backstop.
- **`/media/*` is public.** These URLs end up in the static build and the image
  pipeline that fetches them during `astro build` cannot present a token. Keys
  are 26-character ULIDs, so an unpublished asset is unguessable rather than
  access-controlled. Do not put confidential documents in the media library.
- **`TRUST_PROXY`** must stay `false` unless a reverse proxy sets
  `X-Forwarded-For`, or clients can spoof their address and evade rate limiting.

## Backups

A complete backup is the SQLite file plus the media directory — nothing else.

```bash
pnpm backup -- --out /backups
```

Uses `VACUUM INTO`, which takes a read lock only, so it is safe to run from cron
against a live server and does not produce the torn file a plain `cp` of a
WAL-mode database can. To restore, stop the CMS, put `cms.sqlite` and `media/`
back in `DATA_DIR`, and start it again.

## Tests

```bash
pnpm test          # 41 API tests against an in-memory database
pnpm typecheck     # server (tsc) and admin (vue-tsc)
```

The suite builds a complete application over an in-memory SQLite database,
in-memory media storage and a recording publisher, then drives it through
`app.request()` — no network, no filesystem, no shared state between tests.
