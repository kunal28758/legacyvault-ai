import { expect, test } from "@playwright/test";

import { loadLocalEnv } from "../helpers/load-env";
import { signInAndSettle } from "./session";
import { E2E_USERS } from "./users";

/**
 * Command Centre journey against the real stack: the dashboard's Action Centre
 * and Legacy Readiness come from the account's own data, the palette
 * navigates by command, a life event can be recorded (and becomes actions),
 * and the mobile drawer reaches every area.
 */
loadLocalEnv();

const email = E2E_USERS.commandCentre;
const configured = Boolean(
  process.env.CLERK_SECRET_KEY && process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY,
);

test.describe("command centre", () => {
  test.skip(
    !configured,
    "Clerk development keys are not configured — see docs/DEPLOYMENT.md § Clerk.",
  );
  test.setTimeout(240_000);

  test("dashboard, Action Centre, palette, life events and mobile navigation", async ({ page }) => {
    await signInAndSettle(page, email);

    // ── Dashboard: actions and readiness derived from this account ─────────
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible({ timeout: 60_000 });
    await expect(page.getByRole("list", { name: "Top actions" })).toBeVisible({ timeout: 60_000 });
    await expect(page.getByRole("meter", { name: /legacy readiness score/i })).toBeVisible();
    await expect(
      page.getByRole("list", { name: "Readiness by category" }).getByRole("listitem"),
    ).toHaveCount(6);

    // ── Action Centre page ────────────────────────────────────────────────
    await page
      .getByRole("navigation", { name: "Primary" })
      .getByRole("link", { name: "Action Centre" })
      .click();
    await expect(page.getByRole("heading", { level: 1, name: "Action Centre" })).toBeVisible({
      timeout: 60_000,
    });
    await expect(page.getByRole("group", { name: "Filter actions by source" })).toBeVisible({
      timeout: 60_000,
    });

    // ── Command palette: a navigation command, never a mutation ───────────
    await page.keyboard.press("Control+K");
    const query = page.getByRole("textbox", { name: "Search query" });
    await query.fill("shared");
    await page.getByRole("link", { name: /Show shared documents/ }).click();
    await expect(page).toHaveURL(/\/documents\?filter=shared/, { timeout: 30_000 });
    await expect(
      page.getByRole("group", { name: "Filter documents" }).getByRole("button", { name: "Shared" }),
    ).toHaveAttribute("aria-pressed", "true", { timeout: 30_000 });

    // ── Life event: recorded → steps appear → removed again ───────────────
    await page.goto("/life-events", { waitUntil: "domcontentloaded" });
    await page.getByRole("button", { name: /New property/ }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Record event" }).click();
    await expect(page.getByText("New property recorded").first()).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText("Upload the property documents").first()).toBeVisible({
      timeout: 30_000,
    });
    await page.getByRole("button", { name: "Remove New property" }).first().click();
    await page.getByRole("button", { name: "Remove event" }).click();
    await expect(page.getByText("No life events recorded")).toBeVisible({ timeout: 30_000 });

    // ── Mobile: the drawer reaches every area ─────────────────────────────
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto("/dashboard", { waitUntil: "domcontentloaded" });
    const drawer = page.getByRole("dialog");
    // A click that lands before the shell hydrates does nothing, so retry it
    // until the drawer opens (same pattern as signInAndSettle).
    await expect(async () => {
      await page.getByRole("button", { name: "Open navigation" }).click();
      await expect(drawer).toBeVisible({ timeout: 2_000 });
    }).toPass({ timeout: 60_000 });
    for (const label of [
      "Dashboard",
      "Action Centre",
      "Documents",
      "My Will",
      "Beneficiaries",
      "Dead Man's Switch",
      "AI Copilot",
      "Security Centre",
      "Audit Centre",
      "Settings",
    ]) {
      await expect(drawer.getByRole("link", { name: label, exact: true })).toBeVisible();
    }
    await drawer.getByRole("link", { name: "Audit Centre", exact: true }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Audit Centre" })).toBeVisible({
      timeout: 60_000,
    });
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
  });
});
