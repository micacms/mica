/**
 * Type rich text in the local editor, save, and compare the `.mdoc` file
 * that it writes. No Docker: `mica start` runs from the local build on a
 * temporary Git repository with the starter's content. See ../README.md.
 */

import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { expect, test } from "@playwright/test";

const REPOSITORY = resolve(import.meta.dirname, "../../..");
const CLI = join(REPOSITORY, "apps/local-editor/dist/cli.js");
const FIXTURE = join(REPOSITORY, "examples/starter/content");

let site: string;
let editor: ChildProcess | undefined;
let address: string;
let output = "";

function git(...args: string[]): string {
  return execFileSync("git", args, { cwd: site, encoding: "utf8" }).trim();
}

/** A port that nothing listens on now. */
async function freePort(): Promise<number> {
  return new Promise((done, fail) => {
    const server = createServer();
    server.once("error", fail);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address() as { port: number };
      server.close(() => done(port));
    });
  });
}

/** Waits until the editor answers, or fails with what it printed. */
async function ready(url: string): Promise<void> {
  const until = Date.now() + 30_000;
  while (Date.now() < until) {
    if (editor?.exitCode !== null) throw new Error(`mica start stopped:\n${output}`);
    try {
      if ((await fetch(url)).ok) return;
    } catch {
      // Not listening yet.
    }
    await new Promise((wait) => setTimeout(wait, 200));
  }
  throw new Error(`mica start did not answer in 30 seconds:\n${output}`);
}

test.beforeAll(async () => {
  if (!existsSync(CLI)) throw new Error(`There is no local editor build at ${CLI}. Run rush build first.`);

  site = mkdtempSync(join(tmpdir(), "mica-browser-"));
  cpSync(FIXTURE, join(site, "content"), { recursive: true });
  git("init", "--quiet", "--initial-branch=main");
  git("config", "user.name", "Browser Test");
  git("config", "user.email", "browser-test@example.com");
  git("add", "--all");
  git("commit", "--quiet", "--message", "The starter's content");

  const port = await freePort();
  // The editor accepts writes only from the address that it prints, which names localhost.
  address = `http://localhost:${port}`;
  editor = spawn(process.execPath, [CLI, "start", join(site, "content"), "--port", String(port), "--no-open"], {
    cwd: site,
    stdio: ["ignore", "pipe", "pipe"],
  });
  editor.stdout?.on("data", (chunk: Buffer) => (output += chunk.toString()));
  editor.stderr?.on("data", (chunk: Buffer) => (output += chunk.toString()));
  await ready(`${address}/api/auth/config`);
});

test.afterAll(() => {
  editor?.kill();
  if (site) rmSync(site, { recursive: true, force: true });
});

test("rich text typed in the editor is saved as Markdoc", async ({ page }) => {
  const head = git("rev-parse", "HEAD");

  await page.goto(`${address}/admin/collections/posts/hello-world`);
  await expect(page.getByRole("heading", { name: "Hello, world" })).toBeVisible();

  // Replace the text: a heading, a paragraph with bold, and a list, typed with the Markdown shortcuts.
  const text = page.getByRole("textbox", { name: "Text", exact: true });
  await text.click();
  await page.keyboard.press("ControlOrMeta+A");
  await page.keyboard.press("Backspace");
  await page.keyboard.type("## Typed in a browser");
  await page.keyboard.press("Enter");
  await page.keyboard.type("It has **bold** words.");
  await page.keyboard.press("Enter");
  await page.keyboard.type("- one");
  await page.keyboard.press("Enter");
  await page.keyboard.type("two");

  // At once, without a pause: the save must take the text that the field still holds back.
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByText("Saved · not published")).toBeVisible();
  await expect(page.getByRole("button", { name: "Save changes" })).toBeDisabled();

  const body = readFileSync(join(site, "content/posts/hello-world/body.mdoc"), "utf8");
  expect(body).toBe("## Typed in a browser\n\nIt has **bold** words.\n\n- one\n- two\n");

  // Saved is not published: the repository has not moved, and the change waits in the working tree.
  expect(git("rev-parse", "HEAD")).toBe(head);
  expect(git("status", "--porcelain", "--", "content/posts/hello-world/body.mdoc")).toBe("M content/posts/hello-world/body.mdoc");
});
