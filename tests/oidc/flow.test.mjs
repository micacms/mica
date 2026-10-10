/**
 * The OIDC round trip against the real image and a real Dex — see README.md.
 *
 * No browser and no dependencies: `fetch` follows the redirects by hand,
 * carries the cookies, and posts Dex's login form the way a browser would.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

const MICA = "http://localhost:6422";
const CONTENT_DIR = process.env.MICA_CONTENT_DIR;

/** One person's browser: a cookie jar and a redirect loop. */
class Browser {
  cookies = new Map();

  cookieHeader() {
    return [...this.cookies].map(([name, value]) => `${name}=${value}`).join("; ");
  }

  remember(response) {
    for (const line of response.headers.getSetCookie()) {
      const [pair, ...attributes] = line.split(";");
      const separator = pair.indexOf("=");
      const name = pair.slice(0, separator).trim();
      const value = pair.slice(separator + 1).trim();
      const cleared = attributes.some((attribute) => /^\s*max-age=0\s*$/i.test(attribute));
      if (cleared || value === "") this.cookies.delete(name);
      else this.cookies.set(name, value);
    }
  }

  async fetch(url, init = {}) {
    const headers = new Headers(init.headers);
    if (this.cookies.size > 0) headers.set("cookie", this.cookieHeader());
    const response = await fetch(url, { ...init, headers, redirect: "manual" });
    this.remember(response);
    return response;
  }

  /** Follows redirects until a page or an off-site stop; returns the last response and URL. */
  async follow(url, init = {}) {
    let current = new URL(url);
    let response = await this.fetch(current, init);
    for (let hops = 0; response.status >= 300 && response.status < 400; hops++) {
      assert.ok(hops < 20, "too many redirects");
      current = new URL(response.headers.get("location"), current);
      response = await this.fetch(current);
    }
    return { response, url: current };
  }

  /** Mica's sign-in: Mica → Dex → login form → Dex → Mica's callback. */
  async signIn(email) {
    const start = await this.fetch(`${MICA}/api/auth/login?returnTo=/admin/`);
    assert.equal(start.status, 302, `sign-in did not start: ${start.status} ${await start.text()}`);
    let { response, url } = await this.follow(new URL(start.headers.get("location"), MICA));

    if (url.origin !== MICA) {
      const html = await response.text();
      const action = html.match(/<form[^>]*action="([^"]+)"/i)?.[1];
      assert.ok(action, `no login form at ${url}`);

      ({ response, url } = await this.follow(new URL(action.replaceAll("&amp;", "&"), url), {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ login: email, password: "password" }),
      }));
    }

    assert.equal(url.origin, MICA, `sign-in ended at ${url}`);
    return url;
  }

  /** An admin API call the way the SPA makes it: Origin plus the CSRF header. */
  api(path, { method = "GET", body, csrf = true } = {}) {
    const headers = { origin: MICA };
    if (body !== undefined) headers["content-type"] = "application/json";
    if (csrf && this.cookies.has("mica_csrf")) headers["x-csrf-token"] = this.cookies.get("mica_csrf");
    return this.fetch(`${MICA}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  }
}

describe("signing in through Dex", () => {
  it("refuses the admin API without a session", async () => {
    const response = await new Browser().api("/api/admin/schema");
    assert.equal(response.status, 401);
  });

  it("admits a listed address", async () => {
    const alice = new Browser();
    const landed = await alice.signIn("alice@gmail.com");
    assert.equal(landed.pathname, "/admin/");

    const me = await alice.api("/api/auth/me");
    assert.equal(me.status, 200);
    assert.equal((await me.json()).identity.email, "alice@gmail.com");
  });

  it("admits an address in an admitted domain", async () => {
    const bob = new Browser();
    await bob.signIn("bob@muster-consulting.example");
    assert.equal((await bob.api("/api/auth/me")).status, 200);
  });

  it("refuses somebody the provider vouches for but no rule names", async () => {
    const mallory = new Browser();
    const landed = await mallory.signIn("mallory@gmail.com");

    assert.equal(landed.pathname, "/admin/login");
    assert.match(landed.searchParams.get("error") ?? "", /no access to this site/);
    assert.equal(mallory.cookies.has("mica_session"), false);
    assert.equal((await mallory.api("/api/auth/me")).status, 401);
  });
});

describe("an admitted session", () => {
  it("saves an edit to the repository, and only with the CSRF token", async () => {
    const alice = new Browser();
    await alice.signIn("alice@gmail.com");

    const current = await alice.api("/api/admin/singletons/site");
    assert.equal(current.status, 200);
    const { data, revision } = await current.json();

    const tagline = `Edited through Dex at ${new Date().toISOString()}`;
    const edit = { data: { ...data, tagline }, revision };

    const forged = await alice.api("/api/admin/singletons/site", { method: "PUT", body: edit, csrf: false });
    assert.equal(forged.status, 403);

    const saved = await alice.api("/api/admin/singletons/site", { method: "PUT", body: edit });
    assert.equal(saved.status, 200);

    if (CONTENT_DIR) {
      const onDisk = JSON.parse(readFileSync(join(CONTENT_DIR, "site", "index.json"), "utf8"));
      assert.equal(onDisk.tagline, tagline);
    }
  });

  it("rejects a session cookie that was altered", async () => {
    const alice = new Browser();
    await alice.signIn("alice@gmail.com");

    const value = alice.cookies.get("mica_session");
    alice.cookies.set("mica_session", value.slice(0, 20) + (value[20] === "A" ? "B" : "A") + value.slice(21));
    assert.equal((await alice.api("/api/auth/me")).status, 401);
  });

  it("signs out by clearing both cookies", async () => {
    const alice = new Browser();
    await alice.signIn("alice@gmail.com");

    const response = await alice.api("/api/auth/logout", { method: "POST" });
    assert.equal(response.status, 200);
    assert.equal(alice.cookies.has("mica_session"), false);
    assert.equal(alice.cookies.has("mica_csrf"), false);
    assert.equal((await alice.api("/api/auth/me")).status, 401);
  });
});
