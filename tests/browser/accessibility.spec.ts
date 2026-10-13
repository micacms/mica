/**
 * Automated accessibility checks with axe, on every view of the editor (#108).
 *
 * A serious or critical finding fails the run. axe finds only a part of the
 * problems; the accessibility statement on the website lists the known gaps.
 */

import { AxeBuilder } from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

const BLOCKING = new Set(["serious", "critical"]);

/** The WCAG 2.2 A and AA rules that axe can test. */
const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

async function check(page: Page, view: string): Promise<void> {
  // A view is ready when its heading shows and nothing says "Loading…".
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(page.getByText(/^Loading/)).toHaveCount(0);
  // A control that fades in as data arrives would be measured half transparent.
  await page.waitForFunction(() => document.getAnimations().every((animation) => animation.playState !== "running"));

  const results = await new AxeBuilder({ page }).withTags(TAGS).analyze();
  const blocking = results.violations
    .filter((violation) => BLOCKING.has(violation.impact ?? ""))
    .map((violation) => `${violation.id} (${violation.impact}): ${violation.help} — ${violation.nodes.map((node) => node.target.join(" ")).slice(0, 3).join(", ")}`);
  // Soft, so that one run reports the findings of every view.
  expect.soft(blocking, `${view}: serious or critical accessibility findings`).toEqual([]);
}

test("every view of the editor passes the automated accessibility checks", async ({ page }) => {
  await page.goto("/admin/");
  await check(page, "Sign in");

  await page.getByRole("button", { name: "Sign in" }).click();
  await page.locator("input[name=login]").fill("alice@gmail.com");
  await page.locator("input[name=password]").fill("password");
  await page.locator("button[type=submit]").click();
  await expect(page).toHaveURL(/\/admin\/$/);
  await check(page, "Overview");

  const views: Array<[string, string]> = [
    ["Collection", "/admin/collections/projects"],
    ["Entry", "/admin/collections/projects/order-to-cash-review"],
    ["Entry with one relation", "/admin/collections/news/we-are-hiring-a-junior-consultant"],
    ["Singleton", "/admin/singletons/site"],
    ["Media", "/admin/media"],
    ["Publish", "/admin/changes"],
    ["System", "/admin/system"],
  ];
  for (const [view, path] of views) {
    await page.goto(path);
    await check(page, view);
  }

  // The relation picker, open: a combobox and its list of entries.
  await page.goto("/admin/collections/projects/order-to-cash-review");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await page.getByRole("combobox", { name: /Team/ }).focus();
  await expect(page.getByRole("listbox")).toBeVisible();
  await check(page, "Relation picker");

  // The link dialog of rich text.
  await page.getByRole("button", { name: "Link" }).first().click();
  await expect(page.getByRole("dialog", { name: "Link" })).toBeVisible();
  await check(page, "Link dialog");
  await page.keyboard.press("Escape");
});
