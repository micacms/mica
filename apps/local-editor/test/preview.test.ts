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

  it("gives nothing without a marker", async () => {
    assert.equal(await devServerPreview(root)(), null);
  });

  it("gives the address of a running dev server that answers", async () => {
    mark(process.pid, address);
    assert.equal(await devServerPreview(root)(), address);
  });

  it("gives nothing for a process that stopped, or an address that does not answer", async () => {
    const stopped = spawnSync(process.execPath, ["-e", "process.pid"]).pid!;
    mark(stopped, address);
    assert.equal(await devServerPreview(root)(), null);

    mark(process.pid, "http://localhost:1");
    assert.equal(await devServerPreview(root)(), null);
  });

  it("refuses an address that is not on this machine", async () => {
    mark(process.pid, "https://example.com");
    assert.equal(await devServerPreview(root)(), null);
  });
});
