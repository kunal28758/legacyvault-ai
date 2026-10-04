import { beforeEach, describe, expect, it, vi } from "vitest";

const send = vi.fn();

vi.mock("resend", () => ({
  Resend: class {
    emails = { send };
  },
}));
vi.mock("@/lib/config/env", () => ({
  getEnvGroup: vi.fn(() => ({
    RESEND_API_KEY: "re_test_placeholder",
    EMAIL_FROM: "LegacyVault AI <no-reply@example.com>",
  })),
}));
vi.mock("@/lib/observability/logger", () => ({
  logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn() },
}));

import { sendEmail } from "@/lib/email/client";
import { logger } from "@/lib/observability/logger";

/**
 * The shared send path (ADR-009). Callers log and persist whatever it throws,
 * so a provider failure must surface as a code — never the provider's message,
 * which can quote an address, and never the subject, which names people.
 */
const input = {
  to: "asha.rao@example.com",
  subject: "Priya Sharma named you a beneficiary",
  react: null as unknown as React.ReactElement,
  idempotencyKey: "beneficiary-invite:b1:2026-10-04T09:00:00.000Z",
};

beforeEach(() => {
  send.mockReset();
});

describe("sendEmail", () => {
  it("passes the idempotency key to the provider and returns its message id", async () => {
    send.mockResolvedValue({ data: { id: "msg_1" }, error: null });

    await expect(sendEmail(input)).resolves.toEqual({ providerMessageId: "msg_1" });
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({ to: input.to, from: "LegacyVault AI <no-reply@example.com>" }),
      { idempotencyKey: input.idempotencyKey },
    );
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

    const failure = await sendEmail(input).then(
      () => new Error("expected a failure"),
      (error: unknown) => error as Error,
    );

    expect(failure).toBeInstanceOf(Error);
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
