# 5. Configuration: `MICA_` names, no development mode, secrets from files

**Status:** Accepted

## Context

A name without a prefix, such as `SESSION_SECRET`, collides with other software. A mode such as `NODE_ENV` changes security in ways that the operator cannot see, and a generated secret signs everybody out at each restart.

## Decision

- Each Mica environment variable starts with `MICA_`. `PORT` and `HOST` keep their common names. The names are frozen for 1.x. The reference is the configuration page on mica.build, and a test keeps it complete.
- The local editor reads no `.env` file, because the site's `.env` gave it the site's `NODE_ENV` and secrets. It reads the process environment, and its flags win. `MICA_ADMIN_ORIGINS` and `MICA_ADMIN_DIR` are for the local editor only.
- `NODE_ENV` is not configuration. Plain HTTP is allowed only for an address on the same computer (`localhost`, `127.0.0.1`, `[::1]`): the public URL, the OIDC issuer and the repository URL. A write without an `Origin` header is allowed only when the public URL is on the same computer.
- The image always needs `MICA_PUBLIC_URL`, an origin without a path, and `MICA_SESSION_SECRET`.
- `MICA_SESSION_SECRET_FILE`, `MICA_OIDC_CLIENT_SECRET_FILE` and `MICA_REPOSITORY_TOKEN_FILE` read a secret from a file. Mica reads the token file for each Git call, so a new token in the file needs no restart.
- A duration names its unit, such as `MICA_SIGNIN_WINDOW_MINUTES`.

## Consequences

- A trial on one computer also sets a session secret.
- A test setup reaches its provider and its Git host on `localhost`.
- The image sets `NODE_ENV=production` for the libraries that it uses.
- Change this decision when: a test setup cannot use `localhost`. Then add one setting for that rule, not a mode.
