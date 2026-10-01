import { expect, test } from "@playwright/test";

import { loadLocalEnv } from "../helpers/load-env";
import { signInAndSettle } from "./session";
import { E2E_USERS } from "./users";

/**
 * Two-factor authentication opens Clerk's real enrolment UI.
 *
 * The reported bug was that clicking "Enable" did nothing (it fired a toast and
 * never started enrolment). This proves the integration boundary: the button
 * opens Clerk's own account portal, where two-step verification is set up.
 *
 * Completing TOTP enrolment is Clerk's and needs a real authenticator secret,
 * which cannot be automated here without exposing one — that final step is
 * verified manually (docs/DEPLOYMENT.md). This test stops at the point the bug
 * was: the button must reach Clerk's enrolment UI, not a dead toast.
 */
loadLocalEnv();

const email = E2E_USERS.settings;
const configured = Boolean(
  process.env.CLERK_SECRET_KEY && process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY,
);

test.describe("settings — two-factor authentication", () => {
  test.skip(
    !configured,
    "Clerk development keys are not configured — see docs/DEPLOYMENT.md § Clerk.",
  );

  test("Enable opens Clerk's account portal, not a dead toast", async ({ page }) => {
    test.setTimeout(180_000);
    await signInAndSettle(page, email);

    await page.goto("/settings?tab=security", { waitUntil: "domcontentloaded" });
    // Exact: the card description also mentions two-factor authentication.
    await expect(page.getByText("Two-factor authentication", { exact: true })).toBeVisible({
      timeout: 60_000,
    });

    // The row shows Clerk's live MFA state and a working control.
    const control = page.getByRole("button", { name: /^(Enable|Manage)$/ });
    await expect(control).toBeVisible();
    await control.click();

    // Clerk's real account portal opens (its UserProfile root), which is where
    // two-step verification is actually enrolled — not a toast.
    await expect(page.locator(".cl-userProfile-root, .cl-modalContent").first()).toBeVisible({
      timeout: 60_000,
    });

    await page.keyboard.press("Escape");
  });
});
