# Deployment

Two independent things get deployed, and that separation is the point:

| | What it is | Where it runs |
| --- | --- | --- |
| **CMS** | Node process, SQLite file, media directory | one small server you control |
| **Website** | static HTML, CSS, JS, images | any static host |

The website never talks to the CMS. The CMS never knows where the website is
hosted. They meet once, during a build.

```
Editor ──▶ CMS ──── webhook ────▶ CI ──── astro build ────▶ static host
            │                              │
         SQLite                     reads /api/manifest
          media                     over CMS_READ_TOKEN
```

---

## 1. The CMS

### Requirements

A machine with Docker and about 1 GB of RAM. There is no database server, no
cache and no object storage to provision.

### Install

```bash
git clone <your-repo> && cd mica
cp .env.example .env
```

Fill in `.env`. Two values are mandatory:

```bash
# Generate each separately — do not reuse one for both.
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

- `CMS_BASE_URL` — the exact public origin, including `https://`. Cookies, the
  CSRF Origin check and the media URLs in the content API all derive from it.
- `SESSION_SECRET` — signs session cookies. Changing it signs everyone out.
- `CMS_READ_TOKEN` — the build's password to the content API.

### Give it a content model

The image contains no content model. It knows the field types and is handed a
schema at startup, which is what lets one published image serve any project:

```bash
pnpm build:schema     # mica.config.ts -> mica.config.json
```

`docker-compose.yml` mounts that file read-only at `/app/schema.json`, where
`MICA_SCHEMA` already points. Without it the container refuses to start and says
so. Editing the model later is `pnpm build:schema` followed by
`docker compose restart cms` — no image rebuild, because nothing about the model
is baked in.

Then:

```bash
docker compose up -d
docker compose exec cms node dist/server/scripts/create-user.js
```

The first account created is always an administrator. Sign in at
`https://cms.example.com/admin/`.

### Put TLS in front of it

The container binds to `127.0.0.1:4000` and speaks plain HTTP. Terminate TLS in
a reverse proxy — the CMS sets `Secure` cookies as soon as `CMS_BASE_URL` starts
with `https://`, so without TLS in front nobody can sign in.

