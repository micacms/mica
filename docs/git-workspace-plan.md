# Mica on a Git working tree — Refactoring Plan

Status: draft 3, after two review rounds (section 15); approved (section 14)
Last updated: 12 October 2026

## 1. Purpose

Today, Mica has two draft workspaces. The local editor writes the developer's
working tree and publishes with `git`. The self-hosted app keeps drafts in
SQLite and publishes through the GitHub or GitLab REST API. The second path is
slow (each read is one HTTP call, in series, with no cache), it is limited by
provider rate limits, it needs the broad GitLab `api` scope, and it works with
two hosts only.

After this plan, both apps use **one workspace model: a Git working tree**.

- The local editor works on the developer's checkout, as today.
- The self-hosted app keeps **its own clone** on its data volume. Mica clones,
  fetches, fast-forwards, commits and pushes.
- **No database.** The working tree holds the unpublished drafts.
- Mica uses no provider API. **Any Git host over HTTPS should work.** The
  supported hosts are the ones that are tested (D15).

This document says what to build, in which order, and what to remove. The
change ships as one pull request with one focused commit per step (section 7),
released first as `0.5.0-rc.N`.

### Non-goals

- No editor features beyond what the new model needs: the sync state and the
  conflict actions.
- No change to the content format, the manifest protocol, `@micacms/astro` or
  the Astro loader.
- No change to authentication, admission or sessions.
- No change to `examples/muster-consulting`.
- **Not in this PR:** Git LFS and SSH remotes. Each gets its own follow-up PR
  (section 11).

---

## 2. Target architecture

```
@micacms/runtime
  services ── content store · media · changes and publish
      │ files                          │ git
      ▼                                ▼
  ContentFiles ─── same tree ───── GitTree (status, commit, push, discard,
  (read, list, revision, apply)            HEAD and origin reads)
                                       │
                       OwnerPolicy interface · developer policy · locks

@micacms/editor        = runtime + developer policy + no auth + loopback guards
@micacms/self-hosted   = runtime + managed policy + OIDC
                          managed policy: clone, sync, conflicts, push retry,
                          credentials, isolation, `check` command
```

| | Local editor | Self-hosted |
| --- | --- | --- |
| Working tree | the developer's checkout | Mica's clone in `MICA_DATA_DIR/repository` |
| Updates from the remote | by the developer | by Mica: fetch and fast-forward only |
| Credentials | the developer's Git setup | `MICA_REPOSITORY_TOKEN` |
| Git configuration | the developer's | isolated (D7) |
| Drafts | uncommitted files | uncommitted files |
| Publish | commit and `git push` | commit and push, with retry rules (D5) |
| Database | none | none |

### Packages after the plan

| Package | Change |
| --- | --- |
| `@micacms/core` | Loses `DraftStore`, `memoryDraftStore`, `RepositoryConnector`, `CommitInput`, `Change`, `checkCommitPaths`, `ConnectorError` and `ConflictError`. Keeps `ContentSource`, `contentPath`, the model, the format and `./node` (Astro needs `fileSystemSource`). |
| `@micacms/connectors` | **Removed.** |
| `@micacms/runtime` | Gets `workspace/`: files, Git runner, tree operations, locks, the owner-policy interface and the developer policy. Loses the draft staging service and the SQLite driver. |
| `@micacms/self-hosted` | Loses `db/`. Gets `workspace/` with the managed policy, the credentials, the isolation settings and the `check` command. |
| `@micacms/editor` | Composes the developer policy. Behaviour unchanged. It ships no clone or credential code; a boundary test checks this. |
| `@micacms/editor-ui` | One Publish flow, conflict actions and an extended "Content repository" section. |
| `@micacms/astro`, `@micacms/auth-oidc` | Unchanged, except dependency updates. |

Published packages: **seven**, down from eight.

---

## 3. Decisions

### D1 — One workspace model: a Git working tree

**Decided:** both apps stage saves as uncommitted files in a working tree. One
staging service serves both. The only difference is an **owner policy**:
`developer` or `managed`.

**Why:** the working-tree service exists and is well tested
(`staging-local.ts`, 46 tests). The draft store duplicates it with a second
data model, an overlay connector and a database. One model removes about
2,000 lines and one class of bugs (the two workspaces disagreeing).

**Rejected:** a bare clone plus SQLite (variant "C"). It scales better for
very large media, but it keeps the database and two workspace models.

### D2 — Mica owns the server clone

**Decided:** the managed policy clones `MICA_REPOSITORY_URL` into
`MICA_DATA_DIR/repository` at first start. Mica reads the clone's identity
from the clone itself (`remote.origin.url` and the current branch). It writes
no separate state file.

At each start:

| Volume state | Action |
| --- | --- |
| A `cms.sqlite` file from Mica 0.4 | **Refuse to start** (D13). This check runs first. |
| No clone | Clone (D8). |
| Clone for the same URL and branch | Recover (D10), then sync (D3). |
| Other URL or branch, the tree is clean **and** HEAD is not ahead of `origin/<branch>` | Remove the clone and clone again. Log this. |
| Other URL or branch, and there are drafts or an unpushed commit | **Refuse to start.** List the changed files. Give the two ways out: publish with the old configuration, or copy the drafts with `docker compose cp mica:/data/repository/<root> ./mica-drafts` and delete the volume. |
| Not a valid Git repository | Refuse to start, with the path and Git's message. |

A change of `MICA_REPOSITORY_ROOT` needs no new clone (D8 has no sparse
checkout).

**One writing process per volume.** The docs say this, and the compose file
runs one replica. Mica does not use a lock file: a stale lock after a crash
would block the restart, which is worse. The `check` command (D14) is the one
other process that may open the clone, and it never writes to it.

**Why:** the clone is a cache that also holds the drafts and maybe one
unpushed commit. A clone that you can throw away must never be thrown away
while it holds work.

### D3 — Sync never merges, and Mica finds the conflicts itself

**Decided:** the managed policy syncs every `MICA_REPOSITORY_SYNC_SECONDS`
(default 60), before each publish, and through `POST /api/admin/sync` (used
only by "Try again" in an error state).

1. **Fetch**, holding the `remote` lock only (D9): `git fetch origin <branch>`.
2. **Push a pending commit** first, if there is one (D5).
3. **Prefetch**, still outside the `tree` lock: `git diff --numstat HEAD
   origin/<branch>`. This downloads the missing blobs, so the fast-forward
   needs no network.
4. **Hold at a model or LFS change.** If `<root>/.mica/schema.json`, or any
   `.gitattributes` that can apply under the root, differs between HEAD and
   `origin/<branch>`, stop here. Set `sync.restartRequired`. Saves go on with
   the model that is loaded. Publish waits for a restart (it needs the
   fast-forward). The sync at start skips this step, so the restart
   fast-forwards and then loads the new model (D14). Without this step, a
   save with the old model would remove the new fields, because
   `serializeEntry` drops keys that the model does not declare
   (`packages/core/src/serialize.ts:38-41`).
5. **Find the conflicts**, holding the `tree` lock, **per entry group** (the
   D4 unit): the groups that have a path changed upstream
   (`git diff --no-renames --name-only -z HEAD origin/<branch> -- <root>`)
   intersected with the groups that have a draft path (modified, staged,
   deleted, untracked or ignored), from
   `git status --porcelain=v1 -z -uall --ignored=traditional -- <root>`.
   `--ignored=matching` is not enough: it reports an ignored directory as one
   line, so a draft inside it is not seen (spike S3). `--no-renames` is
   required in every diff that feeds a decision: with rename detection, an
   upstream `git mv` hides the old paths. An entry group is a folder entry
   (`<collection>/<slug>/`), a flat entry file (`<collection>/<slug>.json`), a
   singleton file, or a collection's `_order.json`.
