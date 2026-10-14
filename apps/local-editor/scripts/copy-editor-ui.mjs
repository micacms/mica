// Copies the built editor UI into dist/admin, so that @micacms/editor ships it and needs no @micacms/editor-ui on npm.
import { cpSync, existsSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

const require = createRequire(import.meta.url);
const from = path.join(path.dirname(require.resolve("@micacms/editor-ui/package.json")), "dist");
const to = path.join(import.meta.dirname, "..", "dist", "admin");

if (!existsSync(path.join(from, "index.html"))) {
  console.error(`No built editor UI in ${from}. Build @micacms/editor-ui first.`);
  process.exit(1);
}
rmSync(to, { recursive: true, force: true });
cpSync(from, to, { recursive: true });
