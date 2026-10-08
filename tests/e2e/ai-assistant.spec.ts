import { expect, test, type Page, type Request } from "@playwright/test";

import { loadLocalEnv } from "../helpers/load-env";
import { signInAndSettle } from "./session";
import { E2E_USERS } from "./users";

/**
 * The AI Assistant against the real stack: Clerk, the application's own API,
 * the vault upload pipeline (private storage → size and type checks →
 * promotion) and the configured AI provider. Nothing is mocked — this is the
 * production request path end to end, so it needs a configured provider key
 * and the local stack running, and skips (it does not pass) without them.
 *
 * The documents are generated here by the browser itself — a real PDF with a
 * text layer and a real PNG — so their contents are known and the answers can
 * be checked against them.
 */
loadLocalEnv();

const email = E2E_USERS.ai;
const configured = Boolean(
  process.env.CLERK_SECRET_KEY && process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY,
);

const POLICY_HTML = `<!doctype html><html><body style="font-family: Arial, sans-serif; padding: 40px">
<h1>Term Life Insurance Policy</h1>
<p>Policy number: LV-TL-448120</p>
<p>Insurer: Northbridge Life Assurance Ltd.</p>
<p>Policyholder: Meera Iyer, born 14 February 1979.</p>
<p>Nominee (beneficiary): Kabir Iyer, son of the policyholder, 100% share.</p>
<p>Sum assured: Rs 75,00,000 (seventy-five lakh rupees).</p>
<p>Annual premium: Rs 18,400, due every 5 April.</p>
<p>Policy start date: 5 April 2021. Policy expiry date: 4 April 2046.</p>
<p>Claims must be filed within 90 days of the date of death.</p>
</body></html>`;

const NOTICE_HTML = `<!doctype html><html><body style="margin:0">
<div id="notice" style="width:640px; padding:32px; font-family: Arial, sans-serif; background:#fff; color:#111; border:4px solid #1e3a8a">
<h1 style="margin:0 0 16px">PROPERTY TAX NOTICE</h1>
<p style="font-size:22px">Property ID: PT-99317</p>
<p style="font-size:22px">Owner: Meera Iyer</p>
<p style="font-size:22px">Amount due: Rs 12,960</p>
<p style="font-size:22px">Pay by: 30 November 2026</p>
</div></body></html>`;

async function makeFiles(page: Page) {
  const scratch = await page.context().newPage();
  await scratch.setContent(POLICY_HTML);
  const pdf = await scratch.pdf({ format: "A4" });
  await scratch.setContent(NOTICE_HTML);
  const png = await scratch.locator("#notice").screenshot({ type: "png" });
  await scratch.close();
  return {
    policy: { name: "life-policy.pdf", mimeType: "application/pdf", buffer: pdf },
    notice: { name: "tax-notice.png", mimeType: "image/png", buffer: png },
  };
}

/** Sends a message and waits for the answer to finish; returns the request and the answer. */
async function ask(page: Page, text: string): Promise<{ request: Request; answer: string }> {
  const box = page.getByRole("textbox", { name: "Message" });
  await box.fill(text);
  const [request] = await Promise.all([
    page.waitForRequest((r) => r.url().endsWith("/api/v1/ai/assistant/message")),
    page.getByRole("button", { name: "Send" }).click(),
  ]);
  await expect(page.getByRole("button", { name: "Stop generating" })).toBeHidden({
    timeout: 170_000,
  });
  const reply = page.getByText("Assistant:").last().locator("..");
  await expect(reply.getByRole("alert")).toHaveCount(0);
  await expect(reply.getByText("AI-generated")).toBeVisible();
  return { request, answer: await reply.innerText() };
}

function attachmentIdsOf(request: Request): string[] {
  return (request.postDataJSON() as { attachmentIds?: string[] }).attachmentIds ?? [];
}

