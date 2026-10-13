/** Publish refuses a change that would leave a broken link or a missing image on the site (#69). */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { collection, defineSite, media, memorySource, relation, repeater, slug, text, type ContentChange } from "@micacms/core";

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
        sections: repeater({ fields: { contact: relation({ collection: "team" }) } }),
      },
    }),
  },
});

const files = {
  "team/anna.json": JSON.stringify({ name: "Anna", slug: "anna" }),
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
    const { "team/anna.json": _removed, ...rest } = files;
    const result = await analyseChanges(model, memorySource(rest), [remove("team/anna.json")]);
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

  it("accepts a deletion that nothing links to", async () => {
    // Bob is gone from the staged files; nothing links to him.
    const result = await analyseChanges(model, memorySource(files), [remove("team/bob.json")]);
    assert.deepEqual(messages(result), []);
  });
});

describe("references in a selection", () => {
  it("checks what the commit holds, not the drafts that stay behind", async () => {
    // Bob is a new draft; the article links to him, but only the article is selected.
    const head = memorySource(files);
    const tree = memorySource({
      ...files,
      "team/bob.json": JSON.stringify({ name: "Bob", slug: "bob" }),
      "news/hello/index.json": JSON.stringify({ title: "Hello", slug: "hello", author: "bob", sections: [] }),
    });
    const selected = ["news/hello/index.json"];
    const result = await analyseChanges(model, overlaySource(head, tree, selected), [update(selected[0]!)]);
    assert.deepEqual(messages(result), ['Article: Hello: author: Links to "bob" in Team, which does not exist.']);

    const both = ["news/hello/index.json", "team/bob.json"];
    const together = await analyseChanges(model, overlaySource(head, tree, both), [update(both[0]!), { path: both[1]!, kind: "create" }]);
    assert.deepEqual(messages(together), []);
  });

  it("refuses a URL change while other entries link to the old URL", async () => {
    const published = memorySource(files);
    const { "team/anna.json": _old, ...rest } = files;
    const staged = memorySource({ ...rest, "team/anna-vogt.json": JSON.stringify({ name: "Anna", slug: "anna-vogt" }) });
    const result = await analyseChanges(
      model,
      staged,
      [remove("team/anna.json"), { path: "team/anna-vogt.json", kind: "create" }],
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
