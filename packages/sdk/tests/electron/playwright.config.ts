import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "../..",
  projects: [
    { name: "sdk", testMatch: "tests/electron/**/*.electron.spec.ts" },
    { name: "apps", testMatch: "apps/**/tests/**/*.electron.spec.ts" },
  ],
  outputDir: "test-results",
  timeout: 30_000,
  globalTimeout: 180_000,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: process.env.CI ? "github" : "list",
  use: {
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
});
