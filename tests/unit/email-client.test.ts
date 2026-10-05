import { createElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const send = vi.fn();
const env = vi.hoisted(() => ({
  from: "LegacyVault AI <no-reply@example.com>",
  brevoFrom: "LegacyVault AI <brevo-sender@example.com>" as string | undefined,
  resend: true,
  brevoKey: "xkeysib-test-placeholder" as string | undefined,
}));

vi.mock("resend", () => ({
  Resend: class {
    emails = { send };
  },
}));
vi.mock("@/lib/config/env", () => ({
  getEnvGroup: vi.fn((name: string) => {
    if (name === "email") {
      if (!env.resend) throw new Error('Invalid "email" environment configuration');
      return { RESEND_API_KEY: "re_test_placeholder", EMAIL_FROM: env.from };
    }
    if (name === "brevo") return { BREVO_API_KEY: env.brevoKey, BREVO_EMAIL_FROM: env.brevoFrom };
    throw new Error(`unexpected group ${name}`);
  }),
}));
vi.mock("@/lib/observability/logger", () => ({
  logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn() },
}));

import { emailConfigured, sendEmail } from "@/lib/email/client";
import { logger } from "@/lib/observability/logger";

/**
 * The shared send path (ADR-009). Callers log and persist whatever it throws,
 * so a provider failure must surface as a code — never the provider's message,
 * which can quote an address, and never the subject, which names people.
 *
 * Resend carries every message by default; Brevo only carries a message that
 * asks for it, and only while `BREVO_API_KEY` is set.
 */
const input = {
  to: "asha.rao@example.com",
  subject: "Priya Sharma named you a beneficiary",
  react: createElement("p", null, "Hello Asha"),
  idempotencyKey: "beneficiary-invite:b1:2026-10-04T09:00:00.000Z",
};
const BREVO_ID = "<202610050900.1234567890@smtp-relay.mailin.fr>";

const fetchMock = vi.fn();

function brevoReply(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

async function failureOf(promise: Promise<unknown>): Promise<Error> {
  return promise.then(
    () => new Error("expected a failure"),
    (error: unknown) => error as Error,
  );
}

beforeEach(() => {
  send.mockReset();
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  env.resend = true;
  env.brevoKey = "xkeysib-test-placeholder";
  env.brevoFrom = "LegacyVault AI <brevo-sender@example.com>";
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("sendEmail — Resend", () => {
  it("passes the idempotency key to the provider and returns its message id", async () => {
    send.mockResolvedValue({ data: { id: "msg_1" }, error: null });

    await expect(sendEmail(input)).resolves.toEqual({ providerMessageId: "msg_1" });
    expect(send).toHaveBeenCalledWith(expect.objectContaining({ to: input.to, from: env.from }), {
      idempotencyKey: input.idempotencyKey,
    });
  });

  it("keeps every message on Resend unless the caller asks for Brevo", async () => {
    send.mockResolvedValue({ data: { id: "msg_1" }, error: null });

    await sendEmail(input);

    expect(send).toHaveBeenCalledTimes(1);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("reports a provider refusal by code without the address or the subject", async () => {
    send.mockResolvedValue({
      data: null,
      error: {
        name: "validation_error",
        statusCode: 403,
        message: "You can only send testing emails to your own email address (owner@example.com).",
      },
    });

    const failure = await failureOf(sendEmail(input));

    expect(failure.message).toBe("email send failed: validation_error");
    const logged = JSON.stringify(vi.mocked(logger.error).mock.calls);
    expect(logged).toContain("validation_error");
    expect(logged).toContain("403");
    for (const leaked of ["owner@example.com", input.to, input.subject]) {
      expect(failure.message).not.toContain(leaked);
      expect(logged).not.toContain(leaked);
    }
  });
});

describe("sendEmail — Brevo", () => {
  it("sends through Brevo's transactional API and returns its message id", async () => {
    fetchMock.mockResolvedValue(brevoReply(201, { messageId: BREVO_ID }));

    await expect(sendEmail({ ...input, provider: "brevo" })).resolves.toEqual({
      providerMessageId: BREVO_ID,
    });

    expect(send).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.brevo.com/v3/smtp/email");
    expect(init.method).toBe("POST");
    expect(init.headers).toMatchObject({ "api-key": "xkeysib-test-placeholder" });
    const body = JSON.parse(String(init.body));
    // Brevo's own sender, never Resend's EMAIL_FROM.
    expect(body).toMatchObject({
      sender: { name: "LegacyVault AI", email: "brevo-sender@example.com" },
      to: [{ email: input.to }],
      subject: input.subject,
      headers: { "Idempotency-Key": input.idempotencyKey },
    });
    expect(body.htmlContent).toContain("Hello Asha");
    expect(body.textContent).toContain("Hello Asha");
  });

  it("reports a Brevo refusal by code, without the address, subject, message or key", async () => {
    fetchMock.mockResolvedValue(
      brevoReply(400, { code: "unauthorized", message: "Key not found for owner@example.com" }),
    );

    const failure = await failureOf(sendEmail({ ...input, provider: "brevo" }));

    expect(failure.message).toBe("email send failed: unauthorized");
    const logged = JSON.stringify(vi.mocked(logger.error).mock.calls);
    expect(logged).toContain("unauthorized");
    expect(logged).toContain("400");
    expect(logged).toContain("brevo");
    for (const leaked of [
      "owner@example.com",
      "Key not found",
      "xkeysib-test-placeholder",
      input.to,
      input.subject,
    ]) {
      expect(failure.message).not.toContain(leaked);
      expect(logged).not.toContain(leaked);
    }
  });

  it("does not trust an unexpected error code into the log", async () => {
    fetchMock.mockResolvedValue(brevoReply(400, { code: "bounced <asha.rao@example.com>" }));

    const failure = await failureOf(sendEmail({ ...input, provider: "brevo" }));

    expect(failure.message).toBe("email send failed: unknown_error");
    expect(JSON.stringify(vi.mocked(logger.error).mock.calls)).not.toContain(input.to);
  });

  it("reports a network failure the same way", async () => {
    fetchMock.mockRejectedValue(new TypeError("fetch failed"));

    const failure = await failureOf(sendEmail({ ...input, provider: "brevo" }));

    expect(failure.message).toBe("email send failed: network_error");
  });

  it.each([
    ["BREVO_API_KEY", () => (env.brevoKey = undefined)],
    ["BREVO_EMAIL_FROM", () => (env.brevoFrom = undefined)],
  ])("falls back to Resend, from EMAIL_FROM, while %s is not set", async (_, unset) => {
    unset();
    send.mockResolvedValue({ data: { id: "msg_1" }, error: null });

    await expect(sendEmail({ ...input, provider: "brevo" })).resolves.toEqual({
      providerMessageId: "msg_1",
    });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(send).toHaveBeenCalledWith(expect.objectContaining({ from: env.from }), {
      idempotencyKey: input.idempotencyKey,
    });
  });
});

describe("emailConfigured", () => {
  it("is true when either provider can send, and false when neither can", () => {
    expect(emailConfigured()).toBe(true);

    env.resend = false;
    expect(emailConfigured()).toBe(true);

    // A Brevo key without Brevo's own sender cannot send.
    env.brevoFrom = undefined;
    expect(emailConfigured()).toBe(false);
  });
});