6. Before it takes the `tree` lock, Mica checks that the prefetch is complete
   (`git rev-list --objects --missing=print HEAD..origin/<branch>` lists no
   missing object). If there is no conflict, fast-forward with
   `git merge --ff-only origin/<branch>`. If the fast-forward exits non-zero,
   it can already have changed the tree (spike S3: upstream deletions were
   applied while HEAD stayed at `<from>`). Mica then rolls the upstream paths
   back to `<from>` with the two-part restore from D10, and shows a sync error
   with Git's message. If there are conflicts, report the conflicting groups
   (D4).

**One fast-forward function** does steps 4 to 6 and the D10 marker. Every
caller uses it: the sync, the D5 loop and "Keep my version".

**The entry revision covers the whole entry.** Today the 409 gate on a save
checks only the entry's data file (`store.ts:283-288`), but a save writes all
of the entry's files (`store.ts:251-262`). After a fast-forward that changed
only an entry's `.mdoc`, an open editor tab would write the old body back
with no warning. The entry revision becomes a hash over all files of the
entry, so the 409 in section 6 fires.

Mica never runs `merge` without `--ff-only`, `rebase`, `stash` or `pull` on
the server. `reset --hard` runs only in crash recovery (D10). No conflict
markers can appear in content files.

The developer policy never fetches or fast-forwards. The developer stays in
control of their own checkout.

**Why Mica checks and does not trust Git's refusal:** the architecture review
showed two cases where Git does not refuse. In a sparse clone, a
fast-forward replaced an untracked draft with the upstream bytes, and
`git status` was then clean. A local deletion against an upstream edit
fast-forwarded and would have published the deletion over the edit, with no
conflict shown.

### D4 — Conflicts are resolved per entry, against the website's version

**Decided:**

- The unit of a conflict is an **entry group**: an entry with its `.mdoc`
  files and media, or a singleton. A choice for each file could mix your
  `index.json` with the upstream `.mdoc`.
- The comparison shows the draft against **`origin/<branch>`**, "the
  website's version". It does not compare against HEAD: during a conflict,
  HEAD is still the old head.
- Actions, with these labels:
  - **Use the website's version:** discard the draft for the group, then
    sync. If the draft is a new entry, this deletes it, so the editor must
    confirm first.
  - **Keep my version:** copy only the group's draft files to
    `MICA_DATA_DIR/rescue/`, then write the marker
    `MICA_DATA_DIR/keep-mine.json` last, with an atomic rename. Restore the
    group, fast-forward (with the one function from D3), write the files back,
    then delete the marker and the copy. A start that finds the marker writes
    the copy back. The draft now sits on the new head and replaces the
    upstream version when it is published.
  - **Upstream deleted the entry:** "Restore it" (keep my version) or "Accept
    the deletion" (use the website's version).
- One conflict blocks the fast-forward for every editor. So the conflict is
  shown on the Dashboard, on the Changes page and on the affected entry's
  page, not only on the Changes page.

