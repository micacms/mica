/** A model change that switches the layout must not hide the stored entries (#64). */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  collection,
  defineSite,
  LayoutError,
  media,
  memorySource,
  misplacedFiles,
  readCollection,
  readSingleton,
  singleton,
  slug,
  text,
} from "../dist/index.js";

const flat = { name: text(), slug: slug({ from: "name" }) };
const folders = { ...flat, portrait: media() };

const site = (fields: typeof flat | typeof folders) =>
  defineSite({
    collections: { team: collection({ label: "Team", fields }) },
    singletons: { settings: singleton({ label: "Settings", fields: fields === flat ? { title: text() } : { logo: media() } }) },
  });

describe("an entry in the other layout", () => {
  it("is an error when a media field turned files into folders", async () => {
    const source = memorySource({
      "team/anna.json": JSON.stringify({ name: "Anna", slug: "anna" }),
      "team/bob/index.json": JSON.stringify({ name: "Bob", slug: "bob" }),
      "team/_order.json": JSON.stringify(["bob", "anna"]),
    });
    const team = site(folders).collections["team"]!;

    await assert.rejects(readCollection(source, team, "team"), (error: unknown) => {
      assert.ok(error instanceof LayoutError);
      assert.deepEqual(error.paths, ["team/anna.json"]);
      assert.match(error.message, /"team" is stored as folders with index\.json.*team\/anna\.json.*npx mica migrate-layout/);
      return true;
    });
    assert.deepEqual(await misplacedFiles(source, team.fields, "team", "collection"), ["team/anna.json"]);
  });

  it("is an error when the last media field went and folders became files", async () => {
    const source = memorySource({
      "team/anna/index.json": JSON.stringify({ name: "Anna", slug: "anna" }),
      "team/notes/README.md": "not an entry",
    });
    const team = site(flat).collections["team"]!;

    await assert.rejects(readCollection(source, team, "team"), LayoutError);
    assert.deepEqual(await misplacedFiles(source, team.fields, "team", "collection"), ["team/anna/index.json"]);
  });

  it("is an error for a singleton that exists only in the other layout", async () => {
    const source = memorySource({ "settings.json": JSON.stringify({ logo: null }) });
    const settings = site(folders).singletons["settings"]!;

    await assert.rejects(readSingleton(source, settings, "settings"), LayoutError);
    assert.equal(await readSingleton(memorySource({}), settings, "settings"), null);
  });
});
