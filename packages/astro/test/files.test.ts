/** `mediaFile` gives the file on disk for a media path, and never a path outside the content root. */

import assert from "node:assert/strict";
import { join, resolve } from "node:path";
import { describe, it } from "node:test";

import { mediaFile } from "../src/index.js";

describe("mediaFile", () => {
  it("resolves a media path in the content root", () => {
    assert.equal(mediaFile({ root: "/srv/site/content" }, "tours/ridge/media/track.gpx"), "/srv/site/content/tours/ridge/media/track.gpx");
    assert.equal(mediaFile({ root: "/srv/site/content" }, "/media/prices.csv"), "/srv/site/content/media/prices.csv");
  });

  it("resolves a relative root against the working directory, and the default root without one", () => {
    assert.equal(mediaFile({ root: "./data" }, "media/a.zip"), join(resolve("./data"), "media/a.zip"));
    assert.equal(mediaFile({}, "media/a.zip"), join(resolve("./content"), "media/a.zip"));
  });

  it("refuses a path that leaves the content root", () => {
    assert.throws(() => mediaFile({ root: "/srv/site/content" }, "../secrets.txt"));
  });
});
