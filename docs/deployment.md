# Deployment

Mica is one container. It commits to a Git repository; your CI builds the
website from that repository and uploads it somewhere static. Nothing in that
chain requires Mica to be reachable from the internet, and nothing requires the
website to be reachable from Mica.

```
   editor
     │
     ▼
┌──────────┐   commits    ┌────────────────────┐
│   Mica   │ ───────────▶ │ content repository │
│ (Hono +  │              │  github / gitlab   │
│  Vue)    │              └─────────┬──────────┘
└────┬─────┘                        │ push
     │                              ▼
  cms.sqlite                   ┌─────────┐
  accounts &                   │   CI    │  astro build
  sessions                     └────┬────┘
                                    ▼
                              static files
                                    ▼
                            any static host
```

The two arrows out of Mica are the whole integration surface. There is no
content API, no read token and no build webhook — a push is the trigger, which
every CI system already understands.

---

## 1. Choose how Mica reaches the repository

| `REPOSITORY` | What it does | Use it when |
| --- | --- | --- |
| `github` | Commits through the GitHub API | The repository is on GitHub |
| `gitlab` | Commits through the GitLab API | The repository is on GitLab |
| `local` | Writes into a checkout on disk | Development, or you already have a checkout and your own sync |

For a hosted deployment, prefer a provider connector. There is no clone to keep
in sync, no deploy key on disk, and no risk of the container's working tree
drifting from the remote.

### GitHub

Create a fine-grained personal access token, or a GitHub App installation
token, scoped to **that one repository** with:

- **Contents: read and write**

Nothing else. Mica does not open pull requests, read issues or run workflows.

```env
REPOSITORY=github
REPOSITORY_PROJECT=acme/website
REPOSITORY_TOKEN=github_pat_…
REPOSITORY_ROOT=content
REPOSITORY_BRANCH=main
```

### GitLab

Create a project access token with the `write_repository` scope.

```env
REPOSITORY=gitlab
REPOSITORY_PROJECT=acme/website        # or the numeric project id
REPOSITORY_TOKEN=glpat-…
REPOSITORY_ROOT=content
REPOSITORY_BRANCH=main
```

For GitHub Enterprise Server or self-managed GitLab, add
`REPOSITORY_API_BASE=https://git.example.com`.

### Why `REPOSITORY_ROOT` matters

Mica reads and writes only below that directory. A token with write access to
the whole repository still cannot be used *through Mica* to touch the website's
source code, its CI configuration or its dependencies. Keep content in its own
directory and this holds by construction.

---

## 2. Choose an identity provider

Mica implements no passwords, no reset flow, no MFA and no passkeys. It asks an
OpenID Connect provider who you are and records the answer. That is a smaller
attack surface than any of those features would be, and it means an editor's
account is governed by whatever your organisation already uses.

Any OIDC provider works: Keycloak, Authentik, ZITADEL, Entra ID, Okta, Auth0,
Google Workspace.

To see the whole thing working before wiring up your own,
`docker compose -f e2e/compose.yml up --build` runs Mica against a
pre-configured Keycloak — see [e2e/README.md](../e2e/README.md).

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
other and is required.

### Authentication is not authorization

A provider vouching for someone does **not** let them in. Access is a
*membership* on a site, and an authenticated person with no membership is
turned away with a message telling them to ask an administrator.

That leaves a chicken-and-egg problem on a fresh deployment: no members means
nobody can invite anyone. Break it either way:

```env
OIDC_BOOTSTRAP_ADMIN=you@example.com   # becomes an admin on first sign-in
```

```bash
docker compose exec cms node dist/server/scripts/grant-access.js \
  --email you@example.com --role admin
```

After that, administrators add people from the **People** screen. There is
nothing to send them: they sign in with that address and they are in.

### Removing access

Removing a membership ends every session for that person immediately, on every
device. Authorization is re-read on each request rather than copied into the
session, so a removal does not wait for a cookie to expire.

It does not touch their account at the provider — that is the provider's to
disable, and doing both is the point of keeping them separate.

---

## 3. Configure and start

```bash
cp apps/cms/.env.example .env
# fill in: SESSION_SECRET, CMS_BASE_URL, and the REPOSITORY_* block above
pnpm build:schema                 # mica.config.ts -> mica.config.json
docker compose up -d
docker compose exec cms node dist/server/scripts/grant-access.js --email you@example.com
```

`SESSION_SECRET` is mandatory in production and signs the session cookie.
Generate it with:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Mica refuses to start if `REPOSITORY` names a provider without a project and a
token. That is deliberate: a CMS that starts, shows an editor their content and
only fails when they press Save has already cost them their work.

