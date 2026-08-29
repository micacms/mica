# Mica v3 — Refactoring Plan

Status: accepted; execution guide for [`v3-arch.md`](v3-arch.md)  
Last updated: 19 August 2026

## 1. Purpose

[`v3-arch.md`](v3-arch.md) states the target architecture. This document states
how to reach it from the code that exists today, in which order, and which of
its proposals were changed after review.

Read the architecture document for *what* Mica becomes. Read this one for *what
to do on Monday*.

---

## 2. Decisions taken after review

The architecture document was evaluated against the current code. Eight of its
proposals were changed. Each change is recorded here with the evidence that
caused it, so a future reader can tell a considered deviation from a mistake.

| Topic | `v3-arch.md` | Decided |
| --- | --- | --- |
| Connector packages | three packages | one package; port moves to `core` |
| Publish conflict gate | site-wide `baseRevision` | per-path expectations |
| Local publish | commit and push | commit and push, opt-out |
| Admission | unspecified | claim rule plus explicit list |
| User storage | "no user database" | one table: `sessions` |
| `sites/micacms` | move to `examples/` | stays in `sites/` |
| Release tooling | Rush | Changesets |
| Phase order | layers first | scope, then value, then layers |

Published packages: **eight**, not ten. Collapsing three connector packages into one
is the only reduction.

### 2.1 The connector split is not taken

`v3-arch.md` §11 splits connectors into three packages so that
`npx @micacms/editor` does not download provider code.

[`packages/connectors/package.json`](../packages/connectors/package.json) has
one dependency: `@micacms/model`. The GitHub and GitLab connectors use plain
`fetch` through [`http.ts`](../packages/connectors/src/http.ts). There are no
provider SDKs. The split therefore saves about 600 lines of dependency-free
TypeScript, and costs three manifests, three build configurations and three
release entries.

`v3-arch.md` §17 forbids "a package split without a distribution, dependency,
or responsibility boundary". This split has none of the three.

Split when a connector gains a real dependency. Not before.

The OIDC split *is* taken, for the opposite reason:
[`packages/editor/package.json`](../packages/editor/package.json) depends on
`openid-client`, which pulls `jose`. A local install pays for that today.

### 2.2 Conflicts stay per path

`v3-arch.md` §10.2 stages against one `baseRevision`, and §10.6 blocks Publish
when the branch has moved at all.

