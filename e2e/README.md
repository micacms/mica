# End-to-end test rig

A complete Mica on your machine: the CMS from its image, a real Keycloak, and
the example project's `content/` directory mounted read-write.

This exercises the parts unit tests cannot — a real OpenID Connect round trip,
and the container as it would actually be deployed.

```bash
docker compose -f e2e/compose.yml up --build
```

Then open <http://localhost:4000/admin/>.

> Deliberately insecure and deliberately local: plain HTTP, a committed client
> secret, one-word passwords. It is a test rig, not an example deployment.

---

## The three accounts

| Sign in as | Password | What happens |
| --- | --- | --- |
| `alice` | `alice` | Administrator. `OIDC_BOOTSTRAP_ADMIN` grants it on first sign-in |
| `bob` | `bob` | Nothing, until alice adds him on the **People** screen |
| `mallory` | `mallory` | Authenticates perfectly, and is refused |

**Mallory is the point.** Keycloak vouches for her; Mica turns her away because
nobody gave her a membership. Authentication and authorization are separate
questions, and this is where you can watch that be true.

---

## A walkthrough worth doing once

1. **Sign in as alice.** You are redirected to Keycloak, sign in there, and
   come back with a session. Mica never saw a password.

2. **Open People, add `bob@example.com` as an editor.** He shows as *Invited —
   not signed in yet*: the membership exists, the identity does not.

3. **Sign out, sign in as bob.** The invitation and the Keycloak identity
   resolve to the same account. The People screen is now forbidden to him —
   editors edit content, administrators manage people.

4. **Edit an entry and save.** Then, on your host:

   ```bash
   git diff examples/muster-consulting/content/
   ```

   One file, one line. That is the whole architecture in one command: the
   editor pressed Save, and what came out is a reviewable change to a file you
   own.

5. **Try mallory.** Read the message. Then add her on the People screen and try
   again.

6. **Remove someone while they are signed in.** Their next request is refused
   immediately — authorization is re-read per request, not carried in the
   session.

---

## Driving it from a shell

The flow is a browser redirect, but curl can follow it. `/tmp/e2e-signin.sh` in
the transcript below is the shape:

```bash
# 1. Mica starts the flow.
AUTH=$(curl -s -o /dev/null -c jar -w '%{redirect_url}' \
  http://localhost:4000/api/auth/login)

# 2. Keycloak's login page — scrape the form action.
FORM=$(curl -s -b jar -c jar "$AUTH" \
  | grep -o 'action="[^"]*"' | head -1 | sed 's/action="//; s/"$//; s/&amp;/\&/g')

# 3. Submit credentials; Keycloak redirects to Mica's callback.
CB=$(curl -s -o /dev/null -b jar -c jar -w '%{redirect_url}' \
  --data-urlencode "username=alice" --data-urlencode "password=alice" -X POST "$FORM")

# 4. The callback exchanges the code and sets the session.
curl -s -o /dev/null -b jar -c jar -w '%{redirect_url}\n' "$CB"

# 5. Who are we?
curl -s -b jar http://localhost:4000/api/auth/me
```

---

## Two things about the setup

**Why the CMS shares Keycloak's network namespace.** Mica and your browser must
reach the issuer at the *same* URL, or the `iss` claim in the ID token will not
match what discovery returned and the token is rejected. `network_mode:
service:keycloak` makes `localhost:8080` mean the same thing in both places.
It is also why both ports are published on the `keycloak` service.

**Why `NODE_ENV=development`.** Mica refuses plain-HTTP OIDC discovery when
`NODE_ENV=production` — correctly, since an ID token over http is one anybody
on the path can read. Giving Keycloak a certificate is more machinery than a
local rig deserves, so the rig relaxes that one flag. What is under test is
`MICA_MODE=self-hosted`: a real provider, a real redirect, a real membership
check.

---

## Cleaning up

```bash
docker compose -f e2e/compose.yml down -v      # -v also drops the CMS database
git checkout examples/                        # discard anything you edited
```
