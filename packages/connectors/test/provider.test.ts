/**
 * The GitHub and GitLab connectors.
 *
 * Against a recording stub rather than a live repository. That is not a
 * compromise: what these connectors *are* is the shape of the requests they
 * make, and a stub is the only way to assert on that directly. Whether one
 * commit is produced instead of four, whether a delete names every file under
 * a directory, whether the ref update is forced — all of it is visible here
 * and none of it would be visible in a mock that only returned data.
 *
 * The behaviour both connectors share is stated once, in `contract`, and run
 * against each of them. Anything that differs is tested where it belongs.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  ConflictError,
  githubConnector,
  gitlabConnector,
  type FetchLike,
  type RepositoryConnector,
} from "../dist/index.js";

/* ------------------------------------------------------------------ *
 * A recording stub
 * ------------------------------------------------------------------ */

interface Call {
  method: string;
  url: string;
  body: any;
  headers: Record<string, string>;
}

interface Route {
  /** Matched against `METHOD path?query`. */
  match: RegExp;
  status?: number;
  json?: unknown;
  text?: string;
}

function stub(routes: Route[]): { fetch: FetchLike; calls: Call[] } {
  const calls: Call[] = [];

  const fetch: FetchLike = async (url, init) => {
    const method = init?.method ?? "GET";
    const path = url.replace(/^https?:\/\/[^/]+/, "");
    const key = `${method} ${path}`;

    calls.push({
      method,
      url: path,
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
      headers: (init?.headers ?? {}) as Record<string, string>,
    });

    const route = routes.find((candidate) => candidate.match.test(key));

    if (!route) {
      return new Response("no route", { status: 404, statusText: "Not Found" });
    }
    if (route.status && route.status >= 400) {
      return new Response(route.text ?? "error", {
        status: route.status,
        statusText: "Error",
      });
    }
    if (route.text !== undefined) {
      return new Response(route.text, { status: route.status ?? 200 });
    }
    return new Response(JSON.stringify(route.json ?? {}), {
      status: route.status ?? 200,
      headers: { "content-type": "application/json" },
    });
  };

  return { fetch, calls };
}

/* ------------------------------------------------------------------ *
 * The behaviour both connectors promise
 * ------------------------------------------------------------------ */

interface Fixture {
  connector: RepositoryConnector;
  calls: Call[];
}

interface Harness {
  name: string;
  /** A repository holding `content/theme.json` and `content/pages/a/index.json`. */
  make(overrides?: Route[]): Fixture;
  /** Requests that actually wrote something. */
  writes(calls: Call[]): Call[];
}

