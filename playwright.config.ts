import { defineConfig, devices } from "@playwright/test";

/**
 * Playwright configuration (task T015). E2E journeys run against `next dev`.
 * Authenticated journeys use `@clerk/testing` against a Clerk DEVELOPMENT instance
 * (testing tokens) once T195 is completed; until then only public pages are covered.
 * Install browsers once with `pnpm test:e2e:install`.
 */
const port = Number(process.env.PLAYWRIGHT_PORT ?? 3000);
const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? `http://localhost:${port}`;

export default defineConfig({
  testDir: "./tests/e2e",
  globalSetup: "./tests/e2e/global-setup.ts",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  // `next dev` compiles on demand in a single process, so more browser workers
  // than this make the specs queue behind the compiler rather than the app —
  // which shows up as timeouts that have nothing to do with the product.
  workers: process.env.CI ? 1 : 3,
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: `pnpm dev --port ${port}`,
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
