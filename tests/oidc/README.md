# Automated OIDC test

The real Mica image against a real [Dex](https://dexidp.io), driven by a Node
script with no dependencies. CI runs it on every pull request, in the `docker`
job of [`ci.yml`](../../.github/workflows/ci.yml).

It proves what unit tests cannot: a real OpenID Connect round trip — discovery,
PKCE, `state`, `nonce`, the ID token — through the container as it is deployed.

## What it checks

| Who                             | Rule                | Expected                 |
| ------------------------------- | ------------------- | ------------------------ |
| `alice@gmail.com`               | `MICA_ADMIT_EMAILS` | Admitted                 |
| `bob@muster-consulting.example` | `MICA_ADMIT_DOMAIN` | Admitted                 |
| `mallory@gmail.com`             | none                | Authenticated, refused   |

And, for an admitted session: no admin API without a session, no write
without the CSRF token, an edit that reaches the content directory, an altered
session cookie refused, and sign-out clearing both cookies.

All three users have the password `password`. Dex reports every address as
verified, as Google does.

## Run it

```bash
cp -R examples/muster-consulting/content "$TMPDIR/mica-content"
chmod -R a+rwX "$TMPDIR/mica-content"
export MICA_CONTENT_DIR="$TMPDIR/mica-content"

docker compose -f tests/oidc/compose.yml up -d --build --wait
node --test tests/oidc/flow.test.mjs
docker compose -f tests/oidc/compose.yml down
```

The login rate limit is 10 attempts in 15 minutes. One run uses 7, so restart
the `mica` service before you run the test again.

## What it does not check

- **Groups.** Dex's built-in users carry no groups claim. The group rule and the
  claim shapes of Keycloak and Entra are covered by unit tests and by the manual
  Keycloak rig in [`tests/e2e/`](../e2e/README.md).
- **Publish.** The content is a plain directory with `REPOSITORY=local`, and the
  image has no `git`, so there is no commit to make. Publishing through a
  provider repository is covered by the connector tests against a stub.
- **The editor UI.** No browser is involved.

> Deliberately insecure: plain HTTP, a committed client secret, one password
> for everybody. A test rig, not an example deployment.