function contract(harness: Harness): void {
  describe(harness.name, () => {
    it("reads a file as text", async () => {
      const { connector } = harness.make();
      assert.equal(await connector.read("theme.json"), '{"primaryColor":"#123456"}');
    });

    it("returns null for a file that is not there", async () => {
      const { connector } = harness.make([{ match: /GET .*missing/, status: 404 }]);
      assert.equal(await connector.read("missing.json"), null);
    });

    it("lists a directory as names and kinds", async () => {
      const { connector } = harness.make();
      assert.deepEqual(await connector.list("pages"), [
        { name: "a", type: "directory" },
        { name: "index.json", type: "file" },
      ]);
    });

    it("treats a missing directory as empty rather than as a failure", async () => {
      const { connector } = harness.make([{ match: /GET .*nowhere/, status: 404 }]);
      assert.deepEqual(await connector.list("nowhere"), []);
    });

    it("writes a whole change set as one commit", async () => {
      const { connector, calls } = harness.make();

      const result = await connector.commit({
        message: "Save an entry",
        changes: [
          { type: "write", path: "pages/a/index.json", contents: '{"title":"A"}' },
          { type: "write", path: "pages/a/body.mdoc", contents: "# A\n" },
        ],
      });

      assert.ok(result.revision);
      // The property that matters: an entry and its sidecar reach the
      // repository together or not at all.
      assert.equal(harness.writes(calls).length, 1);
    });

    it("refuses when a file changed after the editor opened it", async () => {
      const { connector, calls } = harness.make();

      await assert.rejects(
        connector.commit({
          message: "Save an entry",
          changes: [{ type: "write", path: "theme.json", contents: "{}" }],
          expect: { "theme.json": "a-revision-from-yesterday" },
        }),
        (error: unknown) => {
          assert.ok(error instanceof ConflictError);
          assert.deepEqual(error.paths, ["theme.json"]);
          return true;
        },
      );

      // Nothing was sent. A conflict must not leave a partial write behind.
      assert.equal(harness.writes(calls).length, 0);
    });

    it("accepts a matching revision", async () => {
      const { connector } = harness.make();

      await connector.commit({
        message: "Save an entry",
        changes: [{ type: "write", path: "theme.json", contents: "{}" }],
        expect: { "theme.json": "blob-theme" },
      });
    });

    it("treats null as an assertion that the file is absent", async () => {
      const { connector } = harness.make();

      // Two editors creating the same slug: the second must lose.
      await assert.rejects(
        connector.commit({
          message: "Create",
          changes: [{ type: "write", path: "theme.json", contents: "{}" }],
          expect: { "theme.json": null },
        }),
        ConflictError,
      );

      // ...and a genuinely new path is fine.
      await connector.commit({
        message: "Create",
        changes: [{ type: "write", path: "pages/b/index.json", contents: "{}" }],
        expect: { "pages/b/index.json": null },
      });
    });

    it("names every file below a directory when deleting a tree", async () => {
      const { connector, calls } = harness.make();

      await connector.commit({
        message: "Delete an entry",
        changes: [{ type: "deleteTree", path: "pages/a" }],
      });

      const write = harness.writes(calls)[0]!;
      const deleted = JSON.stringify(write.body);

      assert.match(deleted, /pages\/a\/index\.json/);
      assert.match(deleted, /pages\/a\/media\/photo\.jpg/);
      // Not a neighbour that merely shares the prefix.
      assert.doesNotMatch(deleted, /pages\/index\.json/);
    });

    it("refuses an empty change set rather than making an empty commit", async () => {
      const { connector } = harness.make();
      await assert.rejects(connector.commit({ message: "Nothing", changes: [] }));
    });

    it("skips deleting a file that is already gone", async () => {
      const { connector } = harness.make();

      // The only change is a no-op, so there is nothing left to commit.
      await assert.rejects(
        connector.commit({
          message: "Delete",
          changes: [{ type: "delete", path: "pages/never-existed.json" }],
        }),
        /Nothing in this change set/,
      );
    });
  });
}

/* ------------------------------------------------------------------ *
 * GitHub
 * ------------------------------------------------------------------ */

const GITHUB_TREE = {
  sha: "tree-root",
  truncated: false,
  tree: [
    { path: "theme.json", mode: "100644", type: "blob", sha: "blob-theme" },
    { path: "pages/index.json", mode: "100644", type: "blob", sha: "blob-pages-index" },
    { path: "pages/a", mode: "040000", type: "tree", sha: "tree-a" },
    { path: "pages/a/index.json", mode: "100644", type: "blob", sha: "blob-a" },
    { path: "pages/a/media/photo.jpg", mode: "100644", type: "blob", sha: "blob-photo" },
  ],
};

