// Deletes a top-level field and its .mdoc file from every entry of a collection, after it left the model.
// Mica keeps a field that the model does not declare, so this is how its content goes. node remove-field.mjs <content root> <collection> <key>
import { existsSync } from "node:fs";
import { readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { collectionIds, documentName, entryFolder, INDEX_FILE, MANIFEST_PATH } from "@micacms/core";
import { fileSystemSource } from "@micacms/core/node";

const [root, collection, key] = process.argv.slice(2);
const manifest = JSON.parse(await readFile(join(root, MANIFEST_PATH), "utf8"));
const def = manifest.collections[collection];
if (!def) throw new Error(`The model has no collection "${collection}".`);
if (def.fields[key]) throw new Error(`"${key}" is still in the model. Remove it there, and run \`npx astro sync\` first.`);

for (const id of await collectionIds(fileSystemSource(root), collection)) {
  const base = join(root, entryFolder(collection, id));
  const file = join(base, INDEX_FILE);
  if (!existsSync(file)) continue;
  const data = JSON.parse(await readFile(file, "utf8"));
  if (key in data) {
    delete data[key];
    await writeFile(file, `${JSON.stringify(data, null, 2)}\n`);
  }
  await rm(join(base, documentName([key])), { force: true });
}
