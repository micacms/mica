# Self-hosting Mica

One container on a machine you control — your own server, or a VPS from
Hetzner, OVH or anyone else. There is no managed Mica to buy, and nothing here
depends on a cloud service.

```
   editor
     │
     ▼
┌──────────────────┐    publishes    ┌────────────────────┐
│       Mica       │ ──────────────▶ │ content repository │
│  1 GB RAM        │  one commit,    │  any Git host      │
│                  │  pushed over    └─────────┬──────────┘
│  its own clone   │  HTTPS                    │ push
│  on the volume   │                           ▼
│  (the drafts are │                      ┌─────────┐
│   in the tree)   │                      │   CI    │  astro build
└──────────────────┘                      └────┬────┘
                                               ▼
                                         static files → any static host
```

Mica keeps its own Git clone of your content repository on its data volume.
The working tree of that clone is the draft workspace: a save is a file that
Git has not committed yet. Publish commits the reviewed files and pushes them.
There is no database.

Those two arrows out of Mica are the whole integration surface. No content API,
no read token, no build webhook — a push is the trigger, which every CI system
already understands. Mica uses no provider API: it speaks Git over HTTPS.

**Want to see it running first?** [`deploy/demo-identity/`](../deploy/demo-identity/README.md) starts Mica and
an identity provider on your machine with two commands. Everything below is the
same shape, with your own domain and provider.

---

## Quickstart

Ten minutes, on a server with Docker and a reverse proxy.

### Before you start

- **A content repository on a Git host that serves HTTPS**, with the content
  model committed at `content/.mica/schema.json`. Your Astro build writes that
  file; you commit it. See [getting-started.md](./getting-started.md).
