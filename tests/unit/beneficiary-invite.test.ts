import { render } from "@react-email/components";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db/server", () => ({
  createUserClient: vi.fn(),
  createServiceClient: vi.fn(),
}));
vi.mock("@/lib/auth/require-user", () => ({
  assertAccountActive: vi.fn(),
}));
vi.mock("@/lib/repositories/beneficiary.repository", () => ({
  findById: vi.fn(),
  findByEmail: vi.fn(),
  insert: vi.fn(),
  markInvited: vi.fn(),
  markInvitedIfUninvited: vi.fn(),
}));
vi.mock("@/lib/security/rate-limit", () => ({
  checkRateLimit: vi.fn(),
}));
vi.mock("@/lib/audit/audit.service", () => ({
  audit: { log: vi.fn() },
}));
vi.mock("@/lib/email/client", () => ({
  emailConfigured: vi.fn(),
}));
vi.mock("@/lib/email/send", () => ({
  sendBeneficiaryInvitationEmail: vi.fn(),
}));
vi.mock("@/lib/observability/logger", () => ({
  logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn() },
}));

import { ApiError } from "@/lib/api/errors";
import { audit } from "@/lib/audit/audit.service";
import type { AppUser } from "@/lib/auth/ensure-app-user";
import { assertAccountActive } from "@/lib/auth/require-user";
import { createServiceClient, createUserClient } from "@/lib/db/server";
import { emailConfigured } from "@/lib/email/client";
import { sendBeneficiaryInvitationEmail } from "@/lib/email/send";
import { BeneficiaryInvitationEmail } from "@/lib/email/templates/beneficiary-invitation-email";
import { logger } from "@/lib/observability/logger";
import * as beneficiaryRepository from "@/lib/repositories/beneficiary.repository";
import { checkRateLimit } from "@/lib/security/rate-limit";
import { createBeneficiary, inviteBeneficiary } from "@/lib/services/beneficiary.service";
import type { Beneficiary } from "@/lib/types/beneficiary";

/**
 * Beneficiary invitation email (POST /beneficiaries/:id/invite).
 *
 * `emailSent` is what the owner is told, so it must be the provider's answer and
 * nothing else; a failed send keeps the recorded invitation; nothing is stamped
 * or sent for a beneficiary the caller does not own; and the message carries a
 * notification, never the owner's data or anything resembling access.
 */
const BENEFICIARY_ID = "33333333-3333-4333-8333-333333333333";
const ADDRESS = "asha.rao@example.com";

const user = {
  id: "22222222-2222-4222-8222-222222222222",
  name: "Priya Sharma",
  email: "owner@example.com",
  role: "USER",
  deletionRequestedAt: null,
} as unknown as AppUser;

function beneficiary(overrides: Partial<Beneficiary> = {}): Beneficiary {
  return {
    id: BENEFICIARY_ID,
    name: "Asha Rao",
    relationship: "Sibling",
    email: ADDRESS,
    phone: "+91 98765 43210",
    status: "PENDING",
    invitedAt: null,
    activatedAt: null,
    notes: "Gets the Goa flat",
    createdAt: "2026-09-01T00:00:00.000Z",
    updatedAt: "2026-09-01T00:00:00.000Z",
    ...overrides,
  };
}

const userDb = { from: vi.fn(), rpc: vi.fn() };
const serviceDb = { from: vi.fn(), rpc: vi.fn() };

beforeEach(() => {
  vi.mocked(createUserClient).mockResolvedValue(userDb as never);
  vi.mocked(createServiceClient).mockReturnValue(serviceDb as never);
  vi.mocked(beneficiaryRepository.findById).mockResolvedValue(beneficiary());
  vi.mocked(beneficiaryRepository.markInvited).mockImplementation(async (_db, _userId, _id, at) =>
    beneficiary({ invitedAt: at }),
  );
  vi.mocked(emailConfigured).mockReturnValue(true);
  vi.mocked(sendBeneficiaryInvitationEmail).mockResolvedValue({
    providerMessageId: "msg_1",
    provider: "brevo",
  });
  vi.mocked(audit.log).mockReset();
  vi.mocked(beneficiaryRepository.findByEmail).mockResolvedValue(null);
  vi.mocked(beneficiaryRepository.insert).mockResolvedValue(beneficiary());
  vi.mocked(beneficiaryRepository.markInvitedIfUninvited).mockImplementation(
    async (_db, _userId, _id, at) => beneficiary({ invitedAt: at }),
  );
  vi.mocked(checkRateLimit).mockResolvedValue({
    allowed: true,
    limit: 5,
    remaining: 4,
    retryAfterSeconds: 900,
  });
});

