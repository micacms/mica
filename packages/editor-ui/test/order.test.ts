/** Moving items, and finding entries for a relation (#99, #101). */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { matchEntries, moveItem } from "../src/lib/order.js";

describe("moveItem", () => {
  it("moves one item and keeps the others in order", () => {
    assert.deepEqual(moveItem(["a", "b", "c", "d"], 3, 0), ["d", "a", "b", "c"]);
    assert.deepEqual(moveItem(["a", "b", "c", "d"], 0, 2), ["b", "c", "a", "d"]);
    assert.deepEqual(moveItem(["a", "b", "c"], 1, 1), ["a", "b", "c"]);
  });

  it("clamps the target, and ignores a source outside the list", () => {
    assert.deepEqual(moveItem(["a", "b", "c"], 0, 99), ["b", "c", "a"]);
    assert.deepEqual(moveItem(["a", "b", "c"], 2, -5), ["c", "a", "b"]);
    assert.deepEqual(moveItem(["a", "b"], 5, 0), ["a", "b"]);
  });
});

describe("matchEntries", () => {
  const entries = [
    { id: "anna-meier", title: "Anna Meier" },
    { id: "jan-annaheim", title: "Jan Annaheim" },
    { id: "bento", title: "Bento" },
  ];

  it("finds a term in the title or the id, with the ones that start with it first", () => {
    assert.deepEqual(matchEntries(entries, "anna").map((entry) => entry.id), ["anna-meier", "jan-annaheim"]);
    assert.deepEqual(matchEntries(entries, "BENTO").map((entry) => entry.id), ["bento"]);
    assert.deepEqual(matchEntries(entries, "jan-").map((entry) => entry.id), ["jan-annaheim"]);
  });

  it("leaves out what is already chosen, and limits the list", () => {
    assert.deepEqual(matchEntries(entries, "", ["bento"]).map((entry) => entry.id), ["anna-meier", "jan-annaheim"]);
    assert.equal(matchEntries(entries, "", [], 2).length, 2);
    assert.deepEqual(matchEntries(entries, "zzz"), []);
  });
});

describe("matchEntries over a reference set (#280)", () => {
  it("finds an item among 10,000 quickly, the start of a title first", () => {
    const items = Array.from({ length: 10_000 }, (_, index) => ({ id: `peak-${index}`, title: `Peak ${index}` }));
    items.push({ id: "toedi", title: "Tödi" });
    const started = performance.now();
    const found = matchEntries(items, "töd");
    assert.ok(performance.now() - started < 100);
    assert.deepEqual(found.map((item) => item.id), ["toedi"]);
    assert.equal(matchEntries(items, "peak").length, 50, "at most 50 results");
  });
});
