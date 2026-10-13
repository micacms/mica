/** Each validation message names the field and the limit, in words an editor reads (#93). */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  boolean,
  coordinates,
  media,
  number,
  relation,
  repeater,
  richText,
  select,
  slug,
  text,
  textarea,
  validateFields,
  type FieldMap,
} from "../dist/index.js";

function messages(fields: FieldMap, data: Record<string, unknown>): string[] {
  const result = validateFields(fields, data);
  return result.ok ? [] : result.issues.map((issue) => issue.message);
}

describe("validation messages", () => {
  it("name the length limit and the current length", () => {
    const fields = {
      title: text({ label: "Title", minLength: 3, maxLength: 5 }),
      intro: textarea({ label: "Intro", maxLength: 2 }),
      body: richText({ label: "Body", maxLength: 1 }),
      url: slug({ label: "URL", maxLength: 3 }),
    };
    assert.deepEqual(messages(fields, { title: "ab", intro: "abc", body: "ab", url: "abcd" }), [
      "Title needs at least 3 characters (now 2).",
      "Intro can have at most 2 characters (now 3).",
      "Body can have at most 1 character (now 2).",
      "URL can have at most 3 characters (now 4).",
    ]);
  });

  it("use the pattern message of the model, or a plain default", () => {
    const fields = {
      country: text({ label: "Country", pattern: "[A-Z]{2}", patternMessage: "Use two capital letters, like CH." }),
      code: text({ label: "Code", pattern: "[0-9]+" }),
    };
    assert.deepEqual(messages(fields, { country: "ch", code: "x" }), [
      "Use two capital letters, like CH.",
      "Code does not have the expected form.",
    ]);
  });

  it("name number limits, whole numbers and wrong types", () => {
    const fields = {
      price: number({ label: "Price", min: 0, max: 100 }),
      rooms: number({ label: "Rooms", integer: true }),
      year: number({ label: "Year" }),
      open: boolean({ label: "Open" }),
    };
    assert.deepEqual(messages(fields, { price: 120, rooms: 2.5, year: "2024", open: "yes" }), [
      "Price must be at most 100.",
      "Rooms must be a whole number.",
      "Year must be a number.",
      "Open must be yes or no.",
    ]);
  });

  it("name list limits for media and repeaters", () => {
    const fields = {
      gallery: media({ label: "Gallery", multiple: true, max: 1 }),
      steps: repeater({ label: "Steps", min: 2, fields: { name: text() } }),
    };
    assert.deepEqual(messages(fields, { gallery: ["a.png", "b.png"], steps: [{ name: "One" }] }), [
      "Gallery allows at most 1 file.",
      "Steps needs at least 2 items.",
    ]);
  });

  it("name the field for coordinates, relations and choices", () => {
    const fields = {
      place: coordinates({ label: "Place" }),
      author: relation({ label: "Author", collection: "team" }),
      size: select({ label: "Size", options: [{ value: "s", label: "S" }] }),
    };
    assert.deepEqual(messages(fields, { place: { lat: 91, lng: 0 }, author: 7, size: "xl" }), [
      "Place: the latitude must be between -90 and 90.",
      "Author must name an entry.",
      "Size must be one of: s.",
    ]);
  });
});
