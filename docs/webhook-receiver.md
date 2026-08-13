# Verifying the publish webhook

The CMS signs every delivery. If you run your own build trigger — rather than a
provider deploy hook — verify the signature before starting a build, or anyone
who learns the URL can make your CI run on demand.

## The request

```
POST <BUILD_WEBHOOK_URL>
Content-Type:     application/json
User-Agent:       mica-cms/1.0
X-Mica-Timestamp: 1754899200
X-Mica-Signature: v1=3f9a…

{
  "source": "mica-cms",
  "deliveredAt": "2026-08-11T13:04:11.000Z",
  "events": [
    { "type": "entry.published", "collection": "projects", "slug": "buchholzstrasse",
      "entryId": "01K…", "actor": { "id": "01K…", "email": "anna@example.ch" },
      "at": "2026-08-11T13:04:09.812Z" }
  ]
}
```

The signature is `HMAC-SHA256("<timestamp>.<raw body>", BUILD_WEBHOOK_SECRET)`.

Signing the timestamp together with the body — rather than the body alone — is
what makes a captured request useless later: a replay fails the freshness check
below.

## Checking it

Three things must hold. Skipping any one of them defeats the others.

1. The timestamp is recent (five minutes is a sane window).
2. The HMAC is computed over the **raw** body, before JSON parsing —
   re-serialising changes the bytes and the signature will not match.
3. The comparison is **constant-time**.

```js
import { createHmac, timingSafeEqual } from "node:crypto";
import { createServer } from "node:http";
import { execFile } from "node:child_process";

const SECRET = process.env.BUILD_WEBHOOK_SECRET;
const TOLERANCE_SECONDS = 300;

function isValid(rawBody, timestamp, signature) {
  const age = Math.abs(Date.now() - Number(timestamp) * 1000);
  if (!Number.isFinite(age) || age > TOLERANCE_SECONDS * 1000) return false;

  const expected = Buffer.from(
    `v1=${createHmac("sha256", SECRET).update(`${timestamp}.${rawBody}`).digest("hex")}`,
  );
  const received = Buffer.from(signature ?? "");

  // timingSafeEqual throws on a length mismatch, so check that first.
  if (expected.length !== received.length) return false;
  return timingSafeEqual(expected, received);
}

createServer((req, res) => {
  if (req.method !== "POST") return res.writeHead(405).end();

  const chunks = [];
  req.on("data", (chunk) => chunks.push(chunk));
  req.on("end", () => {
    const rawBody = Buffer.concat(chunks).toString("utf8");

    if (!isValid(rawBody, req.headers["x-mica-timestamp"], req.headers["x-mica-signature"])) {
      return res.writeHead(401).end("invalid signature");
    }

    // Answer immediately; a build takes minutes and the CMS retries on timeout.
    res.writeHead(202).end("accepted");

    execFile("/usr/local/bin/rebuild-site.sh", (error) => {
      if (error) console.error("build failed", error);
    });
  });
}).listen(9000, "127.0.0.1");
```

`verifySignature()` is exported from
`apps/cms/src/server/services/publisher.ts` if your receiver is JavaScript and
can import it.

## Retry behaviour

- Three attempts, with 1 s and 2 s backoff between them.
- Retried on network failure, `429`, and any `5xx`.
- Not retried on other `4xx` — those will not succeed a second time.
- Events are coalesced over `PUBLISH_DEBOUNCE_MS`, so one delivery may carry
  several events. Treat the batch as "something changed, rebuild", not as a
  work queue.

Respond quickly — `202 Accepted` before doing the work. A receiver that blocks
until the build finishes will hit the CMS's 15 s timeout and be sent the same
batch twice.

## Shell equivalent

```bash
BODY=$(cat)
EXPECTED="v1=$(printf '%s.%s' "$MICA_TIMESTAMP" "$BODY" \
  | openssl dgst -sha256 -hmac "$BUILD_WEBHOOK_SECRET" -r | cut -d' ' -f1)"

[ "$EXPECTED" = "$MICA_SIGNATURE" ] || { echo "bad signature" >&2; exit 1; }
```

Note that this comparison is not constant-time. It is fine for a script behind a
firewall, and not fine for a public endpoint.
