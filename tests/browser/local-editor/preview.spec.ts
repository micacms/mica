/**
 * The live preview beside the form: the example site runs with
 * `MICA_PREVIEW=1 astro dev`, and the local editor shows its pages. See ../README.md.
 */

import { expect, test } from "@playwright/test";

import { startPreviewSite, type PreviewSite } from "./preview-site.js";

let site: PreviewSite;

test.beforeAll(async () => {
  test.setTimeout(120_000);
  site = await startPreviewSite();
});

test.afterAll(() => site?.stop());

test("a click in the preview opens the field, and a save shows on the page", async ({ page }) => {
  test.setTimeout(90_000);
  const head = site.git("rev-parse", "HEAD");

  await page.goto(`${site.address}/admin/collections/pages/services`);
  const preview = page.frameLocator('iframe[title="Preview of the page"]');
  // The texts end with invisible markers: match their start.
  const heading = preview.getByRole("heading", { level: 1, name: /^Services/ });
  await expect(heading).toBeVisible({ timeout: 30_000 });

  // Edit mode: the label names the field, and a click puts the cursor in it.
  await heading.hover();
  await expect(preview.locator("#mica-preview-label")).toContainText("Title");
  await heading.click();
  await expect(page.getByRole("textbox", { name: "Title (required)" })).toBeFocused();

  // A text of another document, a link of the menu in the footer: its form opens over this one, and goes back.
  const privacy = preview.getByRole("contentinfo").getByRole("link", { name: /^Privacy/ });
  await privacy.click();
  const overlay = page.getByRole("region", { name: "Edit Navigation" });
  await expect(overlay).toBeVisible();
  await overlay.getByRole("button", { name: /^Back to page Services/ }).click();
  await expect(overlay).toBeHidden();
  await expect(page).toHaveURL(/\/admin\/collections\/pages\/services$/);

  // The form saves by itself, the page loads again with the new text, and marks it as not published.
  const intro = "Typed in the browser, and shown in the preview.";
  await page.getByRole("textbox", { name: "Introduction" }).fill(intro);
  await expect(page.getByText("Saved · not published")).toBeVisible();
  await expect(preview.locator("[data-mica-changed]", { hasText: intro })).toBeVisible({ timeout: 15_000 });
  expect(site.git("rev-parse", "HEAD")).toBe(head);

  // Browse mode: a link goes to its page, and back in Edit mode the form follows it.
  const modes = page.getByRole("group", { name: "What a click does" });
  await modes.getByRole("button", { name: "Browse" }).click();
  await privacy.click();
  await expect(preview.getByRole("heading", { level: 1, name: /^Privacy/ })).toBeVisible({ timeout: 15_000 });
  await modes.getByRole("button", { name: "Edit" }).click();
  await expect(page).toHaveURL(/\/admin\/collections\/pages\/privacy$/);
  await expect(page.getByRole("heading", { level: 1, name: "Privacy" })).toBeVisible();
});
