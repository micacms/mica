/** `mica start --preview`: which `astro dev` it starts, where, and what it does when the dev server fails. */

import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";

import { astroCommand, astroProjectRoot, startAstroDev } from "../src/astro-dev.js";

function project(): string {
  const root = mkdtempSync(path.join(tmpdir(), "mica-astro-dev-"));
  writeFileSync(path.join(root, "package.json"), "{}");
  mkdirSync(path.join(root, "src/content"), { recursive: true });
  return root;
}

/** A fake `astro` package whose command runs `script`. */
function installAstro(root: string, script: string): string {
  const dir = path.join(root, "node_modules/astro");
  mkdirSync(path.join(dir, "bin"), { recursive: true });
  writeFileSync(path.join(dir, "package.json"), JSON.stringify({ name: "astro", bin: { astro: "./bin/astro.mjs" } }));
  writeFileSync(path.join(dir, "bin/astro.mjs"), script);
  return path.join(dir, "bin/astro.mjs");
}

describe("the Astro project", () => {
  it("is the nearest directory at or above the content root with an astro.config", () => {
    const root = project();
    const content = path.join(root, "src/content");
    assert.equal(astroProjectRoot(content), null);

    writeFileSync(path.join(root, "astro.config.ts"), "export default {};");
    assert.equal(astroProjectRoot(content), root);

    writeFileSync(path.join(content, "astro.config.mjs"), "export default {};");
    assert.equal(astroProjectRoot(content), content);
  });

  it("runs its own astro command, and has none before the install", () => {
    const root = project();
    assert.equal(astroCommand(root), null);
    const script = installAstro(root, "");
    assert.equal(astroCommand(root), realpathSync(script));
  });
});

describe("the dev server", () => {
  it("runs `astro dev` in the foreground in the project with MICA_PREVIEW, and reports a failure with its exit code", async () => {
    const root = project();
    const out = path.join(root, "seen.json");
    const command = installAstro(
      root,
      `import { writeFileSync } from "node:fs";
writeFileSync(${JSON.stringify(out)}, JSON.stringify({ args: process.argv.slice(2), cwd: process.cwd(), preview: process.env.MICA_PREVIEW }));
process.exit(3);`,
    );

    const code = await new Promise<number>((resolve) => startAstroDev({ projectRoot: root, command, env: {}, onFail: resolve }));

    assert.equal(code, 3);
    const seen = JSON.parse(readFileSync(out, "utf8")) as { args: string[]; cwd: string; preview: string };
    assert.deepEqual(seen.args, ["dev", "--ignore-lock"]);
    assert.equal(seen.preview, "1");
    assert.equal(realpathSync(seen.cwd), realpathSync(root));
  });

  it("takes only the preview away when it stops cleanly", async () => {
    const root = project();
    const command = installAstro(root, `setTimeout(() => process.exit(0), 50);`);
    let failed = false;
    startAstroDev({ projectRoot: root, command, env: {}, onFail: () => (failed = true) });
    await new Promise((resolve) => setTimeout(resolve, 1000));
    assert.equal(failed, false);
  });
});
