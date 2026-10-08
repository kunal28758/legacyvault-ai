import { createHash, randomBytes } from "node:crypto";

import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Browser, type Page } from "@playwright/test";

import {
  createServiceScopedClient,
  createUserScopedClient,
  hasLocalStackConfig,
} from "../helpers/db";
import { loadLocalEnv } from "../helpers/load-env";
import { captureUrl, codeIn, linkIn, startMailCapture, type MailCapture } from "./mail-capture";
import { signInAndSettle } from "./session";
import { E2E_USERS } from "./users";

/**
 * The Legacy Execution Engine in a real browser, against the real stack.
 *
 * The owner configures the switch, checks in, and recovers from every stage
 * before release through the UI. Time is the only thing arranged: a switch is
 * made overdue in the local database, then the **real** scheduler runs through
 * the cron endpoints — scan, owner warnings, contact notice, release, delivery
 * — exactly as production's job runner does.
 *
 * What a recipient receives is read from a local stand-in for the mail
 * provider (tests/e2e/mail-capture.ts) when the dev server was started with
 * RESEND_BASE_URL pointing at it; then the contact opens the real emailed link
 * in a separate browser context with no Clerk session and enters the real
 * emailed code. Without that stand-in, those journeys are skipped — not faked —
 * and the spec instead proves the release gate stays shut when no code can be
 * sent.
 */
loadLocalEnv();

const OWNER = E2E_USERS.execution;
const OTHER = E2E_USERS.executionOther;
const EA_OWNER = E2E_USERS.executionEmergency;
const configured = Boolean(
  process.env.CLERK_SECRET_KEY && process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY,
);
const local = hasLocalStackConfig() && !process.env.PLAYWRIGHT_BASE_URL;
const mailUrl = captureUrl();
const BASE =
  process.env.PLAYWRIGHT_BASE_URL ?? `http://localhost:${process.env.PLAYWRIGHT_PORT ?? 3000}`;

const unique = Date.now().toString(36);
const heirName = `E2E Heir ${unique}`;
const heirEmail = `e2e-heir-${unique}@example.com`;
const releasedAsset = `E2E Released ${unique}`;
const keptAsset = `E2E Kept ${unique}`;

type Db = ReturnType<typeof createServiceScopedClient>;
let service: Db;
let mail: MailCapture | null = null;
let owner: { id: string; clerk_user_id: string };
let heirId: string;

async function userRow(email: string): Promise<{ id: string; clerk_user_id: string }> {
  const { data, error } = await service
    .from("users")
    .select("id, clerk_user_id")
    .eq("email", email)
    .single();
  if (error) throw error;
  return data as { id: string; clerk_user_id: string };
}

/** Removes everything this spec created for an owner (local database only). */
async function cleanUp(userId = owner?.id): Promise<void> {
  if (!userId) return;
  await service.from("access_tokens").delete().eq("owner_user_id", userId);
  await service.from("emergency_access_configs").delete().eq("user_id", userId);
  await service.from("dead_man_switches").delete().eq("user_id", userId);
  await service.from("notifications").delete().eq("user_id", userId);
  await service.from("beneficiaries").delete().eq("user_id", userId);
  await service.from("financial_assets").delete().eq("user_id", userId);
}

/**
 * Back to Active through the system side. The UI recovery is exercised once,
 * in the release journey; repeating it would spend the owner's step-up budget
 * (`sensitive`, 5 per 15 minutes) that the limiter rightly enforces.
 */
async function resetToActive(): Promise<void> {
  const { id } = await switchRow();
  await service
    .from("access_tokens")
    .update({ revoked_at: new Date().toISOString(), revoked_reason: "RECOVERY" })
    .eq("dead_man_switch_id", id)
    .is("revoked_at", null);
  await service
    .from("dead_man_switches")
    .update({
      status: "ACTIVE",
      last_check_in_at: new Date().toISOString(),
      next_check_in_at: new Date(Date.now() + 30 * 86_400_000).toISOString(),
      current_escalation_step: 0,
    })
    .eq("id", id);
}

async function switchRow(userId = owner.id): Promise<{ id: string; status: string }> {
  const { data, error } = await service
    .from("dead_man_switches")
    .select("id, status")
    .eq("user_id", userId)
    .single();
  if (error) throw error;
  return data as { id: string; status: string };
}

/** The scan's own system path, for the stages a journey only needs to be in. */
async function transition(
  from: string,
  to: string,
  event: string,
  userId = owner.id,
): Promise<void> {
  const { id } = await switchRow(userId);
  const { error } = await service.rpc("dms_transition", {
    p_switch_id: id,
    p_from: from,
    p_to: to,
    p_event_type: event,
    p_metadata: { nextCheckInAt: new Date(Date.now() + 3_600_000).toISOString() },
  });
  if (error) throw error;
}

