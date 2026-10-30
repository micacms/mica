/** After an autosave the form takes only the keys of new rows from the server, never its form of a value; and the save state of a form. */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { object, repeater, text } from "@micacms/core/internal";

import { saveStateOf, withRowKeys } from "../src/composables/useDocumentEditor.js";

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

describe("the save state of a form", () => {
  const form = { isNew: false, conflict: "none" as const, saving: false, failed: null, changed: false, held: false };

  it("says saved, also with a pending edit: whether it waits to be published is the dot's part", () => {
    assert.deepEqual(saveStateOf(form), { kind: "saved", label: "Saved", tone: "status-success" });
  });

  it("is grey while it saves, and before the first save of a new document", () => {
    assert.equal(saveStateOf({ ...form, saving: true, changed: true }).tone, "status-busy");
    assert.equal(saveStateOf({ ...form, isNew: true, changed: true }).tone, "");
  });

  it("is yellow for a field that breaks a rule, and red for a failed save or a conflict", () => {
    assert.equal(saveStateOf({ ...form, changed: true }).kind, "invalid");
    assert.equal(saveStateOf({ ...form, changed: true }).tone, "status-warning");
    assert.deepEqual(saveStateOf({ ...form, changed: true, failed: "Could not reach Mica." }), {
      kind: "failed",
      label: "Not saved",
      tone: "status-error",
      message: "Could not reach Mica.",
    });
    assert.equal(saveStateOf({ ...form, conflict: "loaded", saving: true }).label, "Not saved: choose a version");
    assert.equal(saveStateOf({ ...form, conflict: "missing" }).tone, "status-error");
  });

  it("says that a new ID waits for its button, while the rest is saved", () => {
    assert.deepEqual(saveStateOf({ ...form, held: true }), { kind: "waiting", label: "Saved · new ID waits", tone: "" });
    assert.equal(saveStateOf({ ...form, held: true, saving: true }).kind, "saving");
  });
});
