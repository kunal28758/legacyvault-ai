import { strFromU8, unzipSync } from "fflate";
import { expect, test } from "@playwright/test";

import { signInAndSettle } from "./session";
import { E2E_USERS } from "./users";

/**
 * Settings → Account → Your data, signed in, in a real browser: each format
 * arrives as a download with the server's file name, and the file is what it
 * claims to be. Reuses the settings account (one export costs one of its five
 * `sensitive` requests per 15 minutes); a fresh sign-in satisfies the
 * `strict` re-verification, so Clerk's modal is not expected here.
 */
const email = E2E_USERS.settings;

test.describe("settings — data export", () => {
  test.skip(!process.env.CLERK_SECRET_KEY, "Clerk development keys are not configured");

  test("downloads a valid Excel workbook and CSV archive", async ({ page }) => {
    test.setTimeout(180_000);
    await signInAndSettle(page, email);
    await page.goto("/settings?tab=account", { waitUntil: "domcontentloaded" });

    const xlsxButton = page.getByRole("button", { name: "Download .xlsx" });
    await expect(xlsxButton).toBeVisible({ timeout: 60_000 });
    const [xlsx] = await Promise.all([page.waitForEvent("download"), xlsxButton.click()]);
    expect(xlsx.suggestedFilename()).toMatch(/^legacyvault-export-\d{4}-\d{2}-\d{2}\.xlsx$/);
    const workbook = unzipSync(new Uint8Array(await streamBytes(await xlsx.createReadStream())));
    expect(Object.keys(workbook)).toContain("xl/workbook.xml");
    expect(strFromU8(workbook["xl/workbook.xml"]!)).toContain('<sheet name="About this export"');
    expect(strFromU8(workbook["xl/workbook.xml"]!)).toContain('<sheet name="Deleted items"');
    await expect(page.getByText("Excel workbook downloaded")).toBeVisible();

    const zipButton = page.getByRole("button", { name: "Download .zip" });
    await expect(zipButton).toBeEnabled();
    const [csv] = await Promise.all([page.waitForEvent("download"), zipButton.click()]);
    expect(csv.suggestedFilename()).toMatch(/^legacyvault-export-\d{4}-\d{2}-\d{2}-csv\.zip$/);
    const archive = unzipSync(new Uint8Array(await streamBytes(await csv.createReadStream())));
    expect(Object.keys(archive)[0]).toBe("README.txt");
    expect(strFromU8(archive["02-profile.csv"]!)).toContain(`"Email","${email}"`);
  });
});

async function streamBytes(stream: NodeJS.ReadableStream): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk as Buffer));
  return Buffer.concat(chunks);
}
