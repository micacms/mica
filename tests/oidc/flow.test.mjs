/**
 * The OIDC round trip against the real image and a real Dex — see README.md.
 *
 * No browser and no dependencies: `fetch` follows the redirects by hand,
 * carries the cookies, and posts Dex's login form the way a browser would.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

const MICA = "http://localhost:6422";
const FORGEJO = `http://localhost:${process.env.FORGEJO_PORT ?? "3000"}/api/v1/repos/editor/site`;
const FORGEJO_AUTH = `Basic ${Buffer.from("editor:Forgejo-test-password-not-for-production").toString("base64")}`;

/** Reads the Git host directly, to see what reached the repository. */
async function forgejo(path, raw = false) {
  const response = await fetch(`${FORGEJO}/${path}`, { headers: { authorization: FORGEJO_AUTH } });
  assert.equal(response.ok, true, `Forgejo: ${path} answered ${response.status}`);
  return raw ? response.text() : response.json();
}

const headOfMain = async () => (await forgejo("branches/main")).commit.id;
const publishedSite = async () => JSON.parse(await forgejo("raw/content/general/index.json?ref=main", true));

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
    await bob.signIn("bob@harborlane.example");
    assert.equal((await bob.api("/api/auth/me")).status, 200);
  });

  it("admits a member of an admitted group, and only through the group (#140)", async () => {
    const carol = new Browser();
    const landed = await carol.signIn("carol@pinecrest.example");
    assert.equal(landed.pathname, "/admin/");
    assert.equal((await carol.api("/api/auth/me")).status, 200);
  });

  it("refuses a member of another group", async () => {
    const dave = new Browser();
    const landed = await dave.signIn("dave@pinecrest.example");
    assert.equal(landed.pathname, "/admin/login");
    assert.equal(landed.searchParams.get("error"), "not_admitted");
    assert.equal((await dave.api("/api/auth/me")).status, 401);
  });

  it("refuses somebody the provider vouches for but no rule names", async () => {
    const mallory = new Browser();
    const landed = await mallory.signIn("mallory@gmail.com");

    assert.equal(landed.pathname, "/admin/login");
    assert.equal(landed.searchParams.get("error"), "not_admitted");
    // The refusal names no address: the URL lands in history and proxy logs.
    assert.doesNotMatch(landed.href, /mallory/);
    assert.equal(mallory.cookies.has("mica_session"), false);
    assert.equal((await mallory.api("/api/auth/me")).status, 401);
  });
});

