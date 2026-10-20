/**
 * Type rich text in the local editor, save, and compare the `.mdoc` file
 * that it writes. No Docker: `mica start` runs from the local build on a
 * temporary Git repository with the starter's content. See ../README.md.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { expect, test } from "@playwright/test";

import { startLocalEditor, type LocalEditor } from "./editor.js";

let editor: LocalEditor;

test.beforeAll(async () => {
  editor = await startLocalEditor();
});

test.afterAll(() => editor?.stop());

test("rich text typed in the editor is saved as Markdoc", async ({ page }) => {
  const head = editor.git("rev-parse", "HEAD");

  await page.goto(`${editor.address}/admin/collections/posts/hello-world`);
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

  // The form saves by itself, with all the text that the field held back.
  await expect(page.getByText("Saved · not published")).toBeVisible();

  const body = readFileSync(join(editor.site, "content/posts/hello-world/body.mdoc"), "utf8");
  expect(body).toBe("## Typed in a browser\n\nIt has **bold** words.\n\n- one\n- two\n");

  // Saved is not published: the repository has not moved, and the change waits in the working tree.
  expect(editor.git("rev-parse", "HEAD")).toBe(head);
  expect(editor.git("status", "--porcelain", "--", "content/posts/hello-world/body.mdoc")).toBe("M content/posts/hello-world/body.mdoc");
});
