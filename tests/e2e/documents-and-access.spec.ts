import { expect, test, type Page } from "@playwright/test";

import { loadLocalEnv } from "../helpers/load-env";
import { signInAndSettle } from "./session";
import { E2E_USERS } from "./users";

/**
 * The whole delivery path, once, in a real browser (Batch 3 + Batch 4).
 *
 * A document is uploaded through the signed-URL pipeline into private storage,
 * shared with a beneficiary, covered by an access link — and then the link is
 * opened in a **separate browser context with no Clerk session at all**, which
 * is the only honest way to prove that the recipient's side works on the access
 * cookie alone. Finally the link is revoked and the same page is refused.
 */
loadLocalEnv();

const email = E2E_USERS.access;
const configured = Boolean(
  process.env.CLERK_SECRET_KEY && process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY,
);

const unique = Date.now().toString(36);
const documentName = `E2E Deed ${unique}.pdf`;
const heirName = `E2E Heir ${unique}`;

/** A real, minimal PDF: the pipeline sniffs magic bytes, so `%PDF-` must be there. */
const PDF = Buffer.from(
  "%PDF-1.7\n1 0 obj<</Type/Catalog>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n",
  "utf8",
);

async function gotoAndSettle(page: Page, path: string, apiPath: string): Promise<void> {
  const settled = page.waitForResponse(
    (response) => response.url().includes(apiPath) && response.request().method() === "GET",
    { timeout: 120_000 },
  );
  await page.goto(path);
  await settled;
}

test.describe("documents and access links", () => {
  test.skip(
    !configured,
    "Clerk development keys are not configured — see docs/DEPLOYMENT.md § Clerk.",
  );
  test.describe.configure({ mode: "serial" });

  test("uploads, shares, hands out a link and revokes it", async ({ page, browser }) => {
    test.setTimeout(240_000);
    await signInAndSettle(page, email);

    // ── A beneficiary to share with ─────────────────────────────────────────
    await gotoAndSettle(page, "/beneficiaries", "/api/v1/beneficiaries");
    await page
      .getByRole("button", { name: /Add (your first )?beneficiary/ })
      .first()
      .click();
    await page.getByLabel("Full name").fill(heirName);
    await page.locator('[data-slot="select-trigger"]').click();
    await page.getByRole("option", { name: "Sibling", exact: true }).click();
    await page.getByLabel("Email").fill(`e2e-access+${unique}@example.com`);
    await page.getByRole("button", { name: "Add beneficiary", exact: true }).last().click();
    await expect(page.getByRole("table").locator("tr", { hasText: heirName })).toBeVisible({
      timeout: 30_000,
    });

    // ── Upload a document through the two-step signed-URL flow ──────────────
    await gotoAndSettle(page, "/documents", "/api/v1/documents");
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
    // "Securely stored" appears only once the server has scanned the file and
    // `promote_upload()` has moved it out of quarantine. (The file's name alone
    // proves nothing: the upload queue shows it as soon as it is selected, and
    // the dialog refuses to close while an upload is still in flight.)
    const uploaded = page
      .getByRole("dialog")
      .getByRole("listitem")
      .filter({ hasText: documentName });
    await expect(uploaded.getByRole("status")).toHaveText("Securely stored", { timeout: 120_000 });
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Close", exact: true })
      .last()
      .click();
    await expect(page.getByRole("dialog")).toBeHidden({ timeout: 30_000 });

    // ── Share it, which is what makes it eligible for a link ────────────────
    await page.getByRole("button", { name: `Actions for ${documentName}` }).click();
    await page.getByRole("menuitem", { name: "Share with beneficiary" }).click();
    await page.getByRole("dialog").locator('[data-slot="select-trigger"]').click();
    await page.getByRole("option", { name: new RegExp(heirName) }).click();
    await page.getByRole("button", { name: "Share document" }).click();
    await expect(page.getByRole("dialog")).toBeHidden({ timeout: 30_000 });

    // ── Issue the access link from the beneficiary's own panel ──────────────
    await gotoAndSettle(page, "/beneficiaries", "/api/v1/beneficiaries");
    await page.getByRole("button", { name: `Actions for ${heirName}` }).click();
    await page.getByRole("menuitem", { name: "View details" }).click();

    const panel = page.getByText("Access links").locator("..");
    await expect(panel.getByText(documentName)).toBeVisible({ timeout: 30_000 });
    await panel.getByRole("checkbox").first().click();
    await page.getByRole("button", { name: "Create and email the link" }).click();

    const linkCode = page.locator("code", { hasText: "/access?t=" });
    await expect(linkCode).toBeVisible({ timeout: 30_000 });
    const link = (await linkCode.innerText()).trim();
    expect(link).toContain("/access?t=");

    // ── Open it as the recipient: a clean context, no Clerk session ─────────
    const recipient = await browser.newContext();
    const recipientPage = await recipient.newPage();
    await recipientPage.goto(link);

    await expect(recipientPage.getByText(documentName)).toBeVisible({ timeout: 60_000 });
    await expect(recipientPage.getByRole("heading", { level: 1 })).toContainText(
      "shared these with you",
    );
    // The secret must not survive in the address bar.
    expect(recipientPage.url()).not.toContain("t=");

    // ── Revoke, and the same page is refused ────────────────────────────────
    await page.getByRole("button", { name: "Revoke" }).first().click();
    await expect(page.getByText("Link revoked")).toBeVisible({ timeout: 30_000 });

    await recipientPage.reload();
    await expect(recipientPage.getByText("This link cannot be opened")).toBeVisible({
      timeout: 60_000,
    });
    await recipient.close();

    // ── Leave the account as it was found ───────────────────────────────────
    await page.getByRole("button", { name: "Close" }).first().click();
    await gotoAndSettle(page, "/documents", "/api/v1/documents");
    await page.getByRole("button", { name: `Actions for ${documentName}` }).click();
    await page.getByRole("menuitem", { name: "Delete" }).click();
    await page.getByRole("button", { name: "Delete document" }).click();
    await expect(page.getByRole("dialog")).toBeHidden({ timeout: 30_000 });
    await expect(page.locator("p", { hasText: documentName })).toHaveCount(0, {
      timeout: 30_000,
    });
  });
});
