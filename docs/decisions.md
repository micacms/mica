# Decisions

Open decisions, accepted trade-offs and deferred work.

Every entry records **what was decided**, **why**, and **what would change it** —
so a future reader can tell a deliberate trade-off from an oversight.

Priorities:

| | |
| --- | --- |
| **P1** | Resolve before the first real customer goes live |
| **P2** | Resolve before the second customer, or when the trigger fires |
| **P3** | Revisit when there is a concrete reason; fine as-is otherwise |

An entry marked **v3 — pending** is decided and not yet built. It constrains new
work from now on, and the code still shows the old shape. The phase that closes
it is named in the entry; the phases are in [`v3-plan.md`](v3-plan.md). A note
marked **built in Phase A** records what the code now does, and what the entry
therefore costs in practice.

---

## Accepted trade-offs

### P1 — Publishing commits straight to a branch, with no review step

**Decided:** Mica does not open a pull request and has no concept of one. The
branch an editor publishes to is the branch CI builds.

**Why:** the editors this is built for are the site's owners. Making them wait
for their own approval would be theatre, and a review queue nobody empties is
worse than no review.

**Consequence:** a typo is live as soon as CI finishes. There is no gate.

**What would change it:** point Mica at a `staging` branch and merge on a human's
schedule — this already works and needs no code. A pull request per publication
would be a connector change: both providers can create a branch and a PR, and the
`RepositoryConnector` interface is where it would go.

**Trigger:** a customer with more than one editor who does not trust all of them,
or a compliance regime that requires four eyes.

**Built in Phase B.** A save is no longer that commit: it lands in the draft
workspace — the working tree locally, SQLite behind a provider connector — and
an explicit Publish writes the accumulated set as one commit. What did not
change is the sentence above: publishing writes to the branch, and nothing
reviews it.

---

### P1 — Local mode has no authentication, and no user either

**Decided:** the local editor has no identity provider, no credential, and no
user. Not a signed-in developer — *nobody*. There is no login screen, no name,
no avatar, no account menu, no sign-out, and no empty space reserved for one.
Authorization is a policy that allows every editor action, which is not the same
thing as a person.

**Why:** the alternative is asking a developer to stand up Keycloak before they
can run `rush dev`. Mica ships no passwords, so there is no third option that
does not mean writing the auth code the project exists to avoid.

**Consequence:** a local Mica is an open editor. This is the single most
dangerous state the software has.

**What contains it:** the local editor binds to loopback and refuses to start on
any other address. There is no override flag, and there will not be one —
reaching Mica from another machine is what the self-hosted distribution is for.
The local package also carries no OIDC dependency, so there is no auth code to
misconfigure.

**What would change it:** a small built-in OIDC provider for development, so the
local path exercises the production code. Considered and not taken — it is auth
code, which is what this was avoiding.

**Built in Phase A.** The `developer@localhost` row and its membership are gone
with the tables that held them, and so are the account and People screens. What
local mode kept at that point was a session carrying the CSRF token — no
identity, no name, and no chrome to draw one with; `startLocalSession` was the
whole of it, until Phase C removed the session entirely (below).

The loopback rule is now enforced rather than promised: local mode defaults
`HOST` to `127.0.0.1` and refuses any other address, alongside the existing
refusals on `NODE_ENV=production` and a non-local `MICA_PUBLIC_URL`.

**Built in Phase C.** The mode is now which app you run. `apps/local-editor`
(published as `@micacms/editor`) composes the runtime with `allowAll()` and
the local connector; its dependency graph has no path to `openid-client`,
`jose` or `@micacms/auth-oidc`, and `test/boundary.test.ts` walks the graph,
greps the built UI bundle and exercises the running composition to keep every
sentence above true.

The local session, its CSRF token and the database went together, as planned.
The token was never the defence: the Origin check refuses a cross-origin write
with no cookie involved. What the cookie *was* quietly also doing — blocking a
DNS-rebinding read, because a rebound name never received a cookie scoped to
`localhost` — is now a **Host allowlist**: the local app answers to
`localhost`, `127.0.0.1` and `[::1]` and refuses any other `Host`, in front of
everything including `/health`.

