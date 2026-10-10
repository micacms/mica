# End-to-end test rig

A complete Mica on your machine: the CMS from its image, a real Keycloak, and
the [GitHub API stub](../github-stub/README.md) seeded with the example
project's content.

This exercises the parts unit tests cannot — a real OpenID Connect round trip,
and the container as it would actually be deployed.

```bash
docker compose -f tests/e2e/compose.yml up --build
```

Then open <http://localhost:6422/admin/>.

It is the *fast* rig: the repository is a stub in memory, so it starts in under
a minute. [`tests/oidc/`](../oidc/README.md) is the automated version with Dex. For the deployed shape — Mica against ZITADEL and a
real repository on github.com or gitlab.com — see [deploy/demo-identity/](../../deploy/demo-identity/README.md).

> Deliberately insecure and deliberately local: plain HTTP, a committed client
> secret, one-word passwords. It is a test rig, not an example deployment.

---

## The three accounts

| Sign in as | Password  | What happens                                              |
| ---------- | --------- | --------------------------------------------------------- |
| `alice`    | `alice`   | In the `mica-editors` group, and therefore an editor      |
| `bob`      | `bob`     | In the same group, and therefore exactly the same         |
| `mallory`  | `mallory` | Authenticates perfectly, and is refused                   |

**Mallory is the point.** Keycloak vouches for her; Mica turns her away because
she is in no group it was told to admit. Authentication and admission are
separate questions, and this is where you can watch that be true.

**Where the answer lives is the other point.** Alice and bob may edit because
of a group in Keycloak — `MICA_ADMIT_GROUP=mica-editors` in
[`compose.yml`](compose.yml) — not because of a row in Mica. There is no user
table, no invitation and no People screen: adding an editor is a group change
in the identity provider, and Mica is not touched.

Alice and bob are also indistinguishable, on purpose. Everybody admitted is an
editor of this site; Mica has no roles, because it has no accounts to hang them
on.

---

## A walkthrough worth doing once

1. **Sign in as alice.** You are redirected to Keycloak, sign in there, and
   come back with a session. Mica never saw a password.

2. **Look for a People screen.** There is not one. Who may edit is
   `MICA_ADMIT_GROUP`, and the System page says so under _Who may edit_.

3. **Sign out, sign in as bob.** He gets in without anybody inviting him,
   because Keycloak already puts him in the group.

4. **Edit the site settings, save, and publish.** Save is a draft: the
   repository does not move until Publish. Then read what arrived:

   ```bash
   curl -s -H 'authorization: Bearer x' -H 'accept: application/vnd.github.raw' \
     'http://localhost:8787/repos/acme/site/contents/content/site/index.json?ref=main'
   ```

   One commit, by the editor who pressed Publish. The stub keeps it in memory,
   so a restart starts from the example content again.

5. **Try mallory.** Read the message. Then open the Keycloak console at
   <http://localhost:8080> (`admin` / `admin`), put her in `mica-editors`, and
   sign in again. Nothing in Mica changed.

6. **Take alice out of the group while she is signed in.** She keeps working
   until her session ends, because Mica checks the claims her provider sent at
   sign-in and cannot know they have changed. That is the accepted cost of
   having no user table, and it is why sessions last hours rather than weeks —
   see the P1 entry in [`decisions.md`](../../docs/decisions.md).

7. **Take her out of `MICA_ADMIT_GROUP` instead** and restart the container.
   Her next request is refused at once: the rules are re-read on every request,
   so a configuration change is immediate even though a provider change is not.

---

## Driving it from a shell

The flow is a browser redirect, but curl can follow it. `/tmp/e2e-signin.sh` in
the transcript below is the shape:

```bash
# 1. Mica starts the flow.
AUTH=$(curl -s -o /dev/null -c jar -w '%{redirect_url}' \
  http://localhost:6422/api/auth/login)

# 2. Keycloak's login page — scrape the form action.
FORM=$(curl -s -b jar -c jar "$AUTH" \
  | grep -o 'action="[^"]*"' | head -1 | sed 's/action="//; s/"$//; s/&amp;/\&/g')

# 3. Submit credentials; Keycloak redirects to Mica's callback.
CB=$(curl -s -o /dev/null -b jar -c jar -w '%{redirect_url}' \
  --data-urlencode "username=alice" --data-urlencode "password=alice" -X POST "$FORM")

# 4. The callback exchanges the code and sets the session.
curl -s -o /dev/null -b jar -c jar -w '%{redirect_url}\n' "$CB"

# 5. Who are we? The identity the provider stated, and no account behind it.
curl -s -b jar http://localhost:6422/api/auth/me
```

---

## Two things about the setup

**Why the CMS shares Keycloak's network namespace.** Mica and your browser must
reach the issuer at the _same_ URL, or the `iss` claim in the ID token will not
match what discovery returned and the token is rejected. `network_mode:
service:keycloak` makes `localhost:8080` mean the same thing in both places.
It is also why both ports are published on the `keycloak` service.

**Why `NODE_ENV=development`.** Mica refuses plain-HTTP OIDC discovery when
`NODE_ENV=production` — correctly, since an ID token over http is one anybody
on the path can read. Giving Keycloak a certificate is more machinery than a
local rig deserves, so the rig relaxes that one flag. What is under test is
the self-hosted composition: a real provider, a real redirect, and a real
admission check against a real group claim.

---

## Cleaning up

```bash
docker compose -f tests/e2e/compose.yml down -v      # -v also drops the volumes
```
