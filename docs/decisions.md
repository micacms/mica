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

### P2 — Publishing commits straight to a branch, with no review step

**Decided:** Mica does not open a pull request and has no concept of one. The
branch an editor publishes to is the branch CI builds.

**Why:** the editors this is built for are the site's owners. Making them wait
for their own approval would be theatre, and a review queue nobody empties is
worse than no review.

**Consequence:** a typo is live as soon as CI finishes. There is no gate.

**What would change it:** point Mica at a `staging` branch and merge on a human's
schedule — this already works and needs no code. A pull request per publication
would be a change to the managed owner policy: push to a branch, then open the
pull request through the host's API — the one feature that would bring a
provider API back.

**Trigger:** a customer with more than one editor who does not trust all of them,
or a compliance regime that requires four eyes.

**Built in Phase B.** A save is no longer that commit: it lands in the draft
workspace — the developer's working tree locally, and since 0.5.0 Mica's own
clone when self-hosted — and an explicit Publish writes the accumulated set as
one commit. What did not
change is the sentence above: publishing writes to the branch, and nothing
reviews it.

**1.0 status:** accepted for 1.0. Approval workflows are out of 1.0; a staging
branch is the review step.

---

### P2 — Local mode has no authentication, and no user either

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
everything including the health endpoints.

**Accepted with it:** a request without a cookie stops being a 401, so any
process on the developer's own machine can call the local API. A process on
that machine can already edit the working tree directly, which is where the
content is.

