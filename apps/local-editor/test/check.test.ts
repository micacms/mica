/** `mica check` on real files: what Mica would skip, refuse or render as a gap must be reported. */

import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";

import {
  collection,
  createManifest,
  defineSite,
  media,
  MANIFEST_PATH,
  relation,
  repeater,
  richText,
  singleton,
  slug,
  text,
} from "@micacms/core";

import { checkContent, formatReport, markdocWarnings, type CheckReport } from "../src/check.js";

const site = defineSite({
  root: "./content",
  collections: {
    team: collection({
      label: "Team",
      fields: { name: text({ required: true }), slug: slug({ from: "name" }) },
    }),
    news: collection({
      label: "News",
      fields: {
        title: text({ required: true }),
        slug: slug({ from: "title" }),
        author: relation({ collection: "team" }),
        cover: media({ accept: "image" }),
        body: richText(),
        sections: repeater({ fields: { heading: text(), text: richText() } }),
      },
    }),
  },
  singletons: {
    settings: singleton({ label: "Website", fields: { siteName: text({ required: true }) } }),
  },
});

let root = "";

const write = (file: string, contents: string | object) => {
  const target = path.join(root, file);
  mkdirSync(path.dirname(target), { recursive: true });
  writeFileSync(target, typeof contents === "string" ? contents : JSON.stringify(contents));
};

const problems = (report: CheckReport, level: "error" | "warning") =>
  report.problems.filter((problem) => problem.level === level).map((problem) => `${problem.path}: ${problem.message}`);

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), "mica-check-"));
  write(MANIFEST_PATH, createManifest(site, "test"));
  write("team/anna/index.json", { name: "Anna", slug: "anna" });
  write("news/hello/index.json", { title: "Hello", slug: "hello", author: "anna", cover: "media/cover.jpg" });
  write("news/hello/media/cover.jpg", "jpeg");
  write("news/hello/body.mdoc", "Hello, **world**.\n");
  write("settings/index.json", { siteName: "Example" });
});

afterEach(() => rmSync(root, { recursive: true, force: true }));

