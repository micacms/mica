/** The languages of a form: the language of a field path, the missing translations, and the fallback of an empty value. */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { collection, defineSite, id, media, repeater, text } from "@micacms/core/internal";

import { fallbackFor, missingTranslations, pathLocale, translationStatus, type FormLocales } from "../src/lib/locales.js";

const site = defineSite({
  locales: ["de", "en", "fr"],
  fallback: { fr: "en" },
  collections: {
    pages: collection({
      label: "Pages",
      fields: {
        id: id(),
        title: text({ localized: true }),
        legal: text({ localized: { fallback: false } }),
        image: media(),
        sections: repeater({ fields: { heading: text({ localized: true }) } }),
      },
    }),
  },
});
const fields = site.collections.pages.fields;
const locales: FormLocales = { list: ["de", "en", "fr"], default: "de", fallback: { fr: "en" } };

describe("pathLocale", () => {
  it("names the locale of a localized field, also in a repeater's row", () => {
    assert.equal(pathLocale(fields, "title.en"), "en");
    assert.equal(pathLocale(fields, "sections.2.heading.fr"), "fr");
  });

  it("gives null for a field that is the same in each locale", () => {
    assert.equal(pathLocale(fields, "image"), null);
    assert.equal(pathLocale(fields, "title"), null);
  });
});

describe("missingTranslations", () => {
  const data = { title: { de: "Über uns", en: null, fr: "À propos" }, legal: { de: "AGB", en: null, fr: null }, sections: [{ heading: { de: "Eins", en: "One", fr: null } }] };

  it("counts the values that the default locale has and the locale has not", () => {
    assert.equal(missingTranslations(fields, data, "en", locales), 2);
    assert.equal(missingTranslations(fields, data, "fr", locales), 2);
  });

  it("is zero for the default locale", () => {
    assert.equal(missingTranslations(fields, data, "de", locales), 0);
  });
});

describe("fallbackFor", () => {
  it("follows the chain, then the default locale", () => {
    assert.deepEqual(fallbackFor(fields.title!, { de: "Über uns", en: "About us", fr: null }, "fr", locales), { locale: "en", value: "About us" });
    assert.deepEqual(fallbackFor(fields.title!, { de: "Über uns", en: null, fr: null }, "fr", locales), { locale: "de", value: "Über uns" });
  });

  it("has none with fallback: false, and none for the default locale", () => {
    assert.equal(fallbackFor(fields.legal!, { de: "AGB", en: null, fr: null }, "en", locales), null);
    assert.equal(fallbackFor(fields.title!, { de: null, en: "About us", fr: null }, "de", locales), null);
  });
});

describe("translationStatus", () => {
  it("is translated when the locale has a value", () => {
    assert.deepEqual(translationStatus(fields.title!, { de: "Über uns", en: "About us", fr: null }, "en", locales), { kind: "translated" });
  });

  it("names the locale that the website shows instead", () => {
    assert.deepEqual(translationStatus(fields.title!, { de: "Über uns", en: "About us", fr: null }, "fr", locales), { kind: "fallback", locale: "en" });
  });

  it("is missing when the website shows nothing: fallback: false, or an empty default locale", () => {
    assert.deepEqual(translationStatus(fields.legal!, { de: "AGB", en: null, fr: null }, "en", locales), { kind: "missing" });
    assert.deepEqual(translationStatus(fields.title!, { de: null, en: "About us", fr: null }, "de", locales), { kind: "missing" });
  });

  it("is empty when no locale has a value", () => {
    assert.deepEqual(translationStatus(fields.title!, { de: null, en: "", fr: null }, "fr", locales), { kind: "empty" });
  });
});