**1.0 status:** accepted for 1.0. The accepted risk goes in the security docs
(#84).

---

### P2 — Access removed at the provider is revoked at the next sign-in

**Decided:** who may edit a self-hosted site is decided by configuration, not by
a table. Either a rule over provider claims (`MICA_ADMIT_GROUPS`,
`MICA_ADMIT_DOMAINS`) or an explicit list — of verified addresses
(`MICA_ADMIT_EMAILS`) or of `(issuer, subject)` pairs (`MICA_ADMIT_SUBJECTS`).
The server refuses to start outside local mode when
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
against the claims sealed in the session cookie; and `MICA_ADMIT_SUBJECTS` as the
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

**1.0 status:** accepted for 1.0. The accepted risk goes in the security docs
(#84).

---

### P2 — Admission by email address, not only by subject

**Decided:** `MICA_ADMIT_EMAILS` admits a listed address, compared
case-insensitively, and only when the provider reports it as verified. A
domain rule that names a public provider such as `gmail.com` is refused at
startup.

**Why:** Google sends no groups claim, and its subject is a number nobody can
read off a console. For a small team on Google accounts the subject list was the
only safe rule, and it was not usable.

**Consequence:** an address is not a permanent key. An organisation that gives
a former editor's address to somebody new gives them this site too. Gmail and
the other public providers never reuse an address, so the risk sits with
organisations that manage their own domain — and those are the ones with a
group or domain rule to use instead.

**What would change it:** a provider that lets a person set an address they do
not own and still reports it verified. `MICA_ADMIT_SUBJECTS` stays the rule
for that case.

**1.0 status:** accepted for 1.0.

---

### P2 — Sessions are encrypted cookies, not rows

**Decided:** a self-hosted session is the `mica_session` cookie itself:
AES-256-GCM over the identity, the CSRF token and the expiry, with a key
derived from `MICA_SESSION_SECRET`. There is no session table. Only the groups a
rule names are kept, because a cookie holds 4 KB and a provider can send
hundreds.

**Why:** Mica's own state should be unpublished drafts and nothing about
people. A session table was the last place Mica stored who somebody is. Since
0.5.0 there is no database at all.

**Consequence:** one session cannot be revoked on the server. Sign-out clears
the cookie in the browser; a copy taken before that stays valid until it
expires — at most `MICA_SESSION_TTL_HOURS`, or `MICA_SESSION_IDLE_HOURS` unused. A group
added to the rules counts from the next sign-in.

**What contains it:** the admission rules are still re-read on every request,
so removing somebody from them takes effect at the next request after a
restart. Rotating `MICA_SESSION_SECRET` ends every session at once.

**What would change it:** a need to end one person's session within seconds
without signing everybody out. That needs a deny list, which is server state
again.

**1.0 status:** accepted for 1.0. "No server-side revocation" goes in the
security docs (#84).

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

**Changed in 0.5.0:** both apps keep the pending set as uncommitted files in a
working tree. Publish commits exactly the paths the editor reviewed; a
colleague's later autosave on another entry stays a draft instead of joining
the publication. That is the server half of a selection (#98).

**1.0 status:** accepted for 1.0. Selective publish (#98) lowers the cost.

---

### P2 — Local publishing spawns the `git` binary

**Decided:** the local editor commits and pushes by running `git`, not by
linking a JavaScript Git implementation. On by default;
`MICA_LOCAL_PUBLISH=false` reduces local mode to autosave plus a read-only view
of the changes.

**Why:** credentials. A developer's push already works because of their SSH
agent, credential helper and remote configuration. The binary inherits all
three. A library would have to reimplement them, and would do it worse — which
is the reason [`files.ts`](../packages/runtime/src/workspace/files.ts) refuses to
be a Git client in the first place.

**Consequence:** `git` must be on the path, and Mica now meets Git's failure
modes — no upstream, a diverged branch, a rejected push. A commit and a push are
not one operation, so `committed-pending-push` is a state the editor must show
and a retry must resume rather than repeat.

**What contains it:** Mica stages an explicit path set from the change model and
never runs `git add -A`, so a developer's unrelated work in the same checkout is
never swept into an editor's commit.

**What would change it:** nothing foreseen.

**Built in Phase B.** `lib/git.ts` spawns the binary with
`GIT_TERMINAL_PROMPT=0`, and `services/staging-local.ts` holds the rules: the
pathspec limits both `git add` and `git commit`, so a developer's unrelated
work — staged or not — never enters an editor's commit; HEAD is verified
against the base the editor reviewed; a failed push returns
`committed-pending-push` and a retry pushes rather than committing again. One
choice the plan left open was fixed then: which workspace a deployment stages
in follows the *connector* (`REPOSITORY`), not `MICA_MODE`.

**Changed in 0.3.0:** a self-hosted deployment no longer accepts a checkout
beside it. See "Local Git is the local editor's, never the server's".

**Changed in 0.5.0:** the self-hosted app spawns `git` too, on a clone it owns
and with an isolated environment instead of the developer's — see "Self-hosted
Mica keeps its own Git clone". The runner is `workspace/git.ts`, the rules
`services/staging.ts`, and the developer's half is the developer policy
(`workspace/developer.ts`). The gate is no longer HEAD: Publish sends the
reviewed paths with their revisions.

**1.0 status:** accepted for 1.0. The Windows CI job tests it.

---

### P2 — Local Git is the local editor's, never the server's

**Superseded in 0.5.0** by "Self-hosted Mica keeps its own Git clone" below.
Its reasons were about a *developer's checkout* mounted into a server: a
second credential path, and the hooks and configuration of whatever was
mounted. A clone that Mica makes and owns has neither — one token, given to
Git by an isolated environment, and no hooks or filters (see "Git on the
server is isolated"). The rest of this entry is kept as history.

**Decided:** there are two ways to run Mica, and each reaches the repository
one way. The local editor works on the developer's checkout and publishes with
their own `git` and credentials. A self-hosted Mica publishes only through a
provider API — `REPOSITORY` must be `github` or `gitlab`, and `local`, once the
default, stops startup.

**Why:** a server has no developer behind it. Local publishing needs the
`git` binary, credentials, a writable checkout owned by the right user, and
somebody to resolve a diverged branch by hand. The image has none of these, so
a working tree there could autosave but never publish. Supplying them would be
a second credential path next to `REPOSITORY_TOKEN`, and `git` would run the
hooks and configuration of whatever repository is mounted.

**Consequence:** self-hosted works only with GitHub and GitLab. A team on
Gitea, Forgejo, Bitbucket or plain SSH cannot self-host Mica yet. Every
self-hosted deployment has the draft database.

**What would change it:** demand for another Git host. The answer then is a
connector for its API, not `git` in the image.

**Built in 0.3.0.** `apps/self-hosted/src/config.ts` refuses any other
`REPOSITORY`. The test stacks publish to a stand-in for the GitHub API
([`tests/github-stub/`](../tests/github-stub/README.md)).

**1.0 status:** accepted for 1.0.

---

### P2 — Self-hosted Mica keeps its own Git clone

**Decided:** both apps stage saves as uncommitted files in a Git working tree,
through one staging service. The only difference is the owner: the local
editor works on the developer's checkout; a self-hosted Mica clones
`MICA_REPOSITORY_URL` into `MICA_DATA_DIR/repository` and keeps that clone
itself. There is no database. Publish commits the reviewed files and pushes
over HTTPS.

**Why:** the provider APIs were slow (one call per read, in series, no cache),
limited by rate limits, needed GitLab's broad `api` scope, and reached two
hosts only. The working-tree service already existed and was well tested; the
draft store duplicated it with a second data model, an overlay and a
database. One model removed about 2,000 lines and the `@micacms/connectors`
package.

**Consequence:** the data volume holds the clone and, in it, the unpublished
drafts — back it up as before. A clone that does not match the configuration
is thrown away only when it holds no draft and no unpushed commit; otherwise
Mica refuses to start and says how to get the work out. One Mica per volume:
there is no lock file, because a stale lock after a crash would block the
restart. For a hosted offering later, a clean clone can move to a new node,
and the drafts pin a site to its volume, as the SQLite file did.

**What would change it:** sites whose media outgrows a full checkout of the
current content; then a bare clone and a draft store again (the "C" variant
in the plan), or LFS first.

**Built in 0.5.0.** `apps/self-hosted/src/workspace/` (clone, sync, push,
credentials, isolation), on the runtime's `workspace/` (runner, tree, locks,
owner policy). The plan and its reviews are in
[`git-workspace-plan.md`](git-workspace-plan.md).

**1.0 status:** accepted for 1.0.

---

### P2 — Sync never merges, and Mica finds the conflicts itself

**Decided:** the managed clone fetches every `MICA_REPOSITORY_SYNC_SECONDS`
(default 60), before each publish and on "Try again". It downloads every blob
the fast-forward needs first, outside the tree lock, then compares upstream
changes with the drafts **per entry group** — an entry with its files, a
singleton, an order — and fast-forwards only when none overlap. An overlap is
a conflict the editor resolves: "Keep my version" (the draft moves onto the
new head) or "Use the website's version" (the draft is discarded). Mica never
merges, rebases, stashes or pulls on the server.

**Why:** a server has no person to resolve a merge, and a draft is a set of
whole files, so file-level choices are enough. Mica checks itself because
Git's own refusal is not enough: in tests, a fast-forward replaced an
untracked draft (in a sparse clone, and inside an ignored directory) and let
a local deletion undo an upstream edit, all without an error. A path-level
check would mix an entry from two sides, so the unit is the group.

**Consequence:** one conflict holds the fast-forward for every editor until
somebody chooses, so it is shown on the Dashboard, the Publish page and the
entry's own page. A change upstream to `.mica/schema.json` holds too, until
a restart (see "The content model is read once").

**What would change it:** frequent conflicts on different fields of one entry;
then a merge per field.

**Built in 0.5.0.** Tested for edit against edit, untracked against an add,
deletion against edit both ways, an upstream `git mv`, `index.json` against
the same entry's `.mdoc`, and an ignored draft.

**1.0 status:** accepted for 1.0.

---

### P2 — Publish takes the reviewed paths; a refused push becomes drafts again

**Decided:** Publish sends each reviewed path with the revision the editor
saw. Mica commits exactly those, and refuses only when one of them, or
another file of the same entry, changed since. On the managed clone there is
at most one unpushed commit, pushed with an explicit refspec and never forced.
A push rejected as non-fast-forward is undone, the clone catches up, the
drafts are checked again (validation and the revisions), and the same commit
is made again with its author and message. A push the host refuses — a
protected branch, a server hook, a token that cannot write — turns the commit
back into drafts and shows the host's reason. A network or authentication
failure keeps the commit and retries at the next sync.

**Why:** a HEAD gate would refuse a publication after every upstream push,
even of code, once the clone syncs every minute. Retrying a refusal forever
would let the clone drift away from the remote.

**Consequence:** the editor is the commit's author and Mica the committer.
Failures without a porcelain line are classified from stderr in a fixed
order, because a GitHub or GitLab 403 also contains the network pattern.

**1.0 status:** accepted for 1.0.

---

### P2 — Git on the server is isolated, and the token never touches the disk

**Decided:** the managed clone's `git` runs with an allowlisted environment —
never `process.env`, which holds `MICA_SESSION_SECRET` and the OIDC secret — and
every setting comes from `GIT_CONFIG_*`: no system or global configuration,
hooks off, symlinks as plain files, `autocrlf` off, `.git/info/attributes`
that switch off every filter, `ident` and encoding, only the `https`
transport (plain `http` only in development on loopback), no submodules,
literal pathspecs, `safe.directory` set, and gc only after a fetch. The token
is answered by a credential helper scoped to the configured host and port,
after an empty `credential.helper` clears any other; it is never in the URL
or in `.git/config`. Every URL in logs and errors is cleaned.

**Why:** the repository is under someone else's control. These settings close
every path from repository content to code execution that Git offers. Tests
showed that an unscoped helper gives the token to any host, and that `ident`
changes bytes on checkout.

**Consequence:** the token Git needs is narrower than the REST API's: GitHub
"Contents: read and write"; GitLab `read_repository` + `write_repository`,
with a role that may push to the branch (a Developer cannot push to a `main`
protected for Maintainers). A token rotates only with a restart.

**1.0 status:** accepted for 1.0.

---

### P2 — A blobless clone, without sparse checkout

**Decided:** `git clone --filter=blob:none --single-branch`, no history blobs,
the whole current tree checked out. Sparse checkout is not used. The first
checkout uses `git checkout`, which fetches missing blobs in one batch.

**Why:** a sparse clone let a fast-forward overwrite an untracked draft
without an error, and the spike measured that it is not needed: a
5,000-file, 2 GB repository cloned in 18 s and used a limit of 64 MB of
memory. `git restore` on a blobless clone fetches each missing blob in its
own request.

**Consequence:** the volume needs about twice the current content (objects
and files), and grows with upstream media changes. To shrink it: publish or
discard every draft, stop Mica, delete `MICA_DATA_DIR/repository`, start.

**1.0 status:** accepted for 1.0.

---

### P2 — A crash in the middle of a fast-forward is finished at the next start

**Decided:** before a fast-forward, Mica writes `MICA_DATA_DIR/operation.json`
with `from` and `to`, atomically. A start that finds it restores every path
that changed between them to `to` — the paths `to` has with `git restore`,
the paths it deleted with `git rm --cached` and an unlink — and moves the
branch to `to`. "Keep my version" writes its own marker after it copies the
group's drafts aside. An `index.lock` older than the longest Git call is
removed at start; a younger one may belong to a process that still runs.

**Why:** without it, a crash during a fast-forward leaves old file versions
that look like drafts, and the next publication would revert upstream work.
No copy of the drafts is needed: the fast-forward ran only after the conflict
check, so no upstream path is a draft. One `restore` over all paths fails as
a whole when a crash leaves an upstream deletion half done, so it is two
steps. Tested with `kill -9` at several points of a fast-forward over 6,301
paths.

**1.0 status:** accepted for 1.0.

---

### P2 — Any Git host over HTTPS; supported means live-tested

**Decided:** the self-hosted Mica uses no provider API, so any Git host over
HTTPS should work. Support has three tiers:

| Tier | Hosts |
| --- | --- |
| Supported (live-tested every week) | github.com and gitlab.com |
| Tested in CI | Forgejo (`tests/oidc`) |
| Expected to work, not tested | Bitbucket Cloud, Gitea, GitHub Enterprise Server, self-managed GitLab |

**Why:** it keeps the rule of the entry it replaces: a promise needs a test.
Forgejo runs in the CI stack; the two hosted services need tokens, so they
run weekly (`live-git.yml`).

**Consequence:** a defect that appears only on an untested host is fixed when
somebody reports it. github.com and gitlab.com count as supported only while
the live runs pass without skipping.

**1.0 status:** blocker until the live runs pass with their secrets (#38).

---

### P2 — No migration of 0.4 drafts

**Decided:** 0.5 has no upgrade path from 0.4. It does not read `cms.sqlite`
or the 0.4 variable names, and it does not check for them. A 0.4 deployment is
set up again from the 0.5 `compose.yml` and `.env.example`.

**Why:** the only 0.4 deployment was a trial. Migration or refusal code would
be carried for one upgrade that nobody makes.

**Consequence:** drafts in a 0.4 `cms.sqlite` are lost unless they are
published on 0.4 first. An old variable name is ignored without a warning.

**1.0 status:** accepted for 1.0.

---

### P2 — The content model is read once, at startup

**Decided:** Mica reads `.mica/schema.json` out of the content repository when
the process starts, and holds it for the life of the process. Changing the
model means restarting.

**Why:** the alternative is re-reading it per request, or a cache with an
invalidation rule — and the
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
revision is recorded at startup; the staging service compares it immediately
before publishing and answers 409 with a message that names the restart. Nothing is discarded: the draft survives, and after the restart it is
re-validated against the new model like any other pending set.

**Changed in 0.5.0:** a clone that Mica keeps up to date by itself would bring
a model change in under a running server. So a sync that would change
`.mica/schema.json` (or a `.gitattributes` that applies to the content root)
holds before the fast-forward and asks for a restart: saves go on with the
loaded model, Publish waits, and the restart fast-forwards and then reads the
new model. Saving with the old model after the change would drop the new
fields, because `serializeEntry` writes only declared keys. #81 (reload
without a restart) becomes more useful with this.

**1.0 status:** accepted for 1.0.

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

**1.0 status:** accepted for 1.0.

---

### P2 — A provider connector reads the content tree on every commit

**Superseded in 0.5.0:** there are no provider connectors. Reads come from the
working tree on disk, and a publication is a local commit and one push. Kept
as history.

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

**1.0 status:** accepted for 1.0, while the budget tests at the scale target
pass (#72).

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

**1.0 status:** accepted for 1.0.

---

### P2 — `node:sqlite` rather than `better-sqlite3`

**Superseded in 0.5.0:** Mica keeps no database. The drafts are files in a Git
working tree, and the SQLite driver, the migrations and the draft store are
removed — see "No migration of 0.4 drafts". Kept as history.

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
`sites`, `tenants` and `repository_connections` are gone; `sessions` was the
only table left then, and it carried the claims admission is checked against. The
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

**Sessions left in 0.3.0.** Migration 3 drops `sessions`; the database holds
the draft store and nothing about people. See "Sessions are encrypted cookies".

**1.0 status:** accepted for 1.0. #130 keeps the driver out of the local editor.

---

### P2 — Semver covers the public surface, not every published package

**Decided:** from 1.0, semver covers `@micacms/core`, `@micacms/astro`, the
`@micacms/editor` CLI, the self-hosted image contract (environment variables,
port, volume, `/health` and `/ready`), the content format and the manifest
protocol.
`@micacms/runtime`, `@micacms/auth-oidc` and `@micacms/editor-ui` are internal
(`@micacms/connectors` was, until 0.5.0 removed it): published only because the apps install
them, pinned exactly by the apps, and free to break in a minor.

**Why:** all packages share one lockstep version, so a public `runtime` would
turn every refactor of its helpers into a major for every package, `core`
included. Adopters lose data when the format or the image contract breaks, not
when `classifyPath` changes; a small surface puts the stability work there, and
it is what one maintainer can keep.

**Consequence:** npm has no "internal" flag. An internal package at 1.4.0 looks
semver-stable, and anyone who depends on it can break in a minor. The
authentication-neutral runtime cannot be reused under another gate with any
promise. The line holds only while public packages do not re-export internal
symbols (#55).

**How to release under it:** in `rush change`, a breaking change to an internal
package is `minor`, never `major`. `major` is only for a break of the public
surface above. Rush already publishes `workspace:*` as an exact version, so no
Rush configuration changes.

**What would change it:** bundle the internal packages into the apps and stop
publishing them, which removes the npm confusion. Or promote a small, named
subset of the runtime to public.

**Trigger:** the first external project that depends on an internal package.

**Built in 0.6 (#55):** each package README says whether it is public or
internal; `@micacms/astro` no longer re-exports the readers of `@micacms/core`,
and the dead exports are gone.

**1.0 status:** accepted for 1.0.

---

### P2 — zod 4 is part of the public contract

**Decided:** zod 4 is a peer dependency of `@micacms/core` and `@micacms/astro`
(`^4.3.6`), and a development dependency for their build. The internal packages
and the apps keep it as a regular dependency. The core boundary test allows
this one peer.

**Why:** zod is already in the public types. `@micacms/astro` hands Astro a
`z.ZodType<T>`, because Astro derives `CollectionEntry<...>["data"]` from
`z.infer`, and `core` exports `fieldsSchema()` and `toIssues(z.ZodError)`. As a
regular dependency, the site gets a second copy as soon as Astro and Mica move
to different zod majors; the types then stop matching and `instanceof ZodError`
fails. A peer gives the site one copy, shared with Astro.

**Consequence:** a move to zod 5 is a Mica major. A site must have a zod that
satisfies both Astro and Mica; npm 7+ and pnpm install it automatically.

**What would change it:** hide zod behind Standard Schema in `core`. `astro`
still has to give Astro a zod type, so this removes zod from only half the
surface.

**Trigger:** an Astro major that moves to a zod major Mica does not support.

**Built in 0.6 (#129):** zod is a peer of `core` and `astro`, and `core` is a
peer of `astro`.

**1.0 status:** done.

---

### P2 — Every Mica configuration name starts with `MICA_`

**Decided:** before the first release candidate, every Mica-specific variable
gets the `MICA_` prefix, and the names are then frozen for 1.x. `NODE_ENV`,
`PORT` and `HOST` keep their names, because they are conventions that Node
libraries and hosting platforms already use. 0.6 removed the old names, with no
aliases and no warning. The local editor reads no `.env` file; it reads the process
environment, and its flags win over it.

| Old | New |
| --- | --- |
| `LOG_LEVEL` | `MICA_LOG_LEVEL` |
| `CONTENT_ROOT` | `MICA_CONTENT_ROOT` |
| `REPOSITORY`, `REPOSITORY_*` | `MICA_REPOSITORY_URL`, `MICA_REPOSITORY_*` (done in 0.5.0; `REPOSITORY` and `REPOSITORY_API_BASE` are gone, the URL says it all) |
| `SESSION_SECRET`, `SESSION_*_HOURS` | `MICA_SESSION_SECRET`, `MICA_SESSION_*_HOURS` |
| `LOGIN_MAX_ATTEMPTS`, `LOGIN_WINDOW_MS` | `MICA_SIGNIN_MAX_ATTEMPTS`, `MICA_SIGNIN_WINDOW_MS` |
| `MAX_UPLOAD_BYTES` | `MICA_MAX_UPLOAD_BYTES` |
| `TRUST_PROXY` | `MICA_TRUST_PROXY` |
| `ADMIN_ORIGINS`, `ADMIN_DIR` | `MICA_ADMIN_ORIGINS`, `MICA_ADMIN_DIR` |
| `DATA_DIR`, `DATABASE_PATH` | `MICA_DATA_DIR` (done in 0.5.0); `DATABASE_PATH` is gone with the database |
| `MICA_ADMIT_GROUP`, `MICA_ADMIT_DOMAIN` | `MICA_ADMIT_GROUPS`, `MICA_ADMIT_DOMAINS` |

**Why:** an unprefixed name such as `REPOSITORY_TOKEN` or `SESSION_SECRET`
collides with other software in the same environment, and an operator cannot
tell which variables are Mica's. All four `MICA_ADMIT_*` take lists, so all
four are plural. `LOGIN_*` limits the start of an OIDC sign-in; Mica has no
password login. No aliases, because 0.x allows the break and no known
deployment depends on the old names; an alias table would be code to carry
through all of 1.x. Reading the site's `.env` gave the editor the site's
`NODE_ENV` and secrets, and a site with `NODE_ENV=production` stopped it.

**Consequence:** every deployment must rename its variables to upgrade to 0.6.
A local-editor user
who kept settings in `.env` must pass them as flags or export them.

**What would change it:** an adopter on 0.x who cannot rename in one step; then
add aliases with a warning for one minor.

**Built in 0.6:** the rename (#57), with a reference at
`micacms.com/docs/configuration` that a test keeps complete, and the local
editor reads no `.env` file, and its flags win over the environment (#113).
The runtime has no default content root any more; each app sets it.

**1.0 status:** done.

---

### P2 — The admin HTTP API is internal and unversioned

**Decided:** `/api/admin/*` and `/api/auth/*` are not part of the semver
contract and carry no version in the path. The admin SPA is their only
supported client.

**Why:** the SPA and the runtime ship together in one image and one
`@micacms/editor`, at one lockstep version, so they can never disagree after a
reload: `index.html` is served `no-cache`, and the hashed assets are immutable.
A versioned API would freeze the editor's internals for a client that does not
exist, and it would come close to the content API that this project removed.

**Consequence:** a script that calls the admin API can break in any release.
An editor tab that stays open during an upgrade runs the old SPA against the
new API until it reloads.

**What would change it:** a real need for a second client, for example a
command-line publish. That client would get a small, separate, versioned
surface, not the admin API.

**Trigger:** the first request for automation against a running Mica.

**1.0 status:** accepted for 1.0; #54 lists it as internal.

---

### P2 — The project lives in the `micacms` organization

**Decided:** the repository moves to `micacms/mica` and the image to
`ghcr.io/micacms/mica`, before the repository becomes public. The product name
follows the organization, as in `payloadcms/payload`; `cms` alone is too generic
for a clone directory or a compose file.

**Why:** a public image name cannot move later. GitHub redirects repository
URLs after a transfer, but not GHCR image names, so a later move breaks every
`docker pull` and compose file that adopters have. While the repository is
private, nobody outside depends on the old names. The organization matches the
npm scope `@micacms` and the domain `micacms.com`, and it can take a second
maintainer without moving again.

**Consequence:** a one-time move: transfer the repository, add the Actions
secrets again, let the first release create the GHCR package under the
organization and make it public, and replace every `amuedespacher` reference.
The old `ghcr.io/amuedespacher/micacms` tags stay private and are not
continued.

**What would change it:** nothing short of a rename of the project.

**1.0 status:** blocker; the move is in #51.

---

### P2 — Node.js 24 or later, and Astro 7

**Decided:** 1.0 supports Node `>=24` and Astro 7 (peer range `^7.0.0`). The
`engines` fields, `rush.json` and the CI matrix say the same. Mica removes a
Node line in a minor after its upstream end of life, announced in the changelog
one minor before. A new Astro major is added in a minor once CI covers it;
removing an Astro major is a Mica major.

**Why:** the image and CI already run Node 24, and only what CI tests is
supported. Node 22 reaches its end of life on 2027-04-30, close to 1.0. (Its
`node:sqlite` was a second reason until 0.5.0 removed the database.) Astro 6 was in the peer range until 0.6, with no test. Removing an
end-of-life Node in a minor is common FOSS practice, and the alternative keeps
an unmaintained runtime in the matrix for all of 1.x.

**Consequence:** a site on Node 22 cannot run `npx @micacms/editor` or
`@micacms/astro` until it upgrades. A site on Astro 6 stays on Mica 0.x.

**What would change it:** an adopter that cannot leave Node 22 or Astro 6
before 1.0; then add that line to the CI matrix rather than promise it untested.

**Built in 0.6 (#130):** `>=24` in every `engines` field and in `rush.json`,
and the `astro` peer range is `^7.0.0`.

**1.0 status:** blocker until the CI matrix is in place (#131).

---

### P2 — The local editor runs on Linux, macOS and Windows; the image on amd64 and arm64

**Decided:** the local editor supports Linux, macOS and native Windows, and CI
runs the core, connectors and local-editor tests on all three. The self-hosted
image is a multi-architecture image for `linux/amd64` and `linux/arm64`, and
carries `git` for both.

**Why:** the people who edit content, and many agencies, work on Windows, and
the local editor runs `git` and handles file paths, which is where Windows
differs. Only a CI job keeps that working. Cheap arm64 servers are common at
the hosts that the self-hosting guide suggests, and Apple Silicon runs an
amd64 image only under emulation. A public repository gets Windows, macOS and
native arm64 runners for free, so neither costs QEMU or money.

**Consequence:** the first Windows run will find path defects to fix before
1.0. Each release builds the image twice.

**What would change it:** a Windows defect class that costs more than it
serves; then document WSL instead of native Windows.

**1.0 status:** blocker; the matrix is in #131, the image build in #132.

---

### P2 — github.com and gitlab.com are supported; self-managed providers are experimental

**Superseded in 0.5.0** by "Any Git host over HTTPS; supported means
live-tested". The rule it set — supported means live-tested — carries over.
Kept as history.

**Decided:** the supported providers of the self-hosted Mica are github.com and
gitlab.com. GitHub Enterprise Server and self-managed GitLab are
"experimental": they work through `MICA_REPOSITORY_API_BASE`, and they carry no
promise. The local editor publishes with the `git` binary, so it works with any
remote, and this entry does not limit it.

**Why:** supported means live-tested. The weekly `live-connectors` workflow
covers the two hosted providers once its tokens exist (#38). GHES cannot run in
CI without a licence, and a GitLab CE container is a heavy weekly job for one
maintainer.

**Consequence:** a defect that appears only on a self-managed instance is fixed
when someone reports it, not found by CI. github.com and gitlab.com count as
supported only when the live suites pass without skipping.

**What would change it:** an adopter on a self-managed instance who can give
the live suite a scratch project there.

**1.0 status:** blocker until #38 runs live; the labels go in the support
matrix (#131), the journeys in #83.

---

### P2 — The 1.0 scale target: 1,000 entries, 5,000 files, 5 editors

**Decided:** Mica 1.0 commits to 1,000 entries per collection, 5,000 files in
the content tree and 5 editors at the same time. The budget tests (#72) use a
fixture of that size and fail when a view exceeds its call or time budget.
Above these numbers, Mica can work, but it makes no promise.

**Why:** this covers brochure and agency sites with a blog or news archive,
which is who Mica is for. Search filters in the browser, which is fine at 1,000
entries. A larger target needs server-side search and paging. (Until 0.5.0 the
first limit was the provider's rate limit; reads now come from the clone on
disk, and the spike measured a 5,000-file, 2 GB clone at 18 s and a normal
sync at under a second.)

**Consequence:** a site with a larger archive must split it into more
collections or accept unmeasured performance.

**What would change it:** an adopter above the target; then measure their
shape first, and raise the numbers only with the budget tests.

**1.0 status:** blocker; the budget tests are in #72.

---

### P2 — Only the latest 1.x minor gets fixes; 0.x ends at 1.0

**Decided:** fixes, security fixes included, go into the next release of the
latest 1.x minor. An earlier minor gets none: the upgrade within 1.x is the
fix. 0.x reaches its end of life when 1.0 ships, with no backports. The window
for 1.x after a 2.0 is decided at 2.0.

**Why:** one maintainer, one lockstep version and one branch, `main`. Each
extra supported line needs a release branch, backports and a release flow that
works from it. A minor in 1.x has no breaking change by definition, so moving
to the latest minor is safe. No known deployment depends on 0.x.

**Consequence:** an adopter who cannot take a minor gets no security fix.
A 0.x deployment must take the breaking upgrade to 1.0 to get any fix. Agencies
cannot plan a 2.0 upgrade window yet.

**What would change it:** a second maintainer, or adopters who need a fixed
window; then add security fixes for the previous minor or major with a release
branch.

**1.0 status:** accepted for 1.0; #54 publishes it.

---

### P2 — 1.0 ships after two weeks of release candidates on real websites

**Decided:** `1.0.0-rc.N` is published under the `next` dist-tag. 1.0.0 ships
when one or two real websites, ideally of different kinds, have run on the
release candidates for at least two weeks, and at least one of them through the
self-hosted image. The maintainer's own websites count; the example and
`sites/micacms` alone do not. A fix gives a new `rc.N` and keeps the clock; a
breaking change to a public surface restarts the two weeks.

**Why:** a real site finds what CI cannot: a provider, an identity provider and
a host in combination. Requiring an outside team would make the release date
depend on a volunteer. Two kinds of site exercise more of the content model
than two copies of one. A fix does not invalidate the evidence; a break does.

**Consequence:** the evidence comes from a maintainer who knows the system, so
gaps in the docs and the onboarding stay less visible. The clean-machine runs
of #53 must cover that.

**What would change it:** an external team that offers to run a candidate;
take it, and keep the two-week rule.

**1.0 status:** blocker; the phase is in #53, the dist-tag in #127.

---

### P2 — The self-hosted server ships only as the image

**Decided:** `@micacms/self-hosted` is no longer published to npm. It keeps the
lockstep version, because the image tag is derived from it. The versions
already on npm are deprecated with a pointer to the image.

**Why:** the package has no `main`, `bin` or `exports`, so nobody can use it as
published, and the image builds from source, not from npm. A real `bin` would
add a second server product, with its own CLI, docs and CI, to keep stable
through 1.x.

**Consequence:** the self-hosted Mica runs only as a container. A Node host
without Docker is not supported.

**What would change it:** a real demand for a Docker-free server, for example
on a Node PaaS; then add a `bin` and put it under semver.

**Built in 0.6 (#129):** `apps/self-hosted` is `private` and has no version
policy, so `rush publish` skips it; `scripts/version.mjs --sync` still sets its
version. Deprecating the versions on npm needs an npm login.

**1.0 status:** done, except the deprecation.

---

### P2 — No native multilingual content in 1.0

**Decided:** the content model has no locale concept in 1.0. The docs describe
two patterns: an object per field (`title: object({ de, fr, en })`) for pages
and singletons, and one collection per locale for streams that differ per
locale, such as news. The content-format specification commits a later
`localized` option to the object-per-locale layout, so it stores exactly what
the first pattern stores today, `body.de.mdoc` included.

**Why:** both patterns work with the current model and need no code. Keeping
the translations of a page in one entry stops them drifting; separate
collections fit content that exists in one language only. Fixing the future
layout now means a site that follows the documented pattern upgrades to native
i18n with no file change.

**Consequence:** no locale switcher in the editor, and long forms with the
object pattern. Localized URLs need a slug field per locale, or the collection
pattern. A future `localized` cannot pick a different layout without a
migration.

**What would change it:** the first site where the forms become unusable, or
where translators need to see only their language.

**1.0 status:** accepted for 1.0; the pattern is in #125, the layout rule in
the format specification (#58).

---

### P2 — A layout change is migrated by a command, not by a lenient reader

**Decided:** `npx @micacms/editor migrate-layout` rewrites every entry whose
layout no longer matches the model, in the working tree, and the developer
commits the result with the model change. The reader stays strict: an entry in
the other layout is an error (#64). The manifest records each collection's
layout, so a change shows in the diff of `.mica/schema.json`. The command
removes a sidecar only when no field still refers to it, and lists each file it
removes.

**Why:** a model change is always a developer's change in the site repository,
so the developer is there to run a command. A reader that accepts both layouts
would make both shapes part of the content format for all of 1.x, in `core` and
in the Astro loader, and entries that nobody edits would keep the old layout
forever.

**Consequence:** a developer who changes the model and forgets the command gets
a failing build and editor, not silent data loss. The command is part of the
semver-covered CLI.

**What would change it:** model changes made where nobody can run a command,
for example from the editor itself.

**Built:** the manifest records `layout` for each collection and singleton
(#60). In 0.6, the reader refuses an entry in the other layout (`LayoutError`),
so the Astro build fails, both apps refuse to start, and a list request answers
409 (#64); `mica migrate-layout` moves the entries (#65).

**1.0 status:** done.

---

### P2 — A text `pattern` is a full match, with the `u` flag

**Decided:** `text({ pattern })` must match the whole value: Mica compiles it as
`new RegExp("^(?:" + pattern + ")$", "u")`. An invalid pattern fails when the
model loads, not at the first save.

**Why:** a pattern on a text field almost always describes a whole value, such
as a code or an ID, and the HTML `pattern` attribute is a full match too. The
code applied it unanchored while the JSDoc said anchored, so one of them had to
change, and after 1.0 either change is breaking. The `u` flag counts code
points, not UTF-16 halves, so an emoji is one character; its stricter syntax is
a break of the same kind, so both are taken at once.

**Consequence:** a "contains" rule needs `.*x.*`. A pattern with a loose escape,
such as `\-` outside a class, stops the model from loading. Both are breaking
changes before 1.0, with a changelog entry.

**What would change it:** nothing in 1.x; the rule is part of the content
format.

**Built in 0.6 (#59).**

**1.0 status:** done.

---

### P2 — The manifest changes only when the model changes

**Decided:** `.mica/schema.json` holds the model, `protocolVersion`,
`generatedBy` without a package version (`"@micacms/astro"`), and the `layout`
of each collection and singleton. Nothing else: no package version, no
timestamp, no build data. The history of the model is the Git history of the
file, and a running Mica tells models apart by the fingerprint it logs and
shows. There is no separate JSON Schema for the file: `checkSchema` validates
it when Mica starts, and `mica check` runs the same check in CI.

**Why:** a self-hosted Mica holds its sync and refuses to publish after any
change to the file, until it restarts. With a package version in the file,
every `@micacms/astro` update in a site, even a patch, would stop the editors,
and every Mica release would change the committed manifests. A JSON Schema
would be a second statement of the field types to keep in step for all of 1.x.

**Consequence:** the manifest does not say which version of `@micacms/astro`
wrote it; the site's lock file does. A reader acts on `protocolVersion` and on
the field kinds it finds, never on a package version.

**What would change it:** an editor or tool outside Mica that must validate
the file without running Mica; then publish a JSON Schema generated from the
same source as the types.

**1.0 status:** accepted for 1.0.

---

### P2 — An unknown field kind makes its collection read-only

**Decided:** when the manifest uses a field kind that this build of Mica does
not know, Mica still starts. The collection or singleton that contains the
kind opens read-only, with a warning that names the upgrade; every other
collection stays editable. A manifest with a newer `protocolVersion` is still
refused, because that is the signal for a change that cannot degrade. Mica
reads each collection's layout from the manifest (see the layout entry), not
from fields it cannot interpret.

**Why:** a developer upgrades `@micacms/astro` with the site, and the operator
upgrades the image on another schedule. Refusing to start locks out every
editor over one field. Locking only the field would need saves to round-trip a
value and sidecars that Mica does not understand; locking the collection means
Mica never writes what it cannot interpret.

**Consequence:** an editor cannot change anything in that collection until the
image is upgraded. The versioning policy says: upgrade the image first, or at
the same time.

**Built (#60):** `readOnlyParts` in the runtime names the parts. Writes and
uploads are refused with the reason, and Publish refuses their pending
changes. The editor shows a notice and a placeholder for the unknown field;
`mica check` reports the part as an error and checks the rest. Entries are
read where the manifest's `layout` says. A collection whose recorded `layout`
is not the one this build derives is read-only too.

**What would change it:** editors who are often blocked by this; then lock
only the field, with a tested round trip of unknown values.

**1.0 status:** the behaviour is built; the rule for operators is still a blocker in #54.

---

### P2 — Alt text is an opt-in on the media field

**Decided:** `media({ alt: "required" | "optional" })` stores `{ path, alt }`
and shows an alt-text input beside the preview. A `media()` without the option
still stores a plain path string, so existing content stays valid. The
getting-started guide and the example use `alt: "required"`. A multilingual
site keeps `media()` and puts a localized `alt` object beside it, because
`{ path, alt }` holds one language.

**Why:** with only a path, the default leads adopters to images with `alt=""`,
which fails WCAG 1.1.1. An input beside the preview is where an editor sees
it. Opt-in keeps the change additive and the stored shape of every existing
field the same.

**Consequence:** a media value has two shapes, chosen by the model, and the
format specification and the Astro types carry both. The multilingual form
places the alt text away from the preview.

**What would change it:** native i18n (see "No native multilingual content");
a localized `alt` then belongs in the media value.

**Built in 0.6 (#61):** the option, the stored shape, the editor input, the
Astro types, `mica check`, the guides and the `mica init` starter. A stored
plain path reads as one without alt text, so adding the option is safe. The
example still uses plain paths.

**1.0 status:** blocker until the example uses it; the Astro helper is in #109.

---

### P2 — An upload from an entry goes into that entry's folder

**Decided:** a file uploaded from an entry's form goes into that entry's
`media/` folder and is stored as `media/x.jpg`. A file uploaded from the Media
view goes into the shared `media/` folder at the content root and is stored as
`/media/x.jpg`. The picker offers the entry's own files and the shared ones,
never another entry's. An upload in a new entry is staged under the slug, and
moves with it if the slug changes before the first save.

**Why:** this is what the docs say and what the layout rule assumes: a `media()`
field forces the directory layout because its files sit beside the entry. An
entry's files then go with it on a delete or a rename, and `media/x.jpg` stays
valid after a slug change. Site-wide files, such as a logo, still have one
place.

**Consequence:** the same image used by two entries is either shared, through
the Media view, or stored twice. Deleting an entry deletes its files.

**What would change it:** editors who mostly reuse images across entries; then
default the picker's upload to the shared folder, which the layout rule would
no longer justify.

**1.0 status:** should for 1.0; the fix is in #102, the path forms in #58.

---

### P2 — Publish refuses a broken reference that it would create

**Decided:** Publish refuses a change set that would leave a relation to a
missing entry or a media path to a missing file: a changed document that links
to nothing, or a deleted entry or file that another document still uses. The
problem names the field and the entries. A broken reference in a document that
the change set does not touch does not block Publish. The Astro loaders warn
about every broken reference, and fail the build with `strict: true`.

**Why:** a broken link or a missing image on the site is silent loss, and
Publish is the last point where Mica can stop it. Refusing references that
were already broken would let one old mistake block every publication.

**Consequence:** deleting an entry, or changing its URL, needs the links to it
changed first, until #70 updates them. The check reads every collection when
the change set deletes something.

**What would change it:** a site with so many entries that the scan at a
deletion is slow; then index the references.

**Built in 0.6 (#69, #111).**

---

### P2 — Media reach Astro as paths, with a supported helper

**Decided:** a media value stays a path string in Astro (or `{ path, alt }`
with the alt option). `@micacms/astro` ships `resolveMedia(path)` and a
`<MicaImage>` component from an uncompiled `.astro` subpath. They resolve both
path forms, use the alt text when there is one, and warn in development, or
fail the build if the site asks, when a file is missing. The integration
generates the `import.meta.glob` for the configured content root.

**Why:** a `media()` field can hold a PDF as well as an image, and Astro's
`image()` handles images only. `image()` resolves paths relative to the entry
file, so the shared `/media/` form would need special handling, and switching
to `ImageMetadata` would change the value type for every site. Today each site
copies the example's glob map, which hard-codes `/content/` and renders nothing
for a missing file.

**Consequence:** a site that wants Astro's image optimization goes through the
helper, not `image()` in the schema. A missing file is a warning unless the
site turns on the build failure.

**What would change it:** Astro's `image()` resolving arbitrary roots and
non-image files; then offer `ImageMetadata` as an opt-in.

**1.0 status:** should for 1.0; the helper is in #109.

---

### P2 — No draft preview in 1.0; a link to the published page

**Decided:** 1.0 has no preview of unpublished changes in the self-hosted Mica.
An optional model option, such as `url: "/news/{slug}"`, together with
`MICA_SITE_URL`, shows "Open on website" in the entry header and after a
publish. It is only a link. A docs page describes the staging-branch setup and
the deploy previews of the common hosts. A live draft preview comes after 1.0.

**Why:** drafts are uncommitted files in Mica's clone, not on any branch the
host builds, so a host's deploy preview cannot see them, and Mica must not
call the website or trigger a build. A link
couples nothing. A staging branch with a second Mica already gives a reviewed
preview with no code.

**Consequence:** a self-hosted editor sees a change on the website only after
publishing it, or on a staging site. The local editor keeps `astro dev` beside
it.

**What would change it:** editors who publish to check their work. The next
step is a "Preview" action that force-pushes the pending change set to a branch
such as `mica/preview` for the host to build: Git only, no webhook, at the
cost of build minutes and a second branch that Mica writes. Since 0.5.0 Mica
pushes with Git itself, so this is a commit on a second branch rather than a
second API.

**1.0 status:** should for 1.0; the link and the docs are in #103. The live
preview is after 1.0.

---

### P2 — Publish a selection; `required` is checked at Publish, not at Save

**Decided:** the Publish page lets an editor select groups of pending changes.
Only the selected groups are validated and committed; the rest stays pending
in the one shared change set. A group keeps together what must not be split:
an entry, its media and its collection's `_order.json`, both halves of a URL
change, and any pending shared upload that a selected entry refers to. Save
checks types and formats, `pattern` and lengths included, but not `required`;
an entry with a missing required value is saved and marked "incomplete".
Publish refuses a selected group that is incomplete.

**Why:** with all-or-nothing, a typo fix waits for, or carries, a colleague's
unfinished article. With `required` at Save, a half-written article cannot be
saved at all, and closing the tab loses it. The two belong together: a lenient
Save puts incomplete documents in the change set, and selection is how the
complete ones get published around them. Selection inside the one change set
keeps the decision against per-editor drafts.

**Consequence:** the change set can hold documents the site's schema rejects.
In the local editor, the working tree is the draft workspace, so `astro dev`
and a local build see an incomplete entry until it is finished. Publish still
never commits one.

**What would change it:** groups that editors find too coarse, or too
surprising when a shared upload comes along.

**Built in 0.5.0, the server half:** Publish takes the reviewed paths with the
revision each had in the review, commits exactly those, and refuses only when
one of them, or another file of the same entry, changed since. The Publish
page still sends every pending path; the selection UI and `required` at
Publish are still #98.

**1.0 status:** should for 1.0; both are in #98. The "One shared pending change
set" entry has its note.

---

### P2 — Images in rich text are kept as blocks; inserting them comes after 1.0

**Decided:** in 1.0, an image or a table in rich text opens as an atomic block:
an image shows a thumbnail and its alt text, and a table a read-only notice.
The text around them stays editable, and an unchanged block is written back
byte for byte. Editors cannot insert or edit an image in rich text in 1.0; a
toolbar option `"image"` adds that in a 1.x minor.

**Why:** losing an image when a field opens is data loss, and #62 fixes that in
any case. Blocks make such fields editable again with little code. Inserting
images needs the picker, an alt-text dialog, and every media-reference check to
scan rich text as well: the "not used" hint, the shared uploads that a
selective publish brings along, and the Astro rendering. That is additive, so
it can wait for a minor.

**Consequence:** an editor who wants an image inside the body text asks a
developer, or uses a `media()` field beside it.

**What would change it:** the first editor who needs an image in body text more
than once a month.

**1.0 status:** blocks are should for 1.0 (#63). No data loss is built in 0.6
(#62): such a field opens read-only. Inserting images is after 1.0.

---

### P2 — "Keep mine" at a conflict, after a comparison, traced in Git

**Decided:** when the repository changed a document after a draft was based on
it, the editor sees both versions side by side, field by field, and chooses.
"Use current" discards the draft. "Keep mine" moves the draft's base to the
current revision. The server logs that choice with the subject, and the publish
commit message names the revision it replaced.

**Why:** discard as the only answer makes the editor pay for someone else's
change. The comparison makes the overwrite a choice, not an accident. Git is
the history, so the trace belongs in the commit, where a developer finds it
next to the change that was replaced; a server log is visible only to the
operator.

**Consequence:** an editor can replace a developer's fix with an older text.
The fix stays in Git and is one revert away, and the commit says which one.

**What would change it:** frequent conflicts on the same fields; then merge per
field, which is after 1.0.

**Built in 0.5.0, in part:** a change on the website to an entry that has a
draft in Mica's clone is a conflict, per entry. The Publish page compares the
draft with the website's version (`origin/<branch>`, not HEAD) and offers
"Keep my version" and "Use the website's version"; Keep mine moves the draft
onto the new head exactly as above. The server logs the choice. The commit
trailer that names the replaced revision is still to do.

**1.0 status:** should for 1.0; the trailer, and conflicts on save in the
local editor, are in #97.

---

### P2 — Mica neither stores nor shows SVG

**Decided:** the media upload refuses SVG with a message that says why. An SVG
that is already in the repository is not listed in the editor, and the admin
media route refuses to serve it. A file counts as SVG by its bytes or by its
`.svg` name, so a leading comment cannot hide one. Every file the media route
serves carries `Content-Security-Policy: sandbox; default-src 'none'`, and a
file that is not an image is sent as `Content-Disposition: attachment`. Both
editors behave the same. The website build is not affected: it reads SVGs from
the repository as before.

**Why:** an SVG can carry a script, and on the admin origin that script runs
with the editor's session, Publish included. Showing repository SVGs in a
sandbox was the first plan; refusing them is simpler and closes the case
completely, and no deployment depends on the old behaviour yet. Sanitizing
would need a large new dependency and would make its correctness a security
promise. SVGs such as logos and icons come from a developer through Git.

**Consequence:** an editor cannot add an icon or a logo; a developer must. A
media field that points at an SVG shows no preview in the editor.

**What would change it:** editors who need to see or upload vector graphics;
then show SVGs as sandboxed previews first, and an upload opt-in with
server-side sanitizing after that, in a 1.x minor.

**1.0 status:** blocker; done in #86.
---

### P2 — The website is the one source of user documentation

**Decided:** the user guides live in `sites/micacms/content/docs` as Mica
content and are published on micacms.com: getting started, the content model,
self-hosting, and the new configuration, versioning, support and
content-format pages. `docs/` keeps the documents for contributors:
architecture, decisions and the historical plans. READMEs, CLI messages and
server messages link to the website. Changes in `sites/micacms` need no
approval, so a code change updates the docs in the same pull request.

**Why:** two hand-kept sets drifted (54 lines against 218 for one page) and the
website made claims the code does not keep. The website is a Mica site, so
writing the docs in Mica is the daily test of the editor. Links to micacms.com
are stable for npm users, who have no repository paths.

**Consequence:** the guides are Mica content, not plain Markdown files beside
the code, and they follow the website's content model. Tests that check the
docs against the code, such as the configuration list (#57), read that
content. A reader on GitHub follows a link to the website.

**What would change it:** docs that need a version per release, which a single
website does not give.

**1.0 status:** blocker; the move and the corrections are in #117.

---

### P2 — Mica is a hobby project, and says so

**Decided:** `GOVERNANCE.md` states that Mica is a hobby project of one
maintainer, built largely with AI-assisted ("vibe") coding, and maintained on a
best-effort basis. It promises no response times and no co-maintainer. 1.0 does
not wait for a second maintainer or a second account owner.

**Why:** an honest statement lets an adopter weigh the risk; a promise one
person cannot keep is worse than none. A co-maintainer, like an outside
adopter, is not in the maintainer's control, so it cannot gate a release.
Saying how the code is written lets a reader judge it by its tests and reviews.

**Consequence:** an agency that needs a response time or continuity must plan
for it itself, for example by being able to fork. One account owns the GitHub
organization, the npm scope, the domain and the release secrets; losing it
stops releases.

**What would change it:** a second person who wants to maintain Mica, or
adopters who depend on it commercially; then add a second owner of the
accounts first, and a co-maintainer second.

**1.0 status:** accepted for 1.0; the statement is in #52.

---

### P2 — No independent security review before 1.0

**Decided:** nobody outside the project reviews the OIDC and session code
before 1.0, and `SECURITY.md` says that Mica is not independently audited.
Instead, CodeQL and a dependency audit run in CI, and the maintainer reviews
the authentication, session, CSRF and admission code against the OWASP ASVS
level 1 checklist and commits the result. Once the repository is public, the
project asks the community for a review. `SECURITY.md` answers reports on a
best-effort basis, with no response times.

**Why:** a paid review does not fit a hobby project, and a volunteer review is
not in the maintainer's control, so neither can gate 1.0. The protocol itself
is `openid-client`, which is widely reviewed; Mica's own part is the admission
rules, the encrypted cookies, CSRF and rate limiting. A committed checklist
makes the self-review checkable by anyone.

**Consequence:** an adopter who needs an audit must commission one. The
self-review finds what its author can see, which is less than an outsider
would.

**What would change it:** an outside reviewer who offers, or an adopter who
funds a review; take it, and publish the result.

**1.0 status:** blocker for the CodeQL job and the checklist (#84); the outside
review is after 1.0.

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

**1.0 status:** accepted for 1.0.

---

### P3 — Rich text that the editor cannot show opens read-only

**Decided:** a rich-text field whose stored Markdoc has a node that the editor
cannot show — a `{% tag %}`, an image, a table, an attribute such as
`{% .class %}`, a link title — opens read-only. The field names what it found
and shows the source; the stored text is written back unchanged. The same
happens when Tiptap refuses the content. The editor's schema always holds
every node it can show; the `toolbar` option limits only the buttons, so a
stored heading in a field without heading buttons still loads.

**Why:** before 0.6, a tag lost its wrapper, an image disappeared, and a
heading that the toolbar did not offer made Tiptap open the field empty; the
next save wrote that loss to the file (#62). Read-only keeps every byte; a
developer can still change the file.

**Consequence:** an editor cannot change such a field in Mica until a developer
removes what the editor cannot show, or until blocks (#63) make it editable.

**What would change it:** a Tiptap node per declared tag, generated from the
model the way fields already are, and image and table blocks (#63).

**Built in 0.6 (#62).**

**1.0 status:** done.

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

**1.0 status:** accepted for 1.0.

---

### P3 — A renamed entry is recognised by its content

**Decided:** the Publish page shows a URL change as one renamed entry when a
deleted and a created entry of one collection agree on at least half of their
non-empty fields, the slug aside. Otherwise they stay one removal and one
addition.

**Why:** an entry has no identity but its slug, and the pending change set
holds only files. Git has no record of a move either: a commit that deletes the
old folder and adds the new one is a rename because Git compares the contents.
The Publish page uses the same rule, so it agrees with `git log --follow`.

**Consequence:** a rename that also rewrites most of the entry shows as a
removal and an addition. A small entry whose title and URL change together can
fall under the threshold in Git too, and its history then stops at the rename.

**What would change it:** a rename recorded explicitly in the draft workspace.
The working tree has no place for that record, so it would need one first.

**1.0 status:** accepted for 1.0.

---

### P3 — Setup by a coding agent: the entry on the website, the guides in the package

**Decided:** `SETUP.md` in the repository root is served at
`micacms.com/setup.md`. It finds the project's situation, installs the
packages and sends the agent to one guide in `@micacms/astro/setup/`. The
guides cover a new or empty Astro project and a project with content
collections; moving content from another CMS is a placeholder. `mica check`
is the agent's "done" signal, and `mica init` writes the starter files.

**Why:** the website deploys from `main` and the packages from a tag, so a
guide on the website can describe a version that `npm install` does not give.
In the package, a guide always matches the installed code. The entry file only
routes, so it stays valid for every version. A setup without a check that an
agent can run alone ends with "the browser opened", which proves nothing about
the content.

**Consequence:** a guide change reaches users only with a release. `SETUP.md`
must not name a version-specific API.

**What would change it:** a second framework besides Astro, which would need
its own guides in its own package.

**1.0 status:** accepted for 1.0.

---

## Deferred scope

Explicitly not built. Everything in this section is after 1.0.

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

**Out of 1.0.** These are not built for 1.0, and the "Scope and non-goals" page
(#124) lists them with how to work without them. Each can come in a 1.x minor
without a break.

- **Roles.** Every admitted editor can do everything, Publish included.
  Trigger: a site whose editors must not all publish.
- **Approval workflows and scheduled publishing.** A publish is immediate. A
  staging branch with a second Mica is the review step. Trigger: a customer who
  needs a sign-off or a timed release.
- **History and revert UI.** Git is the history; the docs show how to revert a
  publish with Git. Trigger: editors who ask a developer to revert more than
  rarely.
- **A blocks field.** A repeater has one item shape; there is no page builder
  with differently shaped items. It would be a new field kind. Trigger: a site
  whose pages are composed of sections of different kinds.
- **Media delete.** A published shared file cannot be deleted from the editor,
  because a delete needs a scan of all content, rich text included, for
  references. An entry's own files go with the entry, and a pending upload can
  be discarded. Trigger: shared media folders that editors cannot keep tidy.
- **A branch switcher.** One Mica serves one branch. Trigger: a team that needs
  to edit more than one branch from one deployment.
- Decided elsewhere in this file: native multilingual content, a draft preview,
  and inserting images in rich text.

## Known gaps to close

- **P3** — The browser test covers one path. CI drives Chromium through "sign
  in, edit, save, publish, sign out" on one singleton
  ([`tests/browser/`](../tests/browser/README.md)). Collections, media,
  discard, conflicts and the local editor are covered by the API tests and by
  hand. Add a path when a regression reaches the UI unseen.
  **1.0 status:** after 1.0; #108 adds accessibility checks on every view.
- **P2** — The group claim is verified by hand, not by CI. CI runs the real
  image against Dex on every pull request ([`tests/oidc/`](../tests/oidc/README.md)):
  sign-in, the email and domain rules, a refusal, CSRF and an edit. Dex's
  built-in users carry no groups, so the group rule against a real provider is
  still only `tests/e2e/compose.yml` (Keycloak) and
  `deploy/demo-identity/compose.yml` (ZITADEL), run by hand. A claim whose name
  and shape differ per provider is exactly what a unit test cannot check.
  **1.0 status:** accepted for 1.0.
- **P2** — The live workflow needs its secrets. `live-git.yml` runs
  `apps/self-hosted/test/live.test.ts` every Monday against scratch
  repositories on github.com and gitlab.com: clone, write check, one
  publication, push. It skips a host whose `MICA_LIVE_*` token or repository is
  not set, and the skip shows. The GitHub half passed by hand on 12 October
  2026; the secrets are not configured yet. Self-managed hosts and GitHub
  Enterprise Server stay untested.
  **1.0 status:** blocker (#38).
- **P2** — Git LFS under the content root is refused. Without the LFS filter,
  Mica would commit whole files where LFS should hold pointers, so it stops
  at start (and holds a sync) when a `.gitattributes` assigns `filter=lfs`
  under the root. Support needs the filter configured before the first
  checkout, `lfs.url` from the environment and `git lfs push` before each
  push; the plan has the details.
  **1.0 status:** after 1.0, before the first adopter with large media.
- **P3** — Only HTTPS remotes. SSH deploy keys, a private CA
  (`http.sslCAInfo`) and a token that rotates without a restart (a GitHub App
  installation token lives an hour) are not supported yet.
  **1.0 status:** on demand.
- **P3** — A file under the content root that `.gitignore` hides is never
  published, and the change list does not show it. Mica writes only content
  files, so this needs a developer's `.gitignore` rule that covers content.
  **1.0 status:** accepted for 1.0; a warning on the Publish page is the fix.
- **P3** — If the rollback of a failed fast-forward fails too (for example on
  a lock that an operator's shell holds), `operation.json` stays, and the next
  start finishes that fast-forward without a new conflict check. The docs tell
  operators to run only `GIT_OPTIONAL_LOCKS=0 git status` in the container.
  **1.0 status:** accepted for 1.0.
- **P3** — A host that requires signed commits, or that allows changes only
  through pull requests, refuses Mica's push. Mica turns the publication back
  into drafts and shows the host's reason; it cannot sign or open a request.
  **1.0 status:** on demand.
- **P3** — Entry search filters in the browser over the whole collection. Fine at
  the stated scale (hundreds to low thousands); a repository large enough to
  need an index is a repository large enough to need a different design.
  **1.0 status:** accepted for 1.0, at the scale target.

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
  cannot show it from there. It is served without a new route at all: the
  existing **authenticated** admin media route reads the working tree, so
  pending uploads are served behind the same session as everything else, and
  nothing is reachable signed-out. If media
  bytes are ever served without a session, the public media route this
  decision forbids has come back.
- **Publishing is not a webhook.** A push is the trigger. An in-process queue
  cannot survive a crash, and the repository's CI already solves this. Autosave
  is not a trigger either: the successful remote branch update is, which is the
  point of separating the two.
- **Rich text is Markdoc, never HTML.** The editor converts at the boundary and
  must never call Tiptap's `getHTML()` — see `packages/editor-ui/src/lib/markdoc.ts`.
- **Git is the history.** No revision table, no retention policy, nothing to
  prune. The drafts are not a second history and must never become one: the
  working tree holds exactly the current pending change set, and a
  publication commits what it published.
- **The local editor carries no auth code.** `@micacms/editor` installs no OIDC
  dependency and bundles no auth code.
  `apps/local-editor/test/boundary.test.ts` checks the resolved dependency
  graph, the app's own imports and the built browser bundle, and CI runs it with
  `rush test`. A helper shared by the two apps belongs in `@micacms/runtime`,
  never in `@micacms/auth-oidc`.
- **Nothing hashes a password.** Reintroducing one would mean owning reset, MFA,
  passkeys and breach response, which is the whole reason it is not here.
