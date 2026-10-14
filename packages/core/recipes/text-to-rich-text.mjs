// Moves a text value out of index.json into the field's .mdoc file, after text() became richText().
// Change the model and run `npx astro sync` first. node text-to-rich-text.mjs <content root> <collection> <key>
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { collectionSlugs, documentName, entryFolder, INDEX_FILE, MANIFEST_PATH } from "@micacms/core";
import { fileSystemSource } from "@micacms/core/node";

const [root, collection, key] = process.argv.slice(2);
const manifest = JSON.parse(await readFile(join(root, MANIFEST_PATH), "utf8"));
const def = manifest.collections[collection];
if (!def) throw new Error(`The model has no collection "${collection}".`);

// Markdoc reads these characters as markup, and a list or a rule at the start of a line; a backslash keeps them as text.
const escape = (line) =>
  line
    .replace(/[\\`*_{}[\]<>#|~]/g, "\\$&")
    .replace(/^([-+])/, "\\$1")
    .replace(/^(\d+)([.)])/, "$1\\$2");

for (const slug of await collectionSlugs(fileSystemSource(root), collection)) {
  const base = join(root, entryFolder(collection, slug));
  const file = join(base, INDEX_FILE);
  const data = JSON.parse(await readFile(file, "utf8"));
  const value = data[key];
  if (typeof value !== "string") continue;
  delete data[key];
  // Each line of the old text becomes a paragraph.
  const paragraphs = value.split(/\r?\n/).map((line) => escape(line.trim())).filter(Boolean);
  if (paragraphs.length > 0) await writeFile(join(base, documentName([key])), `${paragraphs.join("\n\n")}\n`);
  await writeFile(file, `${JSON.stringify(data, null, 2)}\n`);
}
