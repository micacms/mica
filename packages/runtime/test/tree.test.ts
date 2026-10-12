/**
 * Reading `git status` into a change list: what counts as a change to content.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { parseStatus } from "../src/workspace/tree.js";

const status = (...lines: string[]) => lines.map((line) => `${line}\0`).join("");

describe("parseStatus", () => {
  it("leaves out a save's temporary files and the manifest", () => {
    const changes = parseStatus(
      status(
        "?? content/posts/a/index.json",
        "?? content/posts/a/index.json.mica-4242-0",
        " M content/.mica/schema.json",
      ),
      "content",
    );
    assert.deepEqual(
      changes.map((change) => change.path),
      ["posts/a/index.json"],
    );
  });

  it("ignores files outside the content root", () => {
    assert.deepEqual(parseStatus(status(" M src/pages/index.astro"), "content"), []);
  });
});
