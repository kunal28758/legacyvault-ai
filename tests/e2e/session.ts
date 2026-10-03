import { clerk } from "@clerk/testing/playwright";
import { expect, type Page } from "@playwright/test";

/**
 * Signs a journey in and gets it past first run.
 *
 * The dashboard redirects an account that has not completed onboarding, so
 * every authenticated journey would otherwise land on `/onboarding` instead of
 * the page it asked for. Handling it here — rather than marking the test users
 * onboarded behind the application's back — means the gate itself is exercised
 * on the first run against a fresh database, and is a no-op afterwards.
 */
export async function signInAndSettle(page: Page, email: string): Promise<void> {
  await page.goto("/");
  await clerk.signIn({ page, signInParams: { strategy: "email_code", identifier: email } });
  // Clerk navigates on its own after a successful sign-in; starting our own
  // navigation on top of that one aborts it.
  await page.waitForLoadState("domcontentloaded");

  await page.goto("/dashboard", { waitUntil: "domcontentloaded" });
  if (new URL(page.url()).pathname === "/onboarding") {
    // A click that lands before the form hydrates does nothing, so retry it
    // until the navigation happens (completing onboarding is idempotent).
    await expect(async () => {
      if (new URL(page.url()).pathname === "/onboarding") {
        await page.getByRole("button", { name: "Skip for now" }).click();
      }
      await page.waitForURL("**/dashboard", { timeout: 15_000 });
    }).toPass({ timeout: 90_000 });
  }
  await expect(page).toHaveURL(/\/dashboard/, { timeout: 60_000 });
}
