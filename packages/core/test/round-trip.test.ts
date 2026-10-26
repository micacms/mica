/**
 * The authoring format, as properties over generated models and entries (#137).
 *
 * `format.test.ts` checks the format with examples. This file checks the
 * same promises for every model and entry that fast-check makes: what a save
 * writes reads back the same, a second write gives the same bytes, a key the
 * model does not declare stays, and a media path survives the trip to the
 * file and back.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import fc from "fast-check";

import {
  boolean,
  color,
  coordinates,
  date,
  media,
  number,
  object,
  parseEntry,
  relation,
  relativizeMedia,
  repeater,
  resolveMedia,
  richText,
  select,
  serializeEntry,
  tags,
  text,
  textarea,
  type AnyField,
  type FieldMap,
} from "../src/internal.js";

/* ------------------------------------------------------------------ *
 * Models
 * ------------------------------------------------------------------ */

const fieldName = fc.stringMatching(/^[a-z][a-zA-Z0-9]{0,7}$/).filter((name) => name !== "id");

const options = [
  { label: "A", value: "a" },
  { label: "B", value: "b" },
];

const leaf: fc.Arbitrary<AnyField> = fc.oneof(
  fc.constant(text()),
  fc.constant(textarea()),
  fc.constant(number()),
  fc.constant(boolean()),
  fc.constant(date()),
  fc.constant(color()),
  fc.constant(richText()),
  fc.constant(tags()),
  fc.constant(coordinates()),
  fc.constant(media()),
  fc.constant(media({ multiple: true })),
  fc.constant(media({ alt: "optional" })),
  fc.constant(select({ options })),
  fc.constant(select({ options, multiple: true })),
  fc.constant(relation({ collection: "team" })),
  fc.constant(relation({ collection: "team", multiple: true })),
);

const fieldMap = (field: fc.Arbitrary<AnyField>): fc.Arbitrary<FieldMap> =>
  fc.dictionary(fieldName, field, { minKeys: 1, maxKeys: 5, noNullPrototype: true });

/** Objects and repeaters, nested a few levels, with every other kind inside. */
const tree = fc.letrec<{ field: AnyField }>((tie) => ({
  field: fc.oneof(
    { depthSize: "small", withCrossShrink: true },
    leaf,
    fieldMap(tie("field")).map((fields) => object({ fields })),
    fieldMap(tie("field")).map((fields) => repeater({ fields })),
  ),
}));
const model = fieldMap(tree.field);

/* ------------------------------------------------------------------ *
 * Entries: the payload as a read gives it
 * ------------------------------------------------------------------ */

const plain = fc.string({ unit: "grapheme", maxLength: 20 });
const maybe = <T>(value: fc.Arbitrary<T>) => fc.option(value, { nil: null });
const finite = fc.double({ noNaN: true, noDefaultInfinity: true }).filter((n) => !Object.is(n, -0));
const path = fc.stringMatching(/^\/?[a-z0-9_-]{1,8}(\/[a-z0-9_-]{1,8}){0,2}\.(jpg|pdf|gpx)$/);
const rowKey = fc.stringMatching(/^[a-z][a-z0-9]{3,15}$/);
/** Rich text as a read gives it: trimmed and not empty, or null. */
const document = maybe(plain.map((value) => value.trim()).filter((value) => value !== ""));

function holdsRichText(fields: FieldMap): boolean {
  return Object.values(fields).some(
    (field) => field.kind === "richText" || ((field.kind === "object" || field.kind === "repeater") && holdsRichText(field.fields)),
  );
}

