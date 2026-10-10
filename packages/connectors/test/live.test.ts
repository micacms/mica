/**
 * The GitHub and GitLab connectors against a real repository.
 *
 * provider.test.ts asserts the requests; this asserts that the providers agree.
 * Each provider is skipped unless its token is set, so `rush test` stays
 * offline. The live-connectors workflow sets them — see docs/decisions.md.
 *
 *   MICA_LIVE_GITHUB_TOKEN, MICA_LIVE_GITHUB_REPO     (owner/repo)
 *   MICA_LIVE_GITLAB_TOKEN, MICA_LIVE_GITLAB_PROJECT  (group/project)
 *
 * The scratch repository holds the seed files below on `main`. Every run works
 * on its own temporary branch and deletes it afterwards.
 */

import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import { ConflictError, githubConnector, gitlabConnector, type RepositoryConnector } from "../dist/index.js";

const PIXEL = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);
const AUTHOR = { name: "Mica live test", email: "live-test@micacms.invalid" };

/** What the test needs from a provider beyond the connector: branches and commits. */
interface Provider {
  createBranch(name: string): Promise<string>;
  deleteBranch(name: string): Promise<void>;
  commit(sha: string): Promise<{ message: string; parents: string[]; authorEmail: string }>;
  connector(branch: string): RepositoryConnector;
}

async function api(url: string, token: string, init: RequestInit = {}): Promise<any> {
  const response = await fetch(url, {
    ...init,
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json", ...init.headers },
  });
  assert.ok(response.ok, `${init.method ?? "GET"} ${url} answered ${response.status}: ${await response.clone().text()}`);
  return response.status === 204 ? null : response.json();
}

function github(token: string, repo: string): Provider {
  const base = `https://api.github.com/repos/${repo}`;
  const [owner = "", name = ""] = repo.split("/");
  return {
    async createBranch(branch) {
      const main = await api(`${base}/git/ref/heads/main`, token);
      await api(`${base}/git/refs`, token, {
        method: "POST",
        body: JSON.stringify({ ref: `refs/heads/${branch}`, sha: main.object.sha }),
      });
      return main.object.sha;
    },
    async deleteBranch(branch) {
      await api(`${base}/git/refs/heads/${branch}`, token, { method: "DELETE" });
    },
    async commit(sha) {
      const commit = await api(`${base}/git/commits/${sha}`, token);
      return {
        message: commit.message,
        parents: commit.parents.map((parent: { sha: string }) => parent.sha),
        authorEmail: commit.author.email,
      };
    },
    connector: (branch) => githubConnector({ owner, repo: name, branch, token, root: "content" }),
  };
}

function gitlab(token: string, project: string): Provider {
  const base = `https://gitlab.com/api/v4/projects/${encodeURIComponent(project)}/repository`;
  return {
    async createBranch(branch) {
      const created = await api(`${base}/branches?branch=${branch}&ref=main`, token, { method: "POST" });
      return created.commit.id;
    },
    async deleteBranch(branch) {
      await api(`${base}/branches/${branch}`, token, { method: "DELETE" });
    },
    async commit(sha) {
      const commit = await api(`${base}/commits/${sha}`, token);
      return { message: commit.message.trim(), parents: commit.parent_ids, authorEmail: commit.author_email };
    },
    connector: (branch) => gitlabConnector({ project, branch, token, root: "content" }),
  };
}

function contract(name: string, provider: Provider | null): void {
  describe(`${name}, live`, { skip: provider ? false : `MICA_LIVE_${name.toUpperCase()}_* is not set` }, () => {
    if (!provider) return;

    const branch = `mica-live-${Date.now()}`;
    let seed = "";
    let connector: RepositoryConnector;

    before(async () => {
      seed = await provider.createBranch(branch);
      connector = provider.connector(branch);
    });

    after(async () => {
      if (seed) await provider.deleteBranch(branch);
    });

    it("reads the seed content", async () => {
      assert.equal(await connector.head(), seed);
      assert.equal(JSON.parse((await connector.read("site/index.json")) ?? "null").tagline, "Seed tagline");
      assert.deepEqual(Buffer.from((await connector.readBinary("media/pixel.png")) ?? []), PIXEL);
      assert.equal(await connector.read("site/missing.json"), null);
      assert.deepEqual(await connector.list("news"), [{ name: "hello", type: "directory" }]);
      assert.notEqual(await connector.revision("site/index.json"), null);
      assert.equal(await connector.revision("site/missing.json"), null);
    });

    it("publishes writes, a binary and a deleted tree as one commit", async () => {
      const revision = await connector.revision("site/index.json");
      const message = `Live test on ${branch}`;

      const result = await connector.commit({
        message,
        author: AUTHOR,
        expect: { "site/index.json": revision, "news/live/index.json": null },
        changes: [
          { type: "write", path: "site/index.json", contents: '{\n  "tagline": "Live tagline"\n}\n' },
          { type: "write", path: "news/live/index.json", contents: '{\n  "title": "Live"\n}\n' },
          { type: "write", path: "media/live.png", contents: new Uint8Array(PIXEL) },
          { type: "deleteTree", path: "news/hello" },
        ],
      });

      assert.equal(await connector.head(), result.revision);
      const commit = await provider.commit(result.revision);
      assert.equal(commit.message, message);
      assert.deepEqual(commit.parents, [seed]);
      assert.equal(commit.authorEmail, AUTHOR.email);

      assert.equal(JSON.parse((await connector.read("site/index.json")) ?? "null").tagline, "Live tagline");
      assert.deepEqual(Buffer.from((await connector.readBinary("media/live.png")) ?? []), PIXEL);
      assert.deepEqual(await connector.list("news"), [{ name: "live", type: "directory" }]);
    });

    it("refuses a commit based on a stale revision", async () => {
      const head = await connector.head();
      const stale = connector.commit({
        message: "Must not land",
        expect: { "news/live/index.json": null },
        changes: [{ type: "write", path: "news/live/index.json", contents: "{}\n" }],
      });

      await assert.rejects(stale, ConflictError);
      assert.equal(await connector.head(), head);
    });
  });
}

const env = process.env;
contract(
  "GitHub",
  env["MICA_LIVE_GITHUB_TOKEN"] && env["MICA_LIVE_GITHUB_REPO"]
    ? github(env["MICA_LIVE_GITHUB_TOKEN"], env["MICA_LIVE_GITHUB_REPO"])
    : null,
);
contract(
  "GitLab",
  env["MICA_LIVE_GITLAB_TOKEN"] && env["MICA_LIVE_GITLAB_PROJECT"]
    ? gitlab(env["MICA_LIVE_GITLAB_TOKEN"], env["MICA_LIVE_GITLAB_PROJECT"])
    : null,
);
