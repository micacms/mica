/**
 * The dependency rule, as a test.
 *
 * `@micacms/core` is the language every other package speaks, so it must
 * depend on nothing they would drag in: no UI framework, no HTTP framework,
 * no auth implementation, no provider SDK, no database driver — and, outside
 * the deliberate `/node` entry point, no `node:` built-ins, because the main
 * entry is bundled into a browser.
 *
 * A rule that lives only in a document erodes the first time a convenient
 * import appears; this one fails the build instead.
 */

import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

const root = new URL("..", import.meta.url).pathname;

describe("the core boundary", () => {
  it("depends on zod, and on nothing else", () => {
    const manifest = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as {
      dependencies?: Record<string, string>;
      peerDependencies?: Record<string, string>;
      optionalDependencies?: Record<string, string>;
    };

    assert.deepEqual(Object.keys(manifest.dependencies ?? {}), ["zod"]);
    assert.equal(manifest.peerDependencies, undefined);
    assert.equal(manifest.optionalDependencies, undefined);
  });

  it("imports nothing but itself and zod, and node: only from the node entry", () => {
    for (const name of readdirSync(join(root, "src"))) {
      if (!name.endsWith(".ts")) continue;
      const source = readFileSync(join(root, "src", name), "utf8");

      // Anchored to statement shape so a `from "…"` inside an error message
      // does not count as an import.
      for (const match of source.matchAll(/^\s*(?:import|export)[^;]*?from\s+"([^"]+)";/gms)) {
        const specifier = match[1]!;
        if (specifier.startsWith("./") || specifier.startsWith("../")) continue;
        if (specifier === "zod") continue;
        if (specifier.startsWith("node:")) {
          // The one place a filesystem is allowed, and it is a separate entry
          // point precisely so the main graph never pulls it in.
          assert.equal(
            name,
            "node.ts",
            `${name} imports ${specifier}; node built-ins belong only in node.ts`,
          );
          continue;
        }
        assert.fail(`${name} imports "${specifier}", which core must not depend on`);
      }
    }
  });
});
