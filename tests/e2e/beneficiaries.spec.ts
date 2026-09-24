import { clerk } from "@clerk/testing/playwright";
import { expect, test, type Page } from "@playwright/test";

import { loadLocalEnv } from "../helpers/load-env";
import { signInAndSettle } from "./session";
import { E2E_USERS } from "./users";

/**
 * Authenticated beneficiary journey (tasks T071–T076).
 *
 * This is the one check that covers the whole stack at once: a real Clerk
 * session in a real browser, through the versioned API, the service and
 * repository layers, RLS and the guarded functions, into PostgreSQL. The reload
 * step is the point — it proves the row was persisted rather than held in
 * client state.
 *
 * Sign-in uses Clerk's `+clerk_test` email strategy against a DEVELOPMENT
 * instance; no password is stored anywhere in this repository.
 */
loadLocalEnv();

const email = E2E_USERS.beneficiaries;
const configured = Boolean(
  process.env.CLERK_SECRET_KEY && process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY,
);

const unique = Date.now().toString(36);

/** Opens the add/edit sheet and fills it. Relationship is a Base UI select. */
async function fillNewBeneficiary(page: Page, name: string, address: string): Promise<void> {
  await page
    .getByRole("button", { name: /Add (your first )?beneficiary/ })
    .first()
    .click();
  await page.getByLabel("Full name").fill(name);
  await page.locator('[data-slot="select-trigger"]').click();
  await page.getByRole("option", { name: "Sibling", exact: true }).click();
  await page.getByLabel("Email").fill(address);
  await page.getByRole("button", { name: "Add beneficiary", exact: true }).last().click();
}

/**
 * Removal, asserted on what actually happened.
 *
 * The acknowledgement is scoped to the dialog — an unscoped `.first()` can tick
 * a checkbox elsewhere on the page and leave the confirm button disabled — and
 * the dialog must close before the table is inspected, because an open dialog
 * takes the background out of the accessibility tree and would make the "row is
 * gone" assertion pass without anything being removed.
 */
async function removeBeneficiary(page: Page, name: string): Promise<void> {
  await page.getByRole("button", { name: `Actions for ${name}` }).click();
  await page.getByRole("menuitem", { name: "Remove" }).click();

  const dialog = page.getByRole("dialog");
  await dialog.getByRole("checkbox").check();
  await dialog.getByRole("button", { name: "Remove beneficiary" }).click();

  await expect(dialog).toBeHidden({ timeout: 30_000 });
  await expect(page.getByRole("table")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole("table").locator("tr", { hasText: name })).toHaveCount(0, {
    timeout: 30_000,
  });
}

test.describe("beneficiaries", () => {
  test.skip(
    !configured,
    "Clerk development keys are not configured — see docs/DEPLOYMENT.md § Clerk.",
  );
  test.describe.configure({ mode: "serial" });

  test.beforeEach(async ({ page }) => {
    // Several round trips per test against a dev-mode server.
    test.setTimeout(120_000);
    await signInAndSettle(page, email);
  });

  test("creates, persists, deactivates and removes a beneficiary", async ({ page }) => {
    const name = `E2E Beneficiary ${unique}`;
    await page.goto("/beneficiaries");
    await expect(page.getByRole("heading", { name: "Beneficiaries" })).toBeVisible();

    await fillNewBeneficiary(page, name, `e2e+${unique}@example.com`);

    // Scoped to the table: the card layout renders the same name off-screen.
    const row = page.getByRole("table").locator("tr", { hasText: name });
    await expect(row).toBeVisible({ timeout: 20_000 });

    // ── Persisted server-side, not held in client state ─────────────────────
    await page.reload();
    await expect(page.getByRole("table").locator("tr", { hasText: name })).toBeVisible({
      timeout: 20_000,
    });

    // ── Deactivate through the guarded function ─────────────────────────────
    await page.getByRole("button", { name: `Actions for ${name}` }).click();
    await page.getByRole("menuitem", { name: "Deactivate" }).click();
    await expect(
      page.getByRole("table").locator("tr", { hasText: name }).getByText("Inactive"),
    ).toBeVisible({ timeout: 20_000 });

    // ── Remove: cascade + soft delete, one transaction ──────────────────────
    await removeBeneficiary(page, name);
  });

  test("surfaces the server's duplicate-email rejection on the field", async ({ page }) => {
    const name = `E2E Duplicate ${unique}`;
    const address = `e2e-dup+${unique}@example.com`;
    await page.goto("/beneficiaries");

    await fillNewBeneficiary(page, name, address);
    await expect(page.getByRole("table").locator("tr", { hasText: name })).toBeVisible({
      timeout: 20_000,
    });

    // The same address again: the unique index and the service both refuse it,
    // and the 409 has to land on the email field rather than as a raw error.
    await fillNewBeneficiary(page, `${name} again`, address);
    // Specifically the field error, not the toast: a 409 has to be actionable.
    await expect(
      page.locator('p[role="alert"]', { hasText: "A beneficiary with this email already exists." }),
    ).toBeVisible({ timeout: 20_000 });

    // Close with the keyboard and let the toasts expire: sonner pauses its
    // dismiss timer while the pointer is over the notification region, and the
    // region overlaps the sheet footer.
    await page.keyboard.press("Escape");
    await page.mouse.move(0, 0);
    await expect(page.locator("[data-sonner-toast]")).toHaveCount(0, { timeout: 30_000 });

    await removeBeneficiary(page, name);
  });

  test("keeps the session across a reload and ends it on sign-out", async ({ page }) => {
    // The session is a Clerk cookie, so a full reload — not a client navigation
    // — is what proves it survives.
    await page.reload();
    await expect(page).toHaveURL(/\/dashboard/, { timeout: 60_000 });
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible({ timeout: 60_000 });

    await clerk.signOut({ page });
    await page.goto("/dashboard");
    // Signed out, the protected group sends the visitor to sign-in.
    await expect(page).toHaveURL(/\/sign-in/, { timeout: 60_000 });
  });
});
