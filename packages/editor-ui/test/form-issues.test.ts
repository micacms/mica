/** Problems in the form: checked on leaving a field and before a save, gone once the field is correct (#94). */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { nextTick, ref } from "vue";

import { text } from "@micacms/core";

import { useFormIssues } from "../src/composables/useFormIssues.js";

const fields = { title: text({ label: "Title", maxLength: 3, required: true }), intro: text({ label: "Intro" }) };

describe("useFormIssues", () => {
  it("shows a field's problem when the editor leaves it, not before", () => {
    const values = ref<Record<string, unknown>>({ title: "Long", intro: "" });
    const form = useFormIssues(() => fields, values);
    assert.deepEqual(form.issues.value, []);
    form.leave("intro");
    assert.deepEqual(form.issues.value, []);
    form.leave("title");
    assert.deepEqual(form.issues.value.map((issue) => issue.path), ["title"]);
  });

  it("drops a problem as soon as its field is correct", async () => {
    const values = ref<Record<string, unknown>>({ title: "Long", intro: "" });
    const form = useFormIssues(() => fields, values);
    form.leave("title");
    values.value = { ...values.value, title: "Ok" };
    await nextTick();
    assert.deepEqual(form.issues.value, []);
  });

  it("keeps a server problem until its own field changes", async () => {
    const values = ref<Record<string, unknown>>({ title: "Ok", intro: "x" });
    const form = useFormIssues(() => fields, values);
    form.set([{ path: "intro", message: "Intro is taken." }]);
    values.value = { ...values.value, title: "No" };
    await nextTick();
    assert.deepEqual(form.issues.value.map((issue) => issue.path), ["intro"]);
    values.value = { ...values.value, intro: "y" };
    await nextTick();
    assert.deepEqual(form.issues.value, []);
  });

  it("keeps a server problem when the editor leaves another field, or checks before a save", () => {
    const values = ref<Record<string, unknown>>({ title: "Ok", intro: "x" });
    const form = useFormIssues(() => fields, values);
    form.set([{ path: "intro", message: "Intro is taken." }]);
    form.leave("title");
    assert.deepEqual(form.issues.value.map((issue) => issue.path), ["intro"]);
    assert.equal(form.checkAll(), true, "the browser finds nothing; the server checks again");
    assert.deepEqual(form.issues.value.map((issue) => issue.path), ["intro"]);
  });

  it("checks the whole form before a save, but leaves required values to Publish", () => {
    const values = ref<Record<string, unknown>>({ title: "", intro: "" });
    const form = useFormIssues(() => fields, values);
    assert.equal(form.checkAll(), true);
    values.value = { title: "Long", intro: "" };
    assert.equal(form.checkAll(), false);
    assert.equal(form.issues.value[0]?.message, "Title can have at most 3 characters (now 4).");
  });
});
