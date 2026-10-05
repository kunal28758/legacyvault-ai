import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/email/client", () => ({
  sendEmail: vi.fn(),
}));
vi.mock("@/lib/config/env", () => ({
  getEnvGroup: vi.fn(() => ({ APP_URL: "https://app.example.com" })),
}));

import { sendEmail } from "@/lib/email/client";
import {
  sendAccessLinkEmail,
  sendBeneficiaryInvitationEmail,
  sendDmsReminderEmail,
  sendEmergencyCodeEmail,
  sendEmergencyDesignationEmail,
  sendNotificationEmail,
} from "@/lib/email/send";

/**
 * Brevo is scoped to what an owner sends a beneficiary: invitations and
 * DIRECT_SHARE access links. Every other message — DMS and emergency access
 * links, check-in reminders, notifications, emergency codes — stays on the
 * default provider.
 */
beforeEach(() => {
  vi.mocked(sendEmail).mockResolvedValue({ providerMessageId: "msg_1" });
});

function providerOfLastSend() {
  return vi.mocked(sendEmail).mock.calls.at(-1)?.[0].provider;
}

describe("email routing", () => {
  it("sends beneficiary invitations through Brevo and returns the provider id", async () => {
    await expect(
      sendBeneficiaryInvitationEmail({
        to: "asha.rao@example.com",
        beneficiaryName: "Asha Rao",
        ownerName: "Priya Sharma",
        idempotencyKey: "beneficiary-invite:b1:2026-10-05T09:00:00.000Z",
      }),
    ).resolves.toEqual({ providerMessageId: "msg_1" });
    expect(providerOfLastSend()).toBe("brevo");
  });

  it.each([
    ["DIRECT_SHARE", "brevo"],
    ["DMS_RELEASE", undefined],
    ["EMERGENCY_ACCESS", undefined],
  ] as const)("sends a %s access link through %s", async (grantType, provider) => {
    await sendAccessLinkEmail({
      to: "asha.rao@example.com",
      beneficiaryName: "Asha Rao",
      ownerName: "Priya Sharma",
      link: "https://app.example.com/access?t=secret",
      expiresAt: "2026-10-12T00:00:00.000Z",
      grantType,
      idempotencyKey: "access-link:t1",
    });
    expect(providerOfLastSend()).toBe(provider);
  });

  it("leaves every other email on the default provider", async () => {
    const to = "someone@example.com";
    const idempotencyKey = "key";

    await sendDmsReminderEmail({
      to,
      ownerName: "Priya Sharma",
      stage: "REMINDER",
      deadline: "2026-10-12T00:00:00.000Z",
      idempotencyKey,
    });
    expect(providerOfLastSend()).toBeUndefined();

    await sendNotificationEmail({ to, title: "Title", content: "Content", idempotencyKey });
    expect(providerOfLastSend()).toBeUndefined();

    await sendEmergencyCodeEmail({
      to,
      ownerName: "Priya Sharma",
      code: "123456",
      requestId: "r1",
      idempotencyKey,
    });
    expect(providerOfLastSend()).toBeUndefined();

    await sendEmergencyDesignationEmail({
      to,
      beneficiaryName: "Asha Rao",
      ownerName: "Priya Sharma",
      configId: "c1",
      idempotencyKey,
    });
    expect(providerOfLastSend()).toBeUndefined();
  });
});