[`connector.ts:53`](../packages/connectors/src/connector.ts#L53) already keys
expectations per path, and says why: two editors working on different entries
must never block each other.

§9.1 also makes the combined UI and content repository the default. In that
topology every developer push moves the branch. A site-wide gate would block an
editor's Publish because somebody changed a stylesheet.

**Decided:** the draft records its base revision, and the editor displays it.
The publish gate is the per-path `expect` map. Publish is refused only when a
path in the change set moved.

### 2.3 Local publish is opt-out

[`local.ts:1`](../packages/connectors/src/local.ts#L1) states that the local
connector is deliberately not a Git client, because the developer already has
better tools. That reasoning holds for *credentials*, not for *convenience*.

**Decided:** local Publish commits and pushes, and is on by default.
`MICA_LOCAL_PUBLISH=false` reduces local mode to autosave plus a read-only
Recent changes view.

**It adds no dependency.** Mica spawns the `git` binary through
`node:child_process`. The binary inherits the developer's SSH agent, credential
helper and remote configuration. A JavaScript Git library would have to
reimplement all three, which is the part `local.ts` is right to refuse.

### 2.4 Admission: a claim rule plus an explicit list

OIDC states who a person is. It does not state whether that person may edit
this site. Today [`middleware/index.ts:141`](../packages/editor/src/server/middleware/index.ts#L141)
answers that from the `memberships` table, re-read on every request.

With the table gone, admission is configuration. Both forms are supported:

```env
# A — a rule over provider claims. The IdP holds the list.
MICA_ADMIT_GROUP=mica-editors
MICA_ADMIT_DOMAIN=example.com

# B — an explicit list, keyed by issuer and subject.
MICA_ADMIT_SUBJECTS=https://id.example.com|a1b2c3,https://id.example.com|d4e5f6
```

A is the normal path: adding an editor is a group change in the identity
provider, and Mica is not touched. B is the escape hatch for a deployment with
no groups, and for the first sign-in before a group exists.

The list keys on `(issuer, subject)` and never on email, for the reason
[`migrations.ts:150`](../packages/editor/src/server/db/migrations.ts#L150)
already gives: an email is a display attribute a provider may let a person
change, and rebinding an account to whoever holds an address today is how
account takeover happens.

**The server refuses to start when neither is set.** An OIDC deployment that
admits every person its issuer knows is a misconfiguration, not a default.

**Accepted cost — revocation gets slower.** It is immediate today. It becomes
effective at session refresh. Two things contain it: a modest session lifetime
(8 hours, not 30 days), and re-checking admission on the refresh path against
claims stored on the session row. Recorded in
[`decisions.md`](decisions.md) as a P1 trade-off; the trigger that brings the
table back is a customer who must cut access within seconds.

### 2.5 The database becomes one table

`v3-arch.md` §7.3 says "no user database". Traced through the current schema:

| Table | Fate |
| --- | --- |
| `tenants`, `sites`, `repository_connections` | deleted — one runtime, one site, configured by environment |
| `memberships`, `users`, `oidc_identities` | deleted — admission is a claim rule |
| `sessions` | **stays** — session store, CSRF token, revocation handle |

SQLite no longer earns its place through authentication. It earns it in Phase B,
as the self-hosted draft store.

**The migration chain is reset**, not extended. A fifth migration would drop six
tables the first four just built. [`migrations.ts:1`](../packages/editor/src/server/db/migrations.ts#L1)
makes migrations append-only, which is correct while deployments exist. None do.
This is the one moment the rule can be broken cleanly. After Phase A it applies
again.

### 2.6 `sites/micacms` is not an example

It is the production website. [`vercel.json`](../vercel.json) hardcodes
`@micacms/site`, `sites/micacms/dist` and an `ignoreCommand` path. Moving it
breaks the live deployment and mislabels a product site as sample code.

`sites/` holds real deployed sites. `examples/` holds sample code. Only
`sites/muster-consulting` moves.

### 2.7 Changesets, not Rush

`v3-arch.md` §15 needs change files, lockstep versioning, changelogs and
publishing, and explicitly does not need subspaces, multiple lockfiles or the
remote build cache. The cache and phased builds are what Rush is best at.

Changesets covers every stated need with roughly one configuration file, is the
convention in pnpm workspace projects, and replaces
[`scripts/version.mjs`](../scripts/version.mjs) directly.

### 2.8 Sequence: scope, then value, then layers

`v3-arch.md` Phases 1–3 are moves that no user notices. Phase 4 is the change
every user notices.

There is also a hole in the original order. Phase 2 removes the login UI;
Phase 5 restores the self-hosted path. Between them `main` has no working
authenticated deployment, for three phases.

Phase 5 is further mis-described as new work.
[`services/oidc.ts`](../packages/editor/src/server/services/oidc.ts) is 267
lines and [`routes/auth.ts`](../packages/editor/src/server/routes/auth.ts) is
239. OIDC exists. It moves and shrinks.

**Rule for this plan:** file moves are mechanical and can happen at any time.
Behaviour changes cannot. Do behaviour first, in the layout that exists.

---

## 3. Phases

```
A  remove dead scope      ── schema, admission, one SiteContext
      ▼
B  staging and publish    ── the user-visible change
      ▼
C  split the editor       ── editor-ui, runtime, two apps, core, oidc
      ▼
D  moves and tooling      ── examples, deploy, tests, Changesets
```

Each phase leaves `main` releasable. No phase depends on a later one.

---

### Phase A — Remove dead scope

Nothing moves. Code is deleted, and one concept is added.

**A1 — Schema reset.** *(done)*
Replace the migrations with one `initial_schema` that creates `sessions` alone.
Drop `tenants`, `sites`, `repository_connections`, `memberships`, `users` and
`oidc_identities`. The session row carries the claims admission is checked
against, so there is nothing else to look them up in.

**A2 — Admission policy.** *(done)*
Add `MICA_ADMIT_GROUP`, `MICA_ADMIT_DOMAIN` and `MICA_ADMIT_SUBJECTS` to
[`config.ts`](../packages/editor/src/server/config.ts). Refuse to start outside
local mode when none is set. Replace `requireAuth`'s membership lookup with
`requireAccess`, setting an `AccessContext` that carries the admitted identity.
Store the claims the rules need on the session row.

Three deviations, decided while building it:

- **Re-checked on every request, not on refresh.** Reading three arrays from
  configuration costs nothing, and it makes a rule change immediate rather than
  eventual. Only a change *at the provider* has to wait for the next sign-in,
  which is the part Mica genuinely cannot see.
- **No capability list.** `v3-arch.md` §7.3 says an admitted person has every
  editor capability, and offers a capability set only as a later possibility. A
  `can()` that returns true for all four names would be structure standing in
  for a decision nobody has made. Phase B adds `repository:publish` when it
  means something.
- **`MICA_OIDC_GROUPS_CLAIM` was needed.** No standard names the groups claim.
  Without this variable the group rule works against Keycloak and fails silently
  everywhere else.

**A3 — Deletions.** *(done)*
Remove `repositories/{users,identities,memberships,sites}.ts`,
`routes/admin-users.ts`, `services/sign-in.ts`, `scripts/grant-access.ts`,
`views/UsersView.vue` and `views/AccountView.vue`. Remove the `grant-access`
script from both manifests. `stores/auth.ts` becomes `stores/session.ts`: it
holds an identity that may be null rather than a user that may not be.

[`sign-in.ts:22`](../packages/editor/src/server/services/sign-in.ts#L22) is the
one to read before deleting: it creates a `developer@localhost` user row and
grants it a membership. That is the synthetic local user `v3-arch.md` §17
forbids, and it goes with the tables.

**A4 — `SiteContext`.** *(done)*
Replace `siteId` lookups in [`context.ts`](../packages/editor/src/server/context.ts)
with the explicit `SiteContext` of §8, built from configuration. `ctx.site` is
now `{ id, model, contentRepository }`, and the connector is built from the
environment alone — the stored `repository_connections` row was the multi-site
model arriving early.

**A5 — Environment names.** *(done)*
Rename to the `MICA_*` shape of §7.5 while nothing external depends on the old
names. `CMS_BASE_URL` becomes `MICA_PUBLIC_URL`; `OIDC_*` becomes `MICA_OIDC_*`.
Update `.env.example`, [`docker-compose.yml`](../docker-compose.yml),
[`e2e/`](../e2e), [`demo/`](../demo) and [`self-hosting.md`](self-hosting.md).

Only those two families. `REPOSITORY_*`, `CONTENT_ROOT`, `DATA_DIR` and
`SESSION_*` keep their names — §7.5 names four variables, and renaming the rest
would be churn in every deployment file for no gain. They can move with the app
split in Phase C, where those files are rewritten anyway.

`MICA_MODE` survives Phase A, with `cloud` removed from it: Cloud is a separate
private product and was dead scope in this enum. It disappears entirely in
Phase C, where the mode becomes which app you run.

**A6 — Loopback binding, pulled forward from C4.** *(done)*
Local mode defaults `HOST` to `127.0.0.1` and refuses any other address, with no
override. It belongs to the C4 boundary tests, but Phase A removes the session
identity that made an exposed local editor slightly less bad, and the rule is
six lines. §6.3 requires it.

**Exit criteria**

- One table in the database. ✔
- A self-hosted deployment admits by group, by domain, or by subject list. ✔
- The server refuses to start outside local mode with no admission rule. ✔
- No user, account or membership code remains. ✔
- Local mode creates no user row, and shows no identity chrome. ✔
- E2E against Keycloak passes with a group claim. — the realm now carries the
  group and the mapper, and `MICA_ADMIT_GROUP` is set; the run itself is still
  manual, which is the standing gap in [`decisions.md`](decisions.md).

**Actual size:** the source is −2,231 lines and +1,270 across 42 files — a net
loss of about 960, close to the estimate. The deployment files and the guides
are a further +501/−225, most of it the admission chapter in
[`self-hosting.md`](self-hosting.md) and the Keycloak group the e2e rig needed.

---

### Phase B — Staging and publish

The user-visible change. Done in the current package layout.

**B1 — Model types.** *(done)*
`Revision`, `ContentChange`, `DraftChangeSet`, `PublishResult`, the
`DraftStore` port and its staged-change types are in `packages/model`
(`staging.ts`), together with `memoryDraftStore` — the reference
implementation the SQLite store's tests mirror. One deviation:
**`PublishRequest` was not added.** Phase A's connector already carries the
publication contract as `CommitInput` — changes plus the per-path `expect`
map §2.2 decided on — and a second name for the same request would be two
vocabularies for one operation.

**B2 — Connector publication.** *(done, and mostly already true)*
The extension the architecture asked for turned out to exist: Phase A's
`commit()` *is* `publishChangeSet` — GitHub already builds blobs, a tree on
the expected base tree, a commit and a non-forced ref update; GitLab already
uses the Commits API with multiple file actions; neither ever force-updates
the branch. What B2 actually added is `head()`, the branch-head read the
draft records for display, plus `stagedConnector` — a decorator that overlays
a `DraftStore` on any connector, so reads see the repository as it will be
once published and `commit()` records into the draft instead of writing.
`deleteTree` is resolved to per-file deletions at staging time, which keeps
the draft a flat map and keeps directory operations away from providers.

**B3 — `ContentStagingService`.** *(done)*
Orchestration in the server: autosave into the draft store, list recent
changes with owners and validation, discard, publish, and
`committed-pending-push` as an explicit result state. Validation at publish is
scoped to the *changed* documents (§10.6's list), so pre-existing hand-committed
breakage elsewhere cannot hold an unrelated publication hostage.

**B4 — Two draft stores, for a stated reason.** *(done)*

`v3-arch.md` §10.2 gives two implementations and no reason. The reason is
this, and it is stated in the code:

> Local autosave writes to the working tree, because the Astro dev server
> cannot hot-reload a change that is not in the tree. Live preview is the whole
> value of local mode. A shared draft store would break it.

The consequence is that Saved and Published mean different things in the two
workspaces, and Recent changes reads `git status` in one and a stored change
set in the other. The editor UI handles both shapes behind one API.

- Working tree: the checkout, plus `git status` over Mica-managed paths.
- Draft store: SQLite, surviving restarts.

Two deviations, decided while building it:

- **Which workspace applies follows the connector, not the mode.**
  `REPOSITORY=local` stages in the working tree wherever it runs — including a
  self-hosted deployment with a checkout beside it — because a draft store
  shadowing a working tree would show editors a tree that lies. Provider
  connectors stage in SQLite.
- **Media bytes live in the database, not a directory beside it.** §10.4
  sketched "SQLite plus a media directory"; the second location would make
  staging a two-phase write and the backup a two-file promise, and uploads
  are capped small enough for BLOBs.

**B5 — Local publish.** *(done)*
Commit and push through the spawned `git` binary. The pathspec limits both
`git add` and `git commit`, so only the reviewed set is ever staged — never
`git add -A`, and a developer's own staged work survives untouched. HEAD is
verified against the base the editor reviewed. `committed-pending-push` is
returned as a state; the retry pushes and never creates a second commit.
`MICA_LOCAL_PUBLISH=false` disables it.

**B6 — Editor UI.** *(done)*
The Publish page: the pending set grouped by entry, singleton and media rather
than by file, validation problems named, per-group discard behind a
confirmation, a commit-message input and Publish. `committed-pending-push`
renders as a retryable state, derived from Git's own ahead count so it
survives a restart. The sidebar carries a pending-changes badge, the dashboard
a "waiting to be published" card. No user concepts anywhere, and Saved and
Published are visibly different words — the entry header still says Saved; the
Publish page is where Published happens.

**B7 — Draft media.** *(done)*
Unpublished media must be visible in the editor before it reaches the
repository. [`decisions.md`](decisions.md) settles that Mica serves no public
media route, and that decision holds. No new route was needed: the existing
authenticated admin media route reads through the staged overlay, so pending
uploads are served from the draft store behind the same session as everything
else, and nothing is reachable signed out.

**Exit criteria**

- Ten edits to one entry produce one commit. ✔
- Invalid staged content cannot be published. ✔
- A concurrent change to a *different* path does not block Publish. ✔
- A concurrent change to the *same* path blocks it, with an actionable message. ✔
- A failed push is recoverable without a duplicate commit. ✔
- Self-hosted drafts survive a restart. ✔
- Publication clears only what was published. ✔
- Unpublished media renders in the editor and is unreachable when signed out. ✔

**Phase B is complete.** The standing gap from [`decisions.md`](decisions.md)
applies to it in full: no browser test drives "sign in, edit, publish", so the
Publish page is verified by the API tests beneath it and by hand.

**Open question — resolved.** The model-drift behaviour is decided and built:
refuse to publish, name the drift, require a restart. Both staging
implementations compare the manifest's revision against the one recorded at
startup, immediately before publishing. Recorded in
[`decisions.md`](decisions.md).

---

### Phase C — Split the editor

Mechanical, once B is stable.

**C1 — `packages/model` becomes `packages/core`.** *(done)*
The `RepositoryConnector` port and its value types moved in from
`packages/connectors` (`core/src/repository.ts`); `@micacms/connectors`
re-exports them so existing imports survive the move. `@micacms/model` is a
thin re-export of core, kept for one release cycle and still carrying the
lockstep version. The dependency rule of §5.2 is a test, not a sentence:
`core/test/boundary.test.ts` fails the build if core gains any dependency but
`zod` or any `node:` import outside the deliberate `/node` entry.

**C2 — UI and runtime.** *(done)*
`packages/editor-ui` takes the SPA, shipped as built assets the apps serve.
`packages/runtime` takes the Hono API, application services and staging
orchestration; it receives an `AuthSurface` — routes for `/api/auth` plus the
gate before the admin API — and consumes the auth-neutral `AccessContext` now
defined in `@micacms/core` (§7.2 as written). The generic SQLite driver stays
in the runtime as exported infrastructure — §4.1 gives the runtime the
"sessions interface" — while the tables live with their owners: the sessions
repository in `auth/oidc`, the migrations and the SQLite draft store in
`apps/self-hosted`.

**C3 — OIDC and the two apps, in one pull request.** *(done)*
The OIDC service, sessions, admission and auth routes are
`packages/auth/oidc`; `apps/local-editor` (published as `@micacms/editor`) and
`apps/self-hosted` compose the runtime, and `main` never lost the self-hosted
path. `MICA_MODE` is deleted: the mode is the app, and neither app's schema
reads the other's variables — which is a stronger statement than refusing
them.

Two deviations, decided while building it:

- **`@micacms/auth-oidc` depends on `@micacms/runtime`.** §5.2 has adapters
  implement ports from core alone, but an HTTP auth gate necessarily shares
  the runtime's error envelope, request context and driver interface, and
  duplicating those into core would move HTTP into the one package that must
  not have it. The boundary those rules protect is directional and holds: the
  runtime never imports auth, and the local editor has no path to it — walked
  by a test.
- **The identity chrome was made conditional, not deleted.** The SPA draws
  sign-in and account chrome only when the server's `/api/auth/config` says
  authentication exists, and the login view is its own lazily-loaded chunk the
  local editor never fetches. One bundle serves both apps; what §6.2 actually
  forbids — OIDC client code, token handling, provider assets — was never in
  it, and the boundary test greps the build to keep it that way. A second
  build variant would double the distribution to remove a screen the local
  editor already never shows.

**C4 — Local mode loses its session, its token and its database.** *(done —
as designed below, with one addition: `DATA_DIR` is not merely unused but gone
from the local configuration entirely, because working-tree draft media needs
no store; and the Host allowlist stands in front of everything, `/health`
included.)*

Phase A left a residue that only Phase C can clear cleanly: local mode still
starts a session. There is nobody in it — `issuer`, `subject` and `email` are
all null — and it exists to carry one CSRF token, which is why `cms.sqlite`,
the `sessions` table and the migration runner are still there on a developer's
machine. A file called `cms.sqlite` with a table called `sessions` in it
contradicts the sentence this design is built on.

It can all go, because the token was never the defence:

- **The Origin check is.** A browser always sends `Origin` on a cross-origin
  write, so a page on another site is refused with no cookie, no session and no
  token involved. The double-submit token is a second layer over a first layer
  that already stopped the attack.
- **One thing the cookie was quietly also doing** must be replaced rather than
  deleted. Under DNS rebinding a page re-resolves its own name to `127.0.0.1`,
  and the browser then treats `http://evil.example:6422/api/…` as same-origin.
  Writes still fail on the Origin header; *reads* succeed, and the only reason
  they do not today is that a cookie scoped to `localhost` is never sent.

  The replacement is a **Host allowlist**: the local app answers to `localhost`,
  `127.0.0.1` and `[::1]`, and refuses any other `Host`. Smaller than what it
  replaces, standard for exactly this, and it states the true rule — this server
  answers only to itself.

So `apps/local-editor` constructs no session service, no admission policy and no
database. `DATA_DIR` goes unused until Phase B's draft media claims it, and
`npx @micacms/editor` writes nothing outside the content directory.

**Accepted, and worth stating:** the property that a request without a cookie
gets 401 disappears, so any process on the developer's own machine can call the
local API. That property was close to theatre — a process on that machine can
edit the working tree directly, which is where the content is.

**C5 — Boundary tests.** *(done)*
`apps/local-editor/test/boundary.test.ts` walks the dependency graph from
`@micacms/editor` and fails on any path to `openid-client`, `jose` or
`@micacms/auth-oidc`; greps the built UI bundle for OIDC markers; proves the
Host allowlist refuses foreign names and answers this machine's; proves the
unauthenticated surface has no login route to disable; and proves a run
writes into the content directory and nowhere else, with no database
appearing. The loopback refusals are config tests beside it. The one §6.4
check that remains manual is driving a real browser through the rendered UI —
the same standing gap [`decisions.md`](decisions.md) records for everything
else.

**C6 — Verify the entry point.** *(done)*
The bin keeps the name `mica`: `npx @micacms/editor` runs a package's only
binary whatever it is called, and `mica` is the better command name. The CLI
tests execute the real bin through the shell, which is the resolution that
matters.

`packages/connectors` stays one package.

**Exit criteria**

- `@micacms/editor` has no path to `openid-client` or `jose`. ✔ (tested)
- The local bundle contains no auth route, token code or profile store. ✔
  (no OIDC/token code, by grep; the sign-in screen is a lazily-loaded chunk
  the local editor never fetches — see the C3 deviation)
- Local mode binds to loopback and refuses any other address. ✔
- Local mode answers no request whose `Host` is not this machine. ✔
- A local run creates no database and writes nothing outside the content
  directory. ✔ (tested)
- `apps/self-hosted` composes the runtime; it does not fork it. ✔
- One runtime, one `SiteContext`. ✔

---

### Phase D — Moves and tooling

No behaviour change. Two pull requests.

**D1 — Folders.** *(done)*
`sites/muster-consulting` to `examples/split-content-repository` or a named
business-site example. `sites/micacms` **stays**. `demo/` to
`deploy/demo-identity`. Root Compose files to `deploy/self-hosted`. `e2e/` to
`tests/e2e/`.

Update [`vercel.json`](../vercel.json), the three workflows in
[`.github/workflows/`](../.github/workflows), the root manifest scripts,
[`AGENTS.md`](../AGENTS.md) and the docs. Preserve history where practical.

> **Done, with the plan's second option.** The example moved to
> `examples/muster-consulting` — the named business-site example — because the
> package is already `@micacms/example-muster-consulting` and the site is a
> business site; `split-content-repository` would promise a repository split
> the example does not demonstrate. All moves are `git mv`, so history
> follows. The root Compose file took Compose's canonical name on the way:
> `deploy/self-hosted/compose.yml`, beside its `.env.example`.
>
> `vercel.json` was reviewed and needed no change: `sites/micacms` did not
> move, and its `ignoreCommand` names only paths that still exist.
>
> Two stale leftovers surfaced by the sweep were fixed in the same commit:
> the demo compose still launched `dist/server/index.js` — the pre-Phase-C
> entry path, which no longer exists in the image — and CI's docker job still
> passed the deleted `MICA_MODE` variable.

**D2 — Changesets.**
Adopt Changesets with `fixed` grouping over the published packages, keeping one
lockstep version. Mark `examples/`, `deploy/` and `tests/` private. Add
`changeset status` to CI. Retire [`scripts/version.mjs`](../scripts/version.mjs)
only when the release path is proven end to end.

> **Done.** One `fixed` group holds all nine published packages (the eight of
> §4 plus the `@micacms/model` shim, which carries the lockstep version while
> it exists); `privatePackages: { version: false, tag: false }` keeps the two
> private sites out of versioning, so nothing needed a new `private` marker —
> `examples/muster-consulting` already had one, and `deploy/` and `tests/`
> contain no manifests to mark. CI's verify job runs
> `changeset status --since origin/main` (its checkout now fetches history),
> so a pull request that changes a published package without a changeset
> fails; `pnpm changeset --empty` is the escape for changes that should not
> reach the notes.
>
> `scripts/version.mjs` is **not** retired, per the plan — and the two tools
> are bridged instead of coexisting blindly: Changesets knows nothing of the
> root manifest or the image tag in `deploy/self-hosted/compose.yml`, so
> `pnpm changeset:version` runs `changeset version` and then
> `version.mjs --sync`, which carries the version Changesets chose to both.
> A dry-run in a scratch worktree confirmed one `0.2.0` across all eleven
> version-bearing files. Release publishing still runs through the existing
> tag-triggered workflow; `changeset publish` can replace it once the path is
> proven.

**Exit criteria**

- micacms.com still deploys from Vercel.
- CI paths and the website build workflow are correct.
- A dry-run release produces the same version across all eight packages and the
  image.

---

## 4. Published packages after the plan

```
@micacms/core          domain, ports, validation, draft and publish types
@micacms/astro         Astro Content Layer integration
@micacms/editor-ui     identity-neutral SPA
@micacms/runtime       single-site API and application services
@micacms/connectors    local, GitHub and GitLab repository access
@micacms/auth-oidc     server-only OIDC gate
@micacms/editor        local composition root  ── npx @micacms/editor
@micacms/self-hosted   authenticated composition root ── Docker image
```

Eight packages under one lockstep version;
`@micacms/model` continues for one cycle as a re-export of `core`.

---

## 5. Risks

| Risk | Contained by |
| --- | --- |
| Revocation is slower than today | 8-hour sessions; rules re-read per request; recorded as P1 |
| Local publish is a new Git failure surface | spawn `git`; opt-out; `committed-pending-push` is explicit state |
| Draft media becomes the public media route | authenticated, scoped to the change set, tested signed-out |
| Model drift under a pending draft | resolved inside Phase B; refuse and name the drift |
| The Vercel deployment breaks in D1 | `sites/micacms` does not move; `vercel.json` reviewed in the same PR |
| Phase B is large | B1–B3 land before B4–B7; each is independently testable |
| Dropping the local session opens DNS rebinding | a Host allowlist replaces it in C4, and is tested |

---

## 6. Unchanged from `v3-arch.md`

Everything not listed in §2 stands as written. In particular §14 (Cloud), §16
Phases 8 and 9, §17 (non-goals) and the local-mode network rules of §6.3 are
adopted without change.

Cloud work begins only after the open-source runtime is stable, consumes
published artifacts, and never enters this repository.