**Accepted with it:** a request without a cookie stops being a 401, so any
process on the developer's own machine can call the local API. A process on
that machine can already edit the working tree directly, which is where the
content is.

---

### P1 — Access removed at the provider is revoked at the next sign-in

**Decided:** who may edit a self-hosted site is decided by configuration, not by
a table. Either a rule over provider claims (`MICA_ADMIT_GROUP`,
`MICA_ADMIT_DOMAIN`) or an explicit list keyed by `(issuer, subject)`
(`MICA_ADMIT_SUBJECTS`). The server refuses to start outside local mode when
neither is set: an OIDC deployment that admits everybody its issuer knows is a
misconfiguration, not a default.

**Why:** the alternative is a `users`/`memberships` schema, the screens to
administer it, and an invitation lifecycle — an identity product inside a CMS,
duplicating what the operator's identity provider already does properly. With a
claim rule, adding an editor is a group change in the IdP and Mica is not
touched.

**Consequence:** revocation splits in two, and only half of it is immediate.
Changing the *rules* takes effect at once, because they are re-read on every
request. Removing somebody from a *group at the provider* does not: Mica checks
the claims the provider sent at sign-in, and learns better only at the next one.
Until then they can still publish.

**What contains it:** session lifetimes measured in hours, not weeks — the
defaults are 8 hours absolute and 4 idle; the rules re-checked on every request
against the claims stored on the session row; and `MICA_ADMIT_SUBJECTS` as the
instant answer for a departure that cannot wait.

**What would change it:** re-checking admission against the provider on every
request, which is a network call per request, or bringing back a local table of
admitted subjects that an operator can empty instantly.

**Trigger:** a customer who must cut somebody's access within seconds — a
dismissal, or a compromised account.

**Built in Phase A.**
[`admission.ts`](../packages/auth/oidc/src/admission.ts) holds the rules;
`requireAccess` in [`gate.ts`](../packages/auth/oidc/src/gate.ts) applies them
per request (both live in `@micacms/auth-oidc` since Phase C). The membership row it replaced was immediate for both
halves, and that is the behaviour this entry gives up.

Two details the implementation had to settle. The domain rule requires the
provider's `email_verified`, because an open self-registration would otherwise
let anybody claim an admitted domain. And the group claim has no standard name,
so `MICA_OIDC_GROUPS_CLAIM` names it — a Keycloak path and a bare name are both
accepted, since an operator writes the name their own console shows them.

---

### P2 — One shared pending change set per site

**Decided:** a site has one draft workspace, not one per editor. Two people
editing the same site accumulate changes into the same pending set, and either
of them can publish all of it.

**Why:** per-user drafts need merge rules between them, a way to see somebody
else's unfinished work, and an answer to "who publishes whose changes". For the
target deployment — one small organisation, a handful of editors, usually one at
a time — that machinery costs more than the problem.

**Consequence:** an editor can publish a colleague's half-finished entry without
meaning to. The Recent changes view is the containment: it lists everything in
the pending set before Publish is pressed, so the publication is at least
visible rather than silent.

**What would change it:** a change set per editor, with the publish gate moving
to a merge. That is the design if it becomes necessary; it is not the first one.

**Trigger:** two editors working the same site at the same time often enough to
collide, or a customer who asks who published what.

**Built in Phase B.** One draft workspace per site, either shape. Within it,
concurrent sessions still check per-document revisions against the *draft*, so
one browser cannot silently overwrite a colleague's newer autosave; publishing
takes the whole set, whoever presses the button.

---

### P2 — Local publishing spawns the `git` binary

**Decided:** the local editor commits and pushes by running `git`, not by
linking a JavaScript Git implementation. On by default;
`MICA_LOCAL_PUBLISH=false` reduces local mode to autosave plus a read-only view
of the changes.

**Why:** credentials. A developer's push already works because of their SSH
agent, credential helper and remote configuration. The binary inherits all
three. A library would have to reimplement them, and would do it worse — which
is the reason [`local.ts`](../packages/connectors/src/local.ts) refuses to be a
Git client in the first place.

