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

### P1 — Editors commit straight to a branch, with no review step

**Decided:** a save is a commit onto `REPOSITORY_BRANCH`. Mica does not open a
pull request and has no concept of one.

**Why:** the editors this is built for are the site's owners. Making them wait
for their own approval would be theatre, and a review queue nobody empties is
worse than no review.

**Consequence:** a typo is live as soon as CI finishes. There is no gate.

**What would change it:** point Mica at a `staging` branch and merge on a human's
schedule — this already works and needs no code. A per-save pull request would
be a connector change: both providers can create a branch and a PR, and the
`RepositoryConnector` interface is where it would go.

**Trigger:** a customer with more than one editor who does not trust all of them,
or a compliance regime that requires four eyes.

---

### P1 — Local mode has no authentication at all

**Decided:** `MICA_MODE=local` signs every request in as one developer account,
with no identity provider and no credential.

**Why:** the alternative is asking a developer to stand up Keycloak before they
can run `pnpm dev`. Mica ships no passwords, so there is no third option that
does not mean writing the auth code the project exists to avoid.

**Consequence:** a Mica in local mode is an open administrator console. This is
the single most dangerous state the software has.

**What contains it:** the config layer refuses local mode when `NODE_ENV` is
production, and refuses it when `CMS_BASE_URL` is any host but localhost. The
server logs a warning at every start, and the sign-in screen says so on the
page. Four independent statements, because one is not enough for this.

**What would change it:** a small built-in OIDC provider for development, so the
local path exercises the production code. Considered and not taken — it is auth
code, which is what this was avoiding.

---

### P2 — Rate limiting is in-process and resets on restart

**Decided:** fixed-window counters in a `Map` (`lib/rate-limit.ts`).

**Why:** one process and no mandatory external services; Redis for a handful of
editors is not proportionate.

**Consequence:** counters reset on deploy, and the limit is per-process rather
than per-cluster.

It matters less than it did. There are no passwords to guess here: the limiter
now protects the *start* of a sign-in — one discovery request per attempt —
and credential stuffing has moved to the identity provider, which has its own
defences and is far better placed to run them.

**What would change it:** running more than one CMS replica — the current design
assumes exactly one.

**Trigger:** horizontal scaling.

---

### P2 — A provider connector reads the content tree on every commit

**Decided:** `commit()` fetches the whole content tree before writing, to check
`expect` and to expand `deleteTree`.

**Why:** it is one request, and it is the only way to know what a delete should
name without trusting a cached view of the repository.

**Consequence:** one extra round trip per save, and a hard ceiling: GitHub
truncates a tree listing at ~100k entries, which the connector detects and
refuses rather than silently under-deleting.

**What would change it:** a content repository large enough to notice. Caching
the tree keyed by the branch head would remove most of the cost.

**Trigger:** a save taking visibly long, or the truncation error appearing.

---

### P2 — No map widget in the admin

**Decided:** `coordinates` is two numeric inputs plus paste-parsing for
`47.3769, 8.5417` and an "open in OpenStreetMap" link.

**Why:** a slippy map needs a tile provider. Embedding one would make the admin
depend on a third-party endpoint at runtime. MapLibre belongs on the *frontend*,
which is where it lives.

**Consequence:** editors pick coordinates elsewhere and paste them.

**What would change it:** a customer who sets locations often enough for this to
chafe. MapLibre + their own tile key, behind an optional `MAP_STYLE_URL`.

**Trigger:** editor feedback, or a project with more than ~20 located entries.

---

### P2 — `node:sqlite` rather than `better-sqlite3`

**Decided:** the built-in driver, behind the `SqlDatabase` interface in
`db/driver.ts`.

**Why:** zero dependencies, no native build step, no prebuilt-binary mismatch
inside the container.

**Consequence:** tied to a reasonably current Node. The API is younger than
`better-sqlite3`'s.

**What would change it:** swapping the driver means one file — that is the whole
point of the interface.

**Trigger:** a driver bug, or a deployment target stuck on older Node.

---

### P3 — The editor cannot represent a Markdoc tag

**Decided:** `{% callout %}` and friends survive a round trip as their inner
text, not as a tag. The editor drops the wrapper.

**Why:** Tiptap has no node for an arbitrary tag, and inventing a generic one
would give editors a box they cannot meaningfully fill in.

**Consequence:** a developer who hand-writes a Markdoc tag in a `.mdoc` file
loses it the next time an editor opens that field. The words inside are kept —
losing those would be losing content.

**What would change it:** a Tiptap node per declared tag, generated from the
model the way fields already are. That is the right design; nothing needs it
yet.

**Trigger:** the first project that wants callouts or embeds inside rich text.

---

### P3 — Rich-text bundle is ~130 kB gzip

**Decided:** Tiptap/ProseMirror, plus Markdoc's parser for the conversion,
loaded in the chunk shared by the entry and settings editors.

**Why:** editing must not require knowledge of a markup language. A hand-rolled
`contenteditable` is a well-known trap.

**Consequence:** the editor route is the heaviest part of the admin. Sign-in and
the dashboard do not load it.

**What would change it:** nothing at this size. Revisit only if the admin has to
work on a slow mobile connection.

---

## Deferred scope

Explicitly not built; the seams they attach to exist and are tested.

- **P2** — Site management in the UI. The data model is there — tenants, sites,
  memberships and per-site repository connections — and every query is already
  keyed by site. What is missing is a screen, and a reason to build one.
- **P3** — Scheduled publishing.

## Known gaps to close

- **P2** — No end-to-end browser test of the admin. The API has good coverage
  and the Vue app typechecks, but no test drives a real browser through "sign
  in, edit, save". The one place a regression could reach production unseen.
- **P2** — The OIDC round trip is verified by hand, not by CI. `e2e/compose.yml`
  runs Mica against a real Keycloak and the whole flow has been walked through
  there; nothing re-runs it automatically, so a regression would not be caught
  until somebody tried.
- **P2** — The provider connectors are tested against a stub, not against a real
  repository. The request shapes are asserted; the providers' agreement with
  their own documentation is not. Worth one manual run against a scratch
  repository before a customer depends on it.
- **P3** — Entry search filters in the browser over the whole collection. Fine at
  the stated scale (hundreds to low thousands); a repository large enough to
  need an index is a repository large enough to need a different design.

---

## Settled

Questions that were once open, kept because the *answers* still constrain the
design. Anything that was simply built is in the code; these are the ones where
knowing the reasoning stops someone reintroducing the problem.

- **Media is not served by Mica.** Images are repository files and the build
  reads them directly. Do not add a public media route: the "unguessable, not
  access-controlled" trade-off it used to carry disappears only as long as the
  route does.
- **Publishing is not a webhook.** A push is the trigger. An in-process queue
  cannot survive a crash, and the repository's CI already solves this.
- **Rich text is Markdoc, never HTML.** The editor converts at the boundary and
  must never call Tiptap's `getHTML()` — see `apps/cms/src/admin/lib/markdoc.ts`.
- **Git is the history.** No revision table, no retention policy, nothing to
  prune.
- **Nothing hashes a password.** Reintroducing one would mean owning reset, MFA,
  passkeys and breach response, which is the whole reason it is not here.