// Spends the AI provider's quota (the free Gemini tier allows ~20 calls a day),
// so it runs on its own: `pnpm test:e2e:ai`. Everything else: `pnpm test:e2e:app`.
test.describe("AI assistant — real provider", { tag: "@ai-provider" }, () => {
  test.describe.configure({ mode: "serial" });
  test.skip(!configured, "Clerk development keys are not configured — see docs/DEPLOYMENT.md.");

  let page: Page;
  /** The configured chain, as the running server reports it. */
  let chain: string[] = [];

  test.beforeAll(async ({ browser }) => {
    test.setTimeout(240_000);
    page = await (await browser.newContext()).newPage();
    await signInAndSettle(page, email);
    const status = page.waitForResponse((r) => r.url().includes("/api/v1/ai/status"));
    await page.goto("/ai", { waitUntil: "domcontentloaded" });
    // The status query only runs once the page has hydrated.
    const body = (await (await status).json()) as {
      data: { configured: boolean; provider: string | null; fallbacks?: string[] };
    };
    test.skip(!body.data.configured, "No AI provider is configured in this environment.");
    chain = [body.data.provider, ...(body.data.fallbacks ?? [])].filter((name): name is string =>
      Boolean(name),
    );
  });

  test.afterAll(async () => {
    await page?.context().close();
  });

  test("answers text messages through the configured provider", async () => {
    test.setTimeout(600_000);

    const hello = await ask(page, "Hello, introduce yourself briefly.");
    expect(hello.answer).toMatch(/LegacyVault/i);
    expect(attachmentIdsOf(hello.request)).toEqual([]);

    const sum = await ask(page, "What is 2 + 2? Answer with the number.");
    expect(sum.answer).toMatch(/\b4\b/);

    const product = await ask(page, "In two sentences: how does the Dead Man's Switch work?");
    // Models may write the hyphen as U+2010/U+2011 (non-breaking) or a dash.
    expect(product.answer).toMatch(/check[\s\-\u2010-\u2015]?in/i);

    // The usage record names the real provider and model — never the content.
    const usage = await page.request.get("/api/v1/ai/assistant/interactions?limit=3");
    const items = ((await usage.json()) as { data: { items: Record<string, unknown>[] } }).data
      .items;
    expect(items[0]).toMatchObject({ sessionType: "ASSISTANT" });
    // Answered by a provider of the configured chain (normally the primary).
    expect(chain).toContain(items[0]?.provider);
    console.log(`[ai-e2e] answered by ${String(items[0]?.provider)} / ${String(items[0]?.model)}`);
    if (process.env.GEMINI_MODEL && items[0]?.provider === "gemini") {
      expect(items[0]?.model).toBe(process.env.GEMINI_MODEL);
    }
    expect(JSON.stringify(items)).not.toMatch(/Dead Man|2 \+ 2/);
  });

  test("summarizes an attached PDF and answers a follow-up from it", async () => {
    test.setTimeout(600_000);
    await page.getByRole("button", { name: "Clear" }).click();
    const files = await makeFiles(page);

    await page.locator('input[type="file"]').setInputFiles(files.policy);
    const chip = page.getByRole("list", { name: "Files to send" }).getByRole("listitem");
    await expect(chip).toContainText("life-policy.pdf");
    // Uploaded to private storage, checked and promoted before it can be sent.
    await expect(chip).toContainText("Ready", { timeout: 120_000 });

    const summary = await ask(page, "Summarize this document.");
    expect(attachmentIdsOf(summary.request)).toHaveLength(1);
    expect(summary.answer).toMatch(/Meera Iyer/);
    expect(summary.answer).toMatch(/75,00,000|seventy-five lakh/i);

    // Follow-up: the file is carried into the next message, visibly.
    await expect(
      page.getByRole("list", {
        name: "Files from this conversation included with your next message",
      }),
    ).toContainText("life-policy.pdf");
    const followUp = await ask(page, "When does this policy expire, and who is the nominee?");
    expect(attachmentIdsOf(followUp.request)).toEqual(attachmentIdsOf(summary.request));
    expect(followUp.answer).toMatch(/4 April 2046|2046/);
    expect(followUp.answer).toMatch(/Kabir/);

    // A fact the document does not contain is not invented.
    const absent = await ask(page, "What is the policyholder's email address?");
    expect(absent.answer).toMatch(/not|no email|doesn't|does not/i);
    expect(absent.answer).not.toMatch(/@[a-z0-9-]+\.[a-z]/i);
  });

  test("describes an attached image", async () => {
    test.setTimeout(600_000);
    await page.getByRole("button", { name: "Clear" }).click();
    const files = await makeFiles(page);

    await page.locator('input[type="file"]').setInputFiles(files.notice);
    const chip = page.getByRole("list", { name: "Files to send" }).getByRole("listitem");
    await expect(chip).toContainText("Ready", { timeout: 120_000 });

    const described = await ask(page, "Describe the important information visible in this image.");
    expect(attachmentIdsOf(described.request)).toHaveLength(1);
    expect(described.answer).toMatch(/12,960|12960/);
    expect(described.answer).toMatch(/30 November 2026|November 30, 2026/i);
  });

  test("a removed attachment is not sent, and an unsupported file never uploads", async () => {
    test.setTimeout(300_000);
    await page.getByRole("button", { name: "Clear" }).click();
    const files = await makeFiles(page);
    const input = page.locator('input[type="file"]');

    // Unsupported: refused in the browser before any upload session exists.
    const sessions: string[] = [];
    page.on("request", (r) => {
      if (r.method() === "POST" && r.url().endsWith("/api/v1/documents/uploads"))
        sessions.push(r.url());
    });
    await input.setInputFiles({
      name: "setup.exe",
      mimeType: "application/x-msdownload",
      buffer: Buffer.from("MZ fake executable"),
    });
    const pending = page.getByRole("list", { name: "Files to send" }).getByRole("listitem");
    await expect(pending).toContainText("not accepted");
    await expect(page.getByRole("button", { name: "Send" })).toBeDisabled();
    expect(sessions).toHaveLength(0);
    await page.getByRole("button", { name: "Remove setup.exe" }).click();

    // Removed before sending: a ready file that is taken off is not submitted.
    await input.setInputFiles(files.notice);
    await expect(pending).toContainText("Ready", { timeout: 120_000 });
    await page.getByRole("button", { name: "Remove tax-notice.png" }).click();
    await expect(pending).toHaveCount(0);

    const plain = await ask(page, "Reply with the single word: ready");
    expect(attachmentIdsOf(plain.request)).toEqual([]);
  });
});
