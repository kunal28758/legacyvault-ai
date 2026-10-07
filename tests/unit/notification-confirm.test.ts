import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/email/client", () => ({ lookupDelivery: vi.fn() }));
vi.mock("@/lib/repositories/notification.repository", () => ({
  findById: vi.fn(),
  recordOutcome: vi.fn(),
}));
vi.mock("@/lib/audit/audit.service", () => ({ audit: { log: vi.fn() } }));
vi.mock("@/lib/observability/logger", () => ({ logger: { warn: vi.fn(), info: vi.fn() } }));

import { audit } from "@/lib/audit/audit.service";
import { lookupDelivery } from "@/lib/email/client";
import { notificationConfirmHandler } from "@/lib/jobs/handlers/notification-confirm";
import * as notificationRepository from "@/lib/repositories/notification.repository";

/**
 * The confirmation step behind the release gate (migration 0009): SENT only
 * means a provider took the request; this job asks it what happened. Only an
 * explicit delivery becomes DELIVERED. No outcome yet, or an unreachable
 * provider, is a retryable failure — never a confirmation.
 */
const job = { id: "job-1", payload: { notificationId: "n1" } } as never;
const db = {} as never;

function sent(overrides: Record<string, unknown> = {}) {
  return {
    id: "n1",
    user_id: "u1",
    type: "dms.escalating",
    delivery_status: "SENT",
    provider_message_id: "<1@smtp-relay>",
    delivery_provider: "brevo",
    ...overrides,
  } as never;
}

beforeEach(() => {
  vi.mocked(notificationRepository.recordOutcome).mockResolvedValue(true);
});

describe("notification.confirm", () => {
  it.each([
    ["delivered", "DELIVERED"],
    ["bounced", "BOUNCED"],
    ["failed", "FAILED"],
  ] as const)("records %s as %s, asking the provider that carried it", async (outcome, status) => {
    vi.mocked(notificationRepository.findById).mockResolvedValue(sent());
    vi.mocked(lookupDelivery).mockResolvedValue(outcome);

    await notificationConfirmHandler(job, db);

    expect(lookupDelivery).toHaveBeenCalledWith("brevo", "<1@smtp-relay>");
    expect(notificationRepository.recordOutcome).toHaveBeenCalledWith(db, "n1", status);
  });

  it("audits a critical email that did not arrive, without any address", async () => {
    vi.mocked(notificationRepository.findById).mockResolvedValue(sent());
    vi.mocked(lookupDelivery).mockResolvedValue("bounced");

    await notificationConfirmHandler(job, db);

    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "notification.delivery_failed",
        outcome: "FAILURE",
        metadata: {
          ownerUserId: "u1",
          type: "dms.escalating",
          outcome: "bounced",
          provider: "brevo",
        },
      }),
    );
  });

  it("does not audit a delivery", async () => {
    vi.mocked(notificationRepository.findById).mockResolvedValue(sent());
    vi.mocked(lookupDelivery).mockResolvedValue("delivered");
    await notificationConfirmHandler(job, db);
    expect(audit.log).not.toHaveBeenCalled();
  });

  it("fails — to be retried — while the provider has no outcome yet, recording nothing", async () => {
    vi.mocked(notificationRepository.findById).mockResolvedValue(sent());
    vi.mocked(lookupDelivery).mockResolvedValue("pending");

    await expect(notificationConfirmHandler(job, db)).rejects.toThrow("delivery not confirmed yet");
    expect(notificationRepository.recordOutcome).not.toHaveBeenCalled();
  });

  it("fails — to be retried — when the provider cannot be asked, recording nothing", async () => {
    vi.mocked(notificationRepository.findById).mockResolvedValue(sent());
    vi.mocked(lookupDelivery).mockRejectedValue(new Error("email send failed: timeout"));

    await expect(notificationConfirmHandler(job, db)).rejects.toThrow("timeout");
    expect(notificationRepository.recordOutcome).not.toHaveBeenCalled();
  });

  it.each([
    ["already delivered", { delivery_status: "DELIVERED" }],
    ["already bounced", { delivery_status: "BOUNCED" }],
    ["never emailed (in-app only)", { delivery_status: "DELIVERED", provider_message_id: null }],
    ["sent before providers were recorded", { delivery_provider: null }],
  ])("asks nothing when the notification is %s", async (_, overrides) => {
    vi.mocked(notificationRepository.findById).mockResolvedValue(sent(overrides));
    await notificationConfirmHandler(job, db);
    expect(lookupDelivery).not.toHaveBeenCalled();
    expect(notificationRepository.recordOutcome).not.toHaveBeenCalled();
  });

  it("does nothing for a notification that no longer exists", async () => {
    vi.mocked(notificationRepository.findById).mockResolvedValue(null);
    await notificationConfirmHandler(job, db);
    expect(lookupDelivery).not.toHaveBeenCalled();
  });
});
