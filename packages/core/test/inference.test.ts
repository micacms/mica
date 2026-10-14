/**
 * The entry types that a model infers. The checks are types: `rush typecheck`
 * fails when one breaks. The runtime tests cover the model rules behind them.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  boolean,
  collection,
  defineSite,
  media,
  memorySource,
  number,
  object,
  readCollection,
  relation,
  repeater,
  singleton,
  slug,
  tags,
  text,
  defaultValues,
  type InferCollection,
  type InferSingleton,
} from "../dist/index.js";

/** Compiles only when `A` and `B` are the same type. */
type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
function expectType<T extends true>(): T | void {}

const projects = collection({
  label: "Projects",
  defaultSort: { field: "year", direction: "desc" },
  fields: {
    title: text({ required: true }),
    subtitle: text({ required: false }),
    slug: slug({ from: "title" }),
    year: number(),
    featured: boolean(),
    cover: media({ accept: "image", alt: "required" }),
    gallery: media({ multiple: true }),
    lead: relation({ collection: "team" }),
    meta: object({ fields: { note: text(), slugDe: slug() } }),
    steps: repeater({ fields: { label: text({ required: true }) } }),
    keywords: tags({ suggestions: ["web"] }),
  },
});

type Project = InferCollection<typeof projects>;

describe("inferred entry types", () => {
  it("are what the fields store", () => {
    expectType<Equal<Project["title"], string>>();
    expectType<Equal<Project["subtitle"], string | null>>();
    expectType<Equal<Project["slug"], string>>();
    expectType<Equal<Project["year"], number | null>>();
    expectType<Equal<Project["featured"], boolean>>();
    expectType<Equal<Project["cover"], { path: string; alt: string } | null>>();
    expectType<Equal<Project["gallery"], string[]>>();
    expectType<Equal<Project["lead"], string | null>>();
    expectType<Equal<Project["meta"], { note: string | null; slugDe: string | null } | null>>();
    expectType<Equal<Project["steps"], Array<{ label: string }>>>();
    expectType<Equal<Project["keywords"], string[]>>();
    assert.deepEqual(defaultValues(projects.fields)["keywords"], []);
    assert.ok(projects);
  });

  it("sort only by a field of the collection, or by position", () => {
    collection({ label: "A", defaultSort: { field: "position", direction: "asc" }, fields: { slug: slug() } });
    // @ts-expect-error -- "date" is not a field of this collection.
    collection({ label: "B", defaultSort: { field: "date", direction: "asc" }, fields: { slug: slug() } });
  });

  it("keep a slug outside a collection's own fields nullable", () => {
    const home = singleton({ label: "Home", fields: { slug: slug() } });
    expectType<Equal<InferSingleton<typeof home>["slug"], string | null>>();
    assert.ok(defineSite({ collections: {}, singletons: { home } }));
  });

  it("take an entry's URL from its file name, whatever the file holds", async () => {
    const site = defineSite({ collections: { team: collection({ label: "Team", fields: { name: text(), slug: slug() } }) } });
    const source = memorySource({
      "team/anna/index.json": JSON.stringify({ name: "Anna", slug: "anna-vogt" }),
      "team/ben/index.json": JSON.stringify({ name: "Ben", slug: null }),
    });
    const entries = await readCollection(source, site.collections.team, "team");
    assert.deepEqual(entries.map((entry) => entry.data["slug"]), ["anna", "ben"]);
  });
});
