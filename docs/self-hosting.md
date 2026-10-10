# Self-hosting Mica

One container on a machine you control — your own server, or a VPS from
Hetzner, OVH or anyone else. There is no managed Mica to buy, and nothing here
depends on a cloud service.

```
   editor
     │
     ▼
┌──────────┐   publishes  ┌────────────────────┐
│   Mica   │ ───────────▶ │ content repository │
│  1 GB    │  one commit  │  github / gitlab   │
│  RAM     │              └─────────┬──────────┘
└────┬─────┘                        │ push
     │                              ▼
  cms.sqlite                   ┌─────────┐
  pending draft                │   CI    │  astro build
  only                         └────┬────┘
                                    ▼
                              static files → any static host
```

Those two arrows out of Mica are the whole integration surface. No content API,
no read token, no build webhook — a push is the trigger, which every CI system
already understands.

**Want to see it running first?** [`deploy/demo-identity/`](../deploy/demo-identity/README.md) starts Mica and
an identity provider on your machine with two commands. Everything below is the
same shape, with your own domain and provider.

---

## Quickstart

Ten minutes, on a server with Docker and a reverse proxy.

### Before you start

- **A content repository on github.com or gitlab.com**, with the content model
  committed at `content/.mica/schema.json`. Your Astro build writes that file;
  you commit it. See [getting-started.md](./getting-started.md).
