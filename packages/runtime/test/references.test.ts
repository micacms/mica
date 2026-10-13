/** Publish refuses a change that would leave a broken link or a missing image on the site (#69). */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { collection, defineSite, media, memorySource, relation, repeater, slug, text, type ContentChange } from "@micacms/core";

import { analyseChanges } from "../src/services/changes.js";

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
