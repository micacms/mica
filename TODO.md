# TODO

Open decisions, accepted trade-offs and deferred work.

Every entry records **what was decided**, **why**, and **what would change it** —
so a future reader can tell a deliberate trade-off from an oversight.

Priorities:

| | |
| --- | --- |
| **P1** | Resolve before the first real customer goes live |
| **P2** | Resolve before the second customer, or when the trigger fires |
| **P3** | Revisit when there is a concrete reason; fine as-is otherwise |

---

## Accepted trade-offs

### P1 — `/media/*` is publicly readable

**Decided:** media files are served without authentication. Keys are
26-character ULIDs, so an unpublished asset is *unguessable* rather than
*access-controlled*.

**Why:** these URLs end up in the static build, and the image pipeline that
fetches them during `astro build` cannot present a bearer token.

**Consequence:** anything in the media library is effectively public once its
URL is known. Do not store confidential documents there.

**What would change it:** if a customer needs private assets, either
(a) sign media URLs with a short-lived HMAC the build can mint, or
(b) have the loader download bytes at build time and emit them into the static
output, so the CMS origin is never referenced.

**Trigger:** first customer wanting gated PDFs or pre-release content.

> Documented in `apps/cms/README.md` under Security notes.

---

### P1 — Build webhook queue is in memory

**Decided:** publish events are coalesced in memory and delivered with three
retries; `ctx.shutdown()` flushes them.

**Why:** avoids a job table and a worker for what is normally one HTTP POST.

**Consequence:** a hard crash (SIGKILL, OOM, host loss) between an editor
clicking Publish and the webhook landing loses the rebuild trigger. Content is
safe — it is committed to SQLite first — but the live site stays stale until the
next publish or a manual "Rebuild website".

**What would change it:** a `publish_queue` table drained by a loop on startup.
Perhaps 60 lines.

**Trigger:** first report of "I published but the site didn't update", or any
customer without a person who would notice.

---

### P2 — Rate limiting is in-process and resets on restart

**Decided:** fixed-window counters in a `Map` (`lib/rate-limit.ts`).

**Why:** §2.1 asks for one process and no mandatory external services; Redis for
a handful of editors is not proportionate.

**Consequence:** counters reset on deploy, and the limit is per-process rather
than per-cluster. scrypt's ~100 ms cost per attempt is the real backstop.

**What would change it:** running more than one CMS replica — the current design
assumes exactly one.

**Trigger:** horizontal scaling, or evidence of a distributed credential-stuffing
attempt in the logs.

---

### P2 — No map widget in the admin

**Decided:** `coordinates` is two numeric inputs plus paste-parsing for
`47.3769, 8.5417` and an "open in OpenStreetMap" link.

**Why:** a slippy map needs a tile provider. Embedding one would make the admin
depend on a third-party endpoint at runtime, against §2.1. TRD §19 puts MapLibre
on the *frontend*, which is where it now lives.

**Consequence:** editors pick coordinates elsewhere and paste them.

**What would change it:** a customer who sets locations often enough for this to
chafe. MapLibre + their own tile key, behind an optional `MAP_STYLE_URL`.

**Trigger:** editor feedback, or a project with more than ~20 located entries.

---

### P2 — `node:sqlite` rather than `better-sqlite3`

**Decided:** the built-in driver, behind the `SqlDatabase` interface in
`db/driver.ts`.

**Why:** zero dependencies, no native build step, no prebuilt-binary mismatch
inside the container. Node 24 ships SQLite 3.53 with JSON1 and WAL.

**Consequence:** tied to a reasonably current Node. The API is younger than
`better-sqlite3`'s.

**What would change it:** swapping the driver means one file — that is the whole
point of the interface. `better-sqlite3` is the drop-in if the built-in one
disappoints.

**Trigger:** a driver bug, or a deployment target stuck on older Node.

---

### P3 — scrypt rather than Argon2id

**Decided:** scrypt (N=32768, r=8, p=1) via Node's OpenSSL binding.

**Why:** the only memory-hard KDF available without a native dependency. Cost
parameters are stored with each hash and upgraded transparently at next sign-in,
so this is not a one-way door.

