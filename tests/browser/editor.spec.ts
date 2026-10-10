/**
 * Sign in, edit, save and publish, through the editor UI in a real browser.
 *
 * Runs against the OIDC test stack — see README.md. tests/oidc/flow.test.mjs
 * proves the protocol; this proves that an editor can do the same by clicking.
 */

import { expect, test, type APIRequestContext } from "@playwright/test";

const GITHUB = "http://localhost:8787/repos/acme/site";

/** Reads the stand-in GitHub API directly, to see what reached the repository. */
async function github(request: APIRequestContext, path: string, raw = false): Promise<unknown> {
  const response = await request.get(`${GITHUB}/${path}`, {
    headers: {
      authorization: "Bearer test",
      accept: raw ? "application/vnd.github.raw" : "application/vnd.github+json",
    },
  });
  expect(response.ok(), `GitHub stub: ${path} answered ${response.status()}`).toBe(true);
  return raw ? JSON.parse(await response.text()) : response.json();
}

async function headOfMain(request: APIRequestContext): Promise<string> {
  const ref = (await github(request, "git/ref/heads/main")) as { object: { sha: string } };
  return ref.object.sha;
}

async function publishedTagline(request: APIRequestContext): Promise<string> {
  const site = (await github(request, "contents/content/site/index.json?ref=main", true)) as { tagline: string };
  return site.tagline;
}

test("an editor signs in, edits, saves and publishes", async ({ page, request }) => {
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

  // Edit: open the Website settings from the sidebar and change the tagline.
  await sidebar.getByRole("link", { name: "Website" }).click();
  await expect(page.getByRole("heading", { name: "Website" })).toBeVisible();

  const tagline = `Edited in a browser at ${new Date().toISOString()}`;
  await page.getByLabel("Tagline").fill(tagline);

  const before = await headOfMain(request);
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByRole("button", { name: "Saved" })).toBeDisabled();

  // Saved is not published: the repository has not moved.
  expect(await headOfMain(request)).toBe(before);
  expect(await publishedTagline(request)).not.toBe(tagline);

  // Publish: the change list shows the edit, and Publish makes one commit.
  await sidebar.getByRole("link", { name: /Publish/ }).click();
  await expect(page.getByText(tagline)).toBeVisible();

  const message = `Publish the tagline from a browser (${tagline})`;
  await page.getByPlaceholder(/becomes the commit message/).fill(message);
  await page.getByRole("button", { name: "Publish", exact: true }).click();
  await expect(page.getByText("Nothing waiting to be published")).toBeVisible();

  const head = await headOfMain(request);
  const commit = (await github(request, `git/commits/${head}`)) as {
    message: string;
    parents: { sha: string }[];
    author?: { email: string };
  };
  expect(commit.message).toBe(message);
  expect(commit.parents).toEqual([{ sha: before }]);
  expect(commit.author?.email).toBe("alice@gmail.com");
  expect(await publishedTagline(request)).toBe(tagline);

  // Sign out: back to the login view, and the admin API refuses the browser.
  await sidebar.getByRole("button", { name: "Sign out" }).click();
  await expect(page.getByRole("heading", { name: "Sign in to Mica" })).toBeVisible();
  expect((await page.request.get("/api/auth/me")).status()).toBe(401);
});
