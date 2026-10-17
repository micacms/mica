/** Uploads of many files (#282): one after another, a failure does not stop the others, and `max` holds. */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { addPaths, roomFor, uploadEach, type UploadState } from "../src/lib/uploads.js";

const file = (name: string) => new File(["x"], name);

describe("uploadEach", () => {
  it("sends 100 files in their order, and goes on after a failure", async () => {
    const files = Array.from({ length: 100 }, (_, index) => file(`photo-${index}.jpg`));
    const sent: string[] = [];
    let last: UploadState[] = [];
    const run = await uploadEach(
      files,
      async (one) => {
        sent.push(one.name);
        if (one.name === "photo-41.jpg") throw new Error("too large");
        return `media/${one.name}`;
      },
      (states) => (last = states),
      (error) => (error as Error).message,
    );

    assert.deepEqual(sent, files.map((one) => one.name));
    assert.equal(run.done.length, 99);
    assert.equal(run.done[41], "media/photo-42.jpg");
    assert.deepEqual(run.failed.map((one) => one.name), ["photo-41.jpg"]);
    assert.deepEqual(last[41], { name: "photo-41.jpg", status: "failed", message: "too large" });
    assert.equal(last.filter((state) => state.status === "done").length, 99);
  });

  it("reports one file at a time as uploading", async () => {
    const seen: number[] = [];
    await uploadEach([file("a.jpg"), file("b.jpg")], async () => "ok", (states) => seen.push(states.filter((state) => state.status === "uploading").length));
    assert.ok(seen.every((count) => count <= 1));
  });
});

describe("addPaths", () => {
  it("adds in order, leaves out a path that is there, and counts what does not fit", () => {
    assert.deepEqual(addPaths(["a"], ["b", "a", "c"]), { next: ["a", "b", "c"], skipped: 0 });
    assert.deepEqual(addPaths(["a"], ["b", "c", "d"], 3), { next: ["a", "b", "c"], skipped: 1 });
  });

  it("gives the room that is left", () => {
    assert.equal(roomFor(3, 5), 2);
    assert.equal(roomFor(6, 5), 0);
    assert.equal(roomFor(3), Infinity);
  });
});