const githubRoutes: Route[] = [
  { match: /GET \/repos\/acme\/site\/contents\/content\/theme\.json/, text: '{"primaryColor":"#123456"}' },
  {
    match: /GET \/repos\/acme\/site\/contents\/content\/pages\?/,
    json: [
      { name: "index.json", path: "content/pages/index.json", sha: "blob-pages-index", type: "file" },
      { name: "a", path: "content/pages/a", sha: "tree-a", type: "dir" },
    ],
  },
  { match: /GET \/repos\/acme\/site\/git\/ref\/heads\/main/, json: { object: { sha: "head-sha" } } },
  {
    match: /GET \/repos\/acme\/site\/git\/commits\/head-sha/,
    json: { sha: "head-sha", tree: { sha: "base-tree" } },
  },
  { match: /GET \/repos\/acme\/site\/git\/trees\/head-sha:content/, json: GITHUB_TREE },
  { match: /POST \/repos\/acme\/site\/git\/blobs/, json: { sha: "new-blob" } },
  { match: /POST \/repos\/acme\/site\/git\/trees/, json: { sha: "new-tree" } },
  { match: /POST \/repos\/acme\/site\/git\/commits/, json: { sha: "new-commit" } },
  { match: /PATCH \/repos\/acme\/site\/git\/refs\/heads\/main/, json: { object: { sha: "new-commit" } } },
];

contract({
  name: "githubConnector",
  make(overrides = []) {
    const { fetch, calls } = stub([...overrides, ...githubRoutes]);
    return {
      calls,
      connector: githubConnector({
        owner: "acme",
        repo: "site",
        root: "content",
        token: "t",
        fetch,
      }),
    };
  },
  // The tree write is the one that commits the change set; the blob uploads
  // before it are content-addressed and unreferenced until then.
  writes: (calls) => calls.filter((call) => /\/git\/trees$/.test(call.url)),
});

describe("githubConnector specifics", () => {
  const make = (overrides: Route[] = []) => {
    const { fetch, calls } = stub([...overrides, ...githubRoutes]);
    return {
      calls,
      connector: githubConnector({ owner: "acme", repo: "site", root: "content", token: "t", fetch }),
    };
  };

  it("puts everything under the configured content root", async () => {
    const { connector, calls } = make();
    await connector.read("theme.json");

    assert.match(calls[0]!.url, /\/contents\/content\/theme\.json/);
  });

  it("never force-updates the branch", async () => {
    const { connector, calls } = make();
    await connector.commit({
      message: "Save",
      changes: [{ type: "write", path: "theme.json", contents: "{}" }],
    });

    const update = calls.find((call) => call.method === "PATCH")!;
    assert.equal(update.body.force, false);
    assert.deepEqual(
      calls.find((call) => /\/git\/commits$/.test(call.url) && call.method === "POST")!.body.parents,
      ["head-sha"],
    );
  });

  it("reports a branch that moved mid-save as a conflict, not a fault", async () => {
    const { connector } = make([
      { match: /PATCH \/repos\/acme\/site\/git\/refs/, status: 422, text: "not a fast forward" },
    ]);

    await assert.rejects(
      connector.commit({
        message: "Save",
        changes: [{ type: "write", path: "theme.json", contents: "{}" }],
      }),
      ConflictError,
    );
  });

  it("sends binary content as base64 and text as utf-8", async () => {
    const { connector, calls } = make();
    await connector.commit({
      message: "Upload",
      changes: [
        { type: "write", path: "media/x.bin", contents: new Uint8Array([1, 2, 3]) },
        { type: "write", path: "theme.json", contents: "{}" },
      ],
    });

    const blobs = calls.filter((call) => /\/git\/blobs$/.test(call.url));
    assert.equal(blobs[0]!.body.encoding, "base64");
    assert.equal(blobs[0]!.body.content, Buffer.from([1, 2, 3]).toString("base64"));
    assert.equal(blobs[1]!.body.encoding, "utf-8");
  });

  it("refuses to guess when the tree listing was truncated", async () => {
    const { connector } = make([
      {
        match: /GET \/repos\/acme\/site\/git\/trees\/head-sha:content/,
        json: { ...GITHUB_TREE, truncated: true },
      },
    ]);

    await assert.rejects(
      connector.commit({
        message: "Save",
        changes: [{ type: "write", path: "theme.json", contents: "{}" }],
      }),
      /too large/,
    );
  });

  it("reads raw bytes rather than the JSON envelope", async () => {
    const { connector, calls } = make();
    await connector.readBinary("theme.json");

    assert.equal(calls[0]!.headers["accept"], "application/vnd.github.raw");
  });
});

