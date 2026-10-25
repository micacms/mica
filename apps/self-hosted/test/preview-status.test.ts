/** The self-hosted preview's state for the editor (ADR 38, 39): Mica sees only whether it answers. */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { readReport, STOPPED_AFTER_MS, upstreamPreview } from "../src/preview-status.js";

describe("the state of the self-hosted preview", () => {
  const address = "https://preview.cms.example.com";

  it("is live while the preview answers, and gives its address", async () => {
    const preview = upstreamPreview({ upstream: "http://preview:4321", address, fetcher: async () => new Response(null, { status: 403 }) });
    // An image of one's own: no report on port 4380, only an answer of the dev server.
    assert.deepEqual(await preview(), { state: "live", address, detail: null });
  });

  it("is starting for some minutes without an answer, then stopped, and live again at the next answer", async () => {
    let clock = 0;
    let up = false;
    const preview = upstreamPreview({
      upstream: "http://preview:4321",
      address,
      now: () => clock,
      fetcher: async (url) => {
        if (!up || String(url).includes(":4380")) throw new TypeError("fetch failed");
        return new Response(null);
      },
    });

    assert.equal((await preview()).state, "starting");
    clock += STOPPED_AFTER_MS + 10_000;
    const stopped = await preview();
    assert.equal(stopped.state, "stopped");
    assert.match(stopped.detail ?? "", /Tell the person who runs Mica/);

    up = true;
    clock += 10_000;
    assert.equal((await preview()).state, "live");
    // A stop after it ran is new: it starts again as "starting".
    up = false;
    clock += 10_000;
    assert.equal((await preview()).state, "starting");
  });

  it("takes the state, the reason and the lines from the report of Mica's preview image (ADR 40)", async () => {
    let report: object = { state: "installing", reason: null, lines: ["npm ci", "added 812 packages"] };
    let up = false;
    const preview = upstreamPreview({
      upstream: "http://preview:4321",
      address,
      now: (() => {
        let clock = 0;
        return () => (clock += 10_000);
      })(),
      fetcher: async (url) => {
        if (String(url) === "http://preview:4380/status") return Response.json(report);
        if (!up) throw new TypeError("fetch failed");
        return new Response(null);
      },
    });

    const installing = await preview();
    assert.equal(installing.state, "starting");
    assert.match(installing.detail ?? "", /installs the packages/);
    assert.deepEqual(installing.lines, ["npm ci", "added 812 packages"]);

    report = { state: "failed", reason: "The install failed.", lines: [] };
    const failed = await preview();
    assert.equal(failed.state, "stopped");
    assert.equal(failed.detail, "The install failed. Tell the person who runs Mica.");

    report = { state: "running", reason: null, lines: [] };
    up = true;
    assert.equal((await preview()).state, "live");
  });

  it("refuses a report that it cannot read, and cuts what is too long", () => {
    assert.equal(readReport({ state: "dancing" }), null);
    assert.equal(readReport("running"), null);
    const read = readReport({ state: "failed", reason: "x".repeat(400), lines: [...Array(80).keys()].map(String).concat([7 as unknown as string]) });
    assert.equal(read?.reason?.length, 300);
    assert.equal(read?.lines.length, 49);
    assert.equal(read?.lines[0], "31");
  });
});