- **An OpenID Connect provider.** Mica has no passwords of its own. If you do
  not have one, [step 3](#3-an-identity-provider) starts one.
- **A hostname with TLS**, terminated by a proxy in front of the container.

### 1. The two files

No clone of this repository. The image is published, and the content model
comes out of your content repository at runtime.

```bash
mkdir -p /srv/mica && cd /srv/mica
curl -o compose.yml https://raw.githubusercontent.com/amuedespacher/micacms/main/deploy/self-hosted/compose.yml
curl -o .env https://raw.githubusercontent.com/amuedespacher/micacms/main/deploy/self-hosted/.env.example
```

### 2. A repository token

Mica commits through the provider's API. There is no clone to keep in sync and
no deploy key on disk.

**github.com** — a fine-grained personal access token, scoped to **that one
repository**, with **Contents: read and write**. Nothing else: Mica opens no
pull requests, reads no issues and runs no workflows.

> Settings → Developer settings → Personal access tokens → Fine-grained tokens
> → Generate new token → Repository access: Only select repositories →
> Repository permissions → Contents: Read and write

```env
REPOSITORY=github
REPOSITORY_PROJECT=acme/website        # owner/repo
REPOSITORY_TOKEN=github_pat_…
REPOSITORY_ROOT=content
REPOSITORY_BRANCH=main
```

**gitlab.com** — a project access token with the `write_repository` scope.

> The project → Settings → Access tokens → Add new token → Role: Developer →
> Scopes: write_repository

```env
REPOSITORY=gitlab
REPOSITORY_PROJECT=acme/website        # group/project, or the numeric id
REPOSITORY_TOKEN=glpat-…
REPOSITORY_ROOT=content
REPOSITORY_BRANCH=main
```

Saving and publishing are two different things. A save lands in Mica's draft
workspace — durable, but not in Git. An editor's explicit **Publish** writes
the whole accumulated change set as **one commit**, whatever it touched — an
`index.json`, its rich-text sidecars and its images — so the repository never
holds half an entry, and the history reads as publications rather than
keystrokes.

`REPOSITORY_ROOT` is a real boundary: Mica reads and writes only below it. A
token with write access to the whole repository still cannot be used *through
Mica* to touch the website's source, its CI configuration or its dependencies.
Keep content in its own directory and that holds by construction.

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
MICA_ADMIT_GROUP=mica-editors

# B — every address in a domain, and only where the provider says it has
#     verified the address.
MICA_ADMIT_DOMAIN=example.com

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
TRUST_PROXY=true
SESSION_SECRET=…
```

`MICA_PUBLIC_URL` must be exactly what the browser shows. It decides the cookie
scope, the Origin check and the redirect URI, and `https://` is what turns on
`Secure` cookies. Generate the secret:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

`TRUST_PROXY` makes Mica read the client address from `X-Forwarded-For` —
enable it **only** behind a proxy you control, or clients can spoof their
address and walk past the login rate limit.

### 6. Start it

```bash
docker compose up -d
docker compose logs -f mica
curl -s https://cms.example.com/health
```

The startup line says which rule is in force, as `admission`. There is nothing
to bootstrap and nobody to invite: anybody your rule admits signs in and is an
editor, and the **System** page shows the rule under _Who may edit_.

Mica refuses to start if `REPOSITORY` is not `github` or `gitlab`, if the
project or the token is missing, or if the repository has no content model. Both are deliberate: a CMS
that starts, shows an editor their content and only fails when they press Save
has already cost them their work.

---

## The reverse proxy

The container binds to loopback. Terminate TLS in front of it. Caddy is two
lines and gets a certificate by itself:

```
cms.example.com {
    reverse_proxy 127.0.0.1:6422
}
```

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
SESSION_TTL_HOURS=8                    # absolute lifetime
SESSION_IDLE_HOURS=4                   # and the idle window
```

Disabling the account at the provider is the fast path for a departure, and it
is the provider's to do. Where access must be cut within seconds, remove the
person from the `MICA_ADMIT_*` rules and restart the container. The rules are
re-read on every request, so the person is refused at once.

A session is an encrypted cookie, and Mica keeps no list of them. Sign-out
clears the cookie in the browser only, and a copied cookie stays valid until it
expires. To end every session at once, change `SESSION_SECRET` and restart.
Everybody then signs in again.

## Build the website

The build reads the repository. It needs no token, no CMS URL and no network
access to Mica.

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

**Editing on a branch.** `REPOSITORY_BRANCH` can be any branch. Point a second
Mica at `REPOSITORY_BRANCH=staging` and editors have a staging site, reviewed
and merged like any other change. That is how Mica does *release-level*
staging — a step above the built-in draft workspace, which only separates
Saved from Published and has no approval or review of its own.

## Changing the content model

In the project: edit the model, `astro build`, commit `.mica/schema.json`, push.
Then:

```bash
docker compose restart mica
```

The image holds no model — only the field types that interpret one — so it
never needs rebuilding for a content or model change. Deploy the matching
website build at the same time: adding a required field makes existing entries
invalid until they are edited, and the website build is where you find out.

A model change while editors have a **pending draft** is refused at Publish:
the draft was validated against the model the server started with, and Mica
will not publish across the difference. The message says so; restart, review
the pending changes against the new model, and publish then.

## Upgrading

The image tag in `compose.yml` is the version. Change it, then:

```bash
docker compose pull && docker compose up -d
```

Mica is pre-1.0: read the [changelog](../CHANGELOG.md) first, and pin a
version rather than tracking `latest`, so an upgrade is a decision.

---

## Health

`GET /health` checks both halves:

```json
{ "status": "ok", "database": "ok", "repository": "github:acme/website/content@main" }
```

The endpoint
returns 503 if the database is unreadable or the repository is unreachable —
a container that is listening but cannot reach its repository cannot save
anything, so it should not be sent traffic.

It does not check the identity provider. A provider that is briefly unreachable
should stop new sign-ins, not take a container out of rotation and sign out
everybody already working.

## Backups

**Your published content is in the repository, and Git is already keeping
it.** Every publication is a commit, so the history is complete by
construction rather than by schedule, and any clone is a full copy. If it is
on github.com or gitlab.com it is already off-site and replicated; if you want
a copy of your own, mirror it:

```bash
git clone --mirror git@github.com:acme/website.git
git --git-dir=website.git remote update --prune      # on a schedule
```

Restoring is a clone. There is nothing to import and no schema to match, and no
version of Mica has to be running for the files to be readable.

**`cms.sqlite` now holds unpublished work, and that changes what losing it
costs.** It carries the pending draft — everything that
is Saved and not yet Published, media uploads included. Git is not protecting
that yet; only publication moves it into the repository. Losing the volume
therefore loses whatever was saved but never published. It signs nobody out:
sessions are cookies.
Back up the data volume on a schedule, and take the copy with SQLite's own
`.backup` (a plain `cp` is unsafe: WAL mode keeps recent writes in
`cms.sqlite-wal`). Encourage editors to publish rather than to hoard a
large pending set — the draft workspace is a staging area, not an archive.

## Self-managed Git providers

github.com and gitlab.com are the two connectors Mica has. A GitHub Enterprise
Server or a self-managed GitLab speaks the same API, and `REPOSITORY_API_BASE`
points the same connector at it:

```env
REPOSITORY_API_BASE=https://git.example.com
```

That path is not covered by tests against a real instance yet. Other providers
— Gitea, Forgejo, Bitbucket — need their own connector, and do not have one.

---

## Troubleshooting

| Symptom | Likely cause | Fix |
| --- | --- | --- |
| Exits at startup with `ConfigError` | `REPOSITORY` is not `github` or `gitlab` (`local` is refused), or `REPOSITORY_PROJECT` / `REPOSITORY_TOKEN` is missing | Set all three. To edit a checkout, run `npx @micacms/editor` |
| Exits with "No content model at …" | `.mica/schema.json` was never committed, or is on another branch | Build the Astro project, commit it, push to `REPOSITORY_BRANCH` |
| Exits with "Could not read the content model" | The repository is unreachable — bad token, wrong project, provider down | Check the token's scope and `REPOSITORY_PROJECT` |
| Health 503, `repository: unavailable` | Token expired, revoked, or wrong scope | Reissue with contents write / `write_repository` |
| Admin loads with the wrong collections | The model in the repository is stale | Rebuild the project, commit, `docker compose restart mica` |
| Saving returns 409 | Someone else changed that entry in the shared draft | Reload; the editor's work is still in the form |
| Saving returns 422 | The entry does not satisfy the model | The response names the fields |
| Publishing returns 409 | A push landed on a staged path, or the content model changed since startup | The message says which; refresh and review, or restart after a model change |
| Publishing returns 422 | Something in the pending set no longer validates | The response names the entries and fields |
| Editors signed out after a restart | `SESSION_SECRET` unset, so an ephemeral one was generated | Set it |
| "No access to this site" after signing in | Authenticated, but not admitted | Check the group claim actually arrives — `LOG_LEVEL=debug` names the reason — or add the subject to `MICA_ADMIT_SUBJECTS`, or the address to `MICA_ADMIT_EMAILS` |
| Refuses to start: "nothing says who may edit this site" | No admission rule | Set `MICA_ADMIT_GROUP`, `MICA_ADMIT_DOMAIN`, `MICA_ADMIT_EMAILS` or `MICA_ADMIT_SUBJECTS` |
| Sign-in returns to the login page with "expired" | The transaction cookie was lost — usually a `MICA_PUBLIC_URL` that does not match the browser's address | Make them identical |
| 503, "identity provider could not be reached" | `MICA_OIDC_ISSUER` wrong, or discovery blocked | Check `<issuer>/.well-known/openid-configuration` from the container |
| Site build succeeds but content is stale | The host built an older commit | Check CI ran on the editorial commit |
