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
  // A hover before the script marks the heading finds no field: a person's next move would.
  await expect(heading).toHaveAttribute("data-mica-field", /"title"/);
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

  // A row of a list that the template reads: the social link opens General at the URL of its row.
  await preview.getByRole("contentinfo").getByRole("link", { name: "LinkedIn" }).click();
  const general = page.getByRole("region", { name: "Edit General" });
  await expect(general.getByRole("group", { name: /^Social links/ }).getByRole("textbox", { name: /^URL/ }).first()).toBeFocused();
  await general.getByRole("button", { name: /^Back to page Services/ }).click();
  await expect(general).toBeHidden();

  // The form saves by itself, the page loads again with the new text, and marks it as not published.
  const intro = "Typed in the browser, and shown in the preview.";
  await page.getByRole("textbox", { name: "Introduction" }).fill(intro);
  await expect(page.getByText("Saved · not published")).toBeVisible();
  await expect(preview.locator("[data-mica-changed]", { hasText: intro })).toBeVisible({ timeout: 15_000 });
  expect(site.git("rev-parse", "HEAD")).toBe(head);

  // In a rich text, the frame of a change goes around the changed paragraph, not around the whole text.
  const paragraph = "Typed into the first paragraph.";
  await page.getByRole("textbox", { name: "Content", exact: true }).getByText(/^From a two-day process review/).click();
  await page.keyboard.press("End");
  await page.keyboard.type(` ${paragraph}`);
  const text = preview.locator("article[data-mica-changed]", { hasText: paragraph });
  await expect(text).toBeVisible({ timeout: 15_000 });
  const whole = (await text.boundingBox())!.height;
  const frames = preview.locator("#mica-preview-changes > div");
  // One frame for the introduction, one for the paragraph.
  await expect(frames).toHaveCount(2);
  const heights = await frames.evaluateAll((elements) => elements.map((element) => element.getBoundingClientRect().height));
  expect(Math.max(...heights)).toBeLessThan(whole / 2);

  // Browse mode: a link goes to its page, and back in Edit mode the form follows it.
  const modes = page.getByRole("group", { name: "What a click does" });
  await modes.getByRole("button", { name: "Browse" }).click();
  await privacy.click();
  await expect(preview.getByRole("heading", { level: 1, name: /^Privacy/ })).toBeVisible({ timeout: 15_000 });
  await modes.getByRole("button", { name: "Edit" }).click();
  await expect(page).toHaveURL(/\/admin\/collections\/pages\/privacy$/);
  await expect(page.getByRole("heading", { level: 1, name: "Privacy" })).toBeVisible();
});
