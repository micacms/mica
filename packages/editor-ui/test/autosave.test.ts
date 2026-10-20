/** After an autosave the form takes only the keys of new rows from the server, never its form of a value. */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { object, repeater, text } from "@micacms/core/internal";

import { withRowKeys } from "../src/composables/useDocumentEditor.js";

describe("the keys of new rows after an autosave", () => {
  const fields = {
    title: text(),
    seo: object({ fields: { facts: repeater({ fields: { label: text() } }) } }),
    facts: repeater({ fields: { label: text() } }),
  };

  it("takes the keys of new rows, also nested ones, and keeps every value as typed", () => {
    const local = { title: "Our new ", facts: [{ _key: "a1", label: "One" }, { label: "Two " }], seo: { facts: [{ label: "x" }] } };
    const saved = { title: "Our new", facts: [{ _key: "a1", label: "One" }, { _key: "b2", label: "Two" }], seo: { facts: [{ _key: "c3", label: "x" }] } };
    assert.deepEqual(withRowKeys(fields, local, saved), {
      title: "Our new ",
      facts: [{ _key: "a1", label: "One" }, { _key: "b2", label: "Two " }],
      seo: { facts: [{ _key: "c3", label: "x" }] },
    });
  });

  it("takes nothing when the rows differ in number: the editor added or removed one meanwhile", () => {
    const local = { facts: [{ label: "One" }, { label: "Two" }] };
    const saved = { facts: [{ _key: "a1", label: "One" }] };
    assert.deepEqual(withRowKeys(fields, local, saved), local);
  });
});