describe("mica check", () => {
  it("passes valid content and counts it", async () => {
    const report = await checkContent(root);
    assert.deepEqual(report.problems, []);
    assert.equal(report.entries, 2);
    assert.equal(report.collections, 2);
    assert.equal(report.singletons, 1);
    assert.match(formatReport(report, root), /0 errors, 0 warnings\./);
  });

  it("reports a missing content model, and names the command that writes it", async () => {
    rmSync(path.join(root, MANIFEST_PATH));
    const report = await checkContent(root);
    assert.equal(report.model, false);
    assert.deepEqual(problems(report, "error"), [`${MANIFEST_PATH}: There is no content model. Run \`npx astro sync\` in the Astro project to write it.`]);
    assert.match(formatReport(report, root), /^Could not read the content model/);
  });

  it("reports invalid fields, missing media and dangling relations", async () => {
    write("news/hello/index.json", { slug: "hello", author: "nobody", cover: "media/gone.jpg" });
    const errors = problems(await checkContent(root), "error");
    assert.ok(errors.some((line) => line.startsWith("news/hello/index.json: title")), errors.join("\n"));
    assert.ok(errors.some((line) => line.includes('there is no "nobody" in "team"')), errors.join("\n"));
    assert.ok(errors.some((line) => line.includes('"news/hello/media/gone.jpg" does not exist')), errors.join("\n"));
  });

  it("reports an image in rich text whose file is missing, and accepts one from the shared folder or the web", async () => {
    write("media/logo.png", "png");
    write(
      "news/hello/body.mdoc",
      "![Cover](media/cover.jpg)\n\n![Logo](/media/logo.png)\n\n![Web](//cdn.example.com/a.png)\n\n![Gone](media/gone.jpg)\n\n" +
        "![Public](/photo.jpg)\n\n![Up](../../../up.jpg)\n\n`![Code](media/code.jpg)`\n",
    );
    const report = await checkContent(root);
    assert.deepEqual(problems(report, "error"), [
      'news/hello/body.mdoc: The image "media/gone.jpg" does not exist under the content root.',
      'news/hello/body.mdoc: The image "../../../up.jpg" is outside the content root.',
    ]);
    assert.ok(problems(report, "warning").some((line) => line.includes('"/photo.jpg" is not under the content root')));
  });

  it("checks the file and the alt text of a media field with alt", async () => {
    const withAlt = defineSite({
      collections: {
        news: collection({
          label: "News",
          fields: { title: text(), slug: slug({ from: "title" }), cover: media({ alt: "required" }) },
        }),
      },
    });
    write(MANIFEST_PATH, createManifest(withAlt, "test"));
    rmSync(path.join(root, "team"), { recursive: true });
    rmSync(path.join(root, "settings"), { recursive: true });
    rmSync(path.join(root, "news/hello/body.mdoc"));
    write("news/hello/index.json", { title: "Hello", slug: "hello", cover: { path: "media/cover.jpg", alt: "A cover" } });
    assert.deepEqual((await checkContent(root)).problems, []);

    write("news/hello/index.json", { title: "Hello", slug: "hello", cover: { path: "media/gone.jpg", alt: null } });
    const errors = problems(await checkContent(root), "error");
    assert.ok(errors.some((line) => line.includes("cover.alt: cover needs alt text.")), errors.join("\n"));
    assert.ok(errors.some((line) => line.includes('"news/hello/media/gone.jpg" does not exist')), errors.join("\n"));
  });

  it("warns about a slug field that does not match the entry's name, and accepts an empty one", async () => {
    write("team/anna/index.json", { name: "Anna", slug: "anna-vogt" });
    assert.ok(problems(await checkContent(root), "warning").some((line) => line.includes('"anna-vogt", but the entry is named "anna"')));
    write("team/anna/index.json", { name: "Anna", slug: null });
    assert.deepEqual((await checkContent(root)).problems, []);
  });

  it("warns about a file where an entry folder belongs", async () => {
    write("news/notes.json", { title: "Notes" });
    assert.deepEqual(problems(await checkContent(root), "warning"), ['news/notes.json: Not read. Each entry of "news" is a folder with index.json.']);
  });

  it("reports an order file the build cannot read", async () => {
    write("news/_order.json", "{}");
    assert.ok(problems(await checkContent(root), "error").some((line) => line.startsWith("news/_order.json: Must be a JSON array")));
    write("news/_order.json", ["hello"]);
    assert.deepEqual((await checkContent(root)).problems, []);
  });

  it("reports a directory where a file belongs instead of failing", async () => {
    mkdirSync(path.join(root, "news/broken/index.json"), { recursive: true });
    const report = await checkContent(root);
    assert.ok(problems(report, "error").some((line) => line.startsWith("news/broken: Not read")));
  });

  // A conversion from Markdown collections gets these wrong, and Mica skips them without a word.
  it("reports files that Mica would not read as entries", async () => {
    write("team/bob.md", "---\nname: Bob\n---\n");
    write("news/Bad_Name/index.json", { title: "Bad", slug: "Bad_Name" });
    write("news/empty/body.mdoc", "No index.\n");
    const report = await checkContent(root);
    assert.ok(problems(report, "warning").some((line) => line.startsWith("team/bob.md: Not read")));
    assert.ok(problems(report, "error").some((line) => line.startsWith("news/Bad_Name: Not read")));
    assert.ok(problems(report, "error").some((line) => line.startsWith("news/empty: Not read: the folder has no index.json")));
  });

  it("warns about fields the model does not have and rich text in the JSON", async () => {
    write("news/hello/index.json", {
      title: "Hello",
      slug: "hello",
      tags: ["a"],
      body: "Text in the wrong place.",
      sections: [{ heading: "One", extra: true }],
    });
    const warnings = problems(await checkContent(root), "warning");
    assert.ok(warnings.some((line) => line.includes("tags: the model has no such field")), warnings.join("\n"));
    assert.ok(warnings.some((line) => line.includes("body: rich text belongs in body.mdoc")), warnings.join("\n"));
    assert.ok(warnings.some((line) => line.includes("sections.0.extra: the model has no such field")), warnings.join("\n"));
  });

  it("warns about a Markdoc file that no rich-text field reads, and accepts a nested one", async () => {
    write("news/hello/index.json", { title: "Hello", slug: "hello", sections: [{ _key: "kone", heading: "One" }] });
    write("news/hello/content.mdoc", "Wrong name.\n");
    write("news/hello/sections.kone.text.mdoc", "Nested.\n");
    const warnings = problems(await checkContent(root), "warning");
    assert.deepEqual(warnings, ["news/hello/content.mdoc: Not read: no rich-text field has this name."]);
  });

  it("warns about a Markdoc file whose row key no row has (#220)", async () => {
    write("news/hello/index.json", { title: "Hello", slug: "hello", sections: [{ _key: "kone", heading: "One" }] });
    write("news/hello/sections.kgone.text.mdoc", "Orphan.\n");
    const warnings = problems(await checkContent(root), "warning");
    assert.deepEqual(warnings, ["news/hello/sections.kgone.text.mdoc: Not read: the list has no such row. The next save in Mica deletes the file."]);
  });

  it("reports JSON that does not parse, and an empty singleton", async () => {
    write("team/anna/index.json", "{ name: Anna");
    rmSync(path.join(root, "settings"), { recursive: true });
    rmSync(path.join(root, "news/hello/body.mdoc"));
    const report = await checkContent(root);
    assert.ok(problems(report, "error").some((line) => line.startsWith("team/anna/index.json: Content is not valid JSON")));
    assert.ok(problems(report, "warning").some((line) => line.startsWith('settings/index.json: No content for "Website" yet.')));
  });

  it("warns about what Markdoc renders differently, outside code only", async () => {
    write("news/hello/body.mdoc", "A <mark>word</mark>, a footnote[^1] and {% callout %}x{% /callout %}.\n\n`<b>` and <https://example.com>\n\n```html\n<div>code</div>\n```\n");
    const warnings = problems(await checkContent(root), "warning");
    assert.deepEqual(warnings, [
      "news/hello/body.mdoc: Raw HTML (<mark>) is not rendered: Markdoc escapes it.",
      "news/hello/body.mdoc: Markdoc tags (callout) render only if the website declares them in renderRichText(source, { config }).",
      "news/hello/body.mdoc: Footnotes ([^1]) are not Markdoc: they render as plain text.",
    ]);
    assert.deepEqual(markdocWarnings("Plain **Markdown** with a [link](https://example.com).\n"), []);
    assert.deepEqual(markdocWarnings("````md\n```html\n<div>inner</div>\n```\n<p>still code</p>\n````\n"), []);
  });

  it("reports a field kind from a newer @micacms/astro, and checks the rest", async () => {
    const manifest = createManifest(site, "test") as unknown as { collections: Record<string, { fields: Record<string, unknown> }> };
    manifest.collections["team"]!.fields["badge"] = { kind: "hologram" };
    write(MANIFEST_PATH, manifest);
    write("news/hello/index.json", { slug: "hello" });

    const errors = problems(await checkContent(root), "error");
    assert.ok(errors.some((line) => line.startsWith(`${MANIFEST_PATH}: Not checked. "Team" uses "badge" (hologram)`)), errors.join("\n"));
    assert.ok(errors.some((line) => line.startsWith("news/hello/index.json: title")), errors.join("\n"));
  });
});
