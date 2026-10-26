/** The choices of a relation field: the entries of a collection, with their pages' URLs. */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { toOptions } from "../src/lib/entry-options.js";

describe("the choices of a relation field", () => {
  const items = [
    { id: "taetsch", title: "Tätsch", data: { region: "glarus" } },
    { id: "albert-heim-huette", title: "Albert-Heim-Hütte", data: {} },
  ];

  it("have the page's URL when the collection has a url and the address is complete", () => {
    assert.deepEqual(toOptions(items, "/{region}/{id}"), [
      { id: "taetsch", title: "Tätsch", url: "/glarus/taetsch" },
      { id: "albert-heim-huette", title: "Albert-Heim-Hütte", url: null },
    ]);
  });

  it("have no URL without a url in the model", () => {
    assert.deepEqual(toOptions(items).map((option) => option.url), [null, null]);
  });
});
