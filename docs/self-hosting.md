# Self-hosting Mica

One container on a machine you control — your own server, or a VPS from
Hetzner, OVH or anyone else. There is no managed Mica to buy, and nothing here
depends on a cloud service.

```
   editor
     │
     ▼
┌──────────┐   commits    ┌────────────────────┐
│   Mica   │ ───────────▶ │ content repository │
│  1 GB    │              │  github / gitlab   │
│  RAM     │              └─────────┬──────────┘
└────┬─────┘                        │ push
     │                              ▼
  cms.sqlite                   ┌─────────┐
  accounts &                   │   CI    │  astro build
  sessions                     └────┬────┘
                                    ▼
                              static files → any static host
```

Those two arrows out of Mica are the whole integration surface. No content API,
no read token, no build webhook — a push is the trigger, which every CI system
already understands.

**Before you start**

- The content model has to be in the repository. Your Astro build writes it to
  `content/.mica/schema.json`; commit it, or Mica has nothing to edit. See
  [getting-started.md](./getting-started.md).
- There is no published image yet, so `docker compose` builds one from a clone
  of this repository. Everything below assumes that clone is on the server.

---

## 1. How Mica reaches the repository

| `REPOSITORY` | What it does | Use it when |
| --- | --- | --- |
| `github` | Commits through the GitHub API | The repository is on GitHub |
| `gitlab` | Commits through the GitLab API | The repository is on GitLab |
| `local` | Writes into a checkout on disk | Development, or you have a checkout and your own sync |

Prefer a provider connector for anything deployed: no clone to keep in sync, no
deploy key on disk, and no risk of the container's working tree drifting from
the remote.

**GitHub** — a fine-grained personal access token, or a GitHub App installation
token, scoped to **that one repository** with **Contents: read and write**.
Nothing else: Mica does not open pull requests, read issues or run workflows.

```env
REPOSITORY=github
REPOSITORY_PROJECT=acme/website
REPOSITORY_TOKEN=github_pat_…
REPOSITORY_ROOT=content
REPOSITORY_BRANCH=main
```

**GitLab** — a project access token with the `write_repository` scope.

```env
REPOSITORY=gitlab
REPOSITORY_PROJECT=acme/website        # or the numeric project id
REPOSITORY_TOKEN=glpat-…
REPOSITORY_ROOT=content
REPOSITORY_BRANCH=main
```

For GitHub Enterprise Server or self-managed GitLab, add
`REPOSITORY_API_BASE=https://git.example.com`.

`REPOSITORY_ROOT` is a real boundary: Mica reads and writes only below it. A
token with write access to the whole repository still cannot be used *through
Mica* to touch the website's source, its CI configuration or its dependencies.
Keep content in its own directory and that holds by construction.

## 2. An identity provider

Mica implements no passwords, no reset flow, no MFA and no passkeys. It asks an
OpenID Connect provider who you are and records the answer — a smaller attack
surface than any of those features, and it means an editor's account is
governed by whatever your organisation already uses.

Any OIDC provider works: Keycloak, Authentik, ZITADEL, Entra ID, Okta, Auth0,
Google Workspace.

```env
MICA_MODE=self-hosted
OIDC_ISSUER=https://auth.example.com/realms/mica
OIDC_CLIENT_ID=mica
OIDC_CLIENT_SECRET=…            # omit for a public client using PKCE alone
```

Register this redirect URI with the provider:

```
https://cms.example.com/api/auth/callback
```

The flow uses PKCE, `state` and `nonce`, all verified. Mica requests
`openid profile email`; the email address is how editors are identified to each
other, and is required.

To watch it work before wiring up your own,
`docker compose -f e2e/compose.yml up --build` runs Mica against a
pre-configured Keycloak — see [e2e/README.md](../e2e/README.md).

### Authentication is not authorization

A provider vouching for someone does **not** let them in. Access is a
*membership* on a site, and an authenticated person without one is turned away
with a message telling them to ask an administrator.

That leaves a chicken-and-egg on a fresh deployment: no members means nobody
can invite anyone. Break it either way:

```env
OIDC_BOOTSTRAP_ADMIN=you@example.com   # becomes an admin on first sign-in
```

```bash
docker compose exec cms node dist/server/scripts/grant-access.js \
  --email you@example.com --role admin
```

After that, administrators add people from the **People** screen. There is
nothing to send them: they sign in with that address and they are in.

Removing a membership ends every session for that person immediately, on every
device — authorization is re-read on each request rather than copied into the
session. It does not touch their account at the provider, which is the
provider's to disable, and keeping the two separate is the point.

## 3. Start it

```bash
cp apps/cms/.env.example .env
# fill in: SESSION_SECRET, CMS_BASE_URL, the OIDC block, the REPOSITORY block
docker compose up -d
```

`SESSION_SECRET` is mandatory in production and signs the session cookie:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Mica refuses to start if `REPOSITORY` names a provider without a project and a
token, or if the repository has no content model. Both are deliberate: a CMS
that starts, shows an editor their content and only fails when they press Save
has already cost them their work.

### The reverse proxy

The container binds to loopback. Terminate TLS in front of it:

```env
CMS_BASE_URL=https://cms.example.com
TRUST_PROXY=true
```

