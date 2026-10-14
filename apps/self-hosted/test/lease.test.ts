/** One Mica per data volume: the lease (#229). Short timings, so the tests wait a little. */

import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";

import { createLogger } from "@micacms/runtime";

import { CloneRefusal } from "../src/workspace/clone.js";
import { takeLease } from "../src/workspace/lease.js";

const logger = createLogger({ level: "silent", pretty: false });
const timings = { expiresMs: 300, heartbeatMs: 50, waitMs: 600, pollMs: 50 };
const never = () => assert.fail("the lease was lost");

describe("the lease of a data volume", () => {
  it("refuses a second Mica while the first one keeps its heartbeat", async () => {
    const dir = mkdtempSync(join(tmpdir(), "mica-lease-"));
    const first = await takeLease(dir, logger, never, timings);

    await assert.rejects(takeLease(dir, logger, never, timings), (error: unknown) => error instanceof CloneRefusal && /Another Mica/.test(String(error)));
    await first.release();
    assert.equal(existsSync(join(dir, "lease.json")), false);
  });

  it("takes over a lease whose heartbeat stopped, as after a crash", async () => {
    const dir = mkdtempSync(join(tmpdir(), "mica-lease-"));
    writeFileSync(join(dir, "lease.json"), JSON.stringify({ id: "crashed", host: "old", pid: 1, at: Date.now() - 1_000 }));

    const lease = await takeLease(dir, logger, never, timings);
    assert.notEqual(JSON.parse(readFileSync(join(dir, "lease.json"), "utf8")).id, "crashed");
    await lease.release();
  });

  it("waits for a fresh lease to expire, as while an old container stops", async () => {
    const dir = mkdtempSync(join(tmpdir(), "mica-lease-"));
    writeFileSync(join(dir, "lease.json"), JSON.stringify({ id: "stopping", host: "old", pid: 1, at: Date.now() }));

    const lease = await takeLease(dir, logger, never, timings);
    await lease.release();
  });

  it("says so when another process took the lease over", async () => {
    const dir = mkdtempSync(join(tmpdir(), "mica-lease-"));
    const lost = new Promise<string>((resolve) => {
      void takeLease(dir, logger, resolve, timings).then(() => {
        writeFileSync(join(dir, "lease.json"), JSON.stringify({ id: "other", host: "elsewhere", pid: 2, at: Date.now() }));
      });
    });
    assert.match(await lost, /elsewhere/);
  });
});
