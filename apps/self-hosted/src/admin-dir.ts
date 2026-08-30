/** Where the built editor UI lives: inside the @micacms/editor-ui package. */

import { createRequire } from "node:module";
import path from "node:path";

const require = createRequire(import.meta.url);

export function editorUiDist(): string | undefined {
  try {
    return path.join(path.dirname(require.resolve("@micacms/editor-ui/package.json")), "dist");
  } catch {
    return undefined;
  }
}
