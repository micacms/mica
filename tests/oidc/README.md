# Automated OIDC test

The real Mica image against a real [Dex](https://dexidp.io), publishing to a
real Git host, [Forgejo](https://forgejo.org), driven by a Node script with no
dependencies. CI runs it on every pull request that can change the image, in
[`image.yml`](../../.github/workflows/image.yml).

It proves what unit tests cannot: a real OpenID Connect round trip — discovery,
PKCE, `state`, `nonce`, the ID token — and a clone, a save and a publication
over Git, with the container as it is deployed.

## What it checks

| Who                      | Rule                 | Expected               |
| ------------------------ | -------------------- | ---------------------- |
| `alice@gmail.com`        | `MICA_ADMIT_EMAILS`  | Admitted               |
| `bob@harborlane.example` | `MICA_ADMIT_DOMAINS` | Admitted               |
| `carol@pinecrest.example` | `MICA_ADMIT_GROUPS` (`mica-editors`) | Admitted |
| `dave@pinecrest.example` | none (group `everyone`) | Authenticated, refused |
| `mallory@gmail.com`      | none                 | Authenticated, refused |

And, for an admitted session:

- no admin API without a session, and no write without the CSRF token;
- a save is a draft: the repository does not move;
- Publish makes one commit on top of the old head, by the editor who pressed it,
  committed by Mica;
- an altered session cookie is refused;
- sign-out clears both cookies;
- Git LFS: the seed gives `*.png` under the content root to LFS, and Forgejo
  serves LFS. An uploaded PNG is published as a pointer, with the image in
  Forgejo's LFS store. A PNG that Forgejo adds reaches Mica with a sync.

All five users have the password `password`. Dex reports every address as
verified, as Google does. Mica asks for the `groups` scope, because Dex sends
the groups claim only then.

## Run it

```bash
docker compose -f tests/oidc/compose.yml up -d --build --wait
node --test tests/oidc/flow.test.mjs
docker compose -f tests/oidc/compose.yml down -v
```

The ports are 5556 (Dex), 6422 (Mica) and 3000 (Forgejo). When port 3000 is in use, set `FORGEJO_PORT=3001` for `docker compose` and for the tests. A one-shot
`forgejo-seed` service creates the user `editor` and the repository
`editor/site` from the example content. Mica uses the account password where a
token would go, which Forgejo accepts. Run `down -v` to start again from the
example content.

The login rate limit of this stack is 50 attempts in 15 minutes. One run uses
11, and the browser test uses 8. After a few runs, restart the `mica` service.

## What it does not check

- **Other shapes of the groups claim.** Dex sends bare group names. A Keycloak
  path (`/mica-editors`) and the claim of Entra are covered by unit tests and by
  the manual Keycloak rig in [`tests/e2e/`](../e2e/README.md).
- **GitHub and GitLab.** Forgejo is a real Git host, but the hosts that Mica
  supports are checked by the weekly live workflow, not here.
- **The editor UI.** No browser is involved here.
  [`tests/browser/`](../browser/README.md) drives the editor on this stack.

> Deliberately insecure: plain HTTP, a committed client secret, one password
> for everybody. A test rig, not an example deployment.