### The reverse proxy

The container binds to loopback. Terminate TLS in front of it and set:

```env
CMS_BASE_URL=https://cms.example.com
TRUST_PROXY=true
```

`TRUST_PROXY` makes Mica read the client address from `X-Forwarded-For`. Enable
it **only** behind a proxy you control — otherwise clients can spoof their
address and walk past the login rate limit.

`CMS_BASE_URL` starting with `https://` is what turns on `Secure` cookies.

---

## 4. Build the website

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
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with: { node-version: 22, cache: pnpm }

      - run: pnpm install --frozen-lockfile
      - run: pnpm build:packages
      - run: pnpm --filter @micacms/web build

      # …then upload apps/web/dist wherever you like.
```

An editor pressing Save produces a commit on `main`, which triggers this. There
is nothing to wire up on Mica's side.

If your host builds from the repository itself — Vercel, Netlify, Cloudflare
Pages — you do not need the workflow at all. Point the host at the repository
and it will rebuild on every editorial commit, because an editorial commit is
just a commit.

### Keeping editorial commits out of your other CI

Editors commit far more often than developers. If you have expensive jobs on
`main`, filter them by path:

```yaml
on:
  push:
    branches: [main]
    paths-ignore: ["content/**"]
```

…and give the site build the opposite filter, or no filter at all.

### Editing on a branch

`REPOSITORY_BRANCH` can be any branch. Point a second Mica at
`REPOSITORY_BRANCH=staging` and editors have a staging site, reviewed and merged
like any other change — which is how Mica does staging, and why it has no
draft/published states.

---

## 5. Changing the content model

```bash
pnpm build:schema
docker compose restart cms
```

The image holds no model — only the field types that interpret one — so it never
needs rebuilding for a content change. Deploy the matching website build at the
same time: adding a required field to a collection makes existing entries
invalid until they are edited, and the website build is where you find out.

---

## Health

`GET /health` checks both halves:

```json
{ "status": "ok", "database": "ok", "repository": "github:acme/website/content@main" }
```

It does not check the identity provider. A provider that is briefly unreachable
should stop new sign-ins, not take a container out of rotation and sign out
everybody already working.

It returns 503 if the database is unreadable or the repository is unreachable. A
container that is listening but cannot reach its repository cannot save
anything, so it should not be sent traffic.

---

## Troubleshooting

| Symptom | Likely cause | Fix |
| --- | --- | --- |
| Container exits at startup with `ConfigError` | `REPOSITORY` names a provider without `REPOSITORY_PROJECT` / `REPOSITORY_TOKEN` | Set both |
| Health check 503, `repository: unavailable` | Token expired, revoked, or wrong scope | Reissue with contents write / `write_repository` |
| Saving returns 409 | Someone else changed that entry, or a push landed mid-save | Reload; the editor's work is still in the form |
| Saving returns 422 | The entry does not satisfy the model | The response names the fields |
| Admin loads but has no collections | `MICA_SCHEMA` not mounted, or `pnpm build:schema` not run | Mount `mica.config.json` and restart |
| Editors signed out after a restart | `SESSION_SECRET` unset, so an ephemeral one was generated | Set it |
| "no access to this site" after signing in | Authenticated, but no membership | Add them on the People screen, or run `grant-access` |
| Sign-in returns to the login page with "expired" | The transaction cookie was lost — usually a `CMS_BASE_URL` that does not match the browser's address | Make them identical |
| 503 with "identity provider could not be reached" | `OIDC_ISSUER` wrong, or discovery blocked | Check `<issuer>/.well-known/openid-configuration` from the container |
| Container refuses to start: "disables authentication" | `MICA_MODE=local` in production, or on a non-local host | Set `MICA_MODE=self-hosted` and configure OIDC |
| Site build succeeds but content is stale | The host built an older commit | Check the CI ran on the editorial commit |

---

## What is not here

**No content API.** The website reads files. There is nothing to secure, rate
limit, cache or keep available at build time.

**No build webhook.** A push is the trigger.

**No media server.** Images are files in the repository, processed by Astro at
build time and served by your static host with the rest of the site.

**No passwords.** No hashing, no reset emails, no "forgot password" flow, no
MFA enrolment, no passkey registration, and no breach notification to write.
An identity provider does all of it better.

None of these is a gap waiting to be filled. Content in Git makes each of them
unnecessary rather than merely absent, which is the difference between a
simplification and a missing feature.