`CMS_BASE_URL` starting with `https://` is what turns on `Secure` cookies.
`TRUST_PROXY` makes Mica read the client address from `X-Forwarded-For` —
enable it **only** behind a proxy you control, or clients can spoof their
address and walk past the login rate limit.

Caddy is two lines and gets a certificate by itself:

```
cms.example.com {
    reverse_proxy 127.0.0.1:6422
}
```

## 4. A VPS, end to end

For a small Hetzner box (CX22 or similar) with Docker and Caddy installed:

```bash
# on the server — this is the Mica repository, not your website's
git clone <this-repository> /srv/mica
cd /srv/mica
cp apps/cms/.env.example .env && $EDITOR .env
docker compose up -d --build
docker compose logs -f cms
curl -s https://cms.example.com/health
```

Nothing of your project is on this machine: Mica reaches your repository over
the provider's API, and the model comes back with it.

Then, once:

```bash
docker compose exec cms node dist/server/scripts/grant-access.js --email you@example.com
```

Firewall: 80 and 443 only. Mica itself never needs to be reachable from the
internet by anything but the editors' browsers, and the website build never
contacts it at all.

## 5. Build the website

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

An editor pressing Save produces a commit, which triggers this. There is
nothing to wire up on Mica's side.

If your host builds from the repository itself — Vercel, Netlify, Cloudflare
Pages — you do not need the workflow at all. An editorial commit is just a
commit.

**Keeping editorial commits out of your other CI.** Editors commit far more
often than developers. If you have expensive jobs on `main`, filter them with
`paths-ignore: ["content/**"]`, and give the site build the opposite filter.

**Editing on a branch.** `REPOSITORY_BRANCH` can be any branch. Point a second
Mica at `REPOSITORY_BRANCH=staging` and editors have a staging site, reviewed
and merged like any other change. That is how Mica does staging, and why it has
no draft/published states.

## 6. Changing the content model

In the project: edit the model, `astro build`, commit `.mica/schema.json`, push.
Then:

```bash
docker compose restart cms
```

The image holds no model — only the field types that interpret one — so it
never needs rebuilding for a content or model change. Deploy the matching
website build at the same time: adding a required field makes existing entries
invalid until they are edited, and the website build is where you find out.

---

## Health

`GET /health` checks both halves:

```json
{ "status": "ok", "database": "ok", "repository": "github:acme/website/content@main" }
```

It returns 503 if the database is unreadable or the repository is unreachable —
a container that is listening but cannot reach its repository cannot save
anything, so it should not be sent traffic.

It does not check the identity provider. A provider that is briefly unreachable
should stop new sign-ins, not take a container out of rotation and sign out
everybody already working.

## Backups

**Your content repository is the backup, and Git is already keeping it.** Every
save is a commit, so the history is complete by construction rather than by
schedule, and any clone is a full copy. If it is on GitHub or GitLab it is
already off-site and replicated; if you want a copy of your own, mirror it:

```bash
git clone --mirror git@github.com:acme/website.git
git --git-dir=website.git remote update --prune      # on a schedule
```

Restoring is a clone. There is nothing to import and no schema to match, and no
version of Mica has to be running for the files to be readable.

`cms.sqlite` holds accounts, memberships and sessions — no content, no
credentials. Backing it up is optional: decide by asking what you would rather
do after losing the volume, restore a file or run `grant-access` once and tell
three editors to sign in again. If you do want a copy, take it with SQLite's
own `.backup` (a plain `cp` is unsafe: WAL mode keeps recent writes in
`cms.sqlite-wal`).

There is no `mica backup` command, because shipping one would imply that a Mica
backup protects your content — and it is not what you would reach for if you
ever needed it.

---

## Troubleshooting

| Symptom | Likely cause | Fix |
| --- | --- | --- |
| Exits at startup with `ConfigError` | `REPOSITORY` names a provider without `REPOSITORY_PROJECT` / `REPOSITORY_TOKEN` | Set both |
| Exits with "No content model at …" | `.mica/schema.json` was never committed, or is on another branch | Build the Astro project, commit it, push to `REPOSITORY_BRANCH` |
| Exits with "Could not read the content model" | The repository is unreachable — bad token, wrong project, provider down | Check the token's scope and `REPOSITORY_PROJECT` |
| Health 503, `repository: unavailable` | Token expired, revoked, or wrong scope | Reissue with contents write / `write_repository` |
| Admin loads with the wrong collections | The model in the repository is stale | Rebuild the project, commit, `docker compose restart cms` |
| Saving returns 409 | Someone else changed that entry, or a push landed mid-save | Reload; the editor's work is still in the form |
| Saving returns 422 | The entry does not satisfy the model | The response names the fields |
| Editors signed out after a restart | `SESSION_SECRET` unset, so an ephemeral one was generated | Set it |
| "No access to this site" after signing in | Authenticated, but no membership | Add them on the People screen, or run `grant-access` |
| Sign-in returns to the login page with "expired" | The transaction cookie was lost — usually a `CMS_BASE_URL` that does not match the browser's address | Make them identical |
| 503, "identity provider could not be reached" | `OIDC_ISSUER` wrong, or discovery blocked | Check `<issuer>/.well-known/openid-configuration` from the container |
| Refuses to start: "disables authentication" | `MICA_MODE=local` in production, or on a non-local host | Set `MICA_MODE=self-hosted` and configure OIDC |
| Site build succeeds but content is stale | The host built an older commit | Check CI ran on the editorial commit |
