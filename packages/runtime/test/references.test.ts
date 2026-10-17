/** Publish refuses a change that would leave a broken link or a missing image on the site (#69). */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { collection, defineSite, media, memorySource, relation, repeater, richText, singleton, slug, text, type ContentChange } from "@micacms/core/internal";

import { analyseChanges } from "../src/services/changes.js";
import { overlaySource } from "../src/workspace/tree.js";

const model = defineSite({
  collections: {
    team: collection({ label: "Team", labelSingular: "Person", fields: { name: text(), slug: slug({ from: "name" }) } }),
    news: collection({
      label: "News",
      labelSingular: "Article",
      fields: {
        title: text(),
        slug: slug({ from: "title" }),
        author: relation({ collection: "team" }),
        cover: media(),
        body: richText(),
        sections: repeater({ fields: { contact: relation({ collection: "team" }) } }),
      },
    }),
  },
});

const files = {
  "team/anna/index.json": JSON.stringify({ name: "Anna", slug: "anna" }),
  "news/hello/index.json": JSON.stringify({ title: "Hello", slug: "hello", author: "anna", cover: "/media/logo.png", sections: [] }),
  "media/logo.png": "png",
};

const update = (path: string): ContentChange => ({ path, kind: "update" });
const remove = (path: string): ContentChange => ({ path, kind: "delete" });

const messages = (result: Awaited<ReturnType<typeof analyseChanges>>) =>
  result.validation.problems.flatMap((problem) =>
    problem.issues.map((issue) => `${problem.label}: ${issue.path ? `${issue.path}: ` : ""}${issue.message}`),
  );

