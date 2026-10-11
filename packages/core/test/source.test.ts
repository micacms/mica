/**
 * The two content sources.
 *
 * `memorySource` stands in for a real directory in every other test, so the
 * pair are exercised against the same expectations here. A divergence between
 * them would make the rest of the suite prove less than it appears to.
 */

import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, before, describe, it } from "node:test";

import { contentPath, ContentPathError, ContentSourceError, memorySource, type ContentSource } from "../dist/index.js";
import { fileSystemSource, within } from "../dist/node.js";

const fixture: Record<string, string> = {
  "projects/haus-a/index.json": '{ "title": "Haus A" }',
  "projects/haus-a/description.mdoc": "Text.\n",
  "projects/haus-b/index.json": '{ "title": "Haus B" }',
  "theme.json": '{ "primaryColor": "#123456" }',
};

/** The same expectations, run against whichever source the caller supplies. */
function behavesLikeAContentSource(name: string, get: () => ContentSource) {
  describe(name, () => {
    it("reads a file", async () => {
      assert.equal(await get().read("theme.json"), '{ "primaryColor": "#123456" }');
    });

    it("returns null for a file that is not there", async () => {
      assert.equal(await get().read("missing.json"), null);
    });

    it("returns null rather than failing when a parent is a file", async () => {
      assert.equal(await get().read("theme.json/index.json"), null);
    });

    it("lists directories and files apart", async () => {
      assert.deepEqual(await get().list("projects"), [
        { name: "haus-a", type: "directory" },
        { name: "haus-b", type: "directory" },
      ]);
    });

    it("lists the files inside an entry", async () => {
      assert.deepEqual(await get().list("projects/haus-a"), [
        { name: "description.mdoc", type: "file" },
        { name: "index.json", type: "file" },
      ]);
    });

    it("returns an empty list for a directory that is not there", async () => {
      assert.deepEqual(await get().list("news"), []);
    });

    it("sorts, so a build never depends on directory order", async () => {
      const names = (await get().list("projects")).map((item) => item.name);
      assert.deepEqual(names, [...names].sort());
    });
  });
}

behavesLikeAContentSource("memorySource", () => memorySource(fixture));

describe("fileSystemSource", () => {
  let root = "";

  before(async () => {
    root = await mkdtemp(join(tmpdir(), "mica-source-"));
    for (const [path, contents] of Object.entries(fixture)) {
      await mkdir(dirname(join(root, path)), { recursive: true });
      await writeFile(join(root, path), contents, "utf8");
    }
  });

  after(async () => {
    if (root) await rm(root, { recursive: true, force: true });
  });

  behavesLikeAContentSource("against a real directory", () => fileSystemSource(root));

  it("reports its origin, so a failed build can name the directory", () => {
    assert.equal(fileSystemSource(root).origin, root);
  });

  it("refuses a path that escapes the content root", async () => {
    await assert.rejects(() => fileSystemSource(root).read("../secrets.json"), ContentSourceError);
    await assert.rejects(() => fileSystemSource(root).list("../.."), ContentSourceError);
  });

  it("refuses an absolute path", async () => {
    await assert.rejects(() => fileSystemSource(root).read("/etc/passwd"), ContentSourceError);
  });

  it("does not mistake a sibling directory for the root", async () => {
    // `resolve(base + "/../content-old")` shares the string prefix of a root
    // called `content`, which a naive `startsWith` check would accept.
    await assert.rejects(
      () => fileSystemSource(join(root, "content")).read("../content-old/theme.json"),
      ContentSourceError,
    );
  });
});

describe("contentPath", () => {
  it("keeps a normal path, and drops a leading or trailing slash", () => {
    assert.equal(contentPath("projects/haus-a/index.json"), "projects/haus-a/index.json");
    assert.equal(contentPath("/media/photo.jpg"), "media/photo.jpg");
    assert.equal(contentPath("projects/"), "projects");
    assert.equal(contentPath("Häuser/Ü 1.json"), "Häuser/Ü 1.json");
  });

  it("refuses every form that could leave the content root", () => {
    for (const path of ["..", "../x", "a/../../x", "a/./b", "a//b", "a\\b", "..\\x", "a/\u0000b", "a\nb", "C:/x", "c:"]) {
      assert.throws(() => contentPath(path), ContentPathError, path);
    }
  });

  it("names the root only where it is allowed", () => {
    assert.throws(() => contentPath(""), ContentPathError);
    assert.throws(() => contentPath("/"), ContentPathError);
    assert.equal(contentPath("", { allowRoot: true }), "");
    assert.equal(contentPath("/", { allowRoot: true }), "");
  });

  it("is a ContentSourceError, so existing handlers still catch it", () => {
    assert.throws(() => contentPath(".."), ContentSourceError);
  });
});

describe("within", () => {
  it("refuses the root itself unless asked, however the path names it", () => {
    const base = "/srv/content";
    for (const path of ["", "x/..", "a/b/../.."]) {
      assert.throws(() => within(base, path), ContentPathError, path);
    }
    assert.equal(within(base, "", { allowRoot: true }), base);
    assert.equal(within(base, "theme.json"), "/srv/content/theme.json");
  });
});
