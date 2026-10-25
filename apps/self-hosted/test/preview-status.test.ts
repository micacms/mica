/** The self-hosted preview's state for the editor (ADR 38, 39): Mica sees only whether it answers. */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { STOPPED_AFTER_MS, upstreamPreview } from "../src/preview-status.js";

describe("the state of the self-hosted preview", () => {
  const address = "https://preview.cms.example.com";

  it("is live while the preview answers, and gives its address", async () => {
    const preview = upstreamPreview({ upstream: "http://preview:4321", address, fetcher: async () => new Response(null, { status: 403 }) });
    assert.deepEqual(await preview(), { state: "live", address, detail: null });
  });

  it("is starting for some minutes without an answer, then stopped, and live again at the next answer", async () => {
    let clock = 0;
    let up = false;
    const preview = upstreamPreview({
      upstream: "http://preview:4321",
      address,
      now: () => clock,
      fetcher: async () => {
        if (!up) throw new TypeError("fetch failed");
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
});
