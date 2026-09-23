import { clerk } from "@clerk/testing/playwright";
import { expect, test, type Page } from "@playwright/test";

import { loadLocalEnv } from "../helpers/load-env";
import { E2E_USERS } from "./users";

/**
 * Authenticated legacy-plan and asset journey (tasks T057–T090).
 *
 * One pass over the whole Batch 2 surface against a real Clerk session and a
 * real database: the wizard auto-saves a section, an asset is created through
 * `create_asset()`, a beneficiary is assigned through `assign_beneficiary()`,
 * and the asset is then edited and deleted through `delete_asset()`. The
 * reloads are the point — they prove the state came back from PostgreSQL rather
 * than from anything held in the tab.
 */
loadLocalEnv();

const configured = Boolean(
  process.env.CLERK_SECRET_KEY && process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY,
);

const unique = Date.now().toString(36);
const beneficiaryName = `E2E Heir ${unique}`;
const assetName = `E2E Savings ${unique}`;
const renamedAsset = `${assetName} renamed`;
const legalName = `E2E Planner ${unique}`;

/**
 * Navigates and waits for the page's own list request to come back.
 *
 * Clicking straight after `goto` can land before React has hydrated, and the
 * click is then swallowed by the server-rendered markup. Waiting for the
 * client-issued fetch proves the page is interactive.
 */
async function gotoAndSettle(page: Page, path: string, apiPath: string): Promise<void> {
  const settled = page.waitForResponse(
    (response) => response.url().includes(apiPath) && response.request().method() === "GET",
    { timeout: 120_000 },
  );
  await page.goto(path);
  await settled;
}

async function dismissToasts(page: Page): Promise<void> {
  // Sonner pauses its dismiss timer while the pointer is over the notification
  // region, and that region overlaps the sheet footer.
  await page.mouse.move(0, 0);
  await expect(page.locator("[data-sonner-toast]")).toHaveCount(0, { timeout: 30_000 });
}

/**
 * Each journey signs in as its own account: the two are individually heavy
 * enough that sharing one would approach the contracted 100-requests-per-15-min
 * budget, and the limiter is one of the things these tests exist to run against.
 */
function signInAs(email: string) {
  test.beforeEach(async ({ page }) => {
    test.setTimeout(180_000);
    await page.goto("/");
    await clerk.signIn({ page, signInParams: { strategy: "email_code", identifier: email } });
  });
}

