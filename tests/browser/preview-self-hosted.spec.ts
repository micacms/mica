/**
 * The live preview of the self-hosted Mica, on the stack of tests/preview: the
 * example website's `astro dev` in a container of its own, behind Mica's gate
 * on another host name. Only with MICA_PREVIEW_STACK=1. See ../preview/README.md.
 */

import { expect, test } from "@playwright/test";

const EDITOR = "http://cms.localhost:6422";
const FORGEJO = `http://localhost:${process.env["FORGEJO_PORT"] ?? "3000"}/api/v1/repos/editor/site`;
const FORGEJO_AUTH = `Basic ${Buffer.from("editor:Forgejo-test-password-not-for-production").toString("base64")}`;
const PREVIEW = "http://preview.cms.localhost:6422";

test.skip(!process.env["MICA_PREVIEW_STACK"], "Runs on the stack of tests/preview.");

test("an editor sees the drafts beside the form, behind the preview's gate", async ({ page, browser, request }) => {
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
  // Asked again while Vite reloads the page once, on the first visit, after it optimized the dependencies.
  await expect
    .poll(() => preview.locator("body").evaluate(() => document.cookie).catch(() => "reloading"), { timeout: 15_000 })
    .not.toMatch(/mica_|reloading/);

  // Click to edit, as in the local editor.
  await expect(heading).toHaveAttribute("data-mica-field", /"title\.en"/);
  await heading.click();
  await expect(page.getByRole("textbox", { name: "Title (required)" })).toBeFocused();

  // A draft reaches the preview through Mica's volume, and Vite's reload through the gate.
  const intro = `Typed in the self-hosted editor at ${Date.now()}.`;
  await page.getByRole("textbox", { name: "Introduction" }).fill(intro);
  await expect(preview.locator("[data-mica-changed]", { hasText: intro })).toBeVisible({ timeout: 30_000 });

  // A developer changes a template: Mica's sync brings it into the clone, and the preview copies the website again.
  const path = "src/components/SiteFooter.astro";
  const file = (await (await request.get(`${FORGEJO}/contents/${path}?ref=main`, { headers: { authorization: FORGEJO_AUTH } })).json()) as {
    content: string;
    sha: string;
  };
  const changed = Buffer.from(file.content, "base64").toString().replace("</footer>", "<p>Changed in the template</p></footer>");
  const updated = await request.put(`${FORGEJO}/contents/${path}`, {
    headers: { authorization: FORGEJO_AUTH },
    data: { branch: "main", sha: file.sha, message: "A developer changes the footer", content: Buffer.from(changed).toString("base64") },
  });
  expect(updated.ok(), await updated.text()).toBe(true);
  await expect(preview.getByText("Changed in the template")).toBeVisible({ timeout: 90_000 });
  // The draft is still there.
  await expect(preview.getByText(intro)).toBeVisible();
});
