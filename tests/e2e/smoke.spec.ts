import { expect, test } from "@playwright/test";

test.describe("public landing page", () => {
  test("renders the LegacyVault AI identity with security headers", async ({ page }) => {
    const response = await page.goto("/");
    expect(response?.ok()).toBeTruthy();
    expect(response?.headers()["content-security-policy"]).toContain("nonce-");

    await expect(page).toHaveTitle(/LegacyVault AI/);
    await expect(page.getByRole("heading", { level: 1 })).toContainText(/legacy/i);
    const header = page.getByRole("banner");
    await expect(header.getByRole("link", { name: /sign in/i })).toBeVisible();
    await expect(header.getByRole("link", { name: /create account/i })).toBeVisible();
    await expect(
      page.getByRole("link", { name: /create your legacy plan/i }).first(),
    ).toBeVisible();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    await expect(page.getByText(/does not provide legal advice/i).first()).toBeVisible();
  });

  test("has no horizontal overflow on a phone viewport", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 800 });
    await page.goto("/");
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
  });

  test("protected routes fail closed while authentication is not configured", async ({ page }) => {
    test.skip(Boolean(process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY), "Clerk is configured");
    const response = await page.goto("/dashboard");
    expect(response?.status()).toBe(503);
  });
});
