/** Which `.gitattributes` give files under the content root to Git LFS, and what a pointer looks like. */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { isLfsPointer } from "../src/lib/file-type.js";
import { assignsLfsUnder, attributesPlace } from "../src/workspace/lfs.js";

const POINTER =
  "version https://git-lfs.github.com/spec/v1\n" +
  "oid sha256:4d7a214614ab2935c943f9e0ff69d22eadbb8f32b1258daaa5e2ca24d17e2393\n" +
  "size 12345\n";

const bytes = (text: string) => new TextEncoder().encode(text);

describe("an LFS pointer", () => {
  it("is recognized from its first line", () => {
    assert.equal(isLfsPointer(bytes(POINTER)), true);
  });

  it("is not a file that only mentions LFS, or a real image", () => {
    assert.equal(isLfsPointer(bytes(`# Notes\n${POINTER}`)), false);
    assert.equal(isLfsPointer(bytes("version https://git-lfs.github.com/spec/v2\n")), false);
    assert.equal(isLfsPointer(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0])), false);
    assert.equal(isLfsPointer(new Uint8Array()), false);
  });
});

describe("attributes that assign LFS under the content root", () => {
  it("places a .gitattributes file below, above or beside the root", () => {
    assert.equal(attributesPlace("content/media/.gitattributes", "content"), "below");
    assert.equal(attributesPlace(".gitattributes", "site/content"), "above");
    assert.equal(attributesPlace("site/.gitattributes", "site/content"), "above");
    assert.equal(attributesPlace("public/.gitattributes", "content"), null);
    assert.equal(attributesPlace("content/index.json", "content"), null);
  });

  it("counts any LFS line in a file below the root", () => {
    assert.equal(assignsLfsUnder("content/.gitattributes", "*.jpg filter=lfs diff=lfs merge=lfs -text\n", "content"), true);
    assert.equal(assignsLfsUnder("content/.gitattributes", "# *.jpg filter=lfs\n*.json text\n", "content"), false);
  });

  it("counts a pattern above the root only when it can match under it", () => {
    assert.equal(assignsLfsUnder(".gitattributes", "*.jpg filter=lfs\n", "content"), true);
    assert.equal(assignsLfsUnder(".gitattributes", "content/**/*.jpg filter=lfs\n", "content"), true);
    assert.equal(assignsLfsUnder(".gitattributes", "/**/*.jpg filter=lfs\n", "content"), true);
    assert.equal(assignsLfsUnder(".gitattributes", "/public/**/*.jpg filter=lfs\n", "content"), false);
  });

  it("ignores a file beside the root", () => {
    assert.equal(assignsLfsUnder("public/.gitattributes", "*.jpg filter=lfs\n", "content"), false);
  });
});
