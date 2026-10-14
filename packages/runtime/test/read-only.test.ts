/** A model from a newer @micacms/astro: the parts with an unknown field kind are read, never written. */

import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";

import { readManifest } from "@micacms/core/internal";

import { createHarness, uploadPath, pngBytes, type TestHarness } from "./helpers.js";

const checkSchema = (raw: unknown) => readManifest(raw).site;

const site = checkSchema({
  protocolVersion: 1,
  generatedBy: "@micacms/astro",
  collections: {
    news: {
      type: "collection",
      label: "News",
      fields: { title: { kind: "text", required: true }, slug: { kind: "slug", from: "title" } },
    },
    gallery: {
      type: "collection",
      label: "Gallery",
      sortable: true,
      fields: { title: { kind: "text" }, slug: { kind: "slug", from: "title" }, photos: { kind: "photoGrid" } },
    },
  },
  singletons: {
    settings: { type: "singleton", label: "Settings", fields: { logo: { kind: "vector" } } },
  },
});

const json = (method: string, body: unknown): RequestInit => ({
  method,
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
});

describe("a field kind this build does not know", () => {
  let harness: TestHarness;

  before(async () => {
    harness = await createHarness({}, { site });
    mkdirSync(join(harness.contentRoot, "gallery/summer"), { recursive: true });
    writeFileSync(
      join(harness.contentRoot, "gallery/summer/index.json"),
      JSON.stringify({ title: "Summer", slug: "summer", photos: { grid: [1, 2] } }),
    );
  });

  after(() => harness.close());

  it("names the read-only parts in the schema, and leaves the rest editable", async () => {
    const body = (await (await harness.request("/api/admin/schema")).json()) as {
      collections: Array<{ name: string; readOnly: string | null }>;
      singletons: Array<{ name: string; readOnly: string | null }>;
    };
    const readOnly = Object.fromEntries(
      [...body.collections, ...body.singletons].map((part) => [part.name, part.readOnly]),
    );
    assert.equal(readOnly["news"], null);
    assert.match(readOnly["gallery"]!, /"photos" \(photoGrid\).*Upgrade Mica/);
    assert.match(readOnly["settings"]!, /"logo" \(vector\)/);
  });

  it("lists and opens the entries of a read-only collection, with the unknown value as it is", async () => {
    const list = (await (await harness.request("/api/admin/collections/gallery/entries")).json()) as {
      items: Array<{ slug: string }>;
    };
    assert.deepEqual(list.items.map((item) => item.slug), ["summer"]);

    const entry = (await (await harness.request("/api/admin/collections/gallery/entries/summer")).json()) as {
      data: Record<string, unknown>;
    };
    assert.deepEqual(entry.data["photos"], { grid: [1, 2] });
  });

  it("refuses every write to a read-only part with 409 and the reason", async () => {
    const writes: Array<[string, RequestInit]> = [
      ["/api/admin/collections/gallery/entries", json("POST", { data: { title: "Winter" } })],
      ["/api/admin/collections/gallery/entries/summer", json("PUT", { data: { title: "Summer" } })],
      ["/api/admin/collections/gallery/entries/summer?revision=x", { method: "DELETE" }],
      ["/api/admin/collections/gallery/reorder", json("POST", { slugs: ["summer"], revision: null })],
      ["/api/admin/singletons/settings", json("PUT", { data: {} })],
    ];
    for (const [path, init] of writes) {
      const response = await harness.request(path, init);
      assert.equal(response.status, 409, `${init.method} ${path}`);
      assert.match(((await response.json()) as { error: { message: string } }).error.message, /Upgrade Mica/);
    }
  });

  it("refuses an upload into a read-only collection's entry", async () => {
    const response = await harness.request(uploadPath("photo.png", { directory: "gallery/summer/media" }), { method: "POST", body: pngBytes() });
    assert.equal(response.status, 409);
  });

  it("still saves in the other collections", async () => {
    const response = await harness.request("/api/admin/collections/news/entries", json("POST", { data: { title: "Hello" } }));
    assert.equal(response.status, 201);
  });
});

describe("a collection whose new field kind keeps files beside the entry", () => {
  const folders = checkSchema({
    protocolVersion: 1,
    generatedBy: "@micacms/astro",
    collections: {
      albums: {
        type: "collection",
        label: "Albums",
        fields: { title: { kind: "text" }, slug: { kind: "slug", from: "title" }, pictures: { kind: "photoGrid" } },
      },
    },
    singletons: {},
  });
  let harness: TestHarness;

  before(async () => {
    harness = await createHarness({}, { site: folders });
    mkdirSync(join(harness.contentRoot, "albums/summer"), { recursive: true });
    writeFileSync(join(harness.contentRoot, "albums/summer/index.json"), JSON.stringify({ title: "Summer", slug: "summer" }));
  });

  after(() => harness.close());

  it("reads the entries from their folders", async () => {
    const list = (await (await harness.request("/api/admin/collections/albums/entries")).json()) as {
      items: Array<{ slug: string }>;
    };
    assert.deepEqual(list.items.map((item) => item.slug), ["summer"]);
  });

  it("refuses an upload with a leading slash into a read-only collection", async () => {
    const response = await harness.request(uploadPath("photo.png", { directory: "/albums/summer/media" }), { method: "POST", body: pngBytes() });
    assert.equal(response.status, 409);
  });
});