async function cron(path: "dms-scan" | "run-jobs"): Promise<void> {
  const response = await fetch(`${BASE}/api/internal/cron/${path}`, {
    method: "POST",
    headers: { authorization: `Bearer ${process.env.CRON_SECRET ?? ""}` },
  });
  expect(response.ok, `cron ${path} answered ${response.status}`).toBe(true);
}

/** Runs the job runner until the expected email has been sent (or gives up). */
async function jobsUntilMail(to: string, subject: RegExp) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    await cron("run-jobs");
    const sent = mail!.messages.find((item) => item.to.includes(to) && subject.test(item.subject));
    if (sent) return sent;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  return mail!.waitFor(to, subject, 1);
}

/** Delivery confirmations wait two minutes before asking; time is what a journey arranges. */
async function confirmationsDue(): Promise<void> {
  await service
    .from("jobs")
    .update({ run_at: new Date().toISOString() })
    .eq("type", "notification.confirm")
    .eq("status", "QUEUED");
}

/**
 * One hourly tick of the real scheduler, then the job runner three times:
 * the scan, the emails it queued, and the provider confirming them.
 */
async function schedulerTick(): Promise<string> {
  await service.from("jobs").delete().like("idempotency_key", "dms.scan:%");
  await cron("dms-scan");
  await cron("run-jobs");
  await cron("run-jobs");
  await confirmationsDue();
  await cron("run-jobs");
  return (await switchRow()).status;
}

async function gotoSwitch(page: Page): Promise<void> {
  const loaded = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/v1/dead-man-switch") && response.request().method() === "GET",
    { timeout: 120_000 },
  );
  await page.goto("/dead-man-switch");
  await loaded;
}

async function checkIn(page: Page): Promise<void> {
  const done = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/v1/dead-man-switch/check-in") &&
      response.request().method() === "POST",
  );
  await page.getByRole("button", { name: "Check in", exact: true }).click();
  expect((await done).ok()).toBe(true);
  await expect(page.getByTestId("dms-state")).toHaveText("Active", { timeout: 30_000 });
}

/** A release link minted exactly as `access.deliver` mints one (system_issue_access_token). */
async function mintReleaseLink(
  beneficiaryId = heirId,
  userId = owner.id,
): Promise<{ link: string; tokenId: string }> {
  const { id: switchId } = await switchRow(userId);
  const { data: dms } = await service
    .from("dead_man_switches")
    .select("release_scope")
    .eq("id", switchId)
    .single();
  const secret = randomBytes(32).toString("base64url");
  const { data: tokenId, error } = await service.rpc("system_issue_access_token", {
    p_beneficiary_id: beneficiaryId,
    p_grant_type: "DMS_RELEASE",
    p_scope: dms!.release_scope,
    p_token_hash: createHash("sha256").update(secret, "utf8").digest("hex"),
    p_expires_at: new Date(Date.now() + 86_400_000).toISOString(),
    p_dms_id: switchId,
  });
  if (error) throw new Error(`could not mint the release link: ${error.message}`);
  return { link: `${BASE}/access#t=${secret}`, tokenId: tokenId as string };
}

/** Moves a recovered switch to RELEASED through the system path, warned as the gate requires. */
async function releaseNow(userId = owner.id): Promise<void> {
  const { id } = await switchRow(userId);
  // As notification.deliver and notification.confirm would leave a warning
  // the provider confirmed delivered — the release gate's requirement.
  await service.from("notifications").insert({
    user_id: userId,
    type: "dms.grace_period",
    title: "Your LegacyVault check-in is overdue",
    content: "Arranged by the journey: the warning email was delivered.",
    channel: "BOTH",
    delivery_status: "DELIVERED",
    provider_message_id: `e2e-arranged-${randomBytes(6).toString("hex")}`,
    delivery_provider: "resend",
    metadata: { switchId: id },
  });
  await transition("ACTIVE", "REMINDER_SENT", "MISSED_CHECK_IN", userId);
  await transition("REMINDER_SENT", "GRACE_PERIOD", "MISSED_CHECK_IN", userId);
  await transition("GRACE_PERIOD", "ESCALATING", "ESCALATION_STEP", userId);
  await transition("ESCALATING", "RELEASING", "ESCALATION_STEP", userId);
  await transition("RELEASING", "RELEASED", "RELEASE", userId);
  // These journeys mint their own links; the queued deliveries are not theirs.
  await service.from("jobs").delete().eq("type", "access.deliver");
  await service.from("jobs").delete().eq("type", "dms.contact-notice");
}

