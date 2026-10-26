// Renames a top-level field in every entry of a collection, also a rich-text field and its .mdoc file.
// Change the model and run `npx astro sync` first. node rename-field.mjs <content root> <collection> <old key> <new key>
import { existsSync } from "node:fs";
import { readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { collectionIds, documentName, entryFolder, INDEX_FILE, MANIFEST_PATH } from "@micacms/core";
import { fileSystemSource } from "@micacms/core/node";

const [root, collection, from, to] = process.argv.slice(2);
const manifest = JSON.parse(await readFile(join(root, MANIFEST_PATH), "utf8"));
const def = manifest.collections[collection];
if (!def) throw new Error(`The model has no collection "${collection}".`);

for (const id of await collectionIds(fileSystemSource(root), collection)) {
  const base = join(root, entryFolder(collection, id));
  if (def.fields[to]?.kind === "richText") {
    // Rich text is a file beside index.json, not a key in it.
    const [old, renamed] = [join(base, documentName([from])), join(base, documentName([to]))];
    if (existsSync(renamed)) throw new Error(`${renamed} exists already.`);
    if (existsSync(old)) await rename(old, renamed);
    continue;
  }
  const file = join(base, INDEX_FILE);
  const data = JSON.parse(await readFile(file, "utf8"));
  if (!(from in data)) continue;
  if (to in data) throw new Error(`${file} has "${to}" already.`);
  // The key keeps its place, so the diff shows one changed line.
  const renamed = Object.fromEntries(Object.entries(data).map(([key, value]) => [key === from ? to : key, value]));
  await writeFile(file, `${JSON.stringify(renamed, null, 2)}\n`);
}
