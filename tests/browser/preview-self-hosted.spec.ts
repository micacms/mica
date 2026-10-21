/**
 * The live preview of the self-hosted Mica, on the stack of tests/preview: the
 * example website's `astro dev` in a container of its own, behind Mica's gate
 * on another host name. Only with MICA_PREVIEW_STACK=1. See ../preview/README.md.
 */

import { expect, test } from "@playwright/test";

const EDITOR = "http://cms.localhost:6422";
const PREVIEW = "http://preview.cms.localhost:6422";

test.skip(!process.env["MICA_PREVIEW_STACK"], "Runs on the stack of tests/preview.");

test("an editor sees the drafts beside the form, behind the preview's gate", async ({ page, browser }) => {
  test.setTimeout(120_000);

  // Without the editor's sign-in, the gate lets nobody to the website's dev server.
  const stranger = await browser.newPage();
  const refused = await stranger.goto(`${PREVIEW}/services/`);
  expect(refused?.status()).toBe(401);
  await stranger.close();

  await page.goto(`${EDITOR}/admin/`);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.locator("input[name=login]").fill("alice@gmail.com");
  await page.locator("input[name=password]").fill("password");
  await page.locator("button[type=submit]").click();
  await expect(page).toHaveURL(/\/admin\/$/);

  await page.goto(`${EDITOR}/admin/collections/pages/services`);
  const frame = page.locator('iframe[title="Preview of the page"]');
  await expect(frame).toHaveAttribute("src", new RegExp(`^${PREVIEW}/`));
  const preview = page.frameLocator('iframe[title="Preview of the page"]');
  const heading = preview.getByRole("heading", { level: 1, name: /^Services/ });
  await expect(heading).toBeVisible({ timeout: 60_000 });

  // The website's page never gets the editor's cookies: they are for another host.
  expect(await preview.locator("body").evaluate(() => document.cookie)).not.toMatch(/mica_/);

  // Click to edit, as in the local editor.
  await expect(heading).toHaveAttribute("data-mica-field", /"title"/);
  await heading.click();
  await expect(page.getByRole("textbox", { name: "Title (required)" })).toBeFocused();

  // A draft reaches the preview through Mica's volume, and Vite's reload through the gate.
  const intro = `Typed in the self-hosted editor at ${Date.now()}.`;
  await page.getByRole("textbox", { name: "Introduction" }).fill(intro);
  await expect(preview.locator("[data-mica-changed]", { hasText: intro })).toBeVisible({ timeout: 30_000 });
});
