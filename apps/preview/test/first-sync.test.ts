/** The preview's wait for Mica's first sync after a start (ADR 39). */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { LEASE_FRESH_MS, micaSynced } from "../src/first-sync.js";

const now = 1_800_000_000_000;
const lease = (fields: object) => JSON.stringify({ id: "a", host: "mica", pid: 7, ...fields });

describe("Mica's first sync", () => {
  it("is there when a Mica with a fresh heartbeat wrote it", () => {
    assert.equal(micaSynced(lease({ at: now - 5_000, syncedAt: now - 20_000 }), now), true);
  });

  it("is not there yet while a fresh Mica has not ended its first sync", () => {
    assert.equal(micaSynced(lease({ at: now - 5_000 }), now), false);
  });

  it("is not there without a Mica that runs: no lease, a stale one, or one that cannot be read", () => {
    assert.equal(micaSynced(null, now), false);
    assert.equal(micaSynced(lease({ at: now - LEASE_FRESH_MS - 1, syncedAt: now - LEASE_FRESH_MS - 5_000 }), now), false);
    assert.equal(micaSynced("{ half", now), false);
  });
});