describe("an admitted session", () => {
  it("saves an edit as a draft, then publishes it as one commit", async () => {
    const alice = new Browser();
    await alice.signIn("alice@gmail.com");

    const current = await alice.api("/api/admin/singletons/general");
    assert.equal(current.status, 200);
    const { data, revision } = await current.json();

    const tagline = `Edited through Dex at ${new Date().toISOString()}`;
    const edit = { data: { ...data, tagline }, revision };

    const forged = await alice.api("/api/admin/singletons/general", { method: "PUT", body: edit, csrf: false });
    assert.equal(forged.status, 403);

    const before = await headOfMain();
    const saved = await alice.api("/api/admin/singletons/general", { method: "PUT", body: edit });
    assert.equal(saved.status, 200);

    // Saved is not published: the repository has not moved.
    assert.equal(await headOfMain(), before);
    assert.notEqual((await publishedSite()).tagline, tagline);

    // Publish sends back what the editor reviewed, as the Publish page does.
    const status = await (await alice.api("/api/admin/changes")).json();
    const paths = Object.fromEntries(status.changes.map((change) => [change.path, change.revision ?? null]));
    const message = `Publish the tagline (${tagline})`;
    const published = await alice.api("/api/admin/publish", { method: "POST", body: { message, paths } });
    assert.equal(published.status, 200, await published.clone().text());
    assert.equal((await published.json()).state, "published");

    // One commit on top of the old head, by the person who pressed Publish.
    const head = await headOfMain();
    const commit = await forgejo(`git/commits/${head}`);
    assert.equal(commit.commit.message.trim(), `${message}\n\nPublished-with: Mica`);
    assert.deepEqual(commit.parents.map((parent) => parent.sha), [before]);
    assert.equal(commit.commit.author.email, "alice@gmail.com");
    assert.equal(commit.commit.committer.name, "Mica CMS");
    assert.equal((await publishedSite()).tagline, tagline);
  });

  it("shows a change made on the website as a conflict, and publishes the version the editor keeps", async () => {
    const alice = new Browser();
    await alice.signIn("alice@gmail.com");

    const current = await (await alice.api("/api/admin/singletons/general")).json();
    const mine = `Mine, at ${new Date().toISOString()}`;
    const saved = await alice.api("/api/admin/singletons/general", {
      method: "PUT",
      body: { data: { ...current.data, tagline: mine }, revision: current.revision },
    });
    assert.equal(saved.status, 200);

    // A developer changes the same file on the website, through the Git host.
    const file = await forgejo("contents/content/general/index.json?ref=main");
    const theirs = { ...JSON.parse(Buffer.from(file.content, "base64").toString()), tagline: "Theirs" };
    const updated = await fetch(`${FORGEJO}/contents/content/general/index.json`, {
      method: "PUT",
      headers: { authorization: FORGEJO_AUTH, "content-type": "application/json" },
      body: JSON.stringify({
        branch: "main",
        sha: file.sha,
        message: "A developer edits the tagline",
        content: Buffer.from(`${JSON.stringify(theirs, null, 2)}\n`).toString("base64"),
      }),
    });
    assert.equal(updated.status, 200, await updated.text());
    const developerCommit = await headOfMain();

    const synced = await (await alice.api("/api/admin/sync", { method: "POST" })).json();
    assert.deepEqual(
      synced.sync.conflicts.map((conflict) => [conflict.group, conflict.upstream]),
      [["singleton:general", "changed"]],
    );
    assert.equal(synced.publish.enabled, false);

    const compared = await (await alice.api("/api/admin/changes/compare?kind=singleton&name=general&against=origin")).json();
    assert.equal(compared.before.tagline, "Theirs");
    assert.equal(compared.after.tagline, mine);

    const resolved = await (
      await alice.api("/api/admin/changes/resolve", { method: "POST", body: { group: "singleton:general", choice: "mine" } })
    ).json();
    assert.deepEqual(resolved.sync.conflicts, []);
    assert.equal(resolved.head, developerCommit);

    const paths = Object.fromEntries(resolved.changes.map((change) => [change.path, change.revision ?? null]));
    const published = await alice.api("/api/admin/publish", {
      method: "POST",
      body: { message: "Keep my tagline", paths },
    });
    assert.equal(published.status, 200, await published.clone().text());
    assert.equal((await publishedSite()).tagline, mine);
    const commit = await forgejo(`git/commits/${await headOfMain()}`);
    assert.deepEqual(commit.parents.map((parent) => parent.sha), [developerCommit]);
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

/** A 1×1 PNG, with a tail that makes each copy a different LFS object. */
const png = (tail) =>
  Buffer.concat([
    Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==", "base64"),
    Buffer.from(tail),
  ]);

/** The blob that the branch holds at `path`: for an LFS file, its pointer. */
async function committedBlob(path) {
  const { sha } = await forgejo(`contents/${path}?ref=main`);
  return Buffer.from((await forgejo(`git/blobs/${sha}`)).content, "base64").toString();
}

/** The file itself, from Forgejo's LFS store when the branch holds a pointer. */
async function servedFile(path) {
  const response = await fetch(`${FORGEJO}/media/${path}?ref=main`, { headers: { authorization: FORGEJO_AUTH } });
  assert.equal(response.ok, true, `Forgejo: media/${path} answered ${response.status}`);
  return Buffer.from(await response.arrayBuffer());
}

describe("Git LFS (the seed gives *.png to LFS)", () => {
  it("publishes an uploaded image as a pointer, with the image in the LFS store", async () => {
    const alice = new Browser();
    await alice.signIn("alice@gmail.com");

    const image = png(`uploaded ${Date.now()}`);
    const uploaded = await alice.fetch(`${MICA}/api/admin/media?${new URLSearchParams({ name: "lfs-upload.png", accept: "image" })}`, {
      method: "POST",
      headers: { origin: MICA, "x-csrf-token": alice.cookies.get("mica_csrf"), "content-type": "application/octet-stream" },
      body: image,
    });
    assert.equal(uploaded.status, 201, await uploaded.clone().text());
    const { path } = (await uploaded.json()).items[0];

    const status = await (await alice.api("/api/admin/changes")).json();
    const paths = Object.fromEntries(status.changes.map((change) => [change.path, change.revision ?? null]));
    const published = await alice.api("/api/admin/publish", { method: "POST", body: { message: "Add an image in LFS", paths } });
    assert.equal(published.status, 200, await published.clone().text());
    assert.equal((await published.json()).state, "published");

    assert.match(await committedBlob(`content/${path}`), /^version https:\/\/git-lfs\.github\.com\/spec\/v1\n/);
    assert.deepEqual(await servedFile(`content/${path}`), image);
  });

  it("brings an image that the website adds to LFS into Mica with a sync", async () => {
    const alice = new Browser();
    await alice.signIn("alice@gmail.com");

    // Forgejo gives a file to LFS when its .gitattributes says so, as a push with Git LFS does.
    const image = png(`upstream ${Date.now()}`);
    const created = await fetch(`${FORGEJO}/contents/content/media/lfs-upstream.png`, {
      method: "POST",
      headers: { authorization: FORGEJO_AUTH, "content-type": "application/json" },
      body: JSON.stringify({ branch: "main", message: "A developer adds an image", content: image.toString("base64") }),
    });
    assert.equal(created.status, 201, await created.text());
    assert.match(await committedBlob("content/media/lfs-upstream.png"), /^version https:\/\/git-lfs/);

    const synced = await (await alice.api("/api/admin/sync", { method: "POST" })).json();
    assert.equal(synced.sync.error, null, JSON.stringify(synced.sync.error));
    const served = await alice.api("/api/admin/media/file/media/lfs-upstream.png");
    assert.equal(served.status, 200, await served.clone().text());
    assert.deepEqual(Buffer.from(await served.arrayBuffer()), image);
  });
});