describe("references at Publish", () => {
  it("names the new pending files that a changed entry needs, so that they publish together", async () => {
    const source = memorySource({
      ...files,
      "team/ben/index.json": JSON.stringify({ name: "Ben", slug: "ben" }),
      "media/new.png": "png",
      "news/hello/index.json": JSON.stringify({ title: "Hello", slug: "hello", author: "ben", cover: "/media/new.png", sections: [{ contact: "anna" }] }),
    });
    const result = await analyseChanges(model, source, [
      update("news/hello/index.json"),
      { path: "team/ben/index.json", kind: "create" },
      { path: "media/new.png", kind: "create" },
    ]);
    const byPath = new Map(result.changes.map((change) => [change.path, change.needs]));
    assert.deepEqual(byPath.get("news/hello/index.json"), ["team/ben/index.json", "media/new.png"]);
    assert.equal(byPath.get("team/ben/index.json"), undefined);
  });

  it("brings a new file along that an image in rich text uses, and refuses a missing one", async () => {
    const source = memorySource({
      ...files,
      "media/team.jpg": "jpg",
      "news/hello/body.mdoc": "![The team](/media/team.jpg)\n\n![Gone](media/gone.jpg)\n",
    });
    const result = await analyseChanges(model, source, [update("news/hello/index.json"), { path: "media/team.jpg", kind: "create" }]);
    const byPath = new Map(result.changes.map((change) => [change.path, change.needs]));
    assert.deepEqual(byPath.get("news/hello/index.json"), ["media/team.jpg"]);
    assert.deepEqual(messages(result), ['Article: Hello: body: The image "media/gone.jpg" does not exist.']);
  });

  it("publishes a URL change together with the links that follow it, both ways", async () => {
    const { "team/anna/index.json": _old, ...rest } = files;
    const source = memorySource({
      ...rest,
      "team/anna-meier/index.json": JSON.stringify({ name: "Anna", slug: "anna-meier" }),
      "news/hello/index.json": JSON.stringify({ title: "Hello", slug: "hello", author: "anna-meier", cover: "/media/logo.png", sections: [] }),
    });
    const result = await analyseChanges(
      model,
      source,
      [remove("team/anna/index.json"), { path: "team/anna-meier/index.json", kind: "create" }, update("news/hello/index.json")],
      memorySource(files),
    );
    const byPath = new Map(result.changes.map((change) => [change.path, change.needs]));
    assert.deepEqual(byPath.get("news/hello/index.json"), ["team/anna-meier/index.json"]);
    assert.deepEqual(byPath.get("team/anna-meier/index.json"), ["news/hello/index.json"]);
  });

  it("does not hold a URL change back for a new draft that links to the new URL", async () => {
    const { "team/anna/index.json": _old, ...rest } = files;
    const source = memorySource({
      ...rest,
      "team/anna-meier/index.json": JSON.stringify({ name: "Anna", slug: "anna-meier" }),
      "news/draft/index.json": JSON.stringify({ title: "Draft", slug: "draft", author: "anna-meier", sections: [] }),
    });
    const result = await analyseChanges(
      model,
      source,
      [remove("team/anna/index.json"), { path: "team/anna-meier/index.json", kind: "create" }, { path: "news/draft/index.json", kind: "create" }],
      memorySource(files),
    );
    const byPath = new Map(result.changes.map((change) => [change.path, change.needs]));
    assert.deepEqual(byPath.get("news/draft/index.json"), ["team/anna-meier/index.json"]);
    assert.equal(byPath.get("team/anna-meier/index.json"), undefined);
  });

  it("accepts a changed entry whose links and files exist", async () => {
    const result = await analyseChanges(model, memorySource(files), [update("news/hello/index.json")]);
    assert.deepEqual(messages(result), []);
  });

  it("refuses a changed entry that links to a missing entry or file, nested fields included", async () => {
    const source = memorySource({
      ...files,
      "news/hello/index.json": JSON.stringify({
        title: "Hello",
        slug: "hello",
        author: "nobody",
        cover: "media/gone.jpg",
        sections: [{ contact: "carla" }],
      }),
    });
    const result = await analyseChanges(model, source, [update("news/hello/index.json")]);
    assert.equal(result.validation.ok, false);
    assert.deepEqual(messages(result), [
      'Article: Hello: author: Links to "nobody" in Team, which does not exist.',
      'Article: Hello: cover: The file "news/hello/media/gone.jpg" does not exist.',
      'Article: Hello: sections.0.contact: Links to "carla" in Team, which does not exist.',
    ]);
  });

  it("refuses to delete an entry that an unchanged entry still links to", async () => {
    const { "team/anna/index.json": _removed, ...rest } = files;
    const result = await analyseChanges(model, memorySource(rest), [remove("team/anna/index.json")]);
    assert.deepEqual(messages(result), [
      "Person: anna: Still linked from Article: Hello. Remove those links first, or publish them together.",
    ]);
  });

  it("refuses to delete a shared file that an entry still shows", async () => {
    const { "media/logo.png": _removed, ...rest } = files;
    const result = await analyseChanges(model, memorySource(rest), [remove("media/logo.png")]);
    assert.deepEqual(messages(result), [
      "media/logo.png: Still linked from Article: Hello. Remove those links first, or publish them together.",
    ]);
  });

  it("brings a new shared file along that a link in rich text names (#224)", async () => {
    const source = memorySource({
      ...files,
      "media/prices.pdf": "pdf",
      "news/hello/body.mdoc": "See the [price list](/media/prices.pdf) and [our team](/team).\n",
    });
    const result = await analyseChanges(model, source, [update("news/hello/index.json"), { path: "media/prices.pdf", kind: "create" }]);
    const byPath = new Map(result.changes.map((change) => [change.path, change.needs]));
    assert.deepEqual(byPath.get("news/hello/index.json"), ["media/prices.pdf"]);
    // A link to a page of the website is not a file that must exist.
    assert.deepEqual(messages(result), []);
  });

  it("refuses to delete a shared file that rich text still links to (#224)", async () => {
    const { "media/logo.png": _logo, ...rest } = files;
    const source = memorySource({
      ...rest,
      "news/hello/index.json": JSON.stringify({ title: "Hello", slug: "hello", author: "anna", sections: [] }),
      "news/hello/body.mdoc": "Download the [price list](../../media/prices.pdf).\n",
    });
    const result = await analyseChanges(model, source, [remove("media/prices.pdf")]);
    assert.deepEqual(messages(result), [
      "media/prices.pdf: Still linked from Article: Hello. Remove those links first, or publish them together.",
    ]);
  });

  it("refuses to delete an entry whose media another entry still shows (#224)", async () => {
    const source = memorySource({
      "team/anna/index.json": JSON.stringify({ name: "Anna", slug: "anna" }),
      "news/hello/index.json": JSON.stringify({ title: "Hello", slug: "hello", cover: "/team/gone/media/photo.jpg", sections: [] }),
    });
    const result = await analyseChanges(model, source, [remove("team/gone/index.json"), remove("team/gone/media/photo.jpg")]);
    assert.deepEqual(messages(result), [
      "team/gone/media/photo.jpg: Still linked from Article: Hello. Remove those links first, or publish them together.",
    ]);
  });

  it("accepts a deletion that nothing links to", async () => {
    // Bob is gone from the staged files; nothing links to him.
    const result = await analyseChanges(model, memorySource(files), [remove("team/bob/index.json")]);
    assert.deepEqual(messages(result), []);
  });
});

