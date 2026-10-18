import { defineConfig, devices } from "@playwright/test";

// The local editor, with no Docker: each spec starts `mica start` on a copy of a small content repository.
export default defineConfig({
  testDir: "local-editor",
  forbidOnly: !!process.env["CI"],
  retries: 0,
  workers: 1,
  reporter: process.env["CI"] ? [["list"], ["html", { open: "never" }]] : "list",
  use: {
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [{ name: "local-editor", use: { ...devices["Desktop Chrome"] } }],
});
