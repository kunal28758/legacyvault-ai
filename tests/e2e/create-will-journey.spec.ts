import { clerk } from "@clerk/testing/playwright";
import { expect, test, type Page } from "@playwright/test";

import { loadLocalEnv } from "../helpers/load-env";
import { signInAndSettle } from "./session";
import { E2E_USERS } from "./users";

/**
 * The owner's core journey in a real browser against the real stack:
 *
 *   live system status → Create Will (save & continue, skip an optional step,
 *   refresh, resume after signing out and back in) → upload a document straight
 *   to private storage → open it in the AI viewer → upload a second document
 *   from the Dead Man's Switch, which joins its release scope.
 *
 * Every assertion is on server-confirmed state: "Saved" only after the save
 * returned, "Stored privately" only after promotion, and the AI viewer reports
 * the provider state the server reports. No malware scanner exists, and no
 * screen may claim a file was scanned.
 */
loadLocalEnv();

const email = E2E_USERS.journey;
const configured = Boolean(
  process.env.CLERK_SECRET_KEY && process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY,
);
const aiConfigured = Boolean(
  (process.env.OPENAI_API_KEY && !/REPLACE_ME/.test(process.env.OPENAI_API_KEY)) ||
  (process.env.GEMINI_API_KEY && !/REPLACE_ME/.test(process.env.GEMINI_API_KEY)),
);

const unique = Date.now().toString(36);
const documentName = `E2E Policy ${unique}.pdf`;
const releaseDocumentName = `E2E Release Letter ${unique}.pdf`;
const PDF = Buffer.from(
  "%PDF-1.7\n1 0 obj<</Type/Catalog>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n",
  "utf8",
);

async function openWizardStep(page: Page, step: number, heading: RegExp) {
  await page.goto(`/legacy-plan/wizard?step=${step}`);
  await expect(page.getByRole("heading", { level: 2, name: heading })).toBeVisible({
    timeout: 60_000,
  });
}