test.describe("legacy plan and assets", () => {
  test.skip(
    !configured,
    "Clerk development keys are not configured — see docs/DEPLOYMENT.md § Clerk.",
  );
  signInAs(E2E_USERS.legacyPlan);

  test("saves a plan section, then creates, assigns, edits and deletes an asset", async ({
    page,
  }) => {
    // ── A beneficiary to assign the asset to ────────────────────────────────
    await gotoAndSettle(page, "/beneficiaries", "/api/v1/beneficiaries");
    await page
      .getByRole("button", { name: /Add (your first )?beneficiary/ })
      .first()
      .click();
    await page.getByLabel("Full name").fill(beneficiaryName);
    await page.locator('[data-slot="select-trigger"]').click();
    await page.getByRole("option", { name: "Sibling", exact: true }).click();
    await page.getByLabel("Email").fill(`e2e-heir+${unique}@example.com`);
    await page.getByRole("button", { name: "Add beneficiary", exact: true }).last().click();
    await expect(page.getByRole("table").locator("tr", { hasText: beneficiaryName })).toBeVisible({
      timeout: 20_000,
    });

    // ── Legacy plan: auto-save a section ────────────────────────────────────
    await page.goto("/legacy-plan/wizard?step=1");
    await expect(page.getByRole("heading", { name: "Personal Details" })).toBeVisible({
      timeout: 30_000,
    });

    await page.getByLabel("Full legal name").fill(legalName);
    await page.getByLabel("Date of birth").fill("1980-04-02");
    await page.getByLabel("Street address").fill("12 Marine Drive");
    await page.getByLabel("City").fill("Mumbai");
    await page.getByLabel("Country").fill("India");

    // The debounced save reports itself; "Saved" means the server accepted it.
    await expect(page.getByRole("status")).toHaveText(/Saved/, { timeout: 30_000 });

    // ── Persisted server-side, not held in the tab ──────────────────────────
    await page.reload();
    await expect(page.getByLabel("Full legal name")).toHaveValue(legalName, { timeout: 30_000 });

    // The section now counts as complete in the review step.
    await page.goto("/legacy-plan/wizard?step=10");
    await expect(page.getByRole("heading", { name: "Review your plan" })).toBeVisible({
      timeout: 30_000,
    });
    await expect(
      page.getByRole("listitem").filter({ hasText: "Personal Details" }).getByText("complete", {
        exact: true,
      }),
    ).toBeAttached();

    // ── Create an asset through create_asset() ──────────────────────────────
    await gotoAndSettle(page, "/assets/financial", "/api/v1/assets/financial");
    await page
      .getByRole("button", { name: /Add (your first )?asset/ })
      .first()
      .click();
    await page.getByLabel("Name").fill(assetName);
    await page.locator('[data-slot="select-trigger"]').first().click();
    await page.getByRole("option", { name: "Bank account", exact: true }).click();
    await page.getByLabel("Account number").fill("4111111111114821");
    await page.getByLabel("Estimated value").fill("250000");
    await page.getByRole("button", { name: "Add asset", exact: true }).last().click();

    await expect(page.getByText(assetName).first()).toBeVisible({ timeout: 30_000 });
    await dismissToasts(page);

    // ── Assign the beneficiary through assign_beneficiary() ─────────────────
    await page.getByRole("button", { name: `Actions for ${assetName}` }).click();
    await page.getByRole("menuitem", { name: "Assign beneficiary" }).click();
    await page.getByRole("dialog").locator('[data-slot="select-trigger"]').click();
    await page.getByRole("option", { name: new RegExp(beneficiaryName) }).click();
    await page.getByLabel("Allocation").fill("60");
    await page.getByRole("button", { name: "Confirm assignment" }).click();
    await expect(page.getByText("60% allocated")).toBeVisible({ timeout: 30_000 });

    // ── Still there after a reload ──────────────────────────────────────────
    await page.reload();
    await expect(page.getByText(assetName).first()).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText("60% allocated")).toBeVisible({ timeout: 30_000 });
    await dismissToasts(page);

    // ── Edit ────────────────────────────────────────────────────────────────
    await page.getByRole("button", { name: `Actions for ${assetName}` }).click();
    await page.getByRole("menuitem", { name: "Edit" }).click();
    await page.getByLabel("Name").fill(renamedAsset);
    await page.getByRole("button", { name: "Save changes" }).click();
    await expect(page.getByText(renamedAsset).first()).toBeVisible({ timeout: 30_000 });
    await dismissToasts(page);

    // ── Delete through delete_asset() ───────────────────────────────────────
    await page.getByRole("button", { name: `Actions for ${renamedAsset}` }).click();
    await page.getByRole("menuitem", { name: "Delete" }).click();
    await page.getByRole("button", { name: "Delete asset" }).click();
    await expect(page.getByText(renamedAsset)).toHaveCount(0, { timeout: 30_000 });
    await dismissToasts(page);

    // ── Clean up the beneficiary this run created ───────────────────────────
    await gotoAndSettle(page, "/beneficiaries", "/api/v1/beneficiaries");
    await page.getByRole("button", { name: `Actions for ${beneficiaryName}` }).click();
    await page.getByRole("menuitem", { name: "Remove" }).click();
    await page.getByRole("checkbox").first().check();
    await page.getByRole("button", { name: "Remove beneficiary" }).click();
    await expect(page.getByRole("table").locator("tr", { hasText: beneficiaryName })).toHaveCount(
      0,
      { timeout: 30_000 },
    );
  });
});

