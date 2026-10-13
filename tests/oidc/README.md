# Automated OIDC test

The real Mica image against a real [Dex](https://dexidp.io), publishing to a
real Git host, [Forgejo](https://forgejo.org), driven by a Node script with no
dependencies. CI runs it on every pull request, in the `docker` job of
[`ci.yml`](../../.github/workflows/ci.yml).

It proves what unit tests cannot: a real OpenID Connect round trip — discovery,
PKCE, `state`, `nonce`, the ID token — and a clone, a save and a publication
over Git, with the container as it is deployed.

## What it checks

| Who                      | Rule                 | Expected               |
| ------------------------ | -------------------- | ---------------------- |
| `alice@gmail.com`        | `MICA_ADMIT_EMAILS`  | Admitted               |
| `bob@harborlane.example` | `MICA_ADMIT_DOMAINS` | Admitted               |
| `mallory@gmail.com`      | none                 | Authenticated, refused |

And, for an admitted session:

- no admin API without a session, and no write without the CSRF token;
- a save is a draft: the repository does not move;
- Publish makes one commit on top of the old head, by the editor who pressed it,
  committed by Mica;
- an altered session cookie is refused;
- sign-out clears both cookies.

All three users have the password `password`. Dex reports every address as
verified, as Google does.

## Run it

```bash
docker compose -f tests/oidc/compose.yml up -d --build --wait
node --test tests/oidc/flow.test.mjs
docker compose -f tests/oidc/compose.yml down -v
```

The ports are 5556 (Dex), 6422 (Mica) and 3000 (Forgejo). A one-shot
`forgejo-seed` service creates the user `editor` and the repository
`editor/site` from the example content. Mica uses the account password where a
token would go, which Forgejo accepts. Run `down -v` to start again from the
example content.

The login rate limit is 10 attempts in 15 minutes. One run uses 7, and the
browser test uses 1, so restart the `mica` service before you run them again.

## What it does not check

- **Groups.** Dex's built-in users carry no groups claim. The group rule and the
  claim shapes of Keycloak and Entra are covered by unit tests and by the manual
  Keycloak rig in [`tests/e2e/`](../e2e/README.md).
- **GitHub and GitLab.** Forgejo is a real Git host, but the hosts that Mica
  supports are checked by the weekly live workflow, not here.
- **The editor UI.** No browser is involved here.
  [`tests/browser/`](../browser/README.md) drives the editor on this stack.

> Deliberately insecure: plain HTTP, a committed client secret, one password
> for everybody. A test rig, not an example deployment.