afterEach(() => {
  vi.useRealTimers();
});

function auditMetadata() {
  return vi.mocked(audit.log).mock.calls.at(-1)?.[0].metadata;
}

describe("inviteBeneficiary — delivery", () => {
  it("emails the stored address and reports emailSent only after the provider accepts", async () => {
    const result = await inviteBeneficiary(user, BENEFICIARY_ID, "corr");

    expect(result.emailSent).toBe(true);
    expect(result.beneficiary.invitedAt).not.toBeNull();
    expect(sendBeneficiaryInvitationEmail).toHaveBeenCalledTimes(1);
    const input = vi.mocked(sendBeneficiaryInvitationEmail).mock.calls[0][0];
    expect(input).toMatchObject({
      to: ADDRESS,
      beneficiaryName: "Asha Rao",
      ownerName: "Priya Sharma",
    });
    // Exactly what the template needs — no notes, phone or relationship.
    expect(Object.keys(input).sort()).toEqual([
      "beneficiaryName",
      "idempotencyKey",
      "ownerName",
      "to",
    ]);
    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "beneficiary.invited",
        resourceId: BENEFICIARY_ID,
        outcome: "SUCCESS",
        correlationId: "corr",
      }),
    );
    // The provider's id ties this invitation to its delivery events; the
    // response itself does not carry it.
    expect(auditMetadata()).toMatchObject({ emailSent: true, providerMessageId: "msg_1" });
    expect(result).not.toHaveProperty("providerMessageId");
    const audited = JSON.stringify(auditMetadata());
    expect(audited).not.toContain(ADDRESS);
    expect(audited).not.toContain("Asha Rao");
  });

  it("records a Brevo message id unchanged and keeps the response shape", async () => {
    const brevoId = "<202610050900.1234567890@smtp-relay.mailin.fr>";
    vi.mocked(sendBeneficiaryInvitationEmail).mockResolvedValue({
      providerMessageId: brevoId,
      provider: "brevo",
    });

    const result = await inviteBeneficiary(user, BENEFICIARY_ID, "corr");

    expect(Object.keys(result).sort()).toEqual(["beneficiary", "emailSent"]);
    expect(result.emailSent).toBe(true);
    expect(auditMetadata()).toEqual({
      previousInvitedAt: null,
      emailSent: true,
      providerMessageId: brevoId,
    });
    expect(JSON.stringify(auditMetadata())).not.toContain(ADDRESS);
  });

  it("records the invitation but reports emailSent false when email is not configured", async () => {
    vi.mocked(emailConfigured).mockReturnValue(false);

    const result = await inviteBeneficiary(user, BENEFICIARY_ID, "corr");

    expect(result.emailSent).toBe(false);
    expect(beneficiaryRepository.markInvited).toHaveBeenCalledTimes(1);
    expect(sendBeneficiaryInvitationEmail).not.toHaveBeenCalled();
    expect(auditMetadata()).toMatchObject({ emailSent: false });
    expect(auditMetadata()).not.toHaveProperty("providerMessageId");
  });
});

describe("inviteBeneficiary — missing email", () => {
  it.each([
    ["empty", ""],
    ["malformed", "not-an-address"],
  ])("refuses a beneficiary with an %s address before recording or sending", async (_, email) => {
    vi.mocked(beneficiaryRepository.findById).mockResolvedValue(beneficiary({ email }));

    await expect(inviteBeneficiary(user, BENEFICIARY_ID, "corr")).rejects.toMatchObject({
      status: 422,
      code: "VALIDATION_ERROR",
      fields: { email: expect.any(Array) },
    });
    expect(beneficiaryRepository.markInvited).not.toHaveBeenCalled();
    expect(sendBeneficiaryInvitationEmail).not.toHaveBeenCalled();
    expect(audit.log).not.toHaveBeenCalled();
  });
});

