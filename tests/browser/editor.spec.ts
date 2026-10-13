/**
 * Sign in, edit, save and publish, through the editor UI in a real browser.
 *
 * Runs against the OIDC test stack — see README.md. tests/oidc/flow.test.mjs
 * proves the protocol; this proves that an editor can do the same by clicking.
 */

import { expect, test, type APIRequestContext } from "@playwright/test";

const FORGEJO = "http://localhost:3000/api/v1/repos/editor/site";
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
  const site = (await forgejo(request, "raw/content/site/index.json?ref=main", true)) as { tagline: string };
  return site.tagline;
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

  // Edit: open the Website settings from the sidebar and change the tagline.
  await sidebar.getByRole("link", { name: "Website" }).click();
  await expect(page.getByRole("heading", { name: "Website" })).toBeVisible();

  const tagline = `Edited in a browser at ${new Date().toISOString()}`;
  await page.getByLabel("Tagline").fill(tagline);

  const before = await headOfMain(request);
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByRole("button", { name: "Save changes" })).toBeDisabled();
  await expect(page.getByText("Saved · not published")).toBeVisible();

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
  await sidebar.getByRole("link", { name: "Website" }).click();
  const tagline = `Kept across a sign-in at ${new Date().toISOString()}`;
  await page.getByLabel("Tagline").fill(tagline);

  // The session ends while the form has changes: the cookies are gone.
  await context.clearCookies();
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByText("Your session ended")).toBeVisible();

  // Signing in again comes back to the same page, which offers the changes.
  await page.getByRole("button", { name: "Sign in again" }).click();
  await signIn();
  await expect(page).toHaveURL(/\/admin\/singletons\/site$/);
  await page.getByRole("button", { name: "Restore them" }).click();
  await expect(page.getByLabel("Tagline")).toHaveValue(tagline);

  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByText("Saved · not published")).toBeVisible();

  // Leave nothing pending for the next run.
  await page.getByRole("button", { name: "Discard changes" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Discard", exact: true }).click();
  await expect(page.getByText("Saved · not published")).toBeHidden();
});
