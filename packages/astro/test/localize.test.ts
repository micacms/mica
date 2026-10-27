/** Localized fields on the website: the loader gives a value for each locale, and `localize` gives one locale's values. */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { z } from "zod";

import { collection, defineSite, id, memorySource, richText, singleton, text } from "@micacms/core/internal";

import { localesOf, localize, micaCollections, type LoaderContext } from "../src/index.js";

const site = defineSite({
  locales: ["de", "en"],
  collections: {
    pages: collection({ label: "Pages", fields: { id: id(), title: text({ required: true, localized: true }), body: richText({ localized: true }) } }),
  },
  singletons: { settings: singleton({ label: "Settings", fields: { claim: text({ localized: true }) } }) },
});

const files = {
  "pages/about/index.json": JSON.stringify({ id: "about", title: { de: "Über uns", en: null } }),
  "pages/about/body.de.mdoc": "Ein Text.\n",
  "pages/about/body.en.mdoc": "A text.\n",
  "settings/index.json": JSON.stringify({ claim: { de: "Gut gebaut", en: "Well built" } }),
};

async function load(name: "pages" | "settings"): Promise<Map<string, Record<string, unknown>>> {
  const collections = micaCollections(site, { source: memorySource(files) });
  const schema = collections[name].schema!({ image: () => z.string() });
  const store = new Map<string, Record<string, unknown>>();
  const context: LoaderContext = {
    store: { clear: () => store.clear(), set: ({ id, data }) => (store.set(id, data), true), keys: () => [...store.keys()] },
    logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
    meta: { get: () => undefined, set: () => {} },
    parseData: async ({ data }) => (await schema.parseAsync(data)) as Record<string, unknown>,
    generateDigest: (data) => JSON.stringify(data).length.toString(),
  };
  await collections[name].loader.load(context);
  return store;
}

describe("a localized field on the website", () => {
  it("has a value for each locale, rich text included", async () => {
    const about = (await load("pages")).get("about")!;
    assert.deepEqual(about["title"], { de: "Über uns", en: null });
    assert.deepEqual(about["body"], { de: "Ein Text.", en: "A text." });
  });

  it("gives one locale's values with localize, and falls back to the default locale", async () => {
    const about = (await load("pages")).get("about")!;
    const en = localize(site, "pages", about, "en");
    assert.equal(en["title"], "Über uns");
    assert.equal(en["body"], "A text.");
    assert.equal(localize(site, "pages", about)["body"], "Ein Text.");
  });

  it("works for a singleton", async () => {
    const settings = (await load("settings")).get("settings")!;
    assert.equal(localize(site, "settings", settings, "en")["claim"], "Well built");
  });

  it("gives the locales that an entry is in, with localesOf", async () => {
    const about = (await load("pages")).get("about")!;
    // The English title is missing, and it is required: the English page shows the German one.
    assert.deepEqual(localesOf(site, "pages", about), ["de"]);
    assert.deepEqual(localesOf(site, "pages", { ...about, title: { de: "Über uns", en: "About us" } }), ["de", "en"]);
    assert.deepEqual(localesOf(site, "settings", (await load("settings")).get("settings")!), ["de", "en"]);
  });

  it("refuses a site without locales", () => {
    const plain = defineSite({ collections: { pages: collection({ label: "Pages", fields: { id: id() } }) } });
    assert.throws(() => localize(plain, "pages", {}, "de"), /no locales/);
    assert.throws(() => localesOf(plain, "pages", {}), /no locales/);
  });
});
