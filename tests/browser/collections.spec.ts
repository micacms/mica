/**
 * A collection entry from start to end, through the editor UI (#138): create it
 * with an image, change its URL, discard another edit, publish, and delete it.
 *
 * Runs against the OIDC test stack — see README.md. The order of entries is in
 * editor.spec.ts.
 */

import { expect, test, type APIRequestContext, type Page } from "@playwright/test";

const FORGEJO = `http://localhost:${process.env["FORGEJO_PORT"] ?? "3000"}/api/v1/repos/editor/site`;
const FORGEJO_AUTH = `Basic ${Buffer.from("editor:Forgejo-test-password-not-for-production").toString("base64")}`;

/** A 1×1 PNG: the upload checks the bytes, not the name. */
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

/** Whether a file is on `main` of the repository. */
async function published(request: APIRequestContext, path: string): Promise<boolean> {
  const response = await request.get(`${FORGEJO}/contents/${path}?ref=main`, { headers: { authorization: FORGEJO_AUTH } });
  expect([200, 404], `Forgejo: ${path} answered ${response.status()}`).toContain(response.status());
  return response.status() === 200;
}

async function publishedFile(request: APIRequestContext, path: string): Promise<string> {
  const response = await request.get(`${FORGEJO}/raw/${path}?ref=main`, { headers: { authorization: FORGEJO_AUTH } });
  expect(response.ok(), `Forgejo: ${path} answered ${response.status()}`).toBe(true);
  return response.text();
}

async function signIn(page: Page): Promise<void> {
  await page.goto("/admin/");
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.locator("input[name=login]").fill("alice@gmail.com");
  await page.locator("input[name=password]").fill("password");
  await page.locator("button[type=submit]").click();
  await expect(page).toHaveURL(/\/admin\/$/);
}

/** Publishes what is chosen on the Publish page, and waits until nothing is left. */
async function publish(page: Page, message: string): Promise<void> {
  await page.getByRole("complementary").getByRole("link", { name: /Publish/ }).click();
  await page.getByLabel("Say what changed").fill(message);
  await page.getByRole("button", { name: "Publish", exact: true }).click();
  await expect(page.getByText("Your website is being rebuilt now.")).toBeVisible();
}

test("an editor creates an entry with an image, changes its URL, discards another edit, publishes, and deletes it", async ({ page, request }) => {
  const stamp = Date.now().toString(36);
  const name = `Browser Tester ${stamp}`;
  const slug = `moved-${stamp}`;
  const folder = `content/team/${slug}`;
  const taglineBefore = (JSON.parse(await publishedFile(request, "content/general/index.json")) as { tagline: string }).tagline;

  await signIn(page);

  // Create: a name first, so that the entry has a folder for its image.
  await page.goto("/admin/collections/team");
  await page.getByRole("link", { name: "New team member" }).click();
  await page.getByRole("textbox", { name: "Name (required)" }).fill(name);
  await page.getByLabel("Portrait").click();
  const picker = page.getByRole("dialog", { name: "Media" });
  await picker.locator("input[type=file]").setInputFiles({ name: `portrait-${stamp}.png`, mimeType: "image/png", buffer: PNG });
  await expect(picker).toBeHidden();
  await page.getByLabel("Alt text").fill("A test portrait");
  await page.getByRole("button", { name: "Create" }).click();
  await expect(page.getByText("Saved · not published")).toBeVisible();

  // Change the URL: it waits for its button, and the entry and its image move together.
  await page.getByLabel("URL", { exact: true }).fill(slug);
  await page.getByRole("button", { name: "Change URL" }).click();
  await expect(page).toHaveURL(new RegExp(`/admin/collections/team/${slug}$`));
  await expect(page.getByText("Saved · not published")).toBeVisible();

  // Another edit, which the editor then discards on the Publish page.
  await page.getByRole("complementary").getByRole("link", { name: "General" }).click();
  // It saves by itself.
  await page.getByLabel("Tagline").fill(`Not to be published ${stamp}`);
  await expect(page.getByText("Saved · not published")).toBeVisible();

  await page.getByRole("complementary").getByRole("link", { name: /Publish/ }).click();
  await expect(page.getByRole("checkbox", { name: `Publish Team member: ${name}` })).toBeChecked();
  await page
    .getByRole("listitem")
    .filter({ has: page.getByRole("checkbox", { name: "Publish General" }) })
    .getByRole("button", { name: "Discard" })
    .click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Discard", exact: true }).click();
  await expect(page.getByRole("checkbox", { name: "Publish General" })).toBeHidden();

  // Publish the new entry: its data and its image reach the repository, the discarded edit does not.
  await publish(page, `Add ${name}`);
  expect(JSON.parse(await publishedFile(request, `${folder}/index.json`))).toMatchObject({
    name,
    portrait: { path: `media/portrait-${stamp}.png`, alt: "A test portrait" },
  });
  expect(await published(request, `${folder}/media/portrait-${stamp}.png`)).toBe(true);
  expect((JSON.parse(await publishedFile(request, "content/general/index.json")) as { tagline: string }).tagline).toBe(taglineBefore);

  // Delete it, with its image, and publish the deletion.
  await page.goto(`/admin/collections/team/${slug}`);
  await page.getByRole("button", { name: "Delete this team member" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Delete", exact: true }).click();
  await expect(page).toHaveURL(/\/admin\/collections\/team$/);
  await publish(page, `Remove ${name}`);
  expect(await published(request, `${folder}/index.json`)).toBe(false);
  expect(await published(request, `${folder}/media/portrait-${stamp}.png`)).toBe(false);
});