function valueOf(field: AnyField): fc.Arbitrary<unknown> {
  switch (field.kind) {
    case "number":
      return maybe(finite);
    case "boolean":
      return fc.boolean();
    case "richText":
      return document;
    case "tags":
      return fc.uniqueArray(plain, { maxLength: 3 });
    case "coordinates":
      return maybe(fc.record({ lat: finite, lng: finite }, { noNullPrototype: true }));
    case "media":
      if (field.alt) return maybe(fc.record({ path, alt: maybe(plain) }, { noNullPrototype: true }));
      return field.multiple ? fc.array(path, { maxLength: 3 }) : maybe(path);
    case "select":
    case "relation":
      return field.multiple ? fc.array(fc.constantFrom("a", "b"), { maxLength: 2 }) : maybe(fc.constantFrom("a", "b"));
    case "object":
      return entryOf(field.fields);
    case "repeater": {
      const row = entryOf(field.fields);
      if (!holdsRichText(field.fields)) return fc.array(row, { maxLength: 3 });
      // A row with rich text has a key that names its files, first and unique in its list.
      return fc
        .uniqueArray(rowKey, { maxLength: 3 })
        .chain((keys) => fc.tuple(...keys.map((key) => row.map((data) => ({ _key: key, ...data })))));
    }
    default:
      return maybe(plain);
  }
}

function entryOf(fields: FieldMap): fc.Arbitrary<Record<string, unknown>> {
  return fc.record(Object.fromEntries(Object.entries(fields).map(([key, field]) => [key, valueOf(field)])), { noNullPrototype: true });
}

const modelAndEntry = model.chain((fields) => entryOf(fields).map((data) => ({ fields, data })));

/* ------------------------------------------------------------------ *
 * Properties
 * ------------------------------------------------------------------ */

describe("the format round trip (property)", () => {
  it("reads back exactly what a save wrote", () => {
    fc.assert(
      fc.property(modelAndEntry, ({ fields, data }) => {
        const files = serializeEntry(fields, data);
        assert.deepStrictEqual(parseEntry(fields, files), data);
      }),
    );
  });

  it("writes the same bytes again for what it read", () => {
    fc.assert(
      fc.property(modelAndEntry, ({ fields, data }) => {
        const first = serializeEntry(fields, data);
        const second = serializeEntry(fields, parseEntry(fields, first), JSON.parse(first.data));
        assert.equal(second.data, first.data);
        assert.deepStrictEqual(second.documents, first.documents);
      }),
    );
  });

  it("keeps a key that the model does not declare, after the declared ones", () => {
    fc.assert(
      fc.property(modelAndEntry, fc.jsonValue(), ({ fields, data }, kept) => {
        const name = "zUndeclared";
        fc.pre(!(name in fields));
        const written = JSON.parse(serializeEntry(fields, data, { [name]: kept }).data) as Record<string, unknown>;
        assert.deepStrictEqual(written[name], JSON.parse(JSON.stringify(kept)));
        assert.equal(Object.keys(written).at(-1), name);
      }),
    );
  });
});

describe("media paths (property)", () => {
  const fields: FieldMap = { cover: media(), gallery: media({ multiple: true }), image: media({ alt: "required" }) };
  const base = fc.stringMatching(/^[a-z]{1,6}\/[a-z0-9-]{1,8}$/);
  const fromRoot = fc.stringMatching(/^[a-z0-9_-]{1,8}(\/[a-z0-9_-]{1,8}){0,2}\.jpg$/);

  it("a path from the content root survives the trip to the file and back", () => {
    fc.assert(
      fc.property(base, fromRoot, fc.array(fromRoot, { maxLength: 3 }), fromRoot, (folder, cover, gallery, image) => {
        const data = { cover, gallery, image: { path: image, alt: "Alt" } };
        assert.deepStrictEqual(resolveMedia(fields, relativizeMedia(fields, data, folder), folder), data);
      }),
    );
  });

  it("a file in the entry's folder is written next to the entry, and any other from the root", () => {
    fc.assert(
      fc.property(base, fromRoot, (folder, file) => {
        const own = relativizeMedia(fields, { cover: `${folder}/${file}` }, folder);
        assert.equal(own["cover"], file);
        // Longer than any first segment of `base`, so it is never the entry's folder.
        const shared = relativizeMedia(fields, { cover: `sharedfiles/${file}` }, folder);
        assert.equal(shared["cover"], `/sharedfiles/${file}`);
      }),
    );
  });
});