describe("references in a selection", () => {
  it("checks what the commit holds, not the drafts that stay behind", async () => {
    // Bob is a new draft; the article links to him, but only the article is selected.
    const head = memorySource(files);
    const tree = memorySource({
      ...files,
      "team/bob/index.json": JSON.stringify({ name: "Bob", slug: "bob" }),
      "news/hello/index.json": JSON.stringify({ title: "Hello", slug: "hello", author: "bob", sections: [] }),
    });
    const selected = ["news/hello/index.json"];
    const result = await analyseChanges(model, overlaySource(head, tree, selected), [update(selected[0]!)]);
    assert.deepEqual(messages(result), ['Article: Hello: author: Links to "bob" in Team, which does not exist.']);

    const both = ["news/hello/index.json", "team/bob/index.json"];
    const together = await analyseChanges(model, overlaySource(head, tree, both), [update(both[0]!), { path: both[1]!, kind: "create" }]);
    assert.deepEqual(messages(together), []);
  });

  it("refuses a URL change while other entries link to the old URL", async () => {
    const published = memorySource(files);
    const { "team/anna/index.json": _old, ...rest } = files;
    const staged = memorySource({ ...rest, "team/anna-vogt/index.json": JSON.stringify({ name: "Anna", slug: "anna-vogt" }) });
    const result = await analyseChanges(
      model,
      staged,
      [remove("team/anna/index.json"), { path: "team/anna-vogt/index.json", kind: "create" }],
      published,
    );
    assert.deepEqual(messages(result), [
      'Person: anna: The URL changes from "anna" to "anna-vogt", and Article: Hello still link to "anna". Change those links first, or publish them together.',
    ]);
  });
});

describe("overlaySource", () => {
  it("reads and lists the selected paths from the top, everything else from the base", async () => {
    const base = memorySource({ "team/a.json": "a", "team/b.json": "b", "media/x.png": "x" });
    const top = memorySource({ "team/b.json": "B", "team/c.json": "c", "news/new/index.json": "{}" });
    const overlay = overlaySource(base, top, ["team/a.json", "team/c.json", "news/new/index.json"]);

    assert.equal(await overlay.read("team/a.json"), null);
    assert.equal(await overlay.read("team/b.json"), "b");
    assert.equal(await overlay.read("team/c.json"), "c");
    assert.deepEqual((await overlay.list("team")).map((item) => item.name).sort(), ["b.json", "c.json"]);
    assert.deepEqual(await overlay.list("news"), [{ name: "new", type: "directory" }]);
  });
});

describe("a settings page in a folder", () => {
  it("is tied to the URL change that its links follow, by its data file", async () => {
    const site = defineSite({
      collections: model.collections,
      singletons: { about: singleton({ label: "About", fields: { intro: richText(), owner: relation({ collection: "team" }) } }) },
    });
    const published = memorySource({ ...files, "about/index.json": JSON.stringify({ owner: "anna" }) });
    const { "team/anna/index.json": _old, ...rest } = files;
    const source = memorySource({
      ...rest,
      "team/anna-meier/index.json": JSON.stringify({ name: "Anna", slug: "anna-meier" }),
      "about/index.json": JSON.stringify({ owner: "anna-meier" }),
    });
    const result = await analyseChanges(
      site,
      source,
      [remove("team/anna/index.json"), { path: "team/anna-meier/index.json", kind: "create" }, update("about/index.json")],
      published,
    );
    const byPath = new Map(result.changes.map((change) => [change.path, change.needs]));
    assert.deepEqual(byPath.get("about/index.json"), ["team/anna-meier/index.json"]);
    assert.deepEqual(byPath.get("team/anna-meier/index.json"), ["about/index.json"]);
  });
});