describe("inviteBeneficiary — provider failure", () => {
  it("keeps the recorded invitation, reports emailSent false and logs no address", async () => {
    vi.mocked(sendBeneficiaryInvitationEmail).mockRejectedValue(
      new Error("email send failed: validation_error"),
    );

    const result = await inviteBeneficiary(user, BENEFICIARY_ID, "corr");

    expect(result.emailSent).toBe(false);
    expect(result.beneficiary.invitedAt).not.toBeNull();
    expect(auditMetadata()).toMatchObject({ emailSent: false });
    expect(auditMetadata()).not.toHaveProperty("providerMessageId");
    expect(vi.mocked(audit.log).mock.calls[0][0].outcome).toBe("SUCCESS");

    expect(logger.error).toHaveBeenCalledTimes(1);
    const logged = JSON.stringify(vi.mocked(logger.error).mock.calls);
    expect(logged).toContain(BENEFICIARY_ID);
    expect(logged).not.toContain(ADDRESS);
    expect(logged).not.toContain("Asha Rao");
  });
});

describe("inviteBeneficiary — idempotency", () => {
  it("keys the email to the recorded invitation, so a resend is a new message", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });

    vi.setSystemTime(new Date("2026-10-04T09:00:00.000Z"));
    await inviteBeneficiary(user, BENEFICIARY_ID, "corr-1");
    vi.setSystemTime(new Date("2026-10-04T09:05:00.000Z"));
    await inviteBeneficiary(user, BENEFICIARY_ID, "corr-2");

    const stamps = vi.mocked(beneficiaryRepository.markInvited).mock.calls.map((call) => call[3]);
    const keys = vi
      .mocked(sendBeneficiaryInvitationEmail)
      .mock.calls.map((call) => call[0].idempotencyKey);

    // Same key for the same invitation (a retried send is deduplicated by the
    // provider); a deliberate resend stamps a new invitation and a new key.
    expect(keys).toEqual([
      `beneficiary-invite:${BENEFICIARY_ID}:${stamps[0]}`,
      `beneficiary-invite:${BENEFICIARY_ID}:${stamps[1]}`,
    ]);
    expect(new Set(keys).size).toBe(2);
    // One row, re-stamped — never a second invitation record.
    expect(vi.mocked(beneficiaryRepository.markInvited).mock.calls.map((call) => call[2])).toEqual([
      BENEFICIARY_ID,
      BENEFICIARY_ID,
    ]);
  });
});

describe("createBeneficiary — automatic invitation", () => {
  const input = { name: "Asha Rao", relationship: "Sibling", email: ADDRESS };

  it("invites a new beneficiary once, with a key fixed to that first invitation", async () => {
    const created = await createBeneficiary(user, input, "corr");

    expect(created.invitationEmailSent).toBe(true);
    expect(created.invitedAt).not.toBeNull();
    expect(sendBeneficiaryInvitationEmail).toHaveBeenCalledTimes(1);
    expect(vi.mocked(sendBeneficiaryInvitationEmail).mock.calls[0][0]).toMatchObject({
      to: ADDRESS,
      idempotencyKey: `beneficiary-invite:${BENEFICIARY_ID}:initial`,
    });
    // Stamped only while none is recorded, through the caller's own scope.
    expect(beneficiaryRepository.markInvitedIfUninvited).toHaveBeenCalledWith(
      serviceDb,
      user.id,
      BENEFICIARY_ID,
      expect.any(String),
    );
    expect(checkRateLimit).toHaveBeenCalledWith({ policy: "sensitive", subject: user.id });
    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: "beneficiary.invited", resourceId: BENEFICIARY_ID }),
    );
    expect(JSON.stringify(auditMetadata())).not.toContain(ADDRESS);
  });

  it("sends nothing when another request already recorded the invitation", async () => {
    vi.mocked(beneficiaryRepository.markInvitedIfUninvited).mockResolvedValue(null);

    const created = await createBeneficiary(user, input, "corr");

    expect(created.invitationEmailSent).toBe(false);
    expect(sendBeneficiaryInvitationEmail).not.toHaveBeenCalled();
  });

  it("keeps the beneficiary when the invitation email fails", async () => {
    vi.mocked(sendBeneficiaryInvitationEmail).mockRejectedValue(
      new Error("email send failed: unauthorized"),
    );

    const created = await createBeneficiary(user, input, "corr");

    expect(created.id).toBe(BENEFICIARY_ID);
    expect(created.invitationEmailSent).toBe(false);
    expect(JSON.stringify(vi.mocked(logger.error).mock.calls)).not.toContain(ADDRESS);
  });

  it("still reports a delivered invitation when only the audit write fails", async () => {
    vi.mocked(audit.log).mockImplementation(async (entry) => {
      if (entry.action === "beneficiary.invited") throw new Error("audit down");
    });

    const created = await createBeneficiary(user, input, "corr");

    expect(created.invitationEmailSent).toBe(true);
    expect(created.invitedAt).not.toBeNull();
  });

  it("keeps the beneficiary when recording the invitation throws", async () => {
    vi.mocked(beneficiaryRepository.markInvitedIfUninvited).mockRejectedValue(new Error("db down"));

    const created = await createBeneficiary(user, input, "corr");

    expect(created.id).toBe(BENEFICIARY_ID);
    expect(created.invitationEmailSent).toBe(false);
    expect(sendBeneficiaryInvitationEmail).not.toHaveBeenCalled();
  });

  it.each([
    [
      "the third-party email budget is spent",
      () =>
        vi.mocked(checkRateLimit).mockResolvedValue({
          allowed: false,
          limit: 5,
          remaining: 0,
          retryAfterSeconds: 60,
        }),
    ],
    ["email is not configured", () => vi.mocked(emailConfigured).mockReturnValue(false)],
  ])("records and sends nothing when %s", async (_, arrange) => {
    arrange();

    const created = await createBeneficiary(user, input, "corr");

    expect(created.invitationEmailSent).toBe(false);
    expect(created.invitedAt).toBeNull();
    expect(beneficiaryRepository.markInvitedIfUninvited).not.toHaveBeenCalled();
    expect(sendBeneficiaryInvitationEmail).not.toHaveBeenCalled();
  });
});

