import { expect, test, type Page } from "@playwright/test";

import { loadLocalEnv } from "../helpers/load-env";
import { signInAndSettle } from "./session";
import { E2E_USERS } from "./users";

/**
 * Upload progress, as a person actually sees it (regression for 50ec125).
 *
 * In production a normal-sized file finished its transfer before the browser
 * reported any progress, so the card showed "0%" over an empty bar and then a
 * finished file — nothing visibly happened. This uploads a file large enough
 * to watch, over a throttled connection (the browser's own network emulation;
 * nothing in the app is slowed down), and samples the card throughout:
 * preparing → a real percentage → processing → stored, never 100% early.
 */
loadLocalEnv();

const configured = Boolean(
  process.env.CLERK_SECRET_KEY && process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY,
);
const name = `E2E Progress ${Date.now().toString(36)}.pdf`;
const SIZE = 24 * 1024 * 1024;
const UPLOAD_BYTES_PER_SECOND = 2 * 1024 * 1024;

function largePdf(): Buffer {
  const head = Buffer.from("%PDF-1.7\n1 0 obj<</Type/Catalog>>endobj\n", "utf8");
  const tail = Buffer.from("\ntrailer<</Root 1 0 R>>\n%%EOF\n", "utf8");
  return Buffer.concat([head, Buffer.alloc(SIZE - head.length - tail.length, 0x20), tail]);
}

/** What the card shows right now. */
function look(page: Page) {
  return page.evaluate((fileName) => {
    const card = [...document.querySelectorAll("li")].find((li) =>
      li.textContent?.includes(fileName),
    );
    if (!card) return null;
    const bar = card.querySelector('[role="progressbar"]');
    const box = bar?.getBoundingClientRect();
    const track = bar?.querySelector('[data-slot="progress-track"]')?.getBoundingClientRect();
    const fill = bar?.querySelector('[data-slot="progress-indicator"]')?.getBoundingClientRect();
    return {
      status: card.querySelector('[role="status"]')?.textContent ?? "",
      text: card.textContent ?? "",
      bar: bar
        ? {
            label: bar.getAttribute("aria-label") ?? "",
            now: bar.getAttribute("aria-valuenow"),
            visible: Boolean(box && box.width > 0 && box.height > 0),
            fill: track && fill && track.width > 0 ? fill.width / track.width : null,
          }
        : null,
    };
  }, name);
}

test.describe("upload progress", () => {
  test.skip(!configured, "Clerk development keys are not configured.");

  test("shows preparing, a real percentage, then processing, for a large upload", async ({
    page,
  }, testInfo) => {
    test.setTimeout(300_000);
    await signInAndSettle(page, E2E_USERS.access);
    await page.goto("/documents");
    await page
      .getByRole("button", { name: /^Upload( your first document)?$/ })
      .first()
      .click();
    await page.setInputFiles('input[type="file"]', {
      name,
      mimeType: "application/pdf",
      buffer: largePdf(),
    });

    const cdp = await page.context().newCDPSession(page);
    await cdp.send("Network.enable");
    await cdp.send("Network.emulateNetworkConditions", {
      offline: false,
      latency: 0,
      downloadThroughput: -1,
      uploadThroughput: UPLOAD_BYTES_PER_SECOND,
    });

    await page.getByRole("button", { name: "Upload", exact: true }).last().click();

    const seen = { preparing: false, percents: new Set<number>(), processing: false };
    const shots = new Set<string>();
    let hundredBeforeStored = false;
    const deadline = Date.now() + 180_000;
    for (;;) {
      const now = await look(page);
      if (now?.bar) expect(now.bar.visible).toBe(true);
      // Unmeasured work slides a segment; a full bar would read as finished.
      if (now?.bar && now.bar.now === null) expect(now.bar.fill ?? 0).toBeLessThan(0.5);
      if (now?.text.includes("Preparing upload…")) seen.preparing = true;
      const percent = now?.text.match(/(\d{1,3})%/);
      if (percent && now?.status !== "Stored privately") {
        const value = Number(percent[1]);
        if (value >= 100) hundredBeforeStored = true;
        seen.percents.add(value);
        expect(now?.bar?.now).toBe(String(value));
      }
      if (now?.status === "Checking and saving…" && now.bar && now.bar.now === null) {
        seen.processing = true;
      }

      const stage = !now
        ? null
        : now.status === "Stored privately"
          ? "done"
          : now.status === "Checking and saving…"
            ? "processing"
            : percent && Number(percent[1]) >= 40
              ? "mid-upload"
              : now.text.includes("Preparing upload…")
                ? "start"
                : null;
      if (stage && !shots.has(stage)) {
        shots.add(stage);
        await page.screenshot({ path: testInfo.outputPath(`${stage}.png`) });
      }

      if (now?.status === "Stored privately") break;
      expect(now?.status ?? "").not.toMatch(/failed|Rejected/i);
      expect(Date.now()).toBeLessThan(deadline);
      await page.waitForTimeout(150);
    }

    await cdp.send("Network.emulateNetworkConditions", {
      offline: false,
      latency: 0,
      downloadThroughput: -1,
      uploadThroughput: -1,
    });

    expect(seen.preparing).toBe(true);
    // A real, intermediate percentage was on screen — not only 0 or 100.
    expect([...seen.percents].some((value) => value > 0 && value < 100)).toBe(true);
    expect(hundredBeforeStored).toBe(false);
    expect(seen.processing).toBe(true);

    // Leave the account as it was found.
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Close", exact: true })
      .last()
      .click();
    await page.getByRole("button", { name: `Actions for ${name}` }).click();
    await page.getByRole("menuitem", { name: "Delete" }).click();
    await page.getByRole("button", { name: "Delete document" }).click();
    await expect(page.getByRole("dialog")).toBeHidden({ timeout: 30_000 });
  });
});
