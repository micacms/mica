/** The local editor's "Preview" (#281): only a dev server whose process runs and whose address answers. */

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, before, describe, it } from "node:test";

import { devServerMarkerPath } from "@micacms/core/node";

import { devServerPreview } from "../src/preview.js";

describe("devServerPreview", () => {
  let root: string;
  let server: Server;
  let address: string;

  const mark = (pid: number, at: string) => {
    const path = devServerMarkerPath(root);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, JSON.stringify({ pid, address: at }));
  };

  before(async () => {
    root = mkdtempSync(join(tmpdir(), "mica-preview-"));
    server = createServer((_request, response) => response.end("ok"));
    await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
    address = `http://localhost:${(server.address() as AddressInfo).port}`;
  });
  after(() => {
    server.close();
    rmSync(devServerMarkerPath(root), { force: true });
    rmSync(root, { recursive: true, force: true });
  });

  const state = async (options?: Parameters<typeof devServerPreview>[1]) => (await devServerPreview(root, options)()).state;

  it("is off without a marker and without a dev server that --preview started", async () => {
    rmSync(devServerMarkerPath(root), { force: true });
    const off = await devServerPreview(root)();
    assert.equal(off.state, "off");
    assert.match(off.detail ?? "", /mica start --preview/);
  });

  it("is live with the address of a running dev server that answers", async () => {
    mark(process.pid, address);
    assert.deepEqual(await devServerPreview(root)(), { state: "live", address, detail: null });
  });

  it("is starting while the dev server runs but does not answer yet, or before --preview's one wrote its marker", async () => {
    mark(process.pid, "http://localhost:1");
    assert.equal(await state(), "starting");

    rmSync(devServerMarkerPath(root), { force: true });
    assert.equal(await state({ started: () => ({ running: true, exit: null, lines: [] }) }), "starting");
  });

  it("is stopped when the marker's process is gone, or the dev server of --preview ended, with how it ended", async () => {
    const gone = spawnSync(process.execPath, ["-e", "process.pid"]).pid!;
    mark(gone, address);
    assert.equal(await state(), "stopped");

    rmSync(devServerMarkerPath(root), { force: true });
    const ended = await devServerPreview(root, { started: () => ({ running: false, exit: "SIGTERM", lines: ["astro  v7.3.8 ready", "[200] / 12ms"] }) })();
    assert.equal(ended.state, "stopped");
    assert.match(ended.detail ?? "", /It ended with SIGTERM/);
    assert.deepEqual(ended.lines, ["astro  v7.3.8 ready", "[200] / 12ms"], "the last lines of --preview's dev server, for the System page");
  });

  it("takes no marker with an address that is not on this machine", async () => {
    mark(process.pid, "https://example.com");
    assert.equal(await state(), "off");
  });
});
