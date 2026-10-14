/**
 * Where the built editor UI lives: `dist/admin`, copied in at build time
 * (`scripts/copy-editor-ui.mjs`). Run from source, the workspace's
 * `@micacms/editor-ui` build serves instead.
 */

import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

const require = createRequire(import.meta.url);

export function editorUiDist(): string | undefined {
  const copied = path.join(import.meta.dirname, "admin");
  if (existsSync(path.join(copied, "index.html"))) return copied;
  try {
    return path.join(path.dirname(require.resolve("@micacms/editor-ui/package.json")), "dist");
  } catch {
    // Neither: the app falls back to its 503 explainer, which names the fix.
    return undefined;
  }
}