**Consequence:** `git` must be on the path, and Mica now meets Git's failure
modes — no upstream, a diverged branch, a rejected push. A commit and a push are
not one operation, so `committed-pending-push` is a state the editor must show
and a retry must resume rather than repeat.

**What contains it:** Mica stages an explicit path set from the change model and
never runs `git add -A`, so a developer's unrelated work in the same checkout is
never swept into an editor's commit.

**What would change it:** nothing foreseen. Self-hosted mode does not use this
path at all — it publishes through the provider API.

**Built in Phase B.** `lib/git.ts` spawns the binary with
`GIT_TERMINAL_PROMPT=0`, and `services/staging-local.ts` holds the rules: the
pathspec limits both `git add` and `git commit`, so a developer's unrelated
work — staged or not — never enters an editor's commit; HEAD is verified
against the base the editor reviewed; a failed push returns
`committed-pending-push` and a retry pushes rather than committing again. One
choice the plan left open is now fixed: which workspace a deployment stages in
follows the *connector* (`REPOSITORY`), not `MICA_MODE` — a self-hosted
deployment with a checkout beside it stages in that checkout, because shadowing
a working tree with a draft store would show editors a tree that lies.

---

### P2 — The content model is read once, at startup

**Decided:** Mica reads `.mica/schema.json` out of the content repository when
the process starts, and holds it for the life of the process. Changing the
model means restarting.

**Why:** the alternative is re-reading it per request, which is a provider API
call on every page of the admin, or a cache with an invalidation rule — and the
model changes a handful of times in a project's life, always by a developer who
is already deploying something.

**Consequence:** a developer who pushes a model change and forgets to restart
sees the old forms, with no indication why. The startup log prints the model's
fingerprint, which is how two deployments serving different models are told
apart.

**What would change it:** re-reading when the manifest's `revision` changes,
checked at most once per interval. The connector already answers `revision(path)`
cheaply, so this is small — it just has no reason to exist yet.

**Trigger:** a project where a non-developer changes the model, or a deployment
that cannot be restarted casually.

**Decided and built in Phase B.** A pending change set gave this a second
edge: if the repository gains a model change while a draft is waiting, staged
content was validated against a model that no longer holds. The answer is the
expected one — **refuse, name the drift, require a restart**. The manifest's
revision is recorded at startup; both staging implementations compare it
immediately before publishing and answer 409 with a message that names the
restart. Nothing is discarded: the draft survives, and after the restart it is
re-validated against the new model like any other pending set.

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

**Built in Phase B.** The cost mostly disappeared. A commit stopped being the
unit of saving and became the unit of publishing, so the extra round trip is
paid once per publication instead of once per edit. The ceiling is unchanged.
A save still costs one provider read per newly staged path — the revision the
publish gate will expect — which is far cheaper than the commit it replaced.

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

**Built in Phase A, half of it.** `users`, `oidc_identities`, `memberships`,
`sites`, `tenants` and `repository_connections` are gone; `sessions` is the only
table left, and it carries the claims admission is checked against. The
migration chain was reset to a single `initial_schema` rather than extended,
because a fifth migration would have been three quarters `DROP TABLE` and no
deployment existed to carry forward. Append-only applies again from here, and a
database that predates the reset is refused with a message saying that deleting
it costs only sign-ins.

**Built in Phase B.** SQLite has its new job: the self-hosted draft store —
`drafts` and `draft_base`, migration 2 — holding work that is saved and not
yet published. That inverted one of the oldest sentences in this project.
Losing the database used to cost three editors their login and nothing else;
it now also costs unpublished work, which Git is not protecting yet. The
self-hosted backup guidance says so. One deviation from the `v3-arch.md`
§10.4 sketch: media bytes live in the same database rather than a directory
beside it, because a second location would make staging a two-phase write and
the backup a two-file promise — uploads are capped and content trees are
small, so the rows stay within what SQLite is comfortable holding.

---

