import { expect, test, type Page } from "@playwright/test";

import { loadLocalEnv } from "../helpers/load-env";
import { signInAndSettle } from "./session";
import { E2E_USERS } from "./users";

/**
 * Asset Vault + Legacy Intelligence against the real stack.
 *
 * Journey 1: create an asset → view it → its deterministic finding appears on
 * the asset and in the Action Centre → assign a beneficiary (finding resolved)
 * → link a supporting document.
 * Journey 2: edit the legacy details → mark it sold while still assigned
 * (RULE-009 raised) → back to active (resolved) → readiness criterion →
 * palette navigation → another owner's id is "not found" → mobile vault.
 * Journey 3: two same-named assets (RULE-004) → palette to conflicts on
 * Legacy Intelligence → type filters → dismiss the heuristic finding → restore.
 *
 * Each journey has its own account so the two never share the per-user
 * write budget (100 / 15 min) of the limiter, which these tests run against
 * unchanged.
 * Records are uniquely named per run and deleted at the end.
 */
loadLocalEnv();

const configured = Boolean(
  process.env.CLERK_SECRET_KEY && process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY,
);
const unique = Date.now().toString(36);
const PDF = Buffer.from(
  "%PDF-1.7\n1 0 obj<</Type/Catalog>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n",
  "utf8",
);

async function dismissToasts(page: Page): Promise<void> {
  await page.mouse.move(0, 0);
  await expect(page.locator("[data-sonner-toast]")).toHaveCount(0, { timeout: 30_000 });
}

async function gotoAndSettle(page: Page, path: string, apiPath: string): Promise<void> {
  const settled = page.waitForResponse(
    (response) => response.url().includes(apiPath) && response.request().method() === "GET",
    { timeout: 120_000 },
  );
  await page.goto(path);
  await settled;
}

async function addBeneficiary(page: Page, name: string): Promise<void> {
  await gotoAndSettle(page, "/beneficiaries", "/api/v1/beneficiaries");
  await page
    .getByRole("button", { name: /Add (your first )?beneficiary/ })
    .first()
    .click();
  await page.getByLabel("Full name").fill(name);
  await page.locator('[data-slot="select-trigger"]').click();
  await page.getByRole("option", { name: "Sibling", exact: true }).click();
  await page.getByLabel("Email").fill(`e2e-vault-heir+${unique}-${name.length}@example.com`);
  await page.getByRole("button", { name: "Add beneficiary", exact: true }).last().click();
  await expect(page.getByRole("table").locator("tr", { hasText: name })).toBeVisible({
    timeout: 30_000,
  });
  await dismissToasts(page);
}

async function removeBeneficiary(page: Page, name: string): Promise<void> {
  await gotoAndSettle(page, "/beneficiaries", "/api/v1/beneficiaries");
  await page.getByRole("button", { name: `Actions for ${name}` }).click();
  await page.getByRole("menuitem", { name: "Remove" }).click();
  // An open dialog hides the table from the accessibility tree, so the row
  // check below only means something once the dialog has closed.
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("checkbox").check();
  const removed = page.waitForResponse(
    (response) =>
      response.request().method() === "DELETE" && response.url().includes("/api/v1/beneficiaries/"),
  );
  await dialog.getByRole("button", { name: "Remove beneficiary" }).click();
  expect((await removed).ok()).toBe(true);
  await expect(dialog).toBeHidden({ timeout: 30_000 });
  await expect(page.getByRole("table").locator("tr", { hasText: name })).toHaveCount(0, {
    timeout: 30_000,
  });
}

/** Creates a physical asset from the Asset Vault and (by default) opens its page. */
async function createAsset(page: Page, name: string, open = true): Promise<void> {
  await gotoAndSettle(page, "/assets", "/api/v1/assets/physical");
  await expect(page.getByRole("heading", { level: 1, name: "Asset Vault" })).toBeVisible();
  await expect(async () => {
    await page.getByRole("button", { name: "Add asset" }).click();
    await expect(page.getByRole("menuitem", { name: /Physical asset/ })).toBeVisible({
      timeout: 2_000,
    });
  }).toPass({ timeout: 60_000 });
  await page.getByRole("menuitem", { name: /Physical asset/ }).click();
  await page.getByLabel("Name").fill(name);
  await page.getByRole("dialog").locator('[data-slot="select-trigger"]').first().click();
  await page.getByRole("option", { name: "Real estate", exact: true }).click();
  await page.getByRole("button", { name: "Add asset", exact: true }).last().click();
  await dismissToasts(page);
  if (!open) return;
  await page.getByRole("table").getByRole("link", { name, exact: true }).click();
  await expect(page.getByRole("heading", { level: 1, name })).toBeVisible({ timeout: 60_000 });
}

