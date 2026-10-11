import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { safeReturnTo } from "../dist/return-to.js";

const PUBLIC_URL = "https://cms.example.com";

describe("safeReturnTo", () => {
  it("keeps a page of the editor, with its query and fragment", () => {
    assert.equal(safeReturnTo("/admin/", PUBLIC_URL), "/admin/");
    assert.equal(safeReturnTo("/admin", PUBLIC_URL), "/admin");
    assert.equal(safeReturnTo("/admin/collections/news?page=2#top", PUBLIC_URL), "/admin/collections/news?page=2#top");
  });

  it("refuses every form that leaves the site", () => {
    const attempts = [
      "//evil.example",
      "/\\evil.example",
      "/\\/evil.example",
      "\\\\evil.example",
      "/\t/evil.example",
      "/\n/evil.example",
      "/%2F%2Fevil.example",
      "https://evil.example/admin/",
      "http://cms.example.com/admin/",
      "javascript:alert(1)",
      "evil.example",
    ];
    for (const raw of attempts) assert.equal(safeReturnTo(raw, PUBLIC_URL), "/admin/", JSON.stringify(raw));
  });

  it("refuses a page of this site that is not the editor", () => {
    for (const raw of ["/", "/api/auth/logout", "/administrator", "/admin.evil", "/admin/../api/auth/me"]) {
      assert.equal(safeReturnTo(raw, PUBLIC_URL), "/admin/", raw);
    }
  });

  it("falls back when there is nothing to return to", () => {
    assert.equal(safeReturnTo(undefined, PUBLIC_URL), "/admin/");
    assert.equal(safeReturnTo("", PUBLIC_URL), "/admin/");
  });
});
