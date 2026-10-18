import { defineConfig, devices } from "@playwright/test";

// The stack comes from tests/oidc/compose.yml; this config starts nothing.
// The local editor's specs have their own config: local-editor.config.ts.
export default defineConfig({
  testDir: ".",
  testIgnore: "local-editor/**",
  forbidOnly: !!process.env["CI"],
  retries: 0,
  workers: 1,
  reporter: process.env["CI"] ? [["list"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: "http://localhost:6422",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
