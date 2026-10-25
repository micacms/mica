/** The website's name at the top of the editor's menu. */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { siteHost, siteName } from "../src/lib/site.js";

describe("the website's name", () => {
  it("is the model's label, else the host of MICA_SITE_URL without www., else Mica", () => {
    assert.equal(siteName({ label: "Harbor Lane", url: "https://www.harborlane.example" }), "Harbor Lane");
    assert.equal(siteName({ label: null, url: "https://www.harborlane.example/" }), "harborlane.example");
    assert.equal(siteName({ label: null, url: null }), "Mica");
    assert.equal(siteName(null), "Mica");
  });

  it("keeps the port of a host, and has none for an address that cannot be read", () => {
    assert.equal(siteHost("http://localhost:4321"), "localhost:4321");
    assert.equal(siteHost("not a url"), null);
  });
});
