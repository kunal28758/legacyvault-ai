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
  sendDmsContactNoticeEmail,
  sendDmsReminderEmail,
  sendEmergencyCodeEmail,
  sendEmergencyDesignationEmail,
  sendNotificationEmail,
  sendReleaseCodeEmail,
} from "@/lib/email/send";

/**
 * Every message LegacyVault sends belongs to a security or release workflow,
 * so every one goes through the provider verified in production (Brevo):
 * invitations and access links of every kind, release codes, contact notices,
 * emergency codes and designations, and the owner's warnings and alerts. The
 * client falls back to Resend only when Brevo is not configured.
 */
beforeEach(() => {
  vi.mocked(sendEmail).mockResolvedValue({ providerMessageId: "msg_1", provider: "brevo" });
});

function providerOfLastSend() {
  return vi.mocked(sendEmail).mock.calls.at(-1)?.[0].provider;
}

const to = "asha.rao@example.com";
const idempotencyKey = "key";

describe("email routing", () => {
  it("sends beneficiary invitations through Brevo and returns the provider id", async () => {
    await expect(
      sendBeneficiaryInvitationEmail({
        to,
        beneficiaryName: "Asha Rao",
        ownerName: "Priya Sharma",
        idempotencyKey: "beneficiary-invite:b1:2026-10-05T09:00:00.000Z",
      }),
    ).resolves.toEqual({ providerMessageId: "msg_1", provider: "brevo" });
    expect(providerOfLastSend()).toBe("brevo");
  });

  it.each(["DIRECT_SHARE", "DMS_RELEASE", "EMERGENCY_ACCESS"] as const)(
    "sends a %s access link through Brevo",
    async (grantType) => {
      await sendAccessLinkEmail({
        to,
        beneficiaryName: "Asha Rao",
        ownerName: "Priya Sharma",
        link: "https://app.example.com/access?t=secret",
        expiresAt: "2026-10-12T00:00:00.000Z",
        grantType,
        idempotencyKey: "access-link:t1",
      });
      expect(providerOfLastSend()).toBe("brevo");
    },
  );

  it("sends every release and emergency message through Brevo", async () => {
    const sends: [string, () => Promise<unknown>][] = [
      [
        "owner warnings and alerts",
        () => sendNotificationEmail({ to, title: "Title", content: "Content", idempotencyKey }),
      ],
      [
        "trusted-contact notice",
        () =>
          sendDmsContactNoticeEmail({
            to,
            beneficiaryName: "Asha Rao",
            ownerName: "Priya Sharma",
            idempotencyKey,
          }),
      ],
      [
        "release code",
        () =>
          sendReleaseCodeEmail({
            to,
            beneficiaryName: "Asha Rao",
            ownerName: "Priya Sharma",
            code: "123456",
            idempotencyKey,
          }),
      ],
      [
        "emergency code",
        () =>
          sendEmergencyCodeEmail({
            to,
            ownerName: "Priya Sharma",
            code: "123456",
            requestId: "r1",
            idempotencyKey,
          }),
      ],
      [
        "emergency designation",
        () =>
          sendEmergencyDesignationEmail({
            to,
            beneficiaryName: "Asha Rao",
            ownerName: "Priya Sharma",
            configId: "c1",
            idempotencyKey,
          }),
      ],
      [
        "check-in reminder",
        () =>
          sendDmsReminderEmail({
            to,
            ownerName: "Priya Sharma",
            stage: "REMINDER",
            deadline: "2026-10-12T00:00:00.000Z",
            idempotencyKey,
          }),
      ],
    ];
    for (const [name, send] of sends) {
      await send();
      expect(providerOfLastSend(), name).toBe("brevo");
      // The caller's key travels unchanged, so a retried job is deduplicated.
      expect(vi.mocked(sendEmail).mock.calls.at(-1)?.[0].idempotencyKey, name).toBe(idempotencyKey);
    }
  });
});