```nginx
server {
    listen 443 ssl http2;
    server_name cms.example.com;

    ssl_certificate     /etc/letsencrypt/live/cms.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/cms.example.com/privkey.pem;

    # Uploads are capped at MAX_UPLOAD_BYTES (25 MB by default); nginx must not
    # reject them first with its own 1 MB default.
    client_max_body_size 32m;

    location / {
        proxy_pass http://127.0.0.1:4000;
        proxy_set_header Host              $host;
        proxy_set_header X-Real-IP         $remote_addr;
        proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

Set `TRUST_PROXY=true` **only** once a proxy like this is in place. Without one,
a client can forge `X-Forwarded-For` and walk around the login rate limit.

### Caddy

```
cms.example.com {
    reverse_proxy 127.0.0.1:4000
    request_body {
        max_size 32MB
    }
}
```

### Verify

```bash
curl -fsS https://cms.example.com/health
# {"status":"ok","uptimeSeconds":12,"database":"ok","publisher":"configured"}
```

`/health` reads from SQLite, so a green response means the database is genuinely
readable — not merely that the process is up.

---

## 2. The website

### Configure the build

CI needs two values:

```
CMS_URL=https://cms.example.com
CMS_READ_TOKEN=<the same token the CMS was started with>
SITE_URL=https://www.example.com
```

`CMS_READ_TOKEN` is read-only: it cannot create, edit or delete anything. It is
still a secret — it exposes unpublished drafts.

### Build

```bash
pnpm install --frozen-lockfile
pnpm --filter "./packages/**" build
pnpm --filter @micacms/web build
# → apps/web/dist  — upload this directory
```

During the build Astro fetches `/api/manifest` once, then downloads every
referenced image and re-encodes it into `dist/_astro/`. Nothing in the output
points back at the CMS, which you can check yourself:

```bash
grep -r "cms.example.com" apps/web/dist && echo "LEAK" || echo "self-contained"
```

### Host it

`apps/web/dist` is plain files. No adapter, no serverless runtime, no Node on
the web host. It works on Vercel, Netlify, Cloudflare Pages, GitHub Pages,
GitLab Pages, S3 + CloudFront, nginx, Apache, or a USB stick.

Two settings worth getting right wherever you host:

- **404 page** — serve `404.html` for unmatched paths.
- **Caching** — `/_astro/*` is content-hashed and immutable; cache it for a
  year. HTML should revalidate.

nginx:

```nginx
location /_astro/ {
    add_header Cache-Control "public, max-age=31536000, immutable";
}
location / {
    try_files $uri $uri/index.html /404.html;
    add_header Cache-Control "public, max-age=0, must-revalidate";
}
```

---

## 3. Connecting publish to build

Point `BUILD_WEBHOOK_URL` at whatever triggers your build, and set
`BUILD_WEBHOOK_SECRET`. Publishing then rebuilds the site automatically; a burst
of edits is coalesced into one build (`PUBLISH_DEBOUNCE_MS`).

The request is:

```
POST <BUILD_WEBHOOK_URL>
Content-Type:      application/json
X-Mica-Timestamp:  1754899200
X-Mica-Signature:  v1=<hex hmac-sha256 of "<timestamp>.<body>">

{"source":"mica-cms","deliveredAt":"…","events":[{"type":"entry.published",…}]}
```

### GitHub Actions

`BUILD_WEBHOOK_URL` = `https://api.github.com/repos/<owner>/<repo>/dispatches`
does not work directly — GitHub needs its own auth header. Use a tiny relay, or
the simpler route: point the webhook at a workflow-dispatch proxy you control.

For most customers the least-moving-parts option is a provider deploy hook:

- **Netlify** — Site settings → Build & deploy → Build hooks → copy the URL
- **Vercel** — Settings → Git → Deploy Hooks
- **Cloudflare Pages** — Settings → Builds → Deploy hooks

Paste that URL into `BUILD_WEBHOOK_URL`. Those providers ignore the signature
headers, which is why `BUILD_WEBHOOK_SECRET` matters most when you run your own
receiver — see `docs/webhook-receiver.md`.

A scheduled rebuild in `.github/workflows/build-site.yml` is included as a
worked example.

---

## 4. Upgrading

```bash
git pull
docker compose build cms
docker compose up -d cms
```

Migrations run automatically at startup and are recorded in `_migrations`.
They are append-only and numbered, so the sequence is identical on every
deployment.

**Take a backup first.** Rolling *back* to an older image after a migration has
run is refused — the CMS would rather stop than operate against a schema it does
not recognise. Restoring a backup is the supported way back.

---

## 5. If something goes wrong

| Symptom | Cause | Fix |
| --- | --- | --- |
| Sign-in says "Invalid or missing CSRF token" | `CMS_BASE_URL` does not match the address in the browser | correct it, restart |
| Sign-in appears to work but bounces back | `Secure` cookie over plain HTTP | put TLS in front, or use `http://` in `CMS_BASE_URL` for local testing |
| Site build fails with 401 | `CMS_READ_TOKEN` differs between CMS and CI | make them identical |
| Site build fails "Could not load content" | CMS unreachable from the runner | check firewall and `CMS_URL` |
| Uploads fail around 1 MB | reverse proxy body limit | raise `client_max_body_size` |
| Published content does not appear on the site | no build webhook configured | set `BUILD_WEBHOOK_URL`, or press "Rebuild website" |
| Rate-limited out of your own CMS | login attempts exhausted | wait for `LOGIN_WINDOW_MS`, or `docker compose restart cms` |

Logs are JSON lines in production:

```bash
docker compose logs -f cms
docker compose logs cms | grep '"level":"error"'
```

Every request carries an `x-request-id`, and a 500 response returns the same id —
so a user-reported error can be found exactly.
