/** `mica start --preview`: which `astro dev` it starts, where, and what it does when the dev server fails. */

import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";

import { astroCommand, astroProjectRoot, localAddress, startAstroDev, startedDevServer } from "../src/astro-dev.js";

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
    assert.deepEqual(seen.args, ["dev", "--ignore-lock"], "no --port: the site's server.port counts");
    assert.equal(seen.preview, "1");
    assert.equal(realpathSync(seen.cwd), realpathSync(root));
  });

  it("keeps the last lines of its output without colours, and still writes them to the terminal (ADR 40)", async () => {
    const root = project();
    const command = installAstro(
      root,
      `for (let i = 0; i < 60; i++) console.log("\\u001b[32mline " + i + "\\u001b[39m"); process.stderr.write("an err"); process.stderr.write("or\\n"); process.exit(0);`,
    );
    const written: string[] = [];
    const write = process.stdout.write.bind(process.stdout);
    process.stdout.write = ((chunk: string | Uint8Array) => (written.push(String(chunk)), true)) as typeof process.stdout.write;
    try {
      startAstroDev({ projectRoot: root, command, env: {}, onFail: () => assert.fail("it ended cleanly") });
      for (let i = 0; i < 50 && startedDevServer()?.running !== false; i++) await new Promise((resolve) => setTimeout(resolve, 100));
    } finally {
      process.stdout.write = write;
    }
    const run = startedDevServer();
    assert.equal(run?.running, false);
    assert.equal(run?.lines.length, 50);
    assert.equal(run?.lines.includes("an error"), true);
    assert.equal(run?.lines.includes("line 59"), true);
    assert.match(written.join(""), /line 0/);
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

describe("the dev server's address", () => {
  it("is the one that astro dev prints, also in its JSON log lines, when its port was busy", async () => {
    const root = project();
    const command = installAstro(root, `console.log(${JSON.stringify(JSON.stringify({ message: " astro  v7.4.2 ready in 2522 ms\n┃ Local    http://localhost:4322/\n┃ Network  use --host to expose", level: "info" }))}); setTimeout(() => process.exit(0), 50);`);
    startAstroDev({ projectRoot: root, command, env: {}, onFail: () => {} });
    await new Promise((resolve) => setTimeout(resolve, 1000));
    assert.equal(startedDevServer()?.address, "http://localhost:4322");

    assert.equal(localAddress("┃ Local    http://localhost:4321/blog/"), "http://localhost:4321/blog");
    assert.equal(localAddress("[200] / 12ms"), null);
  });
});
