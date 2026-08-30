/**
 * The version of this build, read from the package manifest.
 *
 * Read rather than imported: an import would need a JSON module attribute and
 * would put a second copy of the manifest in `dist/`. The file is a fixed
 * distance from this module in both layouts — `src/lib` and `dist/lib`
 * are the same depth below the package root, and the Docker image copies
 * `package.json` next to `dist/` — so one path serves both.
 *
 * A missing or unreadable manifest is not worth failing a request over; the
 * system page shows "unknown" instead.
 */

import fs from "node:fs";
import path from "node:path";

function readVersion(): string {
  try {
    const manifest = fs.readFileSync(
      path.resolve(import.meta.dirname, "../../package.json"),
      "utf8",
    );
    return (JSON.parse(manifest) as { version?: string }).version ?? "unknown";
  } catch {
    return "unknown";
  }
}

export const VERSION = readVersion();
