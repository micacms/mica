/**
 * Publish and conflicts in the local editor (#139): two pages save the same
 * entry, Publish pushes to a bare remote, and a publication that could not be
 * sent is sent again without a second commit. No Docker. See ../README.md.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { expect, test, type Page } from "@playwright/test";

import { startLocalEditor, type LocalEditor } from "./editor.js";

let editor: LocalEditor;

test.beforeEach(async () => {
  editor = await startLocalEditor({ remote: true });
});

test.afterEach(() => editor?.stop());

const POST = "content/posts/hello-world/index.json";
const teaserOnDisk = () => (JSON.parse(readFileSync(join(editor.site, POST), "utf8")) as { excerpt: string }).excerpt;

async function saveTeaser(page: Page, teaser: string): Promise<void> {
  await page.getByLabel("Teaser").fill(teaser);
  await page.getByRole("button", { name: "Save changes" }).click();
}

async function publish(page: Page, message: string): Promise<void> {
  await page.getByRole("complementary").getByRole("link", { name: /Publish/ }).click();
  await page.getByLabel("Say what changed").fill(message);
  await page.getByRole("button", { name: "Publish", exact: true }).click();
}

test("two pages that save the same entry meet the save conflict, and Keep mine wins", async ({ browser }) => {
  const entry = `${editor.address}/admin/collections/posts/hello-world`;
  const first = await browser.newPage();
  const second = await browser.newPage();
  await first.goto(entry);
  await second.goto(entry);

  await saveTeaser(first, "Saved in the first page.");
  await expect(first.getByText("Saved · not published")).toBeVisible();

  // The second page still holds the old version: its save finds a newer one.
  await saveTeaser(second, "Saved in the second page.");
  await expect(second.getByText("Somebody else saved this while you were editing")).toBeVisible();
  expect(teaserOnDisk()).toBe("Saved in the first page.");

  await second.getByRole("button", { name: "Keep mine" }).click();
  await expect(second.getByText("Saved · not published")).toBeVisible();
  expect(teaserOnDisk()).toBe("Saved in the second page.");
});

test("Publish pushes one commit, and a publication that could not be sent is sent again without a second one", async ({ page }) => {
  const start = Number(editor.git("rev-list", "--count", "HEAD"));
  await page.goto(`${editor.address}/admin/collections/posts/hello-world`);

  // Publish with the remote in reach: one commit, on the remote too.
  await saveTeaser(page, "Published from a browser.");
  await expect(page.getByText("Saved · not published")).toBeVisible();
  await publish(page, "Change the teaser");
  await expect(page.getByText("Your website is being rebuilt now.")).toBeVisible();
  expect(editor.remoteGit("rev-parse", "main")).toBe(editor.git("rev-parse", "HEAD"));
  expect(Number(editor.git("rev-list", "--count", "HEAD"))).toBe(start + 1);

  // Publish without the remote: the commit stays in the checkout and waits.
  const restore = editor.cutRemote();
  await page.goto(`${editor.address}/admin/collections/posts/hello-world`);
  await saveTeaser(page, "Published while offline.");
  await expect(page.getByText("Saved · not published")).toBeVisible();
  await publish(page, "Change the teaser again");
  await expect(page.getByText("Published here, but not sent to the website yet")).toBeVisible();
  const waiting = editor.git("rev-parse", "HEAD");
  expect(Number(editor.git("rev-list", "--count", "HEAD"))).toBe(start + 2);

  // Try again sends the same commit, and makes no new one.
  restore();
  await page.getByRole("button", { name: "Try again" }).click();
  await expect(page.getByText("Published here, but not sent to the website yet")).toBeHidden();
  expect(editor.remoteGit("rev-parse", "main")).toBe(waiting);
  expect(Number(editor.git("rev-list", "--count", "HEAD"))).toBe(start + 2);
});
