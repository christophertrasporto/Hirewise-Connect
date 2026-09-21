import { defineConfig, devices } from "@playwright/test";

/**
 * End-to-end isolation tests (MASTER_PROMPT.md Section 12).
 * Assumes the dev database is migrated and seeded (`npm run db:migrate && npm run db:seed`).
 * Starts the dev server unless one is already listening on E2E_BASE_URL.
 */
const baseURL = process.env.E2E_BASE_URL ?? "http://localhost:3000";

export default defineConfig({
  testDir: "e2e",
  timeout: 120_000,
  workers: 1,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  retries: 0,
  reporter: [["list"]],
  use: { baseURL, trace: "retain-on-failure", ...devices["Desktop Chrome"] },
  webServer: {
    command: "npm run dev",
    url: baseURL,
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
