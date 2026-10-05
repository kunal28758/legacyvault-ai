import { createHash, randomBytes } from "node:crypto";

import { expect, test, type Page } from "@playwright/test";

import {
  createServiceScopedClient,
  createUserScopedClient,
  hasLocalStackConfig,
} from "../helpers/db";
import { loadLocalEnv } from "../helpers/load-env";
import { signInAndSettle } from "./session";
import { E2E_USERS } from "./users";

/**
 * The whole delivery path, once, in a real browser (Batch 3 + Batch 4 + 0007).
 *
 * Documents are uploaded through the signed-URL pipeline into private storage
 * and shared with a beneficiary, who opens their link in a **separate browser
 * context with no Clerk session at all** — the only honest way to prove the
 * recipient's side works on the access cookie alone. A second document shared
 * later appears in that same session with no new link; unsharing the first
 * removes it at once; revoking the link ends the session.
 *
 * Sharing emails the link itself, and no inbox is readable here, so the
 * recipient's link is minted exactly as the emailed one is — through
 * `issue_document_share_token()`, as the signed-in owner — against the local
 * stack. Against a remote deployment that step cannot run, and the journey is
 * skipped rather than faked.
 */
loadLocalEnv();

const email = E2E_USERS.access;
const configured = Boolean(
  process.env.CLERK_SECRET_KEY && process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY,
);
const local = hasLocalStackConfig() && !process.env.PLAYWRIGHT_BASE_URL;

const unique = Date.now().toString(36);
const deedName = `E2E Deed ${unique}.pdf`;
const willName = `E2E Will ${unique}.pdf`;
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

async function upload(page: Page, name: string): Promise<void> {
  await page
    .getByRole("button", { name: /^Upload( your first document)?$/ })
    .first()
    .click();
  await page.setInputFiles('input[type="file"]', {
    name,
    mimeType: "application/pdf",
    buffer: PDF,
  });
  await page.getByRole("button", { name: "Upload", exact: true }).last().click();
  // "Stored privately" appears only once the server has checked the bytes that
  // arrived and `promote_upload()` has added the file. (The file's name alone
  // proves nothing: the upload queue shows it as soon as it is selected, and the
  // dialog refuses to close while an upload is still in flight.)
  const uploaded = page.getByRole("dialog").getByRole("listitem").filter({ hasText: name });
  await expect(uploaded.getByRole("status")).toHaveText("Stored privately", { timeout: 120_000 });
  await page.getByRole("dialog").getByRole("button", { name: "Close", exact: true }).last().click();
  await expect(page.getByRole("dialog")).toBeHidden({ timeout: 30_000 });
}

async function share(page: Page, name: string): Promise<void> {
  await page.getByRole("button", { name: `Actions for ${name}` }).click();
  await page.getByRole("menuitem", { name: "Share with beneficiary" }).click();
  await page.getByRole("dialog").locator('[data-slot="select-trigger"]').click();
  await page.getByRole("option", { name: new RegExp(heirName) }).click();
  await page.getByRole("button", { name: "Share document" }).click();
  await expect(page.getByRole("dialog")).toBeHidden({ timeout: 30_000 });
  // The server reports whether the link email went out; no inbox is configured
  // locally, so either answer is honest — what matters is that nobody copied it.
  await expect(
    page.getByText(/emailed them a secure link|email could not be sent/).first(),
  ).toBeVisible({ timeout: 30_000 });
}

/** The link the share emails, minted the same way for a test that cannot read mail. */
async function emailedLinkFor(baseURL: string): Promise<string> {
  const service = createServiceScopedClient();
  const { data: owner } = await service
    .from("users")
    .select("id, clerk_user_id")
    .eq("email", email)
    .single();
  const { data: heir } = await service
    .from("beneficiaries")
    .select("id")
    .eq("user_id", owner!.id)
    .eq("name", heirName)
    .single();

  const secret = randomBytes(32).toString("base64url");
  const asOwner = await createUserScopedClient(owner!.clerk_user_id);
  const { error } = await asOwner.rpc("issue_document_share_token", {
    p_beneficiary_id: heir!.id,
    p_token_hash: createHash("sha256").update(secret, "utf8").digest("hex"),
    p_expires_at: new Date(Date.now() + 86_400_000).toISOString(),
  });
  if (error) throw new Error(`could not mint the share link: ${error.message}`);
  return `${baseURL.replace(/\/$/, "")}/access?t=${secret}`;
}

test.describe("documents and access links", () => {
  test.skip(
    !configured,
    "Clerk development keys are not configured — see docs/DEPLOYMENT.md § Clerk.",
  );
  test.skip(!local, "Needs the local Supabase stack to stand in for the emailed link.");
  test.describe.configure({ mode: "serial" });

  test("shares documents into one link, follows later shares, and revokes", async ({
    page,
    browser,
    baseURL,
  }) => {
    test.setTimeout(420_000);
    await signInAndSettle(page, email);

    // ── A beneficiary to share with; the server sends the invitation ────────
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
    await expect(
      page.getByText(/emailed them an invitation|invitation email could not be sent/).first(),
    ).toBeVisible({ timeout: 30_000 });

    // ── Two documents; the first is shared ──────────────────────────────────
    await gotoAndSettle(page, "/documents", "/api/v1/documents");
    await upload(page, deedName);
    await upload(page, willName);
    await share(page, deedName);

    // ── The recipient opens their link: a clean context, no Clerk session ───
    const recipient = await browser.newContext();
    const recipientPage = await recipient.newPage();
    await recipientPage.goto(await emailedLinkFor(baseURL!));

    await expect(recipientPage.getByText(deedName)).toBeVisible({ timeout: 60_000 });
    await expect(recipientPage.getByRole("heading", { level: 1 })).toContainText(
      "shared these with you",
    );
    await expect(recipientPage.getByText(willName)).toHaveCount(0);
    // The secret must not survive in the address bar.
    expect(recipientPage.url()).not.toContain("t=");

    // ── A second share appears in the same session — no new link ────────────
    await share(page, willName);
    await recipientPage.reload();
    await expect(recipientPage.getByText(willName)).toBeVisible({ timeout: 60_000 });
    await expect(recipientPage.getByText(deedName)).toBeVisible();

    // ── Unsharing the first removes it at once ──────────────────────────────
    await page.getByRole("button", { name: `Actions for ${deedName}` }).click();
    await page.getByRole("menuitem", { name: "Details & versions" }).click();
    await page.getByRole("button", { name: "Revoke" }).first().click();
    await expect(page.getByText("Share revoked")).toBeVisible({ timeout: 30_000 });
    await page.getByRole("button", { name: "Close" }).first().click();

    await recipientPage.reload();
    await expect(recipientPage.getByText(willName)).toBeVisible({ timeout: 60_000 });
    await expect(recipientPage.getByText(deedName)).toHaveCount(0);

    // ── Revoking the link ends the session ──────────────────────────────────
    await gotoAndSettle(page, "/beneficiaries", "/api/v1/beneficiaries");
    await page.getByRole("button", { name: `Actions for ${heirName}` }).click();
    await page.getByRole("menuitem", { name: "View details" }).click();
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
    for (const name of [deedName, willName]) {
      await page.getByRole("button", { name: `Actions for ${name}` }).click();
      await page.getByRole("menuitem", { name: "Delete" }).click();
      await page.getByRole("button", { name: "Delete document" }).click();
      await expect(page.getByRole("dialog")).toBeHidden({ timeout: 30_000 });
      await expect(page.locator("p", { hasText: name })).toHaveCount(0, { timeout: 30_000 });
    }
  });
});
