/** A failed request in the editor (#218): the status first, and JSON only from a JSON response. */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { api, ApiError, messageOf, readResponse, type Schema } from "../src/api.js";
import { useSchema } from "../src/stores/schema.js";

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

const refusal = async (response: Response): Promise<ApiError> => {
  try {
    await readResponse(response);
  } catch (error) {
    assert.ok(error instanceof ApiError, String(error));
    return error;
  }
  assert.fail("the response was not refused");
};

describe("readResponse", () => {
  it("reads the JSON of a success, and nothing of a 204", async () => {
    assert.deepEqual(await readResponse(json(200, { ok: true })), { ok: true });
    assert.equal(await readResponse(new Response(null, { status: 204 })), undefined);
  });

  it("takes the code, message and issues of Mica's own refusal", async () => {
    const error = await refusal(
      json(422, { error: { code: "validation_failed", message: "Check the title.", issues: [{ path: "title", message: "Too long." }] } }),
    );
    assert.equal(error.status, 422);
    assert.equal(error.code, "validation_failed");
    assert.equal(error.message, "Check the title.");
    assert.deepEqual(error.issues, [{ path: "title", message: "Too long." }]);
  });

  it("keeps the request ID, and names it in the message of a server failure (#78)", async () => {
    const failed = await refusal(json(500, { error: { code: "internal_error", message: "Something went wrong. Please try again.", requestId: "r1b2c3" } }));
    assert.equal(failed.requestId, "r1b2c3");
    assert.equal(messageOf(failed, "x"), "Something went wrong. Please try again. Reference: r1b2c3.");

    const header = new Response(JSON.stringify({ error: { code: "storage_unavailable", message: "Mica cannot save." } }), {
      status: 507,
      headers: { "content-type": "application/json", "x-request-id": "h4d5" },
    });
    assert.equal(messageOf(await refusal(header), "x"), "Mica cannot save. Reference: h4d5.");

    // A refusal that the editor can fix needs no reference.
    assert.equal(messageOf(await refusal(json(422, { error: { code: "validation_failed", message: "Check the title." } })), "x"), "Check the title.");
  });

  it("does not read an HTML page from a proxy as JSON", async () => {
    const page = new Response("<html><h1>413 Request Entity Too Large</h1></html>", { status: 413, headers: { "content-type": "text/html" } });
    const error = await refusal(page);
    assert.equal(error.status, 413);
    assert.match(error.message, /too large/);
  });

  it("keeps the status of a 401 and of a gateway error", async () => {
    assert.equal((await refusal(new Response("", { status: 401 }))).isUnauthenticated, true);
    assert.match((await refusal(new Response("Bad gateway", { status: 502, headers: { "content-type": "text/plain" } }))).message, /cannot be reached/);
  });

  it("refuses a success that is not JSON, instead of a parse error", async () => {
    const error = await refusal(new Response("<html></html>", { status: 200, headers: { "content-type": "text/html" } }));
    assert.equal(error.code, "unreadable_response");
  });
});

describe("api.health", () => {
  const answering = async (answer: () => Promise<Response>): Promise<boolean> => {
    const original = globalThis.fetch;
    globalThis.fetch = answer;
    try {
      return await api.health();
    } finally {
      globalThis.fetch = original;
    }
  };

  it("is true only when Mica answers, not when a proxy answers for a stopped Mica", async () => {
    assert.equal(await answering(async () => json(200, { status: "ok" })), true);
    assert.equal(await answering(async () => new Response("Bad gateway", { status: 502 })), false);
    assert.equal(await answering(() => Promise.reject(new TypeError("Failed to fetch"))), false);
  });
});

describe("the schema store", () => {
  it("forgets a failed request, so that the next navigation tries again", async () => {
    const schema: Schema = { collections: [], singletons: [], references: [], revision: "r1" };
    const original = api.schema;
    let calls = 0;
    api.schema = async () => {
      calls += 1;
      if (calls === 1) throw new ApiError(0, "network_error", "Could not reach Mica.");
      return schema;
    };
    try {
      const store = useSchema();
      store.reset();
      await assert.rejects(store.load(), ApiError);
      assert.equal(await store.load(), schema);
      assert.equal(calls, 2);
    } finally {
      api.schema = original;
    }
  });
});