/* ------------------------------------------------------------------ *
 * GitLab
 * ------------------------------------------------------------------ */

const GITLAB_TREE = [
  { id: "blob-theme", name: "theme.json", path: "content/theme.json", type: "blob" },
  { id: "blob-pages-index", name: "index.json", path: "content/pages/index.json", type: "blob" },
  { id: "tree-a", name: "a", path: "content/pages/a", type: "tree" },
  { id: "blob-a", name: "index.json", path: "content/pages/a/index.json", type: "blob" },
  { id: "blob-photo", name: "photo.jpg", path: "content/pages/a/media/photo.jpg", type: "blob" },
];

const gitlabRoutes: Route[] = [
  {
    match: /GET \/api\/v4\/projects\/acme%2Fsite\/repository\/files\/content%2Ftheme\.json\/raw/,
    text: '{"primaryColor":"#123456"}',
  },
  {
    match: /GET \/api\/v4\/projects\/acme%2Fsite\/repository\/tree\?.*path=content%2Fpages(&|$)/,
    json: [
      { id: "blob-pages-index", name: "index.json", path: "content/pages/index.json", type: "blob" },
      { id: "tree-a", name: "a", path: "content/pages/a", type: "tree" },
    ],
  },
  // The recursive listing used before a commit. Page two is empty, which ends
  // the loop.
  { match: /repository\/tree\?.*recursive=true.*page=1/, json: GITLAB_TREE },
  { match: /repository\/tree\?.*recursive=true.*page=\d/, json: [] },
  { match: /POST \/api\/v4\/projects\/acme%2Fsite\/repository\/commits/, json: { id: "new-commit" } },
];

contract({
  name: "gitlabConnector",
  make(overrides = []) {
    const { fetch, calls } = stub([...overrides, ...gitlabRoutes]);
    return {
      calls,
      connector: gitlabConnector({ project: "acme/site", root: "content", token: "t", fetch }),
    };
  },
  writes: (calls) => calls.filter((call) => call.method === "POST"),
});

describe("gitlabConnector specifics", () => {
  const make = (overrides: Route[] = []) => {
    const { fetch, calls } = stub([...overrides, ...gitlabRoutes]);
    return {
      calls,
      connector: gitlabConnector({ project: "acme/site", root: "content", token: "t", fetch }),
    };
  };

  it("distinguishes creating a file from updating one", async () => {
    const { connector, calls } = make();

    await connector.commit({
      message: "Save",
      changes: [
        { type: "write", path: "theme.json", contents: "{}" },
        { type: "write", path: "pages/new/index.json", contents: "{}" },
      ],
    });

    const actions = calls.find((call) => call.method === "POST")!.body.actions;
    assert.equal(actions[0].action, "update");
    assert.equal(actions[1].action, "create");
  });

  it("authenticates with the private-token header", async () => {
    const { connector, calls } = make();
    await connector.read("theme.json");

    assert.equal(calls[0]!.headers["private-token"], "t");
  });

  it("reports a rejected action as a conflict", async () => {
    const { connector } = make([
      {
        match: /POST .*repository\/commits/,
        status: 400,
        text: '{"message":"A file with this name already exists"}',
      },
    ]);

    await assert.rejects(
      connector.commit({
        message: "Save",
        changes: [{ type: "write", path: "theme.json", contents: "{}" }],
      }),
      ConflictError,
    );
  });

  it("pages through the tree so a delete cannot miss a file", async () => {
    const { connector, calls } = make();
    await connector.commit({
      message: "Delete",
      changes: [{ type: "deleteTree", path: "pages/a" }],
    });

    const pages = calls.filter((call) => /recursive=true/.test(call.url));
    assert.ok(pages.length >= 1);
    assert.match(pages[0]!.url, /per_page=100/);
  });
});
