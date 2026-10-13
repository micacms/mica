/** Link addresses in rich text (#107). */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { linkProblem } from "../src/lib/links.js";

describe("linkProblem", () => {
  it("accepts web, email, phone and site addresses", () => {
    for (const href of ["https://example.com", "http://example.com/a?b=1", "mailto:hi@example.com", "tel:+41441234567", "/about", "/"]) {
      assert.equal(linkProblem(href), null, href);
    }
  });

  it("refuses other addresses with a reason", () => {
    for (const href of ["example.com", "javascript:alert(1)", "https://", "ftp://example.com", "https://exa mple.com"]) {
      assert.match(linkProblem(href) ?? "", /Start the address with/, href);
    }
  });
});
