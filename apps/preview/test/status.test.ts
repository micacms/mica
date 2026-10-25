/** What the preview tells Mica (ADR 40): its state, and its last lines without secrets. */

import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { describe, it } from "node:test";

import { createStatusBoard, redactLine, serveStatus } from "../src/status.js";

describe("the preview's status", () => {
  it("takes credentials, tokens and colours out of a line", () => {
    assert.equal(redactLine("GET https://user:s3cret@registry.example.com/pkg"), "GET https://***@registry.example.com/pkg");
    assert.equal(redactLine("//registry.npmjs.org/:_authToken=npm_abcdefghijklmnopqrstuvwxyz0123"), "//registry.npmjs.org/:_authToken=***");
    assert.equal(redactLine("Authorization: Bearer abc.def"), "Authorization: Bearer ***");
    assert.equal(redactLine("found ghp_abcdefghijklmnopqrstuvwxyz0123 in .npmrc"), "found *** in .npmrc");
    assert.equal(redactLine("\u001b[32m astro \u001b[39m ready"), " astro  ready");
  });

  it("keeps the last 50 lines, joins a line that a chunk cut, and keeps the time of a step that stays", () => {
    let clock = 0;
    const board = createStatusBoard(() => new Date(clock));
    board.output("npm:out", "added 12 pack");
    board.output("npm:out", "ages\nup to date\n");
    for (let index = 0; index < 60; index++) board.line(`line ${index}`);
    board.set("installing");
    clock = 5_000;
    board.set("installing", "still");

    const report = board.report();
    assert.equal(report.lines.length, 50);
    assert.equal(report.lines.at(-1), "line 59");
    assert.equal(report.state, "installing");
    assert.equal(report.since, new Date(0).toISOString());
    assert.equal(report.reason, "still");

    const fresh = createStatusBoard();
    fresh.output("npm:out", "added 12 pack");
    fresh.output("npm:out", "ages\n");
    assert.deepEqual(fresh.report().lines, ["added 12 packages"]);
  });

  it("answers GET /status with the report, and nothing else", async () => {
    const board = createStatusBoard();
    board.set("running");
    board.commit("abc123");
    const server = serveStatus(board, 0);
    await new Promise((resolve) => server.once("listening", resolve));
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    try {
      const report = (await (await fetch(`${base}/status`)).json()) as { state: string; commit: string };
      assert.equal(report.state, "running");
      assert.equal(report.commit, "abc123");
      assert.equal((await fetch(`${base}/`)).status, 404);
      assert.equal((await fetch(`${base}/status`, { method: "POST" })).status, 404);
    } finally {
      server.close();
    }
  });
});