test.describe("asset allocation limits", () => {
  test.skip(
    !configured,
    "Clerk development keys are not configured — see docs/DEPLOYMENT.md § Clerk.",
  );
  signInAs(E2E_USERS.assetAllocation);

  test("refuses an allocation that would exceed 100%", async ({ page }) => {
    const name = `E2E Overallocated ${unique}`;
    const heir = `E2E Second Heir ${unique}`;
    const other = `E2E Third Heir ${unique}`;

    // Two beneficiaries: the dialog hides anyone already assigned to the asset,
    // so attempting the overflow needs somebody who is not the first heir.
    await gotoAndSettle(page, "/beneficiaries", "/api/v1/beneficiaries");
    for (const [person, address] of [
      [heir, `e2e-second+${unique}@example.com`],
      [other, `e2e-third+${unique}@example.com`],
    ]) {
      await page
        .getByRole("button", { name: /Add (your first )?beneficiary/ })
        .first()
        .click();
      await page.getByLabel("Full name").fill(person);
      await page.locator('[data-slot="select-trigger"]').click();
      await page.getByRole("option", { name: "Friend", exact: true }).click();
      await page.getByLabel("Email").fill(address);
      await page.getByRole("button", { name: "Add beneficiary", exact: true }).last().click();
      await expect(page.getByRole("table").locator("tr", { hasText: person })).toBeVisible({
        timeout: 20_000,
      });
      await dismissToasts(page);
    }

    await gotoAndSettle(page, "/assets/physical", "/api/v1/assets/physical");
    await page
      .getByRole("button", { name: /Add (your first )?asset/ })
      .first()
      .click();
    await page.getByLabel("Name").fill(name);
    await page.locator('[data-slot="select-trigger"]').first().click();
    await page.getByRole("option", { name: "Real estate", exact: true }).click();
    await page.getByRole("button", { name: "Add asset", exact: true }).last().click();
    await expect(page.getByText(name).first()).toBeVisible({ timeout: 30_000 });
    await dismissToasts(page);

    // 100% first, then a second assignment that cannot fit.
    await page.getByRole("button", { name: `Actions for ${name}` }).click();
    await page.getByRole("menuitem", { name: "Assign beneficiary" }).click();
    await page.getByRole("dialog").locator('[data-slot="select-trigger"]').click();
    await page.getByRole("option", { name: new RegExp(heir) }).click();
    await page.getByLabel("Allocation").fill("100");
    await page.getByRole("button", { name: "Confirm assignment" }).click();
    await expect(page.getByText("100% allocated")).toBeVisible({ timeout: 30_000 });
    await dismissToasts(page);

    await page.getByRole("button", { name: `Actions for ${name}` }).click();
    await page.getByRole("menuitem", { name: "Assign beneficiary" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.locator('[data-slot="select-trigger"]').click();
    await page.getByRole("option", { name: new RegExp(other) }).click();
    await page.getByLabel("Allocation").fill("10");
    await page.getByRole("button", { name: "Confirm assignment" }).click();

    // The guarded function refuses it; the message reaches the form.
    await expect(dialog.getByText(/above 100%/i)).toBeVisible({ timeout: 30_000 });
    await page.getByRole("button", { name: "Cancel" }).click();

    // Clean up both records.
    await dismissToasts(page);
    await page.getByRole("button", { name: `Actions for ${name}` }).click();
    await page.getByRole("menuitem", { name: "Delete" }).click();
    await page.getByRole("button", { name: "Delete asset" }).click();
    await expect(page.getByText(name)).toHaveCount(0, { timeout: 30_000 });

    await gotoAndSettle(page, "/beneficiaries", "/api/v1/beneficiaries");
    for (const person of [heir, other]) {
      await page.getByRole("button", { name: `Actions for ${person}` }).click();
      await page.getByRole("menuitem", { name: "Remove" }).click();
      await page.getByRole("checkbox").first().check();
      await page.getByRole("button", { name: "Remove beneficiary" }).click();
      await expect(page.getByRole("table").locator("tr", { hasText: person })).toHaveCount(0, {
        timeout: 30_000,
      });
      await dismissToasts(page);
    }
  });
});