test.describe("create will, upload and AI journey", () => {
  test.skip(
    !configured,
    "Clerk development keys are not configured — see docs/DEPLOYMENT.md § Clerk.",
  );
  test.describe.configure({ mode: "serial" });

  test("the owner journey persists across refresh and sign-in", async ({ page }) => {
    test.setTimeout(300_000);
    await signInAndSettle(page, email);

    // ── Live system status: real probes, never a default green ──────────────
    const indicator = page.getByRole("button", { name: /Show system status/ });
    await expect(indicator).toBeVisible();
    await expect(indicator).not.toHaveAccessibleName(/Checking status/, { timeout: 30_000 });
    await indicator.click();
    const popover = page.getByRole("dialog").filter({ hasText: "System status" });
    await expect(popover).toBeVisible();
    await expect(popover.getByRole("list", { name: "Services" })).toContainText("Database");
    await expect(popover).not.toContainText("Malware scanner");
    if (!aiConfigured) {
      await expect(popover.getByRole("listitem").filter({ hasText: "AI services" })).toContainText(
        "Not configured",
      );
    }
    await page.keyboard.press("Escape");

    // ── Step 1: fill, auto-save, Save & continue ────────────────────────────
    await openWizardStep(page, 1, /Personal details/i);
    await page.getByLabel("Full legal name").fill(`Journey Owner ${unique}`);
    await page.getByLabel("Date of birth").fill("1975-06-15");
    await page.getByLabel("Street address").fill("7 Residency Road");
    await page.getByLabel("City").fill("Bengaluru");
    await page.getByLabel("Country").fill("India");
    await expect(page.getByRole("status").filter({ hasText: /Saved/ })).toBeVisible({
      timeout: 30_000,
    });
    await page.getByRole("button", { name: /Save & continue/ }).click();

    // ── Step 2: optional — skip it ──────────────────────────────────────────
    await expect(page.getByRole("heading", { level: 2, name: /Family information/i })).toBeVisible({
      timeout: 30_000,
    });
    await page.getByRole("button", { name: "Skip for now" }).click();
    await expect(page.getByRole("heading", { level: 2, name: /Beneficiaries/i })).toBeVisible({
      timeout: 30_000,
    });
    await expect(page).toHaveURL(/step=3/);

    // ── Refresh keeps the step and the data ─────────────────────────────────
    await page.reload();
    await expect(page.getByRole("heading", { level: 2, name: /Beneficiaries/i })).toBeVisible({
      timeout: 60_000,
    });
    await openWizardStep(page, 2, /Family information/i);
    await expect(page.getByText("Skipped — you can complete this later.")).toBeVisible();

    // Personal details are required: step 1 offers no skip.
    await openWizardStep(page, 1, /Personal details/i);
    await expect(page.getByRole("button", { name: "Skip for now" })).toHaveCount(0);

    // ── Sign out, sign back in, resume ──────────────────────────────────────
    await clerk.signOut({ page });
    await signInAndSettle(page, email);
    await openWizardStep(page, 1, /Personal details/i);
    await expect(page.getByLabel("Full legal name")).toHaveValue(`Journey Owner ${unique}`, {
      timeout: 30_000,
    });

    // The review step shows the skipped section as skipped, not as done.
    await openWizardStep(page, 6, /Review your plan/i);
    // The review row, not the stepper entry of the same name: only the review
    // row has an Edit button.
    const family = page
      .getByRole("listitem")
      .filter({ hasText: "Family Information" })
      .filter({ has: page.getByRole("button", { name: "Edit" }) });
    await expect(family).toContainText("Skipped — you can complete this later.");
    await expect(family.getByText("skipped", { exact: true })).toBeAttached();
    await expect(page.getByText("Release & security")).toBeVisible();

    // ── Upload: validation → private storage → size/type checks → vault ─────
    await page.goto("/documents");
    await page
      .getByRole("button", { name: /^Upload( your first document)?$/ })
      .first()
      .click();
    await page.setInputFiles('input[type="file"]', {
      name: documentName,
      mimeType: "application/pdf",
      buffer: PDF,
    });
    await page.getByRole("button", { name: "Upload", exact: true }).last().click();
    const card = page.getByRole("listitem").filter({ hasText: documentName });
    await expect(card.getByRole("status")).toHaveText("Stored privately", { timeout: 120_000 });
    await expect(card).toContainText("File size and type checked");
    await expect(card).not.toContainText(/scan/i);
    // Scoped and exact: a toast's "Close toast" button also matches "Close".
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Close", exact: true })
      .last()
      .click();
    await expect(page.getByRole("dialog")).toBeHidden({ timeout: 30_000 });
    await expect(page.getByText(documentName).first()).toBeVisible({ timeout: 30_000 });

    // ── AI viewer: honest about the provider state ──────────────────────────
    await page.getByRole("button", { name: `Actions for ${documentName}` }).click();
    await page.getByRole("menuitem", { name: "Open in AI viewer" }).click();
    const viewer = page.getByRole("dialog").filter({ hasText: documentName });
    await expect(viewer.getByRole("toolbar", { name: "Document actions" })).toBeVisible();
    if (!aiConfigured) {
      await expect(viewer.getByText("AI not configured")).toBeVisible({ timeout: 30_000 });
      // Once the saved results have loaded, the empty summary panel offers a
      // Summarize button that cannot run without a provider.
      const summaryPanel = viewer
        .getByText("No summary yet for this version of the document.")
        .locator("..");
      await expect(summaryPanel).toBeVisible({ timeout: 60_000 });
      await expect(summaryPanel.getByRole("button", { name: /^Summarize$/ })).toBeDisabled();
    }
    await expect(viewer.getByText(/Scanned by|Not scanned/)).toHaveCount(0);
    await page.keyboard.press("Escape");

    // ── Dead Man's Switch: the same upload pipeline, into the release scope ─
    await page.goto("/dead-man-switch");
    await page
      .getByRole("button", { name: /^(Enable|Configure)$/ })
      .first()
      .click();
    await page.getByRole("button", { name: "Upload document" }).click({ timeout: 30_000 });
    const releaseDialog = page
      .getByRole("dialog")
      .filter({ hasText: "Upload a document for release" });
    await releaseDialog.locator('input[type="file"]').setInputFiles({
      name: releaseDocumentName,
      mimeType: "application/pdf",
      buffer: PDF,
    });
    await releaseDialog.getByRole("button", { name: "Upload", exact: true }).click();
    const releaseCard = releaseDialog
      .getByRole("listitem")
      .filter({ hasText: releaseDocumentName });
    await expect(releaseCard.getByRole("status")).toHaveText("Stored privately", {
      timeout: 120_000,
    });
    await releaseDialog.getByRole("button", { name: "Close", exact: true }).last().click();
    await expect(releaseDialog).toBeHidden({ timeout: 30_000 });
    // The upload joined the release scope without any further step.
    await expect(
      page.getByRole("listitem").filter({ hasText: releaseDocumentName }).getByRole("checkbox"),
    ).toBeChecked({ timeout: 30_000 });
    await page.keyboard.press("Escape");

    // ── Leave the account as it was found ───────────────────────────────────
    await page.goto("/documents");
    for (const name of [documentName, releaseDocumentName]) {
      await page.getByRole("button", { name: `Actions for ${name}` }).click();
      await page.getByRole("menuitem", { name: "Delete" }).click();
      await page.getByRole("button", { name: "Delete document" }).click();
      await expect(page.locator("p", { hasText: name })).toHaveCount(0, { timeout: 30_000 });
    }
  });
});
