/**
 * The command-line reference on the website (#119) names every command and
 * option that `--help` shows, so that a new option cannot ship undocumented.
 */

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

const CLI = path.resolve(import.meta.dirname, "../src/cli.ts");
const TSX = import.meta.resolve("tsx");
const PAGE = path.resolve(import.meta.dirname, "../../../sites/micacms/content/docs/reference-cli/body.mdoc");

const help = spawnSync(process.execPath, ["--import", TSX, CLI, "--help"], { encoding: "utf8" }).stdout;
const page = readFileSync(PAGE, "utf8");

describe("the command-line reference", () => {
  it("has a section for every command in the help", () => {
    const commands = [...help.matchAll(/\$ npx @micacms\/editor ([a-z-]+)/g)].map((match) => match[1]!);
    assert.ok(commands.length >= 5, help);
    for (const command of commands) assert.match(page, new RegExp(`^### ${command}$`, "m"), command);
  });

  it("names every option in the help", () => {
    const options = [...new Set([...help.matchAll(/(?<=\s)(--?[a-z][a-z-]*)/g)].map((match) => match[1]!))];
    assert.ok(options.includes("--port"), help);
    for (const option of options) assert.ok(page.includes(`\`${option}`), `${option} is not on the page`);
  });
});