- **An OpenID Connect provider.** Mica has no passwords of its own. If you do
  not have one, [step 3](#3-an-identity-provider) starts one.
- **A hostname with TLS**, terminated by a proxy in front of the container.

**The order of the first start.** Mica clones the branch and reads the model
from the clone. So:

1. Build the Astro project once (`npx astro build`, or start the dev server
   once). This writes `content/.mica/schema.json`.
2. Commit the content root **with** `.mica/schema.json`, and push it to the
   branch that Mica will use (`MICA_REPOSITORY_BRANCH`). A pushed model without
   the content gives an editor with empty collections.
3. Make the token ([step 2](#2-a-repository-token)).
4. Run `docker compose run --rm mica check`. It tests the token, the push
   rights and the model, and it clones nothing to the volume
   ([The `check` command](#the-check-command)).
5. Start Mica with `docker compose up -d` ([step 6](#6-start-it)), and sign in.

### 1. The two files

No clone of this repository. The image is published, and the content model
comes out of your content repository at runtime.

```bash
mkdir -p /srv/mica && cd /srv/mica
curl -o compose.yml https://raw.githubusercontent.com/micacms/mica/main/deploy/self-hosted/compose.yml
curl -o .env https://raw.githubusercontent.com/micacms/mica/main/deploy/self-hosted/.env.example
```

### 2. A repository token

Mica reads and writes the repository with Git over HTTPS. The token is the
password. Mica gives it to the one host in `MICA_REPOSITORY_URL` and to no
other host, and it never writes it to the clone or to a log.

```env
MICA_REPOSITORY_URL=https://github.com/acme/website.git
MICA_REPOSITORY_TOKEN=github_pat_…
MICA_REPOSITORY_BRANCH=main
MICA_REPOSITORY_ROOT=content
```

| Variable | Meaning | Default |
| --- | --- | --- |
| `MICA_REPOSITORY_URL` | The HTTPS clone URL. | none, required |
| `MICA_REPOSITORY_TOKEN` | The password for Git over HTTPS. | none, required |
| `MICA_REPOSITORY_USERNAME` | The user name that Git sends with the token. | `x-access-token` on GitHub, `oauth2` on GitLab, `mica` on other hosts |
| `MICA_REPOSITORY_BRANCH` | The branch that Mica clones, syncs and pushes to. | `main` |
| `MICA_REPOSITORY_ROOT` | The content root inside the repository. | `content` |
| `MICA_REPOSITORY_SYNC_SECONDS` | How often Mica fetches the branch. From 5 to 86400. | `60` |
| `MICA_DATA_DIR` | The data directory. The clone is in `MICA_DATA_DIR/repository`. The image sets it to `/data`. | `./data` |

Rules for the URL:

- **HTTPS only.** SSH remotes are not supported yet.
- **No credentials in the URL.** Mica refuses `https://user:token@host/…`. Put
  the token in `MICA_REPOSITORY_TOKEN`.
- Plain `http://` works only with `NODE_ENV=development` and a loopback host.
  It exists for tests.

#### Token reference

| Host | Token | Scope or permission | Role | What fails without it |
| --- | --- | --- | --- | --- |
| github.com | Fine-grained personal access token, one repository | **Contents: read and write**. Nothing else. | — | Read: Mica refuses to start. Write: Publish is refused, and `check` fails |
| gitlab.com | Project access token, one project | **`read_repository`** and **`write_repository`**. Mica does not use the REST API. The `api` scope also works, but it is broader. | A role that may push to the branch | With `read_repository` only: `check` fails with "not allowed to upload code". With a role that cannot push to a protected branch: the dry run passes, and the real push is refused |

> GitHub: Settings → Developer settings → Personal access tokens →
> Fine-grained tokens → Generate new token → Repository access: Only select
> repositories → Repository permissions → Contents: Read and write
>
> GitLab: the project → Settings → Access tokens → Add new token → Scopes:
> `read_repository`, `write_repository` → Expiration date

GitLab protects the default branch, and by default only Maintainers can push to
a protected branch. A **Developer** token cannot push to a `main` that is
protected for Maintainers. A dry run passes, and the real push is refused.
Choose one of these:

- Use the **Maintainer** role.
- Allow Developers to push to the branch (Settings → Repository → Protected
  branches).
- Use a branch that is not protected.

Use a project access token, not a personal one, and give it a short expiry. A
token changes only with a restart: Mica reads it once, at start.

**Supported hosts**

| Tier | Hosts |
| --- | --- |
| Supported: tested live every week | github.com and gitlab.com |
| Tested in CI | Forgejo |
| Expected to work, not tested | Bitbucket, Gitea, GitHub Enterprise Server, self-managed GitLab |

Any Git host that serves HTTPS and accepts a token as the password should work.
For a host that is not in the first two tiers, run `check` and one real
publication before editors depend on it. A host with a private certificate
authority is not supported yet.

#### What Mica does with the repository

- **It clones** the branch into `MICA_DATA_DIR/repository` at the first start.
  The clone is blobless (Git downloads only the files of the current tree) and
  single branch.
- **It syncs** every `MICA_REPOSITORY_SYNC_SECONDS`: it fetches the branch and
  fast-forwards. It never merges, rebases or stashes. Developers can push to
  the branch as before.
- **It finds conflicts itself.** A conflict is an entry that has a draft in
  Mica and a change on the website. While a conflict exists, Mica does not
  fast-forward. The editor sees the conflict on the Dashboard, on the Changes
  page and on the entry, and chooses per entry: **Keep my version** (the
  draft replaces the website's version when it is published) or **Use the
  website's version** (Mica discards the draft).
- **A model change upstream waits for a restart.** When `.mica/schema.json`
  changes on the branch, Mica stops the fast-forward and shows "restart
  required". Editors can go on saving with the model that is loaded.
  Publish waits. Restart the container ([Changing the content
  model](#changing-the-content-model)).
- **A publication is one commit.** The signed-in editor is the author. Mica
  (`Mica CMS <mica@localhost>`) is the committer. Mica pushes the commit to the
  branch and never forces.
- **It retries.** If the branch moved, Mica takes the commit back, catches up,
  makes the commit again with the same author and message, and pushes. It tries
  three times. If the host cannot be reached, the publication stays committed
  in Mica, and the next sync pushes it. The editor sees "Published in Mica, not
  yet sent to the website".
- **A refused push turns the publication back into drafts.** If the host
  refuses the push (a protected branch, a server hook, a token that cannot
  write), the files are drafts again, and Mica shows the host's reason on the
  System page. Nothing is lost.
- **Git LFS under the content root is refused.** It is not supported yet. Mica
  refuses to clone, and `check` fails, when a `.gitattributes` assigns LFS to
  files under the content root. If the file changes later, the sync stops and
  shows "restart required".
- **Mount the volume at `MICA_DATA_DIR`** (`/data` in the image), never at its
  `repository` folder: Mica makes a new clone beside it and renames it into
  place, which a mount point refuses.
- **One Mica per volume.** Do not run two containers on one volume. Mica has no
  lock file, so it cannot stop a second process.

**Volume size.** Plan for about twice the size of the current content: the
objects in `.git` plus the working tree. `.git` also grows with every media
change that comes from the website. To shrink it, publish or discard all
drafts, stop Mica, delete `MICA_DATA_DIR/repository`, and start Mica. Mica
clones again.

`MICA_REPOSITORY_ROOT` is a real boundary: Mica reads and writes only below it.
A token with write access to the whole repository still cannot be used *through
Mica* to touch the website's source, its CI configuration or its dependencies.
Keep content in its own directory and that holds by construction.

Saving and publishing are two different things. A save lands in the clone's
working tree — durable, but not in Git. An editor's explicit **Publish** commits
the files that the editor reviewed as **one commit** — an `index.json`, its
rich-text sidecars and its images — so the repository never holds half an entry,
and the history reads as publications rather than keystrokes. Drafts that other
editors saved after the review stay drafts.

<a id="3-an-identity-provider"></a>

### 3. An identity provider

Mica implements no passwords, no reset flow, no MFA and no passkeys. It asks an
OpenID Connect provider who you are and records the answer — a smaller attack
surface than any of those features, and it means an editor's account is
governed by whatever your organisation already uses.

Any OIDC provider works: ZITADEL, Keycloak, Authentik, Entra ID, Okta, Auth0,
Google Workspace. Register **one** redirect URI:

```
https://cms.example.com/api/auth/callback
```

Then:

```env
MICA_OIDC_ISSUER=https://auth.example.com
MICA_OIDC_CLIENT_ID=mica
MICA_OIDC_CLIENT_SECRET=…              # omit for a public client using PKCE alone
```

`MICA_OIDC_ISSUER` is the value the provider itself publishes as `issuer` — check it
at `<issuer>/.well-known/openid-configuration`. The flow uses PKCE, `state` and
`nonce`, all verified. Mica asks for `openid profile email`; the email address
is how editors are identified to each other, and is required.

<a id="4-who-may-edit"></a>

### 4. Who may edit

Authentication is not admission. Your provider will vouch for everybody it
knows, and nothing in a valid token says the holder may edit this website — so
Mica **refuses to start** until you say who may. There is no user
administration, no invitation and no People screen; this is the whole of it.

```env
# A — a group your provider already manages. The one to grow into.
MICA_ADMIT_GROUPS=mica-editors

# B — every address in a domain, and only where the provider says it has
#     verified the address.
MICA_ADMIT_DOMAINS=example.com

# C — these addresses, verified by the provider. The one for Google accounts.
MICA_ADMIT_EMAILS=alice@gmail.com,bob@example.com

# D — an explicit list, keyed by issuer and subject.
MICA_ADMIT_SUBJECTS=https://auth.example.com|a1b2c3,https://auth.example.com|d4e5f6
```

Any one of them is enough, and they are comma-separated lists. Set the group
rule and adding an editor becomes a group change in your identity provider —
where you already handle joiners and leavers — with nothing to do in Mica: no
restart, no invitation, and no copy of the list here to go stale.

The claim that carries groups has no standard name. Keycloak and Entra normally
send `groups`; if yours sends something else, name it:

```env
MICA_OIDC_GROUPS_CLAIM=roles
```

Google sends no groups claim. With Google accounts, use the email list, or the
domain rule for a Google Workspace domain. Mica refuses a domain rule for
`gmail.com` and other public providers, because it would admit the public.

The email list has one cost: if your organisation gives a former editor's
address to somebody new, that person gets this site too. Gmail never reuses an
address. For your own domain, prefer a group, and remove the address here when
somebody leaves.

The subject list is the strictest rule: a subject never changes and is never
reassigned. It is keyed by `issuer|subject`. The subject is in the ID token as
`sub`, and your provider's console shows it as the user's id.

The email and domain rules need `email_verified` from the provider. Without it
Mica refuses and says so — an unverified address is one the person typed, and
where self-registration is open that would let anybody claim it.

### 5. The rest of `.env`

```env
MICA_PUBLIC_URL=https://cms.example.com
MICA_TRUST_PROXY=true
MICA_SESSION_SECRET=…
```

`MICA_PUBLIC_URL` must be exactly what the browser shows. It decides the cookie
scope, the Origin check and the redirect URI. `https://` is what turns on
`Secure` cookies with `__Host-` names and the `Strict-Transport-Security`
header, and in production Mica refuses to start without it, or with an
`http://` address other than localhost. At startup, Mica warns about any
`MICA_*` variable that it does not read, which is usually a typo. Every
variable, with its default, is in the
[configuration reference](https://micacms.com/docs/configuration/). Generate the
secret:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

`MICA_TRUST_PROXY` makes Mica read the client address from `X-Forwarded-For` —
enable it **only** behind a proxy you control, or clients can spoof their
address and walk past the login rate limit. Mica takes the right-most entry,
which is the address that the proxy in front of it saw. That is correct for one
proxy, such as Caddy or nginx. Behind a CDN *and* a proxy, every client looks
like the CDN.

### 6. Start it

```bash
docker compose run --rm mica check
docker compose up -d
docker compose logs -f mica
curl -s https://cms.example.com/ready
```

The startup line says which rule is in force, as `admission`. There is nothing
to bootstrap and nobody to invite: anybody your rule admits signs in and is an
editor, and the **System** page shows the rule under _Who may edit_.

At the first start, Mica clones the repository. `/health` answers at once.
`/ready` answers 503 with `cloning` until the clone and the model are ready.

Mica refuses to start, and lists every problem in one message, when:

- `MICA_REPOSITORY_URL` or `MICA_REPOSITORY_TOKEN` is missing, or the URL has
  credentials or is not HTTPS;
- the first clone fails;
- the repository has no content model;
- the content root uses Git LFS;
- the clone on the volume is for another URL or branch and holds drafts. The
  message names the files. Publish with the old configuration, or copy the
  drafts out and delete the volume.

All of these are deliberate: a CMS that starts, shows an editor their content
and only fails when they press Save has already cost them their work. When a
clone is in place, a network or token failure does not stop Mica: editing works,
the System page shows the sync error, and Mica tries again.

### The `check` command

`check` tells you whether this configuration can serve the repository. It needs
no browser, so you or a coding agent can run it from a shell.

```bash
docker compose run --rm mica check                   # before the first start
docker compose exec mica node dist/index.js check    # while Mica runs
```

It prints one line per check and exits with 0 when all pass, 1 when one fails,
and 78 when the configuration is wrong. It checks:

- the configuration, with the same refusals as the start;
- **read access**: it fetches the head of the branch;
- **push rights**: a dry-run push of that head to the branch;
- **the content model**: `.mica/schema.json` under the content root, and the
  number of collections and singletons;
- **Git LFS**: that the content root does not use it;
- **the data volume**: whether a clone exists, and how many unpublished draft
  files it holds.

`check` works in a temporary directory. It never writes to an existing clone
and never fetches into it, so it is safe while Mica runs.

A dry run does not see branch protection, server hooks or a host's extra rules.
A pass means that the token may push. It does not mean that every push to the
branch is allowed. The first real publication shows such a refusal.

---

## The reverse proxy

The container binds to loopback. Terminate TLS in front of it. Caddy is two
lines and gets a certificate by itself:

```
cms.example.com {
    reverse_proxy 127.0.0.1:6422
}
```

A publication can take longer than a short proxy timeout, because Git pushes
the commit before Mica answers. This is true for a large push, such as new
images. Set the read timeout of the proxy to at least a few minutes. In nginx,
raise `proxy_read_timeout`.

Firewall: 80 and 443 only. Mica never needs to be reachable from the internet
by anything but the editors' browsers, and the website build never contacts it
at all.

## Taking access away

Two paths, and they take effect at different speeds.

**Changing the rules is immediate.** Mica re-reads them on every request rather
than copying an answer into the session, so somebody removed from
`MICA_ADMIT_SUBJECTS` is refused on their next request once the container has
the new value.

**Removing somebody at the provider is not.** Mica checks the claims the
provider sent at sign-in, and it cannot know they have changed until the person
signs in again. Somebody taken out of `mica-editors` therefore keeps working
until their session ends. That is the cost of having no user database, and it
is why sessions are hours rather than weeks:

```env
MICA_SESSION_TTL_HOURS=8                    # absolute lifetime
MICA_SESSION_IDLE_HOURS=4                   # and the idle window
```

Disabling the account at the provider is the fast path for a departure, and it
is the provider's to do. Where access must be cut within seconds, remove the
person from the `MICA_ADMIT_*` rules and restart the container. The rules are
re-read on every request, so the person is refused at once.

A session is an encrypted cookie, and Mica keeps no list of them. Sign-out
clears the cookie in the browser only, and a copied cookie stays valid until it
expires. To end every session at once, change `MICA_SESSION_SECRET` and restart.
Everybody then signs in again.

## Build the website

The build reads the repository. It needs no token, no CMS URL and no network
access to Mica. Mica's clone is not the source of the build: the push is.

```yaml
# .github/workflows/build.yml
name: Build website
on:
  push:
    branches: [main]

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 22 }
      - run: npm ci
      - run: npx astro build
      # The model in the commit must match the one the build wrote.
      - run: git diff --exit-code content/.mica/schema.json
      # Every entry must match the model (needs @micacms/editor as a dev dependency).
      - run: npx mica check
      # …then upload dist/ wherever you like.
```

An editor pressing Publish produces a commit, which triggers this. There is
nothing to wire up on Mica's side — and autosaves trigger nothing, which is
the point of separating the two.

If your host builds from the repository itself — Vercel, Netlify, Cloudflare
Pages — you do not need the workflow at all. An editorial commit is just a
commit.

**Keeping editorial commits out of your other CI.** Editors commit far more
often than developers. If you have expensive jobs on `main`, filter them with
`paths-ignore: ["content/**"]`, and give the site build the opposite filter.

**Editing on a branch.** `MICA_REPOSITORY_BRANCH` can be any branch. Point a
second Mica, with its own volume, at `MICA_REPOSITORY_BRANCH=staging` and
editors have a staging site, reviewed and merged like any other change. That is
how Mica does *release-level* staging — a step above the built-in draft
workspace, which only separates Saved from Published and has no approval or
review of its own.

## Changing the content model

In the project: edit the model, `astro build`, commit `.mica/schema.json`, push.
Mica sees the change at its next sync and stops the fast-forward. The editor
shows "restart required", and `/ready` carries `restart_required`. Then:

```bash
docker compose restart mica
```

The restart fast-forwards the clone and then loads the new model. The image
holds no model — only the field types that interpret one — so it never needs
rebuilding for a content or model change. Deploy the matching website build at
the same time: adding a required field makes existing entries invalid until
they are edited, and the website build is where you find out.

Until the restart, editors can save, but Publish waits, and Mica does not
fast-forward. The same hold applies to a change of a `.gitattributes` file that
can apply under the content root. Drafts stay in the clone and are kept across
the restart.

## Upgrading

The image tag in `compose.yml` is the version. Change it, then:

```bash
docker compose pull && docker compose up -d
```

Mica is pre-1.0: read the [changelog](../CHANGELOG.md) first, and pin a
version rather than tracking `latest`, so an upgrade is a decision.

---

## Verifying the image

From 0.4.0, every image is signed with a keyless
[cosign](https://docs.sigstore.dev/) signature from this repository's release
workflow, and carries an SBOM and build provenance. To check an image before
you run it:

```bash
cosign verify ghcr.io/micacms/mica:<version> \
  --certificate-identity-regexp '^https://github.com/micacms/mica/\.github/workflows/release\.yml@refs/tags/v' \
  --certificate-oidc-issuer https://token.actions.githubusercontent.com

docker buildx imagetools inspect ghcr.io/micacms/mica:<version> --format '{{ json .SBOM }}'
```

The compose file runs the container hardened: a read-only root file system,
`/tmp` in memory, no Linux capabilities, `no-new-privileges` and a 512 MB
memory limit. Only the `/data` volume is writable.

## Health

Two public endpoints. Neither names the repository or the uptime (the System
view shows both to editors):

- `GET /health` answers `{ "status": "ok" }` while the process runs. It does no
  I/O. The image's `HEALTHCHECK` and the compose file use it, so that a host
  outage does not restart a container that would not be any better for it.
- `GET /ready` answers about the clone. It makes no network call.

  ```json
  { "status": "ok", "repository": "ok", "reasons": ["sync_failing"] }
  ```

  It answers **503 only while there is no usable clone** (`reasons` is
  `["cloning"]`). Otherwise it answers **200**, because editing still works.
  The `reasons` list can carry these codes:

  | Code | Meaning |
  | --- | --- |
  | `sync_failing` | The last sync failed (the host is unreachable, or the repository is not found). Mica tries again. |
  | `auth_failed` | The host refused the token. Fix the token and restart. |
  | `branch_not_found` | `MICA_REPOSITORY_BRANCH` does not exist in the repository. Push it, or fix the name and restart. |
  | `write_forbidden` | The token can read but not write. Publish is refused. |
  | `restart_required` | The content model changed on the branch. Restart Mica. |

  Point an uptime monitor at it, and alert on `reasons`, not on the status
  code. The result is cached for 30 seconds.

It does not check the identity provider. A provider that is briefly unreachable
should stop new sign-ins, not take a container out of rotation and sign out
everybody already working.

## Backups

**Your published content is in the repository, and Git is already keeping
it.** Every publication is a commit, so the history is complete by
construction rather than by schedule, and any clone is a full copy. If it is
on a hosted Git service it is already off-site and replicated; if you want
a copy of your own, mirror it:

```bash
git clone --mirror git@github.com:acme/website.git
git --git-dir=website.git remote update --prune      # on a schedule
```

Restoring is a clone. There is nothing to import and no schema to match, and no
version of Mica has to be running for the files to be readable.

**The volume holds unpublished work, and that is what losing it costs.** The
clone carries the drafts — everything that is Saved and not yet Published,
media uploads included — and maybe one commit that is not pushed yet. Git is
not protecting that; only publication moves it into the repository. Losing the
volume loses it. It signs nobody out: sessions are cookies.

- **Publish first, or stop the container, then copy the volume.** A copy taken
  during a Git write can be inconsistent.
- **For the drafts only,** `tar` the content root of the clone
  (`MICA_DATA_DIR/repository/<MICA_REPOSITORY_ROOT>`).
- **Do not run `git fetch` or `git push` through `docker compose exec`.** That
  shell has no credentials and none of Mica's isolation. Use it only for
  `GIT_OPTIONAL_LOCKS=0 git status` and `git diff`. Without that variable,
  `git status` can take `index.lock` and make a Mica commit fail.

Encourage editors to publish rather than to hoard a large pending set — the
draft workspace is a staging area, not an archive.

---

## Troubleshooting

By error class. The System page and the log show the host's message, with the
token removed.

### Configuration refusals

Mica exits at start and lists every problem in one message.

| Symptom | Likely cause | Fix |
| --- | --- | --- |
| "`MICA_REPOSITORY_URL` is not set" or "… is not a URL" | The variable is missing or wrong | Set the HTTPS clone URL, for example `https://gitlab.com/group/project.git` |
| "`MICA_REPOSITORY_URL` contains credentials" | A token is in the URL | Remove it, and set `MICA_REPOSITORY_TOKEN` |
| "must be an https:// URL" | An `ssh://`, `git@…` or `http://` URL | Use HTTPS. SSH is not supported yet. `http://` works only with `NODE_ENV=development` on loopback |
| "assigns Git LFS to files under the content root" | `.gitattributes` has `filter=lfs` for the content | Keep LFS out of the content root. Mica does not support it yet |
| "The clone on the data volume is for …" | The URL or branch changed, and the clone has drafts | Start with the old configuration and publish, or copy the drafts out and delete the volume |
| "No content model at …" | `.mica/schema.json` was never committed, or is on another branch | Build the Astro project, commit it, push to `MICA_REPOSITORY_BRANCH` |
| Exits with "Missing required production secrets" or "nothing says who may edit this site" | `MICA_SESSION_SECRET` or an admission rule is missing | Set it ([step 4](#4-who-may-edit), [step 5](#5-the-rest-of-env)) |

### Authentication failed

| Symptom | Likely cause | Fix |
| --- | --- | --- |
| `check` or the log says "The repository refused the token"; `/ready` has `auth_failed` | The token is wrong, expired or revoked | Make a new token, put it in `.env`, and restart. The token changes only with a restart |
| The same, and the user name looks wrong | An empty `MICA_REPOSITORY_USERNAME` | Remove it to use the default, or set a non-empty name |

### Write forbidden, or a protected branch

| Symptom | Likely cause | Fix |
| --- | --- | --- |
| `check` says "The token can read the repository but not write"; `/ready` has `write_forbidden` | A GitLab token with `read_repository` only, or a GitHub token with Contents: read | GitLab: add `write_repository`. GitHub: Contents: read and write |
| `check` passes, but Publish says "The repository refused this publication. It is a draft again" | A protected branch, a server hook or signed commits. The System page shows the host's reason | GitLab: use the Maintainer role, or allow Developers to push. Or use a branch that is not protected. The publication is a draft again, so nothing is lost: publish again after the fix |

### Repository not found, or unreachable

| Symptom | Likely cause | Fix |
| --- | --- | --- |
| "The repository does not exist, or the token cannot see it" | A wrong URL, or a token for another repository. The host gives the same answer for both | Check the URL and the token's repository |
| "The branch does not exist in the repository"; `/ready` has `branch_not_found` | `MICA_REPOSITORY_BRANCH` names a branch that is not pushed, or has a typo | Push the branch, or fix `MICA_REPOSITORY_BRANCH` and restart |
| "The repository cannot be reached"; `/ready` has `sync_failing` | The host is down, DNS fails, or the container has no outbound HTTPS | Check from the host: `curl -I <url>`. Mica tries again at each sync. A publication waits as "Published in Mica, not yet sent to the website" and Mica pushes it later |
| The first start fails and `/ready` stays at `cloning` | The clone cannot finish: network, or a very large repository | Read `docker compose logs mica`. A large clone can take minutes |

### Conflicts

| Symptom | Likely cause | Fix |
| --- | --- | --- |
| The editor shows "changed on the website while you edited it" | A developer pushed a change to an entry that has a draft in Mica | Per entry: **Keep my version** or **Use the website's version**. Mica does not fast-forward until every conflict is resolved |
| Saving returns 409 | The entry changed on the website since the editor opened it | Reload; the editor's work is still in the form |
| Publishing says "edited while they were being published" | A colleague saved one of the files after the review | Review the changes again, then publish |

### Restart required

| Symptom | Likely cause | Fix |
| --- | --- | --- |
| "The content model changed on the website"; `/ready` has `restart_required` | `.mica/schema.json` or a `.gitattributes` changed on the branch | `docker compose restart mica` |
| "Read-only in this version of Mica" on a collection | The site uses a field type from a newer `@micacms/astro` than the image | Change the image tag in `compose.yml` to that version or newer, then `docker compose pull && docker compose up -d` |

### Other

| Symptom | Likely cause | Fix |
| --- | --- | --- |
| Saving returns 422 | The entry does not satisfy the model | The response names the fields |
| Publishing returns 422 | Something in the pending set no longer validates | The response names the entries and fields |
| The disk is full | The clone grows with every media change | See "Volume size" in step 2. Publish or discard, stop, delete `MICA_DATA_DIR/repository`, start |
| Editors signed out after a restart | `MICA_SESSION_SECRET` unset, so an ephemeral one was generated | Set it |
| "No access to this site" after signing in | Authenticated, but not admitted | Check the group claim actually arrives — `MICA_LOG_LEVEL=debug` names the reason — or add the subject to `MICA_ADMIT_SUBJECTS`, or the address to `MICA_ADMIT_EMAILS` |
| Sign-in returns to the login page with "expired" | The transaction cookie was lost — usually a `MICA_PUBLIC_URL` that does not match the browser's address | Make them identical |
| 503, "identity provider could not be reached" | `MICA_OIDC_ISSUER` wrong, or discovery blocked | Check `<issuer>/.well-known/openid-configuration` from the container |
| Site build succeeds but content is stale | The host built an older commit | Check CI ran on the editorial commit |