### P3 — A generated file is committed to the content repository

**Decided:** `content/.mica/schema.json` is build output, and it is committed.

**Why:** it is the only channel between the project and Mica. Mounting a
compiled artifact into the container or fetching one over HTTP from the
deployed website both add a second path with its own way of falling out of step;
sending the model the way content already travels means there is one path, and
a model change is reviewable in the same diff as the content it affects.

**Consequence:** a stale commit of that file is possible — someone changes a
collection, does not rebuild, and pushes. CI guards it with
`git diff --exit-code` on the published model, which is the check every project
using Mica should copy.

**What would change it:** nothing foreseen. If Mica ever grew a hosted control
plane, a `mica push` sending the same bytes over HTTP would be the alternative,
and the file format is already that payload.

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

Explicitly not built.

- **Multi-site, tenants, memberships and roles.** One Mica process manages one
  site. Running several sites means running several instances, which is a
  product boundary and not a feature limit. The tables that once anticipated
  this are deleted in Phase A rather than kept as an unused schema; the
  capability belongs to the private Cloud control plane described in
  [`v3-arch.md`](v3-arch.md) §14, which consumes published Mica releases and
  never enters this repository.
- **P2** — A per-editor draft instead of one shared change set. "One shared
  pending change set per site" above records what that costs today.
- **P3** — Approval workflows, named releases, and more than one pending change
  set at a time.
- **P3** — Scheduled publishing.

## Known gaps to close

- **P2** — No end-to-end browser test of the admin. The API has good coverage
  and the Vue app typechecks, but no test drives a real browser through "sign
  in, edit, publish". The one place a regression could reach production unseen.
- **P2** — The OIDC round trip is verified by hand, not by CI. `tests/e2e/compose.yml`
  runs Mica against a real Keycloak with a real group claim, and
  `deploy/demo-identity/compose.yml` against a real ZITADEL with a subject list. Nothing re-runs
  them automatically, so a regression would not be caught until somebody tried.
  This stops being optional: once local mode carries no auth code at all, the
  OIDC path has no second user exercising it by accident — and admission now
  depends on a claim whose name and shape differ per provider, which is exactly
  the kind of thing a unit test cannot check.
- **P2** — Nothing yet proves the local package boundary. The rule that
  `@micacms/editor` installs no OIDC dependency and bundles no auth code is only
  a rule until CI checks the resolved dependency graph and the built bundle.
  Phase C adds those checks; without them the boundary will erode the first time
  somebody shares a helper between the two apps.
- **P2** — The provider connectors are tested against a stub, not against a real
  repository. The request shapes are asserted; the providers' agreement with
  their own documentation is not. `deploy/demo-identity/compose.yml` is the manual run —
  point it at a scratch repository on github.com or gitlab.com — but nothing
  automates it. `REPOSITORY_API_BASE` against GitHub Enterprise Server or a
  self-managed GitLab has had neither.
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

  Staging needed one narrow exception, and it is not that route. An image that
  is uploaded and not yet published is not in the repository, so the editor
  cannot show it from there. Phase B built it without a new route at all: the
  existing **authenticated** admin media route reads through the staged
  overlay, so pending uploads are served from the draft store behind the same
  session as everything else, and nothing is reachable signed-out. If media
  bytes are ever served without a session, the public media route this
  decision forbids has come back.
- **Publishing is not a webhook.** A push is the trigger. An in-process queue
  cannot survive a crash, and the repository's CI already solves this. Autosave
  is not a trigger either: the successful remote branch update is, which is the
  point of separating the two.
- **Rich text is Markdoc, never HTML.** The editor converts at the boundary and
  must never call Tiptap's `getHTML()` — see `packages/editor-ui/src/lib/markdoc.ts`.
- **Git is the history.** No revision table, no retention policy, nothing to
  prune. The draft store is not a second history and must never become one: it
  holds exactly the current pending change set, and a successful publication
  clears what it published.
- **Nothing hashes a password.** Reintroducing one would mean owning reset, MFA,
  passkeys and breach response, which is the whole reason it is not here.