describe("inviteBeneficiary — authorization", () => {
  it("scopes the read and the stamp to the caller", async () => {
    await inviteBeneficiary(user, BENEFICIARY_ID, "corr");

    expect(beneficiaryRepository.findById).toHaveBeenCalledWith(userDb, user.id, BENEFICIARY_ID);
    expect(beneficiaryRepository.markInvited).toHaveBeenCalledWith(
      serviceDb,
      user.id,
      BENEFICIARY_ID,
      expect.any(String),
    );
  });

  it("answers 404 for a beneficiary the caller does not own and sends nothing", async () => {
    vi.mocked(beneficiaryRepository.findById).mockResolvedValue(null);

    await expect(inviteBeneficiary(user, BENEFICIARY_ID, "corr")).rejects.toMatchObject({
      status: 404,
    });
    expect(createServiceClient).not.toHaveBeenCalled();
    expect(beneficiaryRepository.markInvited).not.toHaveBeenCalled();
    expect(sendBeneficiaryInvitationEmail).not.toHaveBeenCalled();
    expect(audit.log).not.toHaveBeenCalled();
  });

  it("refuses an inactive beneficiary and sends nothing", async () => {
    vi.mocked(beneficiaryRepository.findById).mockResolvedValue(
      beneficiary({ status: "INACTIVE" }),
    );

    await expect(inviteBeneficiary(user, BENEFICIARY_ID, "corr")).rejects.toMatchObject({
      status: 422,
      code: "BENEFICIARY_INACTIVE",
    });
    expect(beneficiaryRepository.markInvited).not.toHaveBeenCalled();
    expect(sendBeneficiaryInvitationEmail).not.toHaveBeenCalled();
  });

  it("refuses an account scheduled for deletion before reading anything", async () => {
    vi.mocked(assertAccountActive).mockImplementationOnce(() => {
      throw ApiError.forbidden();
    });

    await expect(inviteBeneficiary(user, BENEFICIARY_ID, "corr")).rejects.toMatchObject({
      status: 403,
    });
    expect(createUserClient).not.toHaveBeenCalled();
    expect(sendBeneficiaryInvitationEmail).not.toHaveBeenCalled();
  });
});

describe("BeneficiaryInvitationEmail", () => {
  it("notifies without granting access or carrying the owner's data", async () => {
    const html = await render(
      BeneficiaryInvitationEmail({
        beneficiaryName: "Asha Rao",
        ownerName: "Priya Sharma",
        appUrl: "https://app.example.com",
      }),
    );
    const text = await render(
      BeneficiaryInvitationEmail({
        beneficiaryName: "Asha Rao",
        ownerName: "Priya Sharma",
        appUrl: "https://app.example.com",
      }),
      { plainText: true },
    );

    expect(text).toContain("Priya Sharma");
    expect(text).toContain("Asha Rao");
    expect(text).toMatch(/does not give you access/i);
    expect(text).toMatch(/contact Priya Sharma directly/i);
    // The only link is the app itself — no token, no access or sign-up path.
    const hrefs = [...html.matchAll(/href="([^"]*)"/g)].map((match) => match[1]);
    expect(hrefs).toEqual(["https://app.example.com"]);
  });
});
