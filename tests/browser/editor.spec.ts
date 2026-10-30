/**
 * Sign in, edit, save and publish, through the editor UI in a real browser.
 *
 * Runs against the OIDC test stack — see README.md. tests/oidc/flow.test.mjs
 * proves the protocol; this proves that an editor can do the same by clicking.
 */

import { expect, test, type APIRequestContext } from "@playwright/test";

const FORGEJO = `http://localhost:${process.env["FORGEJO_PORT"] ?? "3000"}/api/v1/repos/editor/site`;
const FORGEJO_AUTH = `Basic ${Buffer.from("editor:Forgejo-test-password-not-for-production").toString("base64")}`;

/** Reads the Git host directly, to see what reached the repository. */
async function forgejo(request: APIRequestContext, path: string, raw = false): Promise<unknown> {
  const response = await request.get(`${FORGEJO}/${path}`, { headers: { authorization: FORGEJO_AUTH } });
  expect(response.ok(), `Forgejo: ${path} answered ${response.status()}`).toBe(true);
  return raw ? JSON.parse(await response.text()) : response.json();
}

async function headOfMain(request: APIRequestContext): Promise<string> {
  const branch = (await forgejo(request, "branches/main")) as { commit: { id: string } };
  return branch.commit.id;
}

async function publishedTagline(request: APIRequestContext): Promise<string> {
  const site = (await forgejo(request, "raw/content/general/index.json?ref=main", true)) as { tagline: { en: string } };
  return site.tagline.en;
}

test("an editor signs in, edits, saves and publishes", async ({ page, request, baseURL }) => {
  // Mica's pages load nothing from another origin and break no CSP rule.
  // The sign-in itself navigates to Dex, which is not a Mica page.
  const mica = new URL(baseURL ?? "").origin;
  const external: string[] = [];
  const violations: string[] = [];
  page.on("request", (request) => {
    const from = request.frame().url();
    if (from.startsWith(mica) && !request.isNavigationRequest() && new URL(request.url()).origin !== mica) {
      external.push(request.url());
    }
  });
  page.on("console", (message) => {
    if (/Content Security Policy/i.test(message.text())) violations.push(message.text());
  });

  // Sign in: Mica's login view, then Dex's form, then back into the editor.
  await page.goto("/admin/");
  await expect(page.getByRole("heading", { name: "Sign in to Mica" })).toBeVisible();
  await page.getByRole("button", { name: "Sign in" }).click();

  await page.locator("input[name=login]").fill("alice@gmail.com");
  await page.locator("input[name=password]").fill("password");
  await page.locator("button[type=submit]").click();

  await expect(page).toHaveURL(/\/admin\/$/);
  const sidebar = page.getByRole("complementary");
  await expect(sidebar.getByRole("button", { name: "Sign out" })).toBeVisible();

  // Edit: open the General settings from the sidebar and change the tagline.
  await sidebar.getByRole("link", { name: "General" }).click();
  await expect(page.getByRole("heading", { name: "General" })).toBeVisible();

  const tagline = `Edited in a browser at ${new Date().toISOString()}`;
  await page.getByLabel("Tagline").fill(tagline);

  // It saves by itself after a pause.
  const before = await headOfMain(request);
  await expect(page.getByRole("button", { name: /^Saved, (new|changed)/ })).toBeVisible();

  // Saved is not published: the repository has not moved.
  expect(await headOfMain(request)).toBe(before);
  expect(await publishedTagline(request)).not.toBe(tagline);

  // Publish: the change list shows the edit, and Publish makes one commit.
  await sidebar.getByRole("link", { name: /Publish/ }).click();
  await expect(page.getByText(tagline)).toBeVisible();

  const message = `Publish the tagline from a browser (${tagline})`;
  await page.getByLabel("Say what changed").fill(message);
  await page.getByRole("button", { name: "Publish", exact: true }).click();
  await expect(page.getByText("Your website is being rebuilt now.")).toBeVisible();
  await expect(page.getByText("Nothing waiting to be published")).toBeVisible();

  const head = await headOfMain(request);
  const commit = (await forgejo(request, `git/commits/${head}`)) as {
    commit: { message: string; author: { email: string } };
    parents: { sha: string }[];
  };
  expect(commit.commit.message.trim()).toBe(`${message}\n\nPublished-with: Mica`);
  expect(commit.parents.map((parent) => parent.sha)).toEqual([before]);
  expect(commit.commit.author.email).toBe("alice@gmail.com");
  expect(await publishedTagline(request)).toBe(tagline);

  // Sign out: back to the login view, and the admin API refuses the browser.
  await sidebar.getByRole("button", { name: "Sign out" }).click();
  await expect(page.getByRole("heading", { name: "Sign in to Mica" })).toBeVisible();
  expect((await page.request.get("/api/auth/me")).status()).toBe(401);

  expect(external, "requests to another origin").toEqual([]);
  expect(violations, "Content-Security-Policy violations").toEqual([]);
});