async function recipientPage(browser: Browser, phone = false): Promise<Page> {
  // A separate context: no Clerk session, only what the link itself grants.
  const context = await browser.newContext(
    phone ? { viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true } : {},
  );
  return context.newPage();
}

function noOverflow(page: Page) {
  return page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
}

test.describe("legacy execution engine", () => {
  test.skip(
    !configured,
    "Clerk development keys are not configured — see docs/DEPLOYMENT.md § Clerk.",
  );
  test.skip(!local, "Needs the local Supabase stack to move time forward.");
  test.describe.configure({ mode: "serial" });
  test.setTimeout(300_000);

  test.beforeAll(async () => {
    service = createServiceScopedClient();
    if (mailUrl) mail = await startMailCapture(Number(mailUrl.port));
  });

  test.afterAll(async () => {
    await cleanUp();
    await mail?.close();
  });

  test("enables the switch: validated schedule, an explicit contact and an explicit scope", async ({
    page,
  }) => {
    await signInAndSettle(page, OWNER);
    owner = await userRow(OWNER);
    await cleanUp();

    // Arranged as the owner, through RLS and the guarded asset function.
    const asOwner = await createUserScopedClient(owner.clerk_user_id);
    const { data: heir, error: heirError } = await asOwner
      .from("beneficiaries")
      .insert({ user_id: owner.id, name: heirName, relationship: "Sibling", email: heirEmail })
      .select("id")
      .single();
    if (heirError) throw heirError;
    heirId = heir.id;
    for (const name of [releasedAsset, keptAsset]) {
      const { error } = await asOwner.rpc("create_asset", {
        p_resource_type: "FINANCIAL_ASSET",
        p_plain: { name, category: "BANK_ACCOUNT", currency: "INR" },
      });
      if (error) throw error;
    }

    await gotoSwitch(page);
    await expect(page.getByTestId("dms-state")).toHaveText("Disabled");
    await page.getByRole("button", { name: "Enable", exact: true }).click();
    const sheet = page.getByRole("dialog", { name: /Enable the Dead Man/ });
    await expect(sheet).toBeVisible();

    // An interval as long as the threshold leaves no time to warn: refused here.
    await sheet.getByLabel("Check-in interval (days)", { exact: true }).fill("30");
    await sheet.getByLabel("Inactivity threshold (days)", { exact: true }).fill("30");
    await expect(sheet.getByRole("alert")).toHaveText(/shorter than the inactivity threshold/);
    await sheet.getByLabel("Inactivity threshold (days)", { exact: true }).fill("90");
    await sheet.getByLabel("Grace period (hours)", { exact: true }).fill("24");
    await expect(sheet.getByText("If you stopped checking in today")).toBeVisible();

    await sheet.getByRole("checkbox", { name: new RegExp(heirName) }).check();
    await sheet.getByRole("checkbox", { name: releasedAsset }).check({ timeout: 60_000 });
    const saved = page.waitForResponse(
      (response) =>
        response.url().endsWith("/api/v1/dead-man-switch") &&
        response.request().method() === "POST",
    );
    await sheet.getByRole("button", { name: "Enable switch" }).click();
    expect((await saved).status()).toBe(200);
    await expect(sheet).toBeHidden({ timeout: 30_000 });

    await expect(page.getByTestId("dms-state")).toHaveText("Active", { timeout: 30_000 });
    await expect(page.getByRole("list", { name: "Projected schedule" })).toBeVisible();
    await expect(page.getByText(heirName).first()).toBeVisible();
    // Only what was chosen is in the scope.
    await expect(page.getByText(releasedAsset).first()).toBeVisible();
    await expect(page.getByText(keptAsset)).toHaveCount(0);

    const { data: row } = await service
      .from("dead_man_switches")
      .select("check_in_frequency_days, inactivity_period_days, escalation_delay_hours")
      .eq("user_id", owner.id)
      .single();
    expect(row).toEqual({
      check_in_frequency_days: 30,
      inactivity_period_days: 90,
      escalation_delay_hours: 24,
    });
  });

  test("checks in, then recovers by checking in from the warning and the grace period", async ({
    page,
  }) => {
    await signInAndSettle(page, OWNER);
    await gotoSwitch(page);
    await checkIn(page);

    await transition("ACTIVE", "REMINDER_SENT", "MISSED_CHECK_IN");
    await gotoSwitch(page);
    await expect(page.getByTestId("dms-state")).toHaveText("Check-in due");
    await expect(page.getByText(/No recent check-in was recorded/).first()).toBeVisible();
    await page.goto("/actions");
    await expect(page.getByText("Check-in overdue").first()).toBeVisible({ timeout: 60_000 });

    await transition("REMINDER_SENT", "GRACE_PERIOD", "MISSED_CHECK_IN");
    await gotoSwitch(page);
    await expect(page.getByTestId("dms-state")).toHaveText("Grace period");
    await checkIn(page);

    // Every one of those changes is in the owner's own audit trail.
    await page.goto("/activity");
    await expect(page.getByText("Dms checked in").first()).toBeVisible({ timeout: 60_000 });
    await expect(page.getByText("Dms configured").first()).toBeVisible();
  });

  test("a pending release says nothing was released, and a check-in cancels it", async ({
    page,
  }) => {
    await signInAndSettle(page, OWNER);
    await transition("ACTIVE", "REMINDER_SENT", "MISSED_CHECK_IN");
    await transition("REMINDER_SENT", "GRACE_PERIOD", "MISSED_CHECK_IN");
    await transition("GRACE_PERIOD", "ESCALATING", "ESCALATION_STEP");

    await gotoSwitch(page);
    await expect(page.getByTestId("dms-state")).toHaveText("Release pending");
    await expect(page.getByText("Nothing has been released. Check in now").first()).toBeVisible();
    await page.goto("/actions");
    await expect(page.getByText("A release is pending — check in to stop it").first()).toBeVisible({
      timeout: 60_000,
    });

    await gotoSwitch(page);
    await checkIn(page);
    const { data: events } = await service
      .from("dead_man_switch_events")
      .select("event_type, previous_state")
      .eq("dead_man_switch_id", (await switchRow()).id)
      .order("created_at", { ascending: false })
      .limit(1);
    expect(events![0]).toEqual({ event_type: "RECOVERY", previous_state: "ESCALATING" });
  });

  test("releases through the real scheduler, and the contact verifies before anything opens", async ({
    page,
    browser,
  }) => {
    test.skip(!mail, "Start the dev server with RESEND_BASE_URL set to read what was sent.");
    await signInAndSettle(page, OWNER);
    const { id } = await switchRow();
    const past = new Date(Date.now() - 400 * 86_400_000).toISOString();
    await service
      .from("dead_man_switches")
      .update({ last_check_in_at: past, next_check_in_at: past })
      .eq("id", id);

    const seen: string[] = [];
    for (let tick = 0; tick < 10 && seen.at(-1) !== "RELEASED"; tick += 1) {
      seen.push(await schedulerTick());
      await service
        .from("dead_man_switches")
        .update({ next_check_in_at: new Date(Date.now() - 1000).toISOString() })
        .eq("id", id);
    }
    expect(seen).toContain("GRACE_PERIOD");
    expect(seen).toContain("ESCALATING");
    expect(seen.at(-1)).toBe("RELEASED");

    // The owner was warned, the contact was told — with no link — then released to.
    await mail!.waitFor(OWNER, /check-in is overdue/);
    const notice = await mail!.waitFor(heirEmail, /emergency release workflow has started/);
    expect(notice.html).not.toMatch(/\/access[?#]t=/);
    await cron("run-jobs");
    const delivered = await mail!.waitFor(heirEmail, /shared secure access/);
    const link = linkIn(delivered, "/access#t=");

    // Owner side: release visible, Action Centre critical, contact not yet verified.
    await gotoSwitch(page);
    await expect(page.getByTestId("dms-state")).toHaveText("Released");
    await expect(page.getByText("Sent — awaiting verification")).toBeVisible();
    await page.goto("/actions");
    await expect(page.getByText("Your emergency release completed").first()).toBeVisible({
      timeout: 60_000,
    });

    // Contact side, on a phone: the code step first, nothing of the release before it.
    const recipient = await recipientPage(browser, true);
    await recipient.goto(`${BASE}/access${new URL(link).hash}`);
    await expect(recipient.getByRole("heading", { name: "Confirm it is you" })).toBeVisible({
      timeout: 60_000,
    });
    await expect(recipient.getByText(releasedAsset)).toHaveCount(0);
    expect(recipient.url()).not.toContain("t=");
    expect(await noOverflow(recipient)).toBeLessThanOrEqual(0);
    const gate = await new AxeBuilder({ page: recipient })
      .withTags(["wcag2a", "wcag2aa"])
      .analyze();
    expect(gate.violations.map((violation) => violation.id)).toEqual([]);
    const code = codeIn(await mail!.waitFor(heirEmail, /verification code/));
    const codeInput = recipient.getByLabel("Verification code");
    await codeInput.fill(code === "000000" ? "111111" : "000000");
    await recipient.getByRole("button", { name: "Confirm and open" }).click();
    await expect(recipient.locator("#release-code-error")).toHaveText(/not right/);
    await expect(codeInput).toHaveAttribute("aria-invalid", "true");
    await codeInput.fill(code);
    await recipient.getByRole("button", { name: "Confirm and open" }).click();

    await expect(recipient.getByText("Why you can see this")).toBeVisible({ timeout: 60_000 });
    await expect(recipient.getByText(releasedAsset)).toBeVisible();
    await expect(recipient.getByText(keptAsset)).toHaveCount(0);
    expect(await noOverflow(recipient)).toBeLessThanOrEqual(0);
    const releaseView = await new AxeBuilder({ page: recipient })
      .withTags(["wcag2a", "wcag2aa"])
      .analyze();
    expect(releaseView.violations.map((violation) => violation.id)).toEqual([]);

    // The session reaches only what was released — direct API calls included.
    const { data: kept } = await service
      .from("financial_assets")
      .select("id")
      .eq("user_id", owner.id)
      .eq("name", keptAsset)
      .single();
    const api = recipient.request;
    expect((await api.get(`/api/v1/access/assets/FINANCIAL_ASSET/${kept!.id}`)).status()).toBe(404);
    // Nothing of the owner's account: no switch, beneficiaries, links or audit trail.
    for (const path of [
      "/api/v1/dead-man-switch",
      "/api/v1/beneficiaries",
      "/api/v1/access-links",
      "/api/v1/users/me/activity",
      "/api/v1/users/me",
    ]) {
      expect((await api.get(path)).status(), path).toBe(401);
    }

    // The Security Centre shows the live link, verified.
    await page.goto("/security-center");
    const links = page.getByRole("list", { name: "Live access links" });
    const row = links.getByRole("listitem").filter({ hasText: heirName });
    await expect(row).toContainText("Emergency release", { timeout: 60_000 });
    await expect(row).toContainText("Verified by code");

    // Recovery revokes it at once: the contact's open session ends.
    await gotoSwitch(page);
    await page.getByRole("button", { name: "Recover and revoke access" }).click();
    const recovered = page.waitForResponse((response) =>
      response.url().endsWith("/api/v1/dead-man-switch/cancel-escalation"),
    );
    await page.getByRole("button", { name: "Recover now" }).click();
    expect((await recovered).ok()).toBe(true);
    await expect(page.getByTestId("dms-state")).toHaveText("Active", { timeout: 30_000 });

    await recipient.reload();
    await expect(recipient.getByText("This link cannot be opened")).toBeVisible({
      timeout: 60_000,
    });
    await expect(recipient.getByText(releasedAsset)).toHaveCount(0);
    await recipient.context().close();
  });

  test("a revoked link and an expired link open nothing", async ({ page, browser }) => {
    await signInAndSettle(page, OWNER);
    await releaseNow();

    // Revoked from the Security Centre.
    const revoked = await mintReleaseLink();
    await page.goto("/security-center");
    const row = page
      .getByRole("list", { name: "Live access links" })
      .getByRole("listitem")
      .filter({ hasText: heirName });
    await row.getByRole("button", { name: "Revoke" }).click({ timeout: 60_000 });
    const deleted = page.waitForResponse(
      (response) =>
        response.url().includes(`/tokens/${revoked.tokenId}`) &&
        response.request().method() === "DELETE",
    );
    await page.getByRole("button", { name: "Revoke link" }).click();
    expect((await deleted).ok()).toBe(true);
    await expect(page.getByRole("dialog")).toBeHidden();

    const recipient = await recipientPage(browser);
    await recipient.goto(revoked.link);
    await expect(recipient.getByText("This link cannot be opened")).toBeVisible({
      timeout: 60_000,
    });

    // Expired.
    const expired = await mintReleaseLink();
    await service
      .from("access_tokens")
      .update({ expires_at: new Date(Date.now() - 1000).toISOString() })
      .eq("id", expired.tokenId);
    await recipient.goto(expired.link);
    await expect(recipient.getByText("This link cannot be opened")).toBeVisible({
      timeout: 60_000,
    });
    await recipient.context().close();
    await resetToActive();
  });

  test("without a mail provider the release gate stays shut", async ({ page, browser }) => {
    test.skip(Boolean(mail), "The capture endpoint delivers codes; this is the no-provider case.");
    await signInAndSettle(page, OWNER);
    await releaseNow();
    const { link } = await mintReleaseLink();

    const recipient = await recipientPage(browser);
    await recipient.goto(link);
    await expect(recipient.getByText(/could not send your code/)).toBeVisible({ timeout: 60_000 });
    await expect(recipient.getByText(releasedAsset)).toHaveCount(0);
    await expect(recipient.getByText("Why you can see this")).toHaveCount(0);
    await recipient.context().close();
    await resetToActive();
  });

  test("a release with no warning confirmed delivered is held, and the owner is shown why", async ({
    page,
  }) => {
    await signInAndSettle(page, OWNER);
    const { id } = await switchRow();
    // At the release point of a fresh cycle, with no warning confirmed delivered.
    await transition("ACTIVE", "REMINDER_SENT", "MISSED_CHECK_IN");
    await transition("REMINDER_SENT", "GRACE_PERIOD", "MISSED_CHECK_IN");
    await transition("GRACE_PERIOD", "ESCALATING", "ESCALATION_STEP");
    await service
      .from("dead_man_switches")
      .update({
        current_escalation_step: 2,
        next_check_in_at: new Date(Date.now() - 1000).toISOString(),
      })
      .eq("id", id);
    // With the mail stand-in the owner's mailbox bounces; without one, nothing can be sent.
    mail?.bouncing.add(OWNER);
    expect(await schedulerTick()).toBe("ESCALATING");
    mail?.bouncing.delete(OWNER);

    await gotoSwitch(page);
    const banner = page.getByTestId("dms-release-held");
    await expect(banner).toContainText("Release on hold: nothing has been released.");
    await expect(banner).toContainText("Held since");
    await expect(banner).toContainText("Checking in cancels it.");
    // A bounce or a failed send is never counted as the owner having been warned.
    await expect(banner).toContainText(
      mail ? "Latest warning bounced" : "Latest warning could not be sent",
    );
    await page.goto("/actions");
    await expect(page.getByText("Release on hold — check in to stop it").first()).toBeVisible({
      timeout: 60_000,
    });
    await page.goto("/security-center");
    await expect(page.getByText(/Release on hold: no warning email/).first()).toBeVisible({
      timeout: 60_000,
    });
    const { data: tokens } = await service
      .from("access_tokens")
      .select("id")
      .eq("dead_man_switch_id", id)
      .is("revoked_at", null);
    expect(tokens).toHaveLength(0);
    await resetToActive();
  });

  test("disabling the switch ends release access at once", async ({ browser }) => {
    // Its own account: disabling spends step-up budget of its own. Signing in
    // first creates the account's row on a fresh database.
    const context = await browser.newContext();
    const page = await context.newPage();
    await signInAndSettle(page, OTHER);
    const other = await userRow(OTHER);
    await cleanUp(other.id);
    const asOther = await createUserScopedClient(other.clerk_user_id);
    const { data: contact, error: contactError } = await asOther
      .from("beneficiaries")
      .insert({
        user_id: other.id,
        name: `E2E Disabled Heir ${unique}`,
        relationship: "Friend",
        email: `e2e-disabled-${unique}@example.com`,
      })
      .select("id")
      .single();
    if (contactError) throw contactError;
    const { data: assetId, error: assetError } = await asOther.rpc("create_asset", {
      p_resource_type: "FINANCIAL_ASSET",
      p_plain: { name: `E2E Disabled ${unique}`, category: "BANK_ACCOUNT", currency: "INR" },
    });
    if (assetError) throw assetError;
    const { error: configError } = await asOther.rpc("dms_configure", {
      p_config: { inactivityPeriodDays: 90, checkInFrequencyDays: 30, escalationDelayHours: 24 },
      p_contact_beneficiary_ids: [contact.id],
      p_release_scope: {
        documents: [],
        assets: [{ type: "FINANCIAL_ASSET", id: assetId }],
        videos: [],
        planSections: [],
      },
    });
    if (configError) throw configError;
    await releaseNow(other.id);
    const { link } = await mintReleaseLink(contact.id, other.id);

    await gotoSwitch(page);
    await expect(page.getByTestId("dms-state")).toHaveText("Released");
    await page.getByRole("button", { name: "Disable", exact: true }).click();
    const disabled = page.waitForResponse((response) =>
      response.url().endsWith("/api/v1/dead-man-switch/disable"),
    );
    await page.getByRole("button", { name: "Disable switch" }).click();
    expect((await disabled).ok()).toBe(true);
    await expect(page.getByTestId("dms-state")).toHaveText("Disabled", { timeout: 30_000 });
    await context.close();

    const recipient = await recipientPage(browser);
    await recipient.goto(link);
    await expect(recipient.getByText("This link cannot be opened")).toBeVisible({
      timeout: 60_000,
    });
    await recipient.context().close();
    await cleanUp(other.id);
  });

  test("another owner can neither see nor touch this release", async ({ browser }) => {
    await releaseNow();
    const { tokenId } = await mintReleaseLink();

    const context = await browser.newContext();
    const page = await context.newPage();
    await signInAndSettle(page, OTHER);
    const other = page.request;
    const own = await other.get("/api/v1/dead-man-switch");
    expect(own.ok()).toBe(true);
    const ownSwitch = ((await own.json()) as { data: { id: string } | null }).data;
    expect(ownSwitch?.id).not.toBe((await switchRow()).id);

    const links = (await (await other.get("/api/v1/access-links")).json()) as {
      data: { items: { id: string }[] };
    };
    expect(links.data.items.map((item) => item.id)).not.toContain(tokenId);

    const revoke = await other.delete(`/api/v1/beneficiaries/${heirId}/tokens/${tokenId}`, {
      headers: { origin: BASE },
    });
    expect(revoke.status()).toBe(404);
    const tokens = await other.get(`/api/v1/beneficiaries/${heirId}/tokens`);
    expect(tokens.status()).toBe(404);

    const { data: still } = await service
      .from("access_tokens")
      .select("revoked_at")
      .eq("id", tokenId)
      .single();
    expect(still?.revoked_at).toBeNull();
    await context.close();
    await resetToActive();
  });

  test("emergency access: designate, verify, owner approves, contact opens, owner revokes", async ({
    page,
    browser,
  }) => {
    test.skip(!mail, "Start the dev server with RESEND_BASE_URL set to read what was sent.");
    await signInAndSettle(page, EA_OWNER);
    const eaOwner = await userRow(EA_OWNER);
    await cleanUp(eaOwner.id);
    const contactName = `E2E Contact ${unique}`;
    const contactEmail = `e2e-contact-${unique}@example.com`;
    const sharedAsset = `E2E Emergency ${unique}`;
    const privateAsset = `E2E Private ${unique}`;
    const asEaOwner = await createUserScopedClient(eaOwner.clerk_user_id);
    const { error: contactError } = await asEaOwner.from("beneficiaries").insert({
      user_id: eaOwner.id,
      name: contactName,
      relationship: "Friend",
      email: contactEmail,
    });
    if (contactError) throw contactError;
    for (const name of [sharedAsset, privateAsset]) {
      const { error } = await asEaOwner.rpc("create_asset", {
        p_resource_type: "FINANCIAL_ASSET",
        p_plain: { name, category: "BANK_ACCOUNT", currency: "INR" },
      });
      if (error) throw error;
    }

    await page.goto("/emergency-access");
    await page
      .getByRole("button", { name: "Designate contact" })
      .first()
      .click({ timeout: 60_000 });
    const sheet = page.getByRole("dialog", { name: "Designate an emergency contact" });
    await sheet.locator('[data-slot="select-trigger"]').click();
    await page.getByRole("option", { name: new RegExp(contactName) }).click();
    await sheet.getByRole("checkbox", { name: sharedAsset }).check({ timeout: 60_000 });
    const designated = page.waitForResponse(
      (response) =>
        response.url().endsWith("/api/v1/emergency-access/contacts") &&
        response.request().method() === "POST",
    );
    await sheet.getByRole("button", { name: "Designate", exact: true }).click();
    expect((await designated).ok()).toBe(true);

    const { data: config } = await service
      .from("emergency_access_configs")
      .select("id")
      .eq("user_id", eaOwner.id)
      .single();

    // The contact asks, with no session, and verifies the emailed code.
    const recipient = await recipientPage(browser);
    await recipient.goto(`/emergency-access/${config!.id}`);
    await recipient.getByLabel("Your email address").fill(contactEmail);
    await recipient.getByRole("button", { name: "Send me a code" }).click();
    await expect(recipient.getByText("Check your email")).toBeVisible({ timeout: 60_000 });
    const codeMail = await mail!.waitFor(contactEmail, /verification code for/);
    await recipient.goto(linkIn(codeMail, "/emergency-access/verify?r="));
    await recipient.getByLabel("Verification code").fill(codeIn(codeMail));
    const verifiedResponse = recipient.waitForResponse((response) =>
      response.url().endsWith("/api/v1/emergency-access/verify"),
    );
    await recipient.getByRole("button", { name: "Verify" }).click();
    expect((await verifiedResponse).ok()).toBe(true);

    // The owner is told — by email, not only in the app.
    await jobsUntilMail(EA_OWNER, /emergency access request needs your decision/);

    await page.goto("/emergency-access");
    await page.getByRole("button", { name: "Approve" }).click({ timeout: 60_000 });
    const decided = page.waitForResponse((response) => response.url().includes("/decide"));
    await page.getByRole("button", { name: "Approve access" }).click();
    expect((await decided).ok()).toBe(true);

    const delivered = await jobsUntilMail(contactEmail, /shared secure access/);
    await recipient.goto(`${BASE}/access${new URL(linkIn(delivered, "/access#t=")).hash}`);
    // Emergency access was verified at request time: it opens directly, scoped.
    await expect(recipient.getByText(sharedAsset)).toBeVisible({ timeout: 60_000 });
    await expect(recipient.getByText(privateAsset)).toHaveCount(0);

    await page.goto("/emergency-access");
    await page
      .getByRole("button", { name: "Revoke", exact: true })
      .first()
      .click({ timeout: 60_000 });
    const revoked = page.waitForResponse((response) => response.url().includes("/revoke"));
    await page.getByRole("button", { name: "Revoke access" }).click();
    expect((await revoked).ok()).toBe(true);
    await recipient.reload();
    await expect(recipient.getByText("This link cannot be opened")).toBeVisible({
      timeout: 60_000,
    });
    await recipient.context().close();
    await cleanUp(eaOwner.id);
  });

  test("fits a phone, a tablet and a desktop, and checks in on a phone", async ({ page }) => {
    await signInAndSettle(page, OWNER);
    for (const width of [1440, 1024, 768, 375]) {
      await page.setViewportSize({ width, height: 900 });
      for (const path of [
        "/dashboard",
        "/dead-man-switch",
        "/emergency-access",
        "/security-center",
      ]) {
        await page.goto(path);
        await expect(page.getByRole("heading", { level: 1 })).toBeVisible({ timeout: 60_000 });
        // Cards fill in as their data arrives; give them a moment to lay out.
        await page.waitForTimeout(1_500);
        expect(await noOverflow(page), `${path} at ${width}px`).toBeLessThanOrEqual(0);
      }
    }

    // Phone: the changed pages pass WCAG A/AA checks.
    for (const path of ["/dashboard", "/emergency-access", "/security-center"]) {
      await page.goto(path);
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible({ timeout: 60_000 });
      await page.waitForTimeout(1_500);
      const pageScan = await new AxeBuilder({ page })
        .include("main")
        .withTags(["wcag2a", "wcag2aa"])
        .analyze();
      expect(
        pageScan.violations.map((violation) => violation.id),
        path,
      ).toEqual([]);
    }
    await gotoSwitch(page);
    const scan = await new AxeBuilder({ page })
      .include("main")
      .withTags(["wcag2a", "wcag2aa"])
      .analyze();
    expect(scan.violations.map((violation) => violation.id)).toEqual([]);

    // The confirmation dialog fits and passes, and Escape leaves it untouched.
    await page.getByRole("button", { name: "Disable", exact: true }).click();
    const confirm = page.getByRole("dialog", { name: /Disable the Dead Man/ });
    await expect(confirm).toBeVisible();
    expect((await confirm.boundingBox())!.width).toBeLessThanOrEqual(375);
    const confirmScan = await new AxeBuilder({ page })
      .include('[role="dialog"]')
      .withTags(["wcag2a", "wcag2aa"])
      .analyze();
    expect(confirmScan.violations.map((violation) => violation.id)).toEqual([]);
    await page.keyboard.press("Escape");
    await expect(confirm).toBeHidden();
    await expect(page.getByTestId("dms-state")).toHaveText("Active");
    // Keyboard: open the editor, focus stays inside it, Escape returns focus.
    const configure = page.getByRole("button", { name: "Configure", exact: true });
    await configure.focus();
    await page.keyboard.press("Enter");
    const sheet = page.getByRole("dialog", { name: "Configure the switch" });
    await expect(sheet).toBeVisible();
    const box = await sheet.boundingBox();
    expect(box!.width).toBeLessThanOrEqual(375);
    await page.keyboard.press("Tab");
    expect(await sheet.evaluate((dialog) => dialog.contains(document.activeElement))).toBe(true);
    const sheetScan = await new AxeBuilder({ page })
      .include('[role="dialog"]')
      .withTags(["wcag2a", "wcag2aa"])
      .analyze();
    expect(sheetScan.violations.map((violation) => violation.id)).toEqual([]);
    await page.keyboard.press("Escape");
    await expect(sheet).toBeHidden();
    await expect(configure).toBeFocused();
    await checkIn(page);
  });
});
