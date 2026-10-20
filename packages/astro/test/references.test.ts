/** The index of a reference set (#280): read from the website's file, written beside the model, checked in CI. */

import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";

import { referenceSet } from "@micacms/core";
import { parseReferenceIndex, referenceIndexPath } from "@micacms/core/internal";

import { parseCsv, publishReferences, readReferenceItems } from "../src/references.js";

const set = (file: string, keys: { id?: string; title?: string } = {}) => ({ ...referenceSet({ label: "Places", file, ...keys }), name: "places" });

describe("parseCsv", () => {
  it("reads a header row, quotes, a semicolon, a BOM and CRLF", () => {
    assert.deepEqual(parseCsv('﻿slug,name\r\ntoedi,"Tödi, Glarus"\r\n"piz-""x""",Piz\r\n'), [
      { slug: "toedi", name: "Tödi, Glarus" },
      { slug: 'piz-"x"', name: "Piz" },
    ]);
    assert.deepEqual(parseCsv("slug;name\neiger;Eiger\n\n"), [{ slug: "eiger", name: "Eiger" }]);
  });
});

describe("readReferenceItems", () => {
  it("reads a JSON list, a JSON object by id and a CSV file, with the keys of the set", async () => {
    const dir = await mkdtemp(join(tmpdir(), "mica-references-"));
    try {
      await writeFile(join(dir, "list.json"), JSON.stringify([{ id: "a", title: "A" }, { id: 7 }]));
      await writeFile(join(dir, "map.json"), JSON.stringify({ toedi: { name: "Tödi" } }));
      await writeFile(join(dir, "peaks.csv"), "slug,name\neiger,Eiger\n");
      assert.deepEqual(await readReferenceItems(set("list.json"), dir), [{ id: "a", title: "A" }, { id: "7", title: "7" }]);
      assert.deepEqual(await readReferenceItems(set("map.json", { title: "name" }), dir), [{ id: "toedi", title: "Tödi" }]);
      assert.deepEqual(await readReferenceItems(set("peaks.csv", { id: "slug", title: "name" }), dir), [{ id: "eiger", title: "Eiger" }]);

      await writeFile(join(dir, "twice.json"), JSON.stringify([{ id: "a" }, { id: "a" }]));
      await assert.rejects(readReferenceItems(set("twice.json"), dir), /"a" is there twice/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("publishReferences", () => {
  it("writes the index, and in CI fails when the committed one differs", async () => {
    const dir = await mkdtemp(join(tmpdir(), "mica-references-"));
    const logs: string[] = [];
    const logger = { info: (message: string) => logs.push(message), warn: (message: string) => logs.push(message) };
    try {
      await writeFile(join(dir, "places.json"), JSON.stringify([{ id: "toedi", title: "Tödi" }]));
      const references = { places: set("places.json") };
      const content = join(dir, "content");

      await assert.rejects(publishReferences(references, content, dir, true, logger), /is not the one of places\.json/);
      await publishReferences(references, content, dir, false, logger);
      assert.deepEqual(parseReferenceIndex(await readFile(join(content, referenceIndexPath("places")), "utf8")), [{ id: "toedi", title: "Tödi" }]);
      await publishReferences(references, content, dir, true, logger);
      assert.equal(logs.length, 1, "written once, then left alone");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("warns, and goes on, when the content root cannot be written, as in a self-hosted preview", async () => {
    const dir = await mkdtemp(join(tmpdir(), "mica-references-"));
    const warnings: string[] = [];
    const logger = { info: () => {}, warn: (message: string) => warnings.push(message) };
    try {
      await writeFile(join(dir, "places.json"), JSON.stringify([{ id: "toedi", title: "Tödi" }]));
      // A file where the folder should be: no write can succeed, also for root.
      await writeFile(join(dir, "content"), "");
      await publishReferences({ places: set("places.json") }, join(dir, "content"), dir, false, logger);
      assert.match(warnings[0] ?? "", /Could not write the index of "Places"/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("indexes 10,000 items in well under a second", async () => {
    const dir = await mkdtemp(join(tmpdir(), "mica-references-"));
    try {
      const rows = Array.from({ length: 10_000 }, (_, index) => `peak-${index},Peak ${index}`);
      await writeFile(join(dir, "peaks.csv"), `slug,name\n${rows.join("\n")}\n`);
      const started = performance.now();
      const items = await readReferenceItems(set("peaks.csv", { id: "slug", title: "name" }), dir);
      assert.equal(items.length, 10_000);
      assert.ok(performance.now() - started < 1000);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