**Why:** this is the "Keep mine" decision (#97), applied to the working tree:
"Keep mine moves the draft's base to the current revision". The commit trailer
that names the replaced revision stays in #97.

### D5 — Publish: the reviewed paths, at most one unpushed commit, classified push results

**Decided:** publish keeps the rules of `staging-local.ts`: an explicit path
set, never `git add -A` over the repository, the model drift gate and
validation. Three things change.

**Publish sends the reviewed paths (both owners).** `GET /changes` returns
each pending path with its working-tree revision. Publish sends back the paths
that the editor reviewed, with those revisions. Mica commits exactly these
paths. It refuses only if one of them, or another file of its entry group,
changed since the review. Drafts that other editors saved after the review
stay drafts. This replaces the HEAD gate: a background sync every 60 s would
refuse a publish after every upstream push, even a push of code outside the
content root. It also fits a later selection of changes (#98). Mica checks the
revisions again just before each `git commit`, because `commit -- <paths>`
takes the working-tree content, which could be a newer autosave.

**At most one unpushed commit (managed).** Before a new publish, Mica pushes
the pending commit, or refuses until it is pushed.

**Push results are classified** from `git push --porcelain` with `LC_ALL=C`.
The base of the pending commit is always derived from Git, not kept in
memory, so a restart does not lose it: Mica proceeds only when
`git rev-list --count origin/<branch>..HEAD` is 1, and the base is then
`HEAD^`.

| Result | Action | Editor sees |
| --- | --- | --- |
| Pushed | done | "Published" |
| `[rejected]` with `(non-fast-forward)` or `(fetch first)` | `git reset --soft HEAD^`, fetch, fast-forward (D3), run the drift gate, validation and the revision check again, `git add -- <paths>`, `git commit -C <old commit> -- <paths>` (the author, the author date and the message stay), push. At most three tries. If a hold or a conflict stops the fast-forward, the commit stays undone: its files are staged drafts again, and the conflict is shown (D4). After the third rejection, the commit stays re-made on the newest `origin/<branch>` as `committed-pending-push`, and the next sync pushes it. | nothing, or the conflict |
| Network failure (stderr `unable to access`, `Could not resolve host`) or authentication failure (stderr `Authentication failed`, HTTP 401) | Keep the commit (`committed-pending-push`). The next sync tries again. Log only when the state changes. | "Published in Mica, not yet sent to the website. Mica tries again every minute. If this stays, tell the person who runs Mica." |
| `write_forbidden`: HTTP 403 (stderr `403`, `remote: Forbidden`), the token can read but not write | `git reset --soft HEAD^`: the commit becomes drafts again. No automatic retry. | "The repository refused this publication. Tell the person who runs Mica." The operator sees "the token cannot write" with the host's message. |
| `[remote rejected]` (protected branch, server hook, signed commits) | `git reset --soft HEAD^`: the commit becomes drafts again. No automatic retry. The porcelain line says only "(pre-receive hook declined)"; the host's reason is in the `remote:` lines on stderr, so Mica keeps those (trimmed, without credentials). | "The repository refused this publication. Tell the person who runs Mica." The operator sees the host's reason on the System page and in the log. |

Authentication, network, 403 and not-found failures exit with 128 and print
**no** porcelain line (spike S1, S2). Mica takes their class from stderr, with
`LC_ALL=C`:

The patterns are checked **in this order**. A 403 from GitHub and GitLab also
contains `unable to access`, so the network pattern must come last.

| stderr | Class |
| --- | --- |
| `403`, `remote: Forbidden`, `not allowed to upload code` | `write_forbidden` |
| `Authentication failed`, `Invalid username or token`, `HTTP Basic: Access denied`, HTTP 401 | auth |
| `Repository not found`, `repository '…' not found`, `could not be found or you don't have permission` | `repo_not_found`: the repository does not exist, or the token cannot see it (GitHub and GitLab give the same text for both). No retry at start; a message for the operator. A `read_repository` GitLab token gets a 403 here instead, because GitLab checks the scope first. |
| `unable to access`, `Could not resolve host` | network |

A protected-branch refusal is different: it exits with **1** and prints a
porcelain line, `[remote rejected] (pre-receive hook declined)`.

For `[remote rejected]`, Mica keeps the reason from the porcelain line **and**
the `remote:` lines: GitHub puts the reason only in the porcelain line;
Forgejo and GitLab only in the `remote:` lines (GitLab prefixes it with
`GitLab: `, which Mica strips). A known GitHub reason: an OAuth token without the
`workflow` scope cannot push a commit that touches `.github/workflows/`. A new file must be added with `git add -- <paths>` before
`git commit -- <paths>`; the commit alone refuses untracked files.

The managed commit author is the signed-in editor (the OIDC name and email).
The committer is `Mica CMS <mica@localhost>`. Push uses
`git push --porcelain origin HEAD:refs/heads/<branch>` and never forces.

The developer policy keeps today's push behaviour: the author comes from the
developer's Git, the push is a plain `git push`, and `committed-pending-push`
waits for "Retry push".

### D6 — Credentials: HTTPS, scoped to one host, never on disk

**Decided:**

- `MICA_REPOSITORY_TOKEN` is the password. `MICA_REPOSITORY_USERNAME` is
  optional; its default follows the host in the URL (from spike S1):
  `x-access-token` for GitHub, `oauth2` for GitLab, `mica` elsewhere.
  GitHub, GitLab and Forgejo accept any non-empty username with a token;
  Bitbucket is not checked. Startup refuses an empty username: GitHub and
  GitLab reject it.
- Git gets the credential helper through `GIT_CONFIG_*` environment
  variables: first an empty `credential.helper=` (it clears every other
  helper), then `credential.https://<host>[:<port>].helper` scoped to the
  configured host. The key must include a non-default port, or the helper
  does not answer. Git treats the default port as no port, and host names as
  case-insensitive (spike S1, GitHub). The helper answers `get` only, and it reads the token from the
  process environment. The architecture review showed that an unscoped helper
  gives the token to any host.
- The `git` process gets an **allowlisted environment**: `PATH`, `HOME`,
  `LC_ALL=C`, the `GIT_CONFIG_*` set and the token. Today `gitRunner` passes
  the whole `process.env` (`lib/git.ts:44`), which includes
  `SESSION_SECRET` and the OIDC secret.
- Startup refuses a `MICA_REPOSITORY_URL` that contains credentials, and
  points to `MICA_REPOSITORY_TOKEN`.
- Only `https://` URLs are accepted. `http://` is accepted only with
  `NODE_ENV=development` and a loopback host, the same rule as for the OIDC
  issuer. The tests need this.
- One function removes credentials from every URL in logs and errors. A test
  checks it.

**Why:** Git over HTTPS should need only `read_repository` +
`write_repository` on GitLab and "Contents: read and write" on GitHub, which is
narrower than the `api` scope that the REST connector needs (#169). The spike
confirmed that `api` alone pushes over HTTPS and that `read_repository` alone
cannot push; a `write_repository` token is still to be checked. GitLab also
needs a role that may push to the branch: a Developer token cannot push to a
`main` that is protected for Maintainers (spike S2).

**Known gaps** (section 11): a token rotates only with a restart, so
short-lived tokens such as GitHub App installation tokens do not fit yet. A
host with a private CA is not supported yet.

### D7 — Git on the server is isolated

**Decided:** the managed policy runs `git` with these settings, all set
through `GIT_CONFIG_*` or the allowlisted environment:

| Setting | Value | Reason |
| --- | --- | --- |
| `GIT_CONFIG_NOSYSTEM`, `GIT_CONFIG_GLOBAL` | `1`, `/dev/null` | No configuration from the image or the host |
| `core.hooksPath` | `/dev/null` | No hooks run |
| `core.symlinks` | `false` | A symlink becomes a plain file, so a read cannot leave the content root |
| `core.autocrlf` | `false` | The bytes on disk are the bytes in Git |
| `.git/info/attributes` | `* -text -ident -filter -working-tree-encoding` | The repository's `.gitattributes` cannot change bytes or run a filter. The review showed `ident` changing `$Id$` in the working tree. |
| `protocol.allow`, `protocol.https.allow` | `never`, `always` | No `file`, `ext`, `ssh` or `http` transports (`http` only in development, D6) |
| `submodule.recurse` | `false` | Submodules are never fetched |
| `gc.auto` | `0`; Mica runs `git maintenance run --auto` after each fetch, under the `remote` lock | No automatic gc inside a commit that holds the `tree` lock; the clone still stays small |
| `safe.directory` | the clone path, always | Git refuses a repository with another owner ("dubious ownership"); the volume owner can differ from the process user. The `GIT_CONFIG_*` form works (spike S5) |
| `GIT_LITERAL_PATHSPECS` | `1` | A path such as `tour[1]/index.json` is not a glob. Without it, the spike's recovery overwrote the draft `tour1/index.json`. Long path lists go through `--pathspec-from-file=- --pathspec-file-nul` |
| `GIT_TERMINAL_PROMPT`, `GIT_OPTIONAL_LOCKS` | `0`, `0` on read-only calls | No prompt. A status call does not take `index.lock` |

Arguments are validated: the branch with `git check-ref-format --branch`, the
root without `..`, and `--` before every path argument.

The developer policy keeps the developer's configuration, as today.

**Why:** the repository is under someone else's control. These settings
remove every path from repository content to code execution that Git offers.
They replace the reasons in the decision "Local Git is the local editor's,
never the server's".

### D8 — Clone shape: blobless and single branch; LFS is refused for now

**Decided:**

```
git clone --filter=blob:none --single-branch --branch <b> <url> repository
```

- No sparse checkout. A blobless clone downloads only the blobs of the
  current tree, not the history. Sparse checkout caused the silent overwrite
  in D3. Spike S7 showed that it is not needed: a blobless clone of 5,000
  files and 2 GB of media took 18 s.
- **Disk use:** the volume needs about twice the size of the current content
  (the objects in `.git` plus the working tree), and `.git` grows with every
  upstream media change; `git maintenance run --auto` does not reclaim it.
  The docs say how to shrink it: publish or discard every draft, stop Mica,
  delete `MICA_DATA_DIR/repository`, start (Mica clones again).
- **LFS:** in 0.5.0, Mica refuses LFS under the content root. Without the
  filter, Mica would commit full files to LFS paths. Mica reads the
  `.gitattributes` blobs of `origin/<branch>` directly, and treats any
  `filter=lfs` line that can match a path under the root as LFS.
  `git check-attr` cannot be used: the `-filter` line from D7 makes it answer
  `unset`. The check runs at start (refuse to start) and in sync, where a
  changed `.gitattributes` is a hold (D3 step 4). Support comes in the LFS
  follow-up.

### D9 — Locks: a remote queue and a read/write tree lock

**Decided:** one module in the runtime owns two locks. Both wait; neither
refuses.

- **`remote`** (a queue): fetch, prefetch and push.
- **`tree`** (a read/write lock):
  - shared: file reads, `git status`, HEAD and origin reads;
  - exclusive: saves, uploads, discard, conflict actions, fast-forward,
    commit and `reset --soft`.

An operation that needs both takes `remote` first, then `tree`. **No network
access happens while the `tree` lock is held.** Prefetch (D3) moves the
downloads out of the lock, so a long fetch or push never blocks autosave.
Every Git call under the `tree` lock sets `GIT_NO_LAZY_FETCH=1`, so a missing
blob makes the call fail instead of downloading it.

**Why:** Git's checkout deletes and rewrites a file without a rename, so a
read during a fast-forward can see a missing or half-written file. A save
during a commit could put half of an entry into the commit. This closes #67
for both apps.

### D10 — Recovery at start, and file hygiene

**Decided (managed policy):**

- **An interrupted fast-forward.** Before a fast-forward, Mica writes
  `MICA_DATA_DIR/operation.json` with `{from, to}`, with an atomic rename.
  After success it deletes it. At start, if the marker exists, Mica takes the
  paths from `git diff --no-renames --name-only -z <from> <to>` and restores
  them in **two parts**:
  - paths that exist in `<to>`: `git restore --source=<to> --staged
    --worktree --pathspec-from-file=- --pathspec-file-nul`;
  - paths that do not exist in `<to>` (upstream deletions):
    `git rm --cached --ignore-unmatch` and delete the file.

  Then `git update-ref refs/heads/<branch> <to>`. One `git restore` over all
  paths is not enough: after a crash between the index write and the ref
  update, an upstream-deleted path is in neither `<to>`, the index nor the
  tree, and the whole `restore` fails (spike D10). This is safe without a copy
  of the drafts, because the fast-forward ran only after the conflict check:
  the upstream paths and the draft paths do not overlap. The spike tested it
  with `kill -9` at several points of a fast-forward over 6,301 paths: HEAD
  was `<to>`, every draft was intact, and the status showed only the drafts.
  Without this step, a crash during a fast-forward would leave old file
  versions that look like drafts, and a publish would revert upstream
  changes.
- **An interrupted "Keep my version"**: the `keep-mine.json` marker (D4).
- **A stale `index.lock`** is removed at start only when it is older than the
  longest Git timeout. A younger lock can belong to a process that still
  runs, for example during a rolling deploy.
- **Temporary files.** The `*.mica-<pid>-<n>` files that a save writes
  (`local.ts:110`) are left out of the change list in both apps. The managed
  policy deletes old ones at start.
- **Ignored files.** A file that Mica wrote but `.gitignore` ignores can never
  be published. `status --ignored=traditional -uall` under the content root
  finds it, also inside an ignored directory.
  The change list shows it as a validation problem.
- **Runner limits.** Clone, fetch and push get long timeouts. `git show` of a
  media file has no 10 MB buffer limit (it streams to a file).

### D11 — Code placement; `@micacms/connectors` is removed

**Decided:**

- **Runtime** (`packages/runtime/src/workspace/`): `files.ts` (from the local
  connector; `RepositoryConnector` becomes `ContentFiles`, `commit()` becomes
  `apply()`, `head()` is removed), `git.ts` (the runner with the allowlisted
  environment), `tree.ts` (status, commit, push, discard, HEAD and origin
  reads), `locks.ts`, `policy.ts` (the owner-policy interface) and
  `developer.ts`.
- **Runtime services:** `content-store.ts` (from `connectors/store.ts`) and
  `changes.ts` (the shared analysis from `staging.ts`).
- **Self-hosted** (`apps/self-hosted/src/workspace/`): `managed.ts` (clone,
  volume states, sync, conflicts, push classification, recovery),
  `credentials.ts`, `isolation.ts`, and the `check` command. This follows the
  OIDC pattern: server-only code stays out of the local editor.
- The repository-port types move from `core` into the runtime.

**Why:** after the removals, one implementation and one consumer remain. A
package for them is a boundary with nothing on the other side. "Commit" will
mean a Git commit in the same services, so the file operation needs another
name. A separate Git package is not justified either: it would have one
consumer.

### D12 — Configuration uses the `MICA_` names now

**Decided:** the repository variables change in this PR anyway, so they take
their final names from the `MICA_`-prefix decision. Startup refuses each old
name and names the new one, in **one** message that lists every problem.

| Old | New |
| --- | --- |
| `REPOSITORY` | removed: the URL tells everything |
| `REPOSITORY_PROJECT`, `REPOSITORY_API_BASE` | `MICA_REPOSITORY_URL` |
| `REPOSITORY_TOKEN` | `MICA_REPOSITORY_TOKEN` |
| — | `MICA_REPOSITORY_USERNAME` (optional) |
| `REPOSITORY_BRANCH` | `MICA_REPOSITORY_BRANCH` (default `main`) |
| `REPOSITORY_ROOT` | `MICA_REPOSITORY_ROOT` (default `content`) |
| — | `MICA_REPOSITORY_SYNC_SECONDS` (default `60`) |
| `DATA_DIR` | `MICA_DATA_DIR` |
| `DATABASE_PATH` | removed |

The `MICA_` decision's table lists `MICA_REPOSITORY` and `MICA_DATABASE_PATH`.
That table is updated. The other unprefixed names (`LOG_LEVEL`, `SESSION_*`,
…) stay until #57.

### D13 — Upgrade from 0.4: no draft migration, and clear steps

**Decided:** if `MICA_DATA_DIR` contains `cms.sqlite`, startup refuses. Mica
does not open the file. The message and the 0.5.0 release notes give the
steps in order:

1. On 0.4.1, publish or discard every pending change.
2. Stop Mica.
3. Delete `cms.sqlite` from the volume. Drafts that you did not publish are
   lost.
4. Replace **both** `compose.yml` and `.env` with the 0.5.0 versions. The
   0.4 `compose.yml` sets `REPOSITORY` and `DATA_DIR` in `environment`, so an
   edit of `.env` alone is refused.
5. Convert the project to a URL: GitHub `acme/site` becomes
   `https://github.com/acme/site.git`; GitLab `group/project` becomes
   `https://gitlab.com/group/project.git`.
6. Narrow the token: GitLab `api` becomes `read_repository` +
   `write_repository`.
7. Run `docker compose run --rm mica check` (D14), then start.

**Why:** the known deployments are trials. Migration code would keep SQLite
in the codebase to run once.

### D14 — Start, readiness, the `check` command and the logs

**Decided:**

- **Order at start:** config checks → start the HTTP server (`/health` is
  200, `/ready` is 503 `cloning`) → clone or recover → fetch → fast-forward
  (D3) → load the model → `/ready` is 200. The model loads after the
  fast-forward, so a restart applies a waiting model change.
- **Access check:** the first fetch proves read access.
  `git push --dry-run --porcelain origin HEAD:refs/heads/<branch>` checks
  write access. A dry run proves only authentication and push rights. It does
  not run protected-branch rules, server hooks or GitHub's `workflow`-scope
  check, so the docs and the first real refusal (D5) name the GitLab role and
  branch protection.
- **Refusal versus degraded start:** startup refuses only when no clone
  exists and cloning fails. With a clone in place, a network failure or an
  authentication failure starts Mica in a degraded state: editing works, the
  sync error is shown, and Mica tries again.
- **`/ready`** makes no network call, and its body has reason codes only, no
  repository names (#79). It is 503 only while there is no usable clone:
  `cloning` or `clone_failed`. Otherwise it is 200, and the body may carry
  `sync_failing`, `auth_failed`, `write_forbidden` or `restart_required`. A stale sync, a
  conflict or a held model does not take traffic away, because editing still
  works.
- **`check` command:** it runs the access checks, loads the model, prints a
  summary and exits 0 or 1. A coding agent can verify a setup without a
  browser. This covers the `doctor` part of #170. **When a clone exists,
  `check` never writes to the volume:** no recovery, fetch into the clone,
  fast-forward, re-clone or clean-up. It uses `GIT_OPTIONAL_LOCKS=0`,
  `git ls-remote` and `git push --dry-run`, and loads the model from HEAD.
  While the server runs, use `docker compose exec mica check`. Before the
  first start, `docker compose run --rm mica check` works on an empty volume
  and clones nothing to it (it checks access only).
- **Logs:** one summary line at start (URL, branch, root, head, number of
  collections, write check). Sync logs only when something changes: a new
  head, an error, a recovery.

### D15 — Supported hosts

**Decided:**

| Tier | Hosts |
| --- | --- |
| Supported (live-tested every week) | github.com and gitlab.com over HTTPS |
| Tested in CI | Forgejo (the compose stack) |
| Expected to work, not tested | Bitbucket Cloud, Gitea, GitHub Enterprise Server, self-managed GitLab |

This replaces the decision "github.com and gitlab.com are supported;
self-managed experimental". It keeps that decision's rule: supported means
live-tested.

### D16 — Tests use real Git

**Decided:**

- **Unit and integration tests** run real `git` against temporary bare
  repositories, served over HTTP on loopback by a `git http-backend` helper
  that checks a token. So the credential path runs in `rush test`.
- **Compose stack** (`tests/oidc`, which the browser test uses): **Forgejo**
  replaces `tests/github-stub`. A seed job creates the user, the token and the
  repository, and pushes the example content. The flow test and the browser
  test check results with `git ls-remote` and `git show`.
- **Live workflow** (weekly, `live-git.yml`): it replaces
  `live-connectors.yml`. It clones, publishes and pushes against scratch
  repositories on github.com and gitlab.com, with the existing secrets (#38).

---

## 4. Before the PR

1. **Baseline.** Measure 0.4.1 on barber-niederdorf (gitlab.com): dashboard,
   collection list, entry open, publish and cold start. Section 13 compares
   against these numbers.
2. **Docs fix for 0.4.x**, as a small separate PR: the GitLab token needs
   `api` today. micacms.com says `write_repository`
   (`sites/micacms/content/docs/self-hosting/body.mdoc:27`) (#169). **Done:
   PR #172.**
3. **Spike** (section 5).

---

## 5. Spike: verify before coding

Run the spike in the hardened compose shape: `read_only`, a non-root user,
`cap_drop: ALL`. **If S1, S3 or S6 fails, stop and revise this plan.**

| # | Assumption | Pass when |
| --- | --- | --- |
| S1 | The scoped credential helper (D6) works for clone, fetch and push on GitHub (fine-grained PAT), GitLab (project token), Forgejo and Bitbucket. It gives nothing to another host. | All pass. Record the username that each host accepts, and set the defaults. |
| S2 | `git push --dry-run` fails with a read-only token and passes with a write token. Check what a Developer-role GitLab token on a protected `main` gives in the dry run and in a real push. | Recorded on GitHub and GitLab. The docs and the D5 messages use the result. |
| S3 | The conflict check (D3) finds, per entry group: an untracked draft against an upstream add, a local edit against an upstream edit, a local deletion against an upstream edit, an upstream deletion against a local edit, **an upstream rename (`git mv`) against a local edit**, **a local edit of `index.json` against an upstream edit of the same entry's `.mdoc`**, an ignored draft file, and a draft inside an ignored directory. Without conflicts, the fast-forward keeps every draft. | All cases. |
| S5 | `apk add git` on `node:24-alpine` (amd64 and arm64). Trivy shows no CRITICAL finding. `safe.directory` through `GIT_CONFIG_*`: needed or not, and does it work. | Record the image size increase. |
| S6 | The non-fast-forward loop (D5) gives the expected tree and keeps the author, with one and with two competing pushes. | True. |
| S7 | Cold clone time, disk use and memory on a synthetic repository shaped like the planned hiking blog: one collection with more than 1,000 entries, 5,000 files and 2 GB of media without LFS. | Record the numbers. They set the docs and `mem_limit`. |

(S4, the LFS check, moves to the LFS follow-up.)

Record the results in section 15 before you start section 7.

---

## 6. API and editor UI

### Changes status (`GET /api/admin/changes`)

| Field | Today | After |
| --- | --- | --- |
| `workspace` | `"working-tree" \| "draft-store"` | replaced by `owner: "developer" \| "managed"` |
| `updatedAt` | draft store only | removed |
| `baseRevision` | the HEAD gate | `head`, for display only |
| `changes[].revision` | — | each pending path's working-tree revision (D5) |
| `branch`, `ahead` | working tree only | always |
| — | — | `sync: { lastSyncAt, behind, error, restartRequired, pendingPush, refused, conflicts: [{ group, label, paths, upstream: "changed" \| "deleted" \| "added" }] }` |
| `publish`, `changes`, `validation` | | unchanged |

### New endpoints (managed only; 404 in the local editor)

- `POST /api/admin/publish` (both owners) takes
  `{ message, paths: { [path]: revision } }` in place of `expectedBase`.
- `POST /api/admin/sync`: sync now ("Try again" in an error state).
- `POST /api/admin/changes/resolve` `{ group, choice: "mine" | "website" }`.
- `GET /api/admin/changes/compare` gets a `against: "origin"` option for a
  conflict (D4).

### System info (`GET /api/admin/system`)

- `database` and `deployment.repositoryMode` are removed.
- The **"Content repository"** section gets: the URL without credentials, the
  branch, the root, the head, the last sync, the last error, the clone size
  on disk, and "restart needed". The Git version goes only into the
  copyable support report.

### Editor UI

- **Wording follows the owner.** The managed owner uses today's draft-store
  words ("Saved in Mica, waiting to be published"). Git words ("working
  tree", "Based on abc1234", "Retry push") appear only in the local editor.
- **Problems only.** A sync banner appears only for a problem: an error, a
  pending push, a refused publication, a restart needed. "Try again" calls
  `POST /sync`. No "Check now" button.
- **Conflicts** appear on the Dashboard, the Changes page and the entry page,
  with the labels and confirmations from D4. Each conflict opens the compare
  view against the website's version.
- **Save after a fast-forward:** a 409 says "This entry was changed on the
  website. Reload to see the current version." It no longer says "Someone
  else saved this entry".
- **System view:** the "Operational database" section is removed. The
  content-repository lines are added to the support report.

### Error classes

| Class | Audience | Message (short) | Action |
| --- | --- | --- | --- |
| Conflict | editor | "This entry was changed on the website while you edited it." | Keep my version / Use the website's version |
| Pending push | editor | "Published in Mica, not yet sent to the website." | none; Mica tries again |
| Refused by the host | editor and operator | "The repository refused this publication." | operator: role, branch protection, signing |
| Authentication failed | operator | the Git message, without credentials | fix the token, restart |
| Remote unreachable | operator | "Cannot reach the repository since <time>." | none; Mica tries again |
| Restart required | editor and operator | "The content model changed. Ask the person who runs Mica to restart it." | operator: restart |

---

## 7. Work plan

Branch: `refactor/git-workspace`, from an up-to-date `main`. One PR. Each
commit builds, type-checks and passes its tests.

| # | Commit | Main files | Tests |
| --- | --- | --- | --- |
| 1 | Move the shared change analysis out of the draft staging service | `services/staging.ts` → `services/changes.ts` | unchanged, all pass |
| 2 | Extract the Git runner, tree operations and locks | `workspace/{git,tree,locks,policy,developer}.ts`; the allowlisted environment; `staging-local.ts` uses them; temporary files out of the change list | `staging-local.test.ts` unchanged and passing; new tests for the locks and the environment |
| 3 | Add the managed policy | `apps/self-hosted/src/workspace/*`; `test/helpers/git-http.ts` | clone and volume states, sync, all S3 conflict cases (rename, same entry other file, ignored), Keep mine and its marker, Use the website's version, holding at a model or `.gitattributes` change, recovery after an interrupted fast-forward, the stale-lock age rule, the whole-entry revision 409, the push classes, credentials never in `.git/config` or logs, the helper refusing another host, a symlink stays a file, `ident` has no effect |
| 4 | Run the self-hosted app on the managed workspace | `apps/self-hosted/src/{config,index}.ts`, `runtime/src/{config,context}.ts`, `routes/{health,admin-system,admin-staging}.ts`, the `check` command; `Dockerfile` adds `git`; `tests/oidc` moves to Forgejo. The API keeps its current field names until commit 7: the managed side reports `workspace: "draft-store"` (so the UI keeps the editor wording, `ChangesView.vue:98-99`) and `repositoryMode: "git"` (display only, `api.ts:358`), and publish still accepts `expectedBase`. | `config` and `api` tests for the new variables; old names, `cms.sqlite` and LFS refused; `/ready` codes; `check` writes nothing to an existing clone; the compose flow test and the browser test |
| 5 | Remove the draft store and the provider connectors | delete `connectors/src/{github,gitlab,http,staged}.ts`, the draft service, `DraftStore` and `memoryDraftStore`, `apps/self-hosted/src/db/`, `runtime/src/db/driver.ts`, `live-connectors.yml`. `tests/github-stub/` stays until commit 8, because `tests/e2e/compose.yml` still uses it. | delete the matching tests |
| 6 | Fold `@micacms/connectors` into the runtime and rename the port | D11 moves; `rush.json`, `Dockerfile` COPY lines, dependencies, `core` exports, `version-policies.json` comment | `local.test.ts` and `store.test.ts` move; boundary tests (the local editor ships no managed code) |
| 7 | Change the API and the editor UI together | `changes` status shape, publish with reviewed paths, `resolve`, compare against origin; `api.ts`, `ChangesView.vue`, `DashboardView.vue`, `EntryView.vue`, `SystemView.vue`, `stores/staging.ts` | editor-ui tests; a browser test for a conflict (part of #139) |
| 8 | Deploy files and the live workflow | `deploy/self-hosted/*`, `deploy/demo-identity/*`, `tests/e2e/*` (to Forgejo), delete `tests/github-stub/`, `.github/workflows/live-git.yml` | the live workflow is run by hand once |
| 9 | Documentation and decisions | section 9 | links checked; `rush change` |

After commit 9: `rush typecheck`, `rush test` and `rush build` (the
`validator` agent), then the `reviewer` agent on the whole branch.

### Release

1. Publish `0.5.0-rc.1` under the `next` tag (#127).
2. Upgrade barber-niederdorf to the RC with the release notes only. Run it for
   at least one week.
3. Check the success criteria (section 13). Then release 0.5.0.
4. Run `npm deprecate @micacms/connectors "Removed in 0.5.0: …"`. Tell the
   known adopter directly. Publish a release post on micacms.com.

---

## 8. Configuration after the plan (self-hosted)

```dotenv
MICA_PUBLIC_URL=https://cms.example.com
SESSION_SECRET=…

MICA_REPOSITORY_URL=https://gitlab.com/acme/website.git
MICA_REPOSITORY_TOKEN=…     # GitLab: read_repository + write_repository; role allowed to push to the branch
MICA_REPOSITORY_BRANCH=main
MICA_REPOSITORY_ROOT=content

MICA_OIDC_ISSUER=…
MICA_ADMIT_GROUP=…
```

The image keeps `VOLUME /data` (`MICA_DATA_DIR=/data`). The volume holds the
clone, and the drafts in it. Git writes only into `/data` and `/tmp`, so the
read-only root filesystem stays.

**Backups:** publish first, or stop the container, then copy the volume. A
copy taken during a Git write can be inconsistent. For drafts only, `tar` the
content root. Do not run `git fetch` or `git push` through
`docker compose exec`: that shell has no credentials and no isolation. Use it
only for `GIT_OPTIONAL_LOCKS=0 git status` and `git diff`; without that
variable, `git status` can take `index.lock` and make a server commit fail.

---

## 9. Documentation and site

| Where | Change |
| --- | --- |
| `docs/architecture.md` | "The one constraint" becomes "Losing Mica's data volume must never mean losing website content"; "The pieces"; "Saved and Published"; "Repository access" (rewrite); "The two apps"; "The operational database" removed |
| `docs/decisions.md` | **Supersede:** l.293 "Local Git is the local editor's, never the server's"; l.431 "`node:sqlite`"; l.383 "A provider connector reads the content tree"; l.681 supported hosts (by D15). **Update:** l.26, 56, 192, 221, 252, 323, 474 (connectors no longer listed), 538 (the rename table), 633, 658, 706 (the rate-limit reason is gone; the 1.0 numbers stay), 984, 1011, 1068 (what shipped; the trailer stays in #97), 1265, 1289, 1330, 1367. **New:** D2–D10, D15, D13, and a cloud trade-off (a clean clone can move to a new node; drafts pin a site to its volume, as SQLite did). **Known gaps:** signed commits; pull-request publishing; token rotation; private CA |
| `docs/self-hosting.md` | rewrite: the diagram; a **token table** per host (token type, scopes, role, username, expiry); a "before the first start" checklist (build, commit `content/` with `.mica/schema.json`, push, start, `check`); the volume; backups (section 8); `/ready` codes; a proxy-timeout note for long publishes; troubleshooting by error class |
| `docs/getting-started.md`, `docs/security-review.md` | "The three pieces"; evidence rows for the new Git code; new threat rows: repository-controlled Git behaviour, credential leaks, disk use |
| `docs/v3-arch.md`, `docs/v3-plan.md` | one line at the top: superseded in part by this plan |
| `README.md` and package READMEs | update; delete `packages/connectors/README.md` |
| `AGENTS.md` | "Mica keeps no database"; remove the migration approval item; the repository map |
| `CHANGELOG.md` (at release) | a Breaking section and the upgrade steps (D13); the preamble's package count; the removal of `@micacms/connectors` (`rush change` cannot record a removed project) |
| `sites/micacms` (through `site-keeper`) | `docs/{architecture,choose-how-to-run,self-hosting,security,sign-in-with-google}`, `features/{small-secure-runtime,git-native-content,history-and-conflicts}`, `product.json`, a `releases` entry for 0.5.0 |
| License notices | Git (GPL-2.0) in the image (#141) |

---

## 10. Issues affected

| Effect | Issues |
| --- | --- |
| Closed by this PR | #66, #67, #68, #74; #169 (with the token table and the checklist from section 9) |
| Partly done; update the text | #130 (the SQLite half; the Node floor stays), #170 (the start check and `check`; separate project and branch messages stay), #57 (the repository and data-directory names), #55 (core exports), #139 (the conflict browser test) |
| Reframed: rewrite the text | #72 (time budgets, no call budgets), #73, #75 and #76 (disk reads; the ETag part of #75 stays), #77 and #78 (Git errors), #80 (backup per section 8), #83 and #136 (one workspace suite against Git remotes), #171 (no database; the Forgejo and Dex stack can seed the local trial) |
| Input for | #38 (the live workflow's tokens), #131 (the D15 tiers), #118 (the 0.5 upgrade steps), #100 (Publish wording), #141 (Git license) |
| Made easier, still separate | #81 (model reload), #96 and #97 (full comparison, trailer), #98 (selection), #103 (preview branch) |

Update the issues after the PR is merged.

---

## 11. Out of scope and follow-ups

| Follow-up | When |
| --- | --- |
| **Git LFS**: enable it before the first checkout, `filter.lfs.*` with `required=true`, `lfs.url` from the environment (so `.lfsconfig` cannot redirect), `lfs.fetchinclude`, `git lfs fetch` outside the tree lock, `git lfs push` before push; S4 | before the hiking blog moves to Mica |
| **SSH remotes**: deploy key and `known_hosts` files, `GIT_SSH_COMMAND` with `-F /dev/null -o BatchMode=yes -o IdentitiesOnly=yes -o StrictHostKeyChecking=yes -o UserKnownHostsFile=<file>`; `openssh-client` in the image | on demand |
| Model reload without a restart (#81) | next; D3 makes it more useful |
| `MICA_REPOSITORY_TOKEN_FILE`, read on each Git call (short-lived tokens) | on demand, or for the cloud |
| `MICA_REPOSITORY_CA_FILE` (private CA) | on demand |
| Downscaling images on upload; the rest of the `MICA_` prefix (#57); the local push refspec (#71); pull-request publishing; signed commits | separate |

---

## 12. Risks

| Risk | Mitigation |
| --- | --- |
| Concurrency bugs in the shared working tree | D9 locks; integration tests with parallel saves, syncs and publishes |
| A fast-forward loses a draft or an upstream edit | Mica's own conflict check per entry group (D3); the whole-entry revision; the D10 recovery; the S3 cases as tests |
| A crash during a Git operation | D10 recovery; tests that kill a fast-forward |
| Hosts differ (usernames, protected branches) | S1, S2; Forgejo in CI; the weekly live workflow; D15 tiers |
| A credential leaks | Scoped helper, allowlisted environment, no credentials in URLs, one URL cleaner, tests |
| The volume or memory is too small | S7 numbers in the docs; clone size on the System page |
| The PR is too large to review | One green commit per step; the decisions reviewed here first; an RC before the release |
| The image gains Git CVEs | Trivy in CI as today; #134 |
| An operator deletes `cms.sqlite` without publishing | The refusal message and the release notes say what is lost |

---

## 13. Success criteria

Measured on barber-niederdorf (gitlab.com) and on the S7 fixture, against the
0.4.1 baseline (section 4):

- With a warm clone, each view is under 300 ms on barber-niederdorf and
  under 500 ms on the S7 fixture. No provider HTTP call per view.
- Publish takes under 5 s on barber-niederdorf. The cold clone time is
  recorded.
- A `read_repository` + `write_repository` token works end to end. A token
  that is too narrow is refused at start, or by `check`.
- barber-niederdorf upgrades from 0.4.1 with the release notes alone, in
  under 15 minutes.
- Forgejo CI is green. The live runs on github.com and gitlab.com pass twice
  in a row before 0.5.0.
- Seven published packages. No `sqlite` in any package.

---

## 14. Approvals required (AGENTS.md)

**Status: all items approved by the maintainer on 12 October 2026.**

1. `git` in the runtime image. (`git-lfs` and `openssh-client` come with
   their follow-ups.)
2. Remove the SQLite database and its migrations.
3. Breaking changes to the image contract and the configuration (release
   0.5.0): the variables (D12), the `/ready` body, the volume contents.
4. Remove the published package `@micacms/connectors`, and remove exports from
   the public `@micacms/core`.
5. Reverse or replace the decisions in section 9.
6. Forgejo as a container image in CI.
7. Edit `AGENTS.md`.
8. Release `0.5.0-rc.N` under `next`, and run the RC on barber-niederdorf.
9. No change to `examples/muster-consulting` is planned. If one becomes
   necessary, ask first.

---

## 15. Review record

### Reviews of draft 1 (12 October 2026)

| Review | Verdict |
| --- | --- |
| UX/DX | ready with changes (2 blockers) |
| Product | ready with changes (2 blockers) |
| Architecture | **not ready** (1 blocker, found by experiment) |

Main findings and what changed:

| Finding | From | Change in draft 2 |
| --- | --- | --- |
| A fast-forward in a sparse clone overwrites an untracked draft without an error. A local deletion against an upstream edit is not refused. | Architecture (experiment) | Mica finds conflicts itself (D3); sparse checkout dropped (D8); S3 rewritten |
| A re-clone can delete an unpushed commit | UX/DX, architecture | D2: "clean **and** not ahead" |
| The conflict comparison shows the old HEAD | UX/DX | D4: compare against `origin/<branch>` |
| The HEAD gate fights the 60 s sync | UX/DX, architecture | D5: a review token (in draft 3: the reviewed paths) |
| The retry loop is not specified; a host rejection retries forever | Architecture, UX/DX | D5: classified push results, `commit -C`, at most one unpushed commit |
| Saves with the old model after a sync drop the new fields | Architecture | D3 step 4: hold at a model change; D14 start order |
| An unscoped credential helper gives the token to any host; `git` gets every secret | Architecture (experiment) | D6: scoped helper, allowlisted environment |
| The isolation list is not complete | Architecture (experiment) | D7: `autocrlf`, `info/attributes`, exact protocol keys, `gc.autoDetach`, `GIT_OPTIONAL_LOCKS`, argument validation |
| Reads are not atomic during a fast-forward; network access under the tree lock | Architecture | D9: read/write tree lock, prefetch outside the lock |
| Crash recovery, stale locks, temporary files, ignored files | Architecture | D10 |
| Commits 4–7 are not green in the old order | Architecture | Section 7: API and UI change together in commit 7; `git` and Forgejo in commit 4 |
| A network failure at start locks editors out; `/ready` leaks repository details | UX/DX, architecture | D14: degraded start; reason codes only |
| `push --dry-run` misses protected branches | UX/DX, product | S2; the D5 "refused" class; the token table |
| No check without a browser | UX/DX, product | D14: the `check` command and the summary log line |
| Managed mode shows Git words to editors; conflicts shown as paths | UX/DX | Section 6: wording by owner, entry groups, labels, banners only for problems |
| "Any Git host" has no support tiers | Product | D15 |
| No success criteria and no baseline | Product | Sections 4 and 13 |
| LFS and SSH make the PR too large | Product, UX/DX | Moved to follow-ups; 0.5.0 refuses LFS paths (D8) |
| The upgrade path is too thin | Product, UX/DX | D13: ordered steps, refusals listed in one message |
| A change file cannot record a removed package | Product, architecture | Section 9: CHANGELOG and `npm deprecate` |
| Issue table partly wrong | Product | Section 10 corrected |
| The wrong token scope is live on micacms.com | Product | Section 4: a separate docs PR first |
| RC before the release | Product | Section 7, "Release" |
| `repository.json` is not needed; `ls-remote` is not needed at start | Architecture | D2 reads the clone; D14 uses the first fetch (`check` still uses `ls-remote`, because it must not fetch into the clone) |
| Code placement | Architecture | D11: the managed code goes to `apps/self-hosted` |

Not taken:

- **A lock file for one process per volume** (architecture). A stale lock
  after a crash would block the restart. D2 documents one replica instead.
- **`MICA_REPOSITORY_TOKEN_FILE` and a private CA in 0.5.0** (product,
  architecture). Recorded as follow-ups and known gaps.

### Second architecture review, of draft 2 (12 October 2026)

**Verdict:** ready with changes. All draft-1 findings resolved, several
verified by experiment: the retry loop keeps the author; the scoped helper
gives nothing to another host or to `http://`; `info/attributes` stops
`ident` and `eol=crlf`; the protocol keys block `file` and `ext`; after the
prefetch, the fast-forward works with the remote offline.

| Finding | Change in draft 3 |
| --- | --- |
| **Blocker:** `check` in a second container writes to the server's clone (recovery, lock removal, fast-forward, even a re-clone) | D14: `check` never writes to an existing clone; `exec` while the server runs; D2 wording; D10 stale-lock age rule |
| An upstream rename hides the old paths from the conflict check; sync then sticks with no conflict shown | D3: `--no-renames`; a Git refusal is a sync error |
| A path-level check mixes an entry; the next autosave of an open tab reverts an upstream `.mdoc` edit | D3: conflicts per entry group; the entry revision covers all files of the entry |
| The rescue copy before each fast-forward is unsafe in its order and costly | D10: recovery by `restore --source=<to>` and `update-ref`, no copy (tested); Keep mine copies only its group, marker last |
| The LFS check cannot see LFS after `-filter`, and runs only at start | D8: read the `.gitattributes` blobs; check at start and in sync (a hold) |
| Model-hold gaps: Keep mine skipped it; start sync must skip it; `/ready` 503 took traffic | D3: one fast-forward function; start skips the hold; D14: `/ready` 200 with a code |
| A token over all pending paths refuses on any colleague's autosave and does not fit #98 | D5: publish sends the reviewed paths and revisions; re-check before each commit |
| Minors: `(fetch first)`; host reason on stderr; the base from Git, not memory; `GIT_NO_LAZY_FETCH`; auth failure as degraded start; ignored drafts; `<root>/.mica/schema.json`; port in the helper key; `gc.auto=0` with maintenance after fetch; `GIT_OPTIONAL_LOCKS=0` for `exec … git status`; the e2e stub until commit 8; the commit-4 interim API values | D5, D9, D14, D3, D6, D7, section 8, section 7 |

### Spike results, local part (12 October 2026)

Run on an Apple M3 Max (arm64), git 2.54.0, Node 24.18, Docker 29.8.1,
Forgejo 15.0.9. Scripts and raw results: in the session scratchpad
(`spike/scripts/`, `run-all.sh`); not committed.

| Item | Result | Deviation, and the change it made |
| --- | --- | --- |
| S3 conflict check | **PASS** with one flag change. 15 of 16 cases passed with the draft-3 flags, all 16 with `--ignored=traditional`. Without the check, a plain `merge --ff-only` lost data in four kinds of case (a local deletion undone, an entry half deleted, an ignored draft overwritten, entries mixed). After the prefetch, the fast-forward works with `GIT_NO_LAZY_FETCH=1` and the remote gone. | A draft inside an ignored directory was not seen with `--ignored=matching` → D3 step 5, D10. A fast-forward that fails during checkout changes the tree → D3 step 6 rollback and the prefetch check. |
| D10 recovery | **PASS** with two changes. `kill -9` during a fast-forward over 6,301 paths; recovery gave HEAD = `<to>`, every draft intact. | One `restore` fails after a crash between the index write and the ref update → the two-part restore. A path such as `tour[1]` acted as a glob and overwrote a draft → `GIT_LITERAL_PATHSPECS=1` (D7). |
| S6 push loop | **PASS.** One and two competing pushes; author, author date, committer and message kept; new and deleted files included; unrelated drafts stay drafts. | `commit -- <paths>` refuses untracked files → `git add` first (D5). The end state after the third rejection → D5. |
| S1, local | **PASS.** Clone, fetch and push under `env -i` with configuration only through `GIT_CONFIG_*`; the token is in no file. The helper answers nothing to another port, another host name, or another scheme. | Forgejo accepts any non-empty username (D6). Authentication and network failures print no porcelain line → classes from stderr (D5). |
| S2, local (Forgejo) | **PASS, recorded.** A read token: the dry run fails with 403. A write token: the dry run and the push pass. A protected `main`: the dry run **passes**, the real push gives `[remote rejected] (pre-receive hook declined)`. | A 403 has no porcelain line and would retry forever → the `write_forbidden` class (D5). The dry run cannot find branch protection, as expected (D14). |
| S5 image | **PASS.** git 2.54.0 on Alpine 3.24.2, arm64 and amd64; +13.0 MiB (arm64), +12.4 MiB (amd64). Trivy: 0 CRITICAL; the 8 HIGH findings are the same with and without git (Node's bundled npm). Clone, commit, push and maintenance work in the hardened shape (read-only, `cap_drop: ALL`, non-root); nothing written outside `/data` and `/tmp`. | Without `safe.directory`, Git refuses a repository with another owner; the `GIT_CONFIG_*` form works → set it always (D7). |
| S7 scale | **PASS, recorded.** 5,000 files, 1.98 GiB of media. Blobless clone 18 s over HTTP; `.git` 2.0 GiB and working tree 2.0 GiB; the clone works with a memory limit down to 64 MB (62 s; 21 s with no limit). `git status` 0.48 s cold, 0.03 s warm. Small sync: fetch 0.21 s, prefetch 0.18 s, conflict check 50 ms, fast-forward 0.03 s. A 207 MiB media sync: prefetch 2.39 s. Publish: commit 0.04 s, push 0.22 s. Reading 1,500 JSON files with Node: 111–156 ms in series, 32–35 ms in parallel. | `.git` grows with every upstream media change → the disk note in D8. `mem_limit: 512m` is enough for Git. Sparse checkout is not needed. |

### Spike results, gitlab.com (12 October 2026)

Run against the private scratch project `alexander.muedespacher/micacms-scratch`
with two Developer-role project access tokens from the maintainer (`api`, and
`read_repository`). Four `spike/` branches were created and deleted; nothing
landed on `main`.

| Item | Result | Change it made |
| --- | --- | --- |
| S1 | **PASS.** Blobless single-branch clone, fetch, commit and push with the `api` token. Usernames `oauth2`, `x-access-token`, the login and `anything` all work; an empty one fails. No credential in `.git/config`. The helper answers for `gitlab.com`, `gitlab.com:443` and `GitLab.com`, and gives nothing to `gitlab.com:8443`, `www.gitlab.com` or `github.com`. The `read_repository` token clones and fetches. | D6: default `oauth2`. |
| S2 | **PASS, recorded.** `read_repository`: the dry run and the push both fail with 128, `remote: You are not allowed to upload code.` and `…returned error: 403`. `api`: the dry run and the push pass. **A Developer token on the protected `main`:** the dry run passes; the real push exits 1 with `[remote rejected] (pre-receive hook declined)` and `remote: GitLab: You are not allowed to push code to protected branches on this project.` | D5: pattern order (403 before network), more patterns, exit 1 with a porcelain line for a protected branch. D6 "Why". D14 confirmed. The self-hosting docs must say: Maintainer role, or allow Developers to push, or an unprotected branch. |

### Spike results, github.com (12 October 2026)

Run against the private scratch repository `amuedespacher/micacms-scratch`,
`spike/*` branches only, with the `gh` OAuth token (`gho_`, scopes `repo`,
`read:org`, `gist`), not a fine-grained PAT. All branches were deleted
afterwards; no setting was changed.

| Item | Result | Change it made |
| --- | --- | --- |
| S1 | **PASS.** Blobless single-branch clone, fetch, commit and push over HTTPS with the scoped helper. Usernames `x-access-token`, `oauth2`, the login and `anything` all work; an empty one fails. No credential in `.git/config`. The helper answered nothing for `api.github.com` or for a key of another host. | D6: default username, empty refused, default port. |
| S2 | **Partly.** The dry run passes to a new branch and finds a non-fast-forward. **Branch protection could not be set:** GitHub needs Pro or a public repository for it. As a stand-in, a push that GitHub refuses (a workflow file without the `workflow` scope) passed the dry run and gave `[remote rejected] (refusing to allow an OAuth App to create or update workflow …)`, with the reason in the porcelain line and no `remote:` lines. | D5: reason from both places, the `repo_not_found` class, the auth patterns. D14: what a dry run proves. |

**Still open:**

- **GitLab:** a token with `write_repository` (without `api`), to confirm the
  narrow scope.
- **Bitbucket:** skipped by the maintainer; stays "expected to work, not
  tested" (D15).
- **GitHub:** the protected-branch case (needs a public scratch repository
  or GitHub Pro), a fine-grained PAT, and a read-only token (cannot be
  created through the API).
- S3, S6 and D10 in the hardened container, and one hardened run on amd64.
  This is low risk; it can run in CI with commit 3.

Section 13's per-view targets look reachable: the slowest local step of a
view is reading the files (about 35–160 ms for 1,500 entries).