test("an editor whose session ends signs in again and keeps the unsaved changes", async ({ page, context }) => {
  const signIn = async () => {
    await page.locator("input[name=login]").fill("alice@gmail.com");
    await page.locator("input[name=password]").fill("password");
    await page.locator("button[type=submit]").click();
  };

  await page.goto("/admin/");
  await page.getByRole("button", { name: "Sign in" }).click();
  await signIn();
  await expect(page).toHaveURL(/\/admin\/$/);

  const sidebar = page.getByRole("complementary");
  await sidebar.getByRole("link", { name: "General" }).click();
  await expect(page.getByRole("heading", { name: "General" })).toBeVisible();

  // The session ends, and then the form changes: the autosave finds no session.
  await context.clearCookies();
  const tagline = `Kept across a sign-in at ${new Date().toISOString()}`;
  await page.getByLabel("Tagline").fill(tagline);
  await expect(page.getByText("Your session ended")).toBeVisible();

  // Signing in again comes back to the same page, which offers the changes.
  await page.getByRole("button", { name: "Sign in again" }).click();
  await signIn();
  await expect(page).toHaveURL(/\/admin\/singletons\/general$/);
  await page.getByRole("button", { name: "Restore them" }).click();
  await expect(page.getByLabel("Tagline")).toHaveValue(tagline);

  // Restored changes save by themselves.
  await expect(page.getByRole("button", { name: /^Saved, (new|changed)/ })).toBeVisible();

  // Leave nothing pending for the next run.
  await page.getByRole("button", { name: /^Saved, (new|changed)/ }).click();
  await page.getByRole("button", { name: "Discard changes" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Discard", exact: true }).click();
  await expect(page.getByRole("button", { name: "Saved", exact: true })).toBeVisible();
});

test("the appearance follows the system, or the choice that the browser keeps", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "light" });
  await page.goto("/admin/");
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.locator("input[name=login]").fill("alice@gmail.com");
  await page.locator("input[name=password]").fill("password");
  await page.locator("button[type=submit]").click();
  await expect(page).toHaveURL(/\/admin\/$/);

  const html = page.locator("html");
  await expect(html).not.toHaveAttribute("data-theme");
  await expect(page.getByRole("radio", { name: "System" })).toBeChecked();

  // The radio buttons are hidden; their labels take the click.
  await page.locator('label[title="Dark"]').click();
  await expect(html).toHaveAttribute("data-theme", "dark");
  await page.reload();
  await expect(html).toHaveAttribute("data-theme", "dark");
  await expect(page.getByRole("radio", { name: "Dark" })).toBeChecked();

  await page.locator('label[title="System"]').click();
  await expect(html).not.toHaveAttribute("data-theme");
});

test("entries and list items change their order in the same way", async ({ page }) => {
  await page.goto("/admin/");
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.locator("input[name=login]").fill("alice@gmail.com");
  await page.locator("input[name=password]").fill("password");
  await page.locator("button[type=submit]").click();
  await expect(page).toHaveURL(/\/admin\/$/);

  // A collection: an arrow moves an entry one step and saves; the focus stays on the entry's arrows.
  await page.goto("/admin/collections/pages");
  const titles = page.locator("tbody tr td:nth-child(2) a");
  await expect(titles.nth(0)).toHaveText("About us");
  await page.getByRole("button", { name: "Move “About us” down", exact: true }).click();
  await expect(titles.nth(1)).toHaveText("About us");
  await expect(page.getByRole("button", { name: "Move “About us” down", exact: true })).toBeFocused();

  // The handle and the keyboard move it back, so the order is as it was and nothing stays pending.
  // While the first move saves, the controls are disabled.
  const handle = page.getByRole("button", { name: "Move “About us”", exact: true });
  await expect(handle).toBeEnabled();
  await handle.focus();
  await page.keyboard.press("Space");
  await page.keyboard.press("ArrowUp");
  await page.keyboard.press("Space");
  await expect(titles.nth(0)).toHaveText("About us");

  // A list in a form has the same controls: the arrows at the end of the row, the handle at its start.
  await page.goto("/admin/collections/pages/services");
  const sections = page.getByRole("group", { name: "Extra sections" });
  // The headings of the rows: the language button of a field opens a popover too.
  const headings = sections.locator("li [aria-expanded]:not([data-field-action])");
  await expect(headings.nth(0)).toHaveText("Our approach");
  await sections.getByRole("button", { name: "Move “Our approach” down", exact: true }).click();
  await expect(headings.nth(1)).toHaveText("Our approach");
  await sections.getByRole("button", { name: "Move “Our approach”", exact: true }).focus();
  await page.keyboard.press("Space");
  await page.keyboard.press("Home");
  await page.keyboard.press("Space");
  await expect(headings.nth(0)).toHaveText("Our approach");
  // The form is back as it was: nothing was saved, and the page is still as published.
  await expect(page.getByRole("button", { name: "Saved", exact: true })).toBeVisible();

  // The chosen entries of a relation: the same controls again.
  await page.goto("/admin/collections/projects/order-to-cash-review");
  const team = page.getByRole("list", { name: "Chosen team" }).getByRole("listitem");
  await expect(team.nth(0)).toContainText("Amara Okafor");
  await page.getByRole("button", { name: "Move “Amara Okafor” down", exact: true }).click();
  await expect(team.nth(1)).toContainText("Amara Okafor");
  await page.getByRole("button", { name: "Move “Amara Okafor”", exact: true }).focus();
  await page.keyboard.press("Space");
  await page.keyboard.press("ArrowUp");
  await page.keyboard.press("Space");
  await expect(team.nth(0)).toContainText("Amara Okafor");
  await expect(page.getByRole("button", { name: "Saved", exact: true })).toBeVisible();
});
