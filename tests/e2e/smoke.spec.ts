import { expect, test } from "@playwright/test";

test.describe("public landing page", () => {
  test("renders the LegacyVault AI identity with security headers", async ({ page }) => {
    const response = await page.goto("/");
    expect(response?.ok()).toBeTruthy();
    expect(response?.headers()["content-security-policy"]).toContain("nonce-");

    await expect(page).toHaveTitle(/LegacyVault AI/);
    await expect(page.getByRole("heading", { level: 1 })).toContainText(/legacy/i);
    await expect(page.getByRole("link", { name: /sign in/i })).toBeVisible();
    await expect(page.getByRole("link", { name: /create account/i })).toBeVisible();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  });
});
