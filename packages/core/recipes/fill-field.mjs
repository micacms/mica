// Gives a top-level field a value in every entry of a collection that has none, for example after a new required field.
// Change the model and run `npx astro sync` first. node fill-field.mjs <content root> <collection> <key> <value as JSON>
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { collectionEntryPath, collectionSlugs, entryLayout, INDEX_FILE, MANIFEST_PATH } from "@micacms/core";
import { fileSystemSource } from "@micacms/core/node";

const [root, collection, key, json] = process.argv.slice(2);
const value = JSON.parse(json);
const manifest = JSON.parse(await readFile(join(root, MANIFEST_PATH), "utf8"));
const def = manifest.collections[collection];
if (!def) throw new Error(`The model has no collection "${collection}".`);
if (def.fields[key]?.kind === "richText") throw new Error(`"${key}" is rich text, which is a file: write it in the editor.`);

for (const slug of await collectionSlugs(fileSystemSource(root), def, collection)) {
  const base = collectionEntryPath(def.fields, collection, slug);
  const file = join(root, entryLayout(def.fields) === "file" ? base : `${base}/${INDEX_FILE}`);
  const data = JSON.parse(await readFile(file, "utf8"));
  if (data[key] !== undefined && data[key] !== null && data[key] !== "") continue;
  data[key] = value;
  await writeFile(file, `${JSON.stringify(data, null, 2)}\n`);
}
