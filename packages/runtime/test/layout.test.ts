/** Entries in the other layout stop the start, and a list that meets one says why (#64). */

import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";

import { memorySource } from "@micacms/core";

import { checkSchema, layoutProblems } from "../src/schema.js";
import { createHarness, type TestHarness } from "./helpers.js";

const site = checkSchema({
  protocolVersion: 1,
  generatedBy: "@micacms/astro",
  collections: {
    team: {
      type: "collection",
      label: "Team",
      fields: { name: { kind: "text" }, slug: { kind: "slug", from: "name" }, portrait: { kind: "media" } },
    },
  },
  singletons: {
    settings: { type: "singleton", label: "Settings", fields: { title: { kind: "text" } } },
  },
});

describe("layoutProblems", () => {
  it("names each collection and singleton with files in the other layout", async () => {
    const source = memorySource({
      "team/anna.json": "{}",
      "team/bob/index.json": "{}",
      "settings/index.json": "{}",
    });
    const problems = await layoutProblems(source, site);
    assert.equal(problems.length, 2);
    assert.match(problems[0]!, /"team" is stored as folders.*team\/anna\.json/);
    assert.match(problems[1]!, /"settings" is stored as \.json files.*settings\/index\.json/);
  });

  it("finds nothing when every file is where the model says", async () => {
    assert.deepEqual(await layoutProblems(memorySource({ "team/bob/index.json": "{}", "settings.json": "{}" }), site), []);
  });
});

describe("a list that meets an entry in the other layout", () => {
  let harness: TestHarness;

  before(async () => {
    harness = await createHarness({}, { site });
    mkdirSync(join(harness.contentRoot, "team"), { recursive: true });
    writeFileSync(join(harness.contentRoot, "team/anna.json"), JSON.stringify({ name: "Anna", slug: "anna" }));
  });

  after(() => harness.close());

  it("answers 409 with the files and the command that moves them", async () => {
    const response = await harness.request("/api/admin/collections/team/entries");
    assert.equal(response.status, 409);
    const body = (await response.json()) as { error: { message: string } };
    assert.match(body.error.message, /team\/anna\.json.*npx mica migrate-layout/);
  });
});