**Consequence:** Argon2id is the stronger modern choice; scrypt is proven and
entirely adequate at this scale.

**What would change it:** a customer with a compliance regime that names
Argon2id. `services/password.ts` already parses a `$`-delimited algorithm
prefix, so both can coexist during migration.

---

### P3 — Drafts validate leniently, publishing validates strictly

**Decided:** `required` is not enforced on a draft save; types, ranges and
formats always are. Publishing re-validates in full.

**Why:** an editor must be able to save half-finished work and come back
tomorrow. Losing a paragraph to a validation error is worse than a temporarily
incomplete draft.

**Consequence:** a draft can exist that cannot be published as-is. The publish
error names every field, and the editor is scrolled to the first one.

**What would change it:** nothing expected — but if a customer wants drafts to
be publishable at all times, flip `enforceRequired` in
`services/content.ts::validate`.

---

### P3 — Revisions capped at 30 per entry

**Decided:** `REVISIONS_KEPT = 30` in `services/content.ts`, oldest pruned.

**Why:** bounds database growth for an entry edited daily for years. §8 asks for
recoverable previous versions, not an audit log.

**What would change it:** a customer with a retention obligation. The constant is
the only change; make it configurable rather than unbounded.

---

### P3 — Rich-text bundle is ~130 kB gzip

**Decided:** Tiptap/ProseMirror, loaded in the chunk shared by the entry and
settings editors.

**Why:** §10 requires editing without knowledge of HTML or Markdown. A
hand-rolled `contenteditable` is a well-known trap.

**Consequence:** the editor route is the heaviest part of the admin. Sign-in and
the dashboard do not load it.

**What would change it:** nothing at this size. Revisit only if the admin has to
work on a slow mobile connection.

---

### P2 — SVG media stays hosted on the CMS

**Decided:** `toStaticUrl` runs raster images through Astro's image service so
the built site embeds a local copy. SVG and dimensionless files cannot go
through it and keep their CMS URL.

**Why:** the image service re-encodes rasters; there is nothing for it to do to
a vector, and no built-in way to copy one into the output.

**Consequence:** a customer who uses an SVG logo gets a `<link rel="icon">` (and
possibly an `og:image`) pointing at the CMS. The page still renders if the CMS
is down — only the favicon is missing — but the independence claim has an
asterisk.

**What would change it:** a small Astro integration that copies non-raster media
into `dist/_assets/` and rewrites the URL. Perhaps 40 lines.

**Trigger:** the first customer whose logo is an SVG. Until then, uploading a
PNG logo sidesteps it entirely.

---

## Deferred scope

Explicitly not built; the seams they attach to exist and are tested.

- **P3** — PostgreSQL support (TRD §6.1 explicitly defers it)
- **P3** — Scheduled publishing (TRD §7 puts it out of V1 scope)

## Known gaps to close

- **P2** — No end-to-end browser test of the admin. The API has 41 tests and the
  Vue app typechecks, but no test drives a real browser through "sign in, edit,
  publish". The one place a regression could reach production unseen.
- **P3** — `entries.list` search is a `LIKE` over the JSON payload. Fine at the
  stated scale (hundreds to low thousands); revisit with SQLite FTS5 if a
  customer's collection grows past that.
- **P3** — The `backup` compose profile sleeps 24 h in a loop rather than using
  a real scheduler, so its timing drifts across restarts. Host cron is the
  better answer for anyone who cares when the backup runs.

---

## Done

Kept for the record — these were open questions that are now settled.

- ~~Docker image and `docker-compose.yml`~~ — built and verified: image boots,
  healthcheck passes, `create-user` and `backup` run inside the container,
  SIGTERM shuts down gracefully in under a second.
- ~~Deployment, backup and restore documentation~~ — `docs/deployment.md`,
  `docs/backup-and-restore.md`, `docs/webhook-receiver.md`.
- ~~Root README~~ — written.
- ~~`og:image` and favicon pointed at the CMS~~ — caught by the full-chain test;
  raster media now goes through the image pipeline (see the SVG caveat above).
- ~~Astro collection data typed as `any`~~ — the loader's schema now carries the
  model-derived type, so renaming a field breaks the website build.