async function deleteAssetFromDetail(page: Page): Promise<void> {
  await page.getByRole("button", { name: "More asset actions" }).click();
  await page.getByRole("menuitem", { name: "Delete asset" }).click();
  await page.getByRole("button", { name: "Delete asset" }).click();
  await expect(page).toHaveURL(/\/assets$/, { timeout: 30_000 });
}

/** Assigns 100% of the open asset to `person` from the detail page. */
async function assignAll(page: Page, person: string): Promise<void> {
  await page.getByRole("button", { name: "Assign beneficiary" }).first().click();
  await page.getByRole("dialog").locator('[data-slot="select-trigger"]').click();
  await page.getByRole("option", { name: new RegExp(person) }).click();
  await page.getByLabel("Allocation").fill("100");
  await page.getByRole("button", { name: "Confirm assignment" }).click();
  await expect(
    page.getByRole("region", { name: "Beneficiaries" }).getByText(/100% allocated/),
  ).toBeVisible({ timeout: 30_000 });
  await dismissToasts(page);
}

test.describe("asset vault and legacy intelligence", () => {
  test.skip(
    !configured,
    "Clerk development keys are not configured — see docs/DEPLOYMENT.md § Clerk.",
  );
  test.setTimeout(300_000);

  test("create, view, finding, Action Centre, assign (resolves it) and link a document", async ({
    page,
  }) => {
    const asset = `E2E House ${unique}`;
    const heir = `E2E Vault Heir ${unique}`;
    const deed = `E2E Vault Deed ${unique}.pdf`;
    await signInAndSettle(page, E2E_USERS.assetVault);
    await addBeneficiary(page, heir);

    // A document to link later, through the real upload pipeline.
    await gotoAndSettle(page, "/documents", "/api/v1/documents");
    await page
      .getByRole("button", { name: /^Upload( your first document)?$/ })
      .first()
      .click();
    await page.setInputFiles('input[type="file"]', {
      name: deed,
      mimeType: "application/pdf",
      buffer: PDF,
    });
    await page.getByRole("button", { name: "Upload", exact: true }).last().click();
    await expect(
      page.getByRole("dialog").getByRole("listitem").filter({ hasText: deed }).getByRole("status"),
    ).toHaveText("Stored privately", { timeout: 120_000 });
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Close", exact: true })
      .last()
      .click();

    // ── 1–2. Create and view ────────────────────────────────────────────────
    await createAsset(page, asset);
    await expect(page.getByRole("region", { name: "Overview" })).toBeVisible();

    // ── 6–7. Intelligence on the asset: a deterministic finding with its rule ─
    const intelligence = page.getByRole("region", { name: "Intelligence" });
    const missing = intelligence
      .getByRole("listitem")
      .filter({ hasText: `${asset} has no beneficiary` });
    await expect(missing).toBeVisible({ timeout: 60_000 });
    await expect(missing.getByText("ASSET-BEN-001")).toBeVisible();
    await expect(missing.getByText("System detected")).toBeVisible();

    // ── 9. The same finding is in the Action Centre, once, marked as detected ─
    await page
      .getByRole("navigation", { name: "Primary" })
      .getByRole("link", { name: "Action Centre" })
      .click();
    await expect(page.getByRole("heading", { level: 1, name: "Action Centre" })).toBeVisible({
      timeout: 60_000,
    });
    const action = page
      .getByRole("listitem")
      .filter({ hasText: /has no beneficiary|have no beneficiary/ });
    await expect(action).toHaveCount(1, { timeout: 60_000 });
    await expect(action.getByText("System detected")).toBeVisible();
    await page.goBack();
    await expect(page.getByRole("heading", { level: 1, name: asset })).toBeVisible({
      timeout: 60_000,
    });

    // ── 4 + 8. Assign a beneficiary → the finding resolves ──────────────────
    await assignAll(page, heir);
    await expect(missing).toHaveCount(0, { timeout: 60_000 });
    await expect(page.getByRole("list", { name: "Relationships" })).toContainText(
      "Assigned to 1 beneficiary",
    );

    // ── 5. Link the supporting document ─────────────────────────────────────
    await page
      .getByRole("region", { name: "Supporting documents" })
      .getByRole("button", { name: "Link documents" })
      .click();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: `Link ${deed}` })
      .click();
    await expect(page.getByRole("dialog").getByRole("button", { name: `Link ${deed}` })).toHaveText(
      /Linked/,
      { timeout: 30_000 },
    );
    await page.keyboard.press("Escape");
    await expect(
      page.getByRole("region", { name: "Supporting documents" }).getByRole("link", { name: deed }),
    ).toBeVisible({ timeout: 30_000 });
    await expect(page.getByRole("list", { name: "Relationships" })).toContainText(
      "Supported by 1 document",
    );
    await dismissToasts(page);

    // Clean up this run's asset and beneficiary (the uniquely named document stays
    // in this dedicated test account's vault).
    await deleteAssetFromDetail(page);
    await removeBeneficiary(page, heir);
  });

  test("edit, contradictory status (RULE-009), readiness, palette, isolation and mobile", async ({
    page,
  }) => {
    const asset = `E2E Flat ${unique}`;
    const heir = `E2E Guard Heir ${unique}`;
    await signInAndSettle(page, E2E_USERS.assetGuard);
    await addBeneficiary(page, heir);
    await createAsset(page, asset);
    await assignAll(page, heir);

    // ── 3. Edit the legacy details ──────────────────────────────────────────
    await page.getByRole("button", { name: "Edit", exact: true }).first().click();
    await page
      .getByRole("textbox", { name: /^Instructions/ })
      .fill("Transfer to my sibling. Papers are in the blue folder.");
    await page.getByRole("textbox", { name: /^Nominee\s*Optional$/i }).fill("E2E Nominee");
    await page.getByRole("button", { name: "Save changes" }).click();
    await expect(
      page.getByRole("region", { name: "Instructions" }).getByText(/Transfer to my sibling/),
    ).toBeVisible({ timeout: 30_000 });
    await expect(page.getByRole("region", { name: "Nominee" })).toContainText("E2E Nominee");
    await dismissToasts(page);

    // ── 7. Trigger RULE-009: sold, but still assigned ───────────────────────
    const setStatus = async (label: string) => {
      await page.getByRole("button", { name: "Edit", exact: true }).first().click();
      await page
        .getByRole("group", { name: "Legacy details" })
        .locator('[data-slot="select-trigger"]')
        .first()
        .click();
      await page.getByRole("option", { name: label, exact: true }).click();
      await page.getByRole("button", { name: "Save changes" }).click();
      await dismissToasts(page);
    };
    await setStatus("Sold");
    const contradiction = page
      .getByRole("region", { name: "Intelligence" })
      .getByRole("listitem")
      .filter({ hasText: "RULE-009" });
    await expect(contradiction).toContainText(`${asset} is marked sold but is still assigned`, {
      timeout: 60_000,
    });
    // ── 8. Resolve it ───────────────────────────────────────────────────────
    await setStatus("Active");
    await expect(contradiction).toHaveCount(0, { timeout: 60_000 });

    // ── 10. Readiness counts asset coverage as an explained criterion ───────
    await page
      .getByRole("navigation", { name: "Primary" })
      .getByRole("link", { name: "Dashboard" })
      .click();
    const categories = page.getByRole("list", { name: "Readiness by category" });
    await expect(categories).toBeVisible({ timeout: 60_000 });
    await categories.getByText("Beneficiaries", { exact: true }).click();
    await expect(categories.getByText("Every asset you hold has a beneficiary")).toBeVisible();

    // ── 15. Command palette: navigation only ────────────────────────────────
    await page.keyboard.press("Control+K");
    await page.getByRole("textbox", { name: "Search query" }).fill("without beneficiaries");
    await page.getByRole("link", { name: /Show assets without beneficiaries/ }).click();
    await expect(page).toHaveURL(/\/assets\?rule=ASSET-BEN-001/, { timeout: 30_000 });
    await expect(page.getByText(/Showing assets flagged by/)).toBeVisible({ timeout: 60_000 });

    // ── 11. Another owner's (or a non-existent) id is simply not found ──────
    const foreign = "4f1c2b3a-9d8e-4c7b-a6f5-0e1d2c3b4a59";
    const status = await page.evaluate(
      async (id) => (await fetch(`/api/v1/assets/physical/${id}`)).status,
      foreign,
    );
    expect(status).toBe(404);
    await page.goto(`/assets/physical/${foreign}`);
    await expect(page.getByRole("heading", { level: 1, name: "Asset not found" })).toBeVisible({
      timeout: 60_000,
    });

    // ── 14. Mobile Asset Vault: cards, no horizontal scroll ─────────────────
    await page.setViewportSize({ width: 375, height: 812 });
    await gotoAndSettle(page, "/assets", "/api/v1/assets/physical");
    const card = page
      .getByRole("list", { name: "Assets" })
      .getByRole("listitem")
      .filter({ hasText: asset });
    await expect(card).toBeVisible({ timeout: 60_000 });
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);

    // Clean up.
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.getByRole("table").getByRole("link", { name: asset }).click();
    await expect(page.getByRole("heading", { level: 1, name: asset })).toBeVisible({
      timeout: 60_000,
    });
    await deleteAssetFromDetail(page);
    await removeBeneficiary(page, heir);
  });

  test("Legacy Intelligence: palette, type filters, dismiss and restore a heuristic finding", async ({
    page,
  }) => {
    const twin = `E2E Twin ${unique}`;
    await signInAndSettle(page, E2E_USERS.intelligence);
    // Two assets with the same name and category: a potential duplicate (RULE-004).
    await createAsset(page, twin, false);
    await createAsset(page, twin, false);

    // ── 16. Palette → conflicts on Legacy Intelligence ──────────────────────
    await page.keyboard.press("Control+K");
    await page.getByRole("textbox", { name: "Search query" }).fill("conflicting");
    await page.getByRole("link", { name: /Show conflicting legacy information/ }).click();
    await expect(page).toHaveURL(/\/intelligence\?type=CONFLICT/, { timeout: 30_000 });
    await expect(
      page.getByRole("heading", { level: 1, name: "Legacy Intelligence" }),
    ).toBeVisible();
    const filters = page.getByRole("group", { name: "Filter findings by kind" });
    const conflictFilter = filters.getByRole("button", { name: /Potential conflicts/ });
    await expect(conflictFilter).toHaveAttribute("aria-pressed", "true", { timeout: 60_000 });
    const duplicate = page
      .getByRole("list", { name: "Potential conflicts" })
      .getByRole("listitem")
      .filter({ hasText: `Potential duplicate: ${twin}` });
    await expect(duplicate).toBeVisible({ timeout: 60_000 });
    await expect(duplicate.getByText("RULE-004")).toBeVisible();
    await expect(duplicate.getByText("System detected")).toBeVisible();

    // ── 17. Type filters show one kind at a time ────────────────────────────
    await expect(page.getByRole("list", { name: "Missing information" })).toHaveCount(0);
    await filters.getByRole("button", { name: /Missing information/ }).click();
    await expect(
      page
        .getByRole("list", { name: "Missing information" })
        .getByRole("listitem")
        .filter({ hasText: `${twin} has no instructions` })
        .first(),
    ).toBeVisible();
    await expect(page.getByRole("list", { name: "Potential conflicts" })).toHaveCount(0);
    await conflictFilter.click();

    // ── 18. Dismiss the heuristic finding, then restore it ──────────────────
    await duplicate.getByRole("button", { name: /^Dismiss/ }).click();
    await expect(page.getByText("Finding dismissed")).toBeVisible({ timeout: 30_000 });
    await expect(duplicate).toHaveCount(0, { timeout: 30_000 });
    await page.getByRole("button", { name: /^Dismissed · \d+/ }).click();
    const dismissed = page
      .getByRole("list", { name: "Dismissed findings" })
      .getByRole("listitem")
      .filter({ hasText: `Potential duplicate: ${twin}` });
    await expect(dismissed).toBeVisible();
    await dismissToasts(page);
    await dismissed.getByRole("button", { name: /^Restore/ }).click();
    await expect(page.getByText("Finding restored")).toBeVisible({ timeout: 30_000 });
    await expect(duplicate).toBeVisible({ timeout: 30_000 });
    await dismissToasts(page);

    // ── 19. Phone width: no horizontal scroll ───────────────────────────────
    await page.setViewportSize({ width: 375, height: 812 });
    await expect(duplicate).toBeVisible();
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
    await page.setViewportSize({ width: 1280, height: 800 });

    // ── 20. Security Centre renders from the same shared legacy state ───────
    await page
      .getByRole("navigation", { name: "Primary" })
      .getByRole("link", { name: "Security Centre" })
      .click();
    await expect(page.getByRole("heading", { level: 1, name: "Security Centre" })).toBeVisible({
      timeout: 60_000,
    });
    await expect(page.getByText("Recommendations", { exact: true })).toBeVisible({
      timeout: 60_000,
    });

    // Clean up both assets.
    for (let left = 2; left > 0; left--) {
      await gotoAndSettle(page, "/assets", "/api/v1/assets/physical");
      await page.getByRole("table").getByRole("link", { name: twin, exact: true }).first().click();
      await expect(page.getByRole("heading", { level: 1, name: twin })).toBeVisible({
        timeout: 60_000,
      });
      await deleteAssetFromDetail(page);
    }
  });
});
