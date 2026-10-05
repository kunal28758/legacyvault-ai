import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db/server", () => ({
  createUserClient: vi.fn(),
  createServiceClient: vi.fn(),
}));
vi.mock("@/lib/auth/require-user", () => ({
  assertAccountActive: vi.fn(),
}));
vi.mock("@/lib/config/env", () => ({
  getEnvGroup: vi.fn(() => ({ APP_URL: "https://app.example.com" })),
}));
vi.mock("@/lib/security/rate-limit", () => ({
  checkRateLimit: vi.fn(),
}));
vi.mock("@/lib/email/client", () => ({
  emailConfigured: vi.fn(() => true),
}));
vi.mock("@/lib/email/send", () => ({
  sendAccessLinkEmail: vi.fn(),
}));
vi.mock("@/lib/audit/audit.service", () => ({
  audit: { log: vi.fn() },
}));
vi.mock("@/lib/observability/logger", () => ({
  logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn() },
}));
vi.mock("@/lib/repositories/access-token.repository", () => ({
  findById: vi.fn(),
}));

import { audit } from "@/lib/audit/audit.service";
import type { AppUser } from "@/lib/auth/ensure-app-user";
import { createUserClient } from "@/lib/db/server";
import { emailConfigured } from "@/lib/email/client";
import { sendAccessLinkEmail } from "@/lib/email/send";
import { logger } from "@/lib/observability/logger";
import * as accessTokenRepository from "@/lib/repositories/access-token.repository";
import { hashAccessToken } from "@/lib/security/access-token";
import { checkRateLimit } from "@/lib/security/rate-limit";
import { issueDocumentShareLink } from "@/lib/services/access.service";

/**
 * The link a document share emails by itself (migration 0007).
 *
 * Minted through `issue_document_share_token()` with only the hash, emailed as a
 * DIRECT_SHARE link, audited — and never able to break the share that asked for
 * it: a refused mint, a failed email or a spent budget all answer
 * `emailSent: false` without throwing, and nothing secret reaches a log.
 */
const BENEFICIARY_ID = "33333333-3333-4333-8333-333333333333";
const TOKEN_ID = "55555555-5555-4555-8555-555555555555";
const ADDRESS = "asha.rao@example.com";
const user = {
  id: "22222222-2222-4222-8222-222222222222",
  name: "Priya Sharma",
  role: "USER",
  deletionRequestedAt: null,
} as unknown as AppUser;

function fakeDb(rpcResult: { data: unknown; error: unknown }) {
  const chain: object = new Proxy(
    {},
    {
      get: (_target, prop) =>
        prop === "maybeSingle"
          ? () =>
              Promise.resolve({
                data: { id: BENEFICIARY_ID, name: "Asha Rao", email: ADDRESS, status: "PENDING" },
                error: null,
              })
          : () => chain,
    },
  );
  return { from: vi.fn(() => chain), rpc: vi.fn(async () => rpcResult) };
}

let db: ReturnType<typeof fakeDb>;

beforeEach(() => {
  db = fakeDb({ data: TOKEN_ID, error: null });
  vi.mocked(createUserClient).mockResolvedValue(db as never);
  vi.mocked(checkRateLimit).mockResolvedValue({
    allowed: true,
    limit: 5,
    remaining: 4,
    retryAfterSeconds: 900,
  });
  vi.mocked(sendAccessLinkEmail).mockResolvedValue({ providerMessageId: "msg_1" });
  vi.mocked(audit.log).mockReset();
  vi.mocked(accessTokenRepository.findById).mockResolvedValue({ id: TOKEN_ID } as never);
});

describe("issueDocumentShareLink", () => {
  it("mints a share-following link from the hash alone and emails it", async () => {
    await expect(issueDocumentShareLink(user, BENEFICIARY_ID, "corr")).resolves.toEqual({
      emailSent: true,
    });

    expect(checkRateLimit).toHaveBeenCalledWith({ policy: "sensitive", subject: user.id });
    expect(db.rpc).toHaveBeenCalledWith("issue_document_share_token", {
      p_beneficiary_id: BENEFICIARY_ID,
      p_token_hash: expect.stringMatching(/^[0-9a-f]{64}$/),
      p_expires_at: expect.any(String),
      p_corr: "corr",
    });

    const email = vi.mocked(sendAccessLinkEmail).mock.calls[0][0];
    expect(email).toMatchObject({
      to: ADDRESS,
      grantType: "DIRECT_SHARE",
      idempotencyKey: `access-link:${TOKEN_ID}`,
    });
    // The emailed secret is the one whose hash was stored — and only its hash was.
    const secret = new URL(email.link).searchParams.get("t") ?? "";
    const rpcArgs = (db.rpc.mock.calls[0] as unknown[])[1] as { p_token_hash: string };
    expect(hashAccessToken(secret)).toBe(rpcArgs.p_token_hash);

    const audited = JSON.stringify(vi.mocked(audit.log).mock.calls);
    expect(audited).toContain('"emailSent":true');
    expect(audited).not.toContain(ADDRESS);
    expect(audited).not.toContain(secret);
  });

  it("still reports a delivered email when only the audit write after it fails", async () => {
    vi.mocked(audit.log).mockRejectedValue(new Error("audit down"));

    await expect(issueDocumentShareLink(user, BENEFICIARY_ID, "corr")).resolves.toEqual({
      emailSent: true,
    });
    expect(sendAccessLinkEmail).toHaveBeenCalledTimes(1);
    expect(logger.error).toHaveBeenCalledTimes(1);
  });

  it("never logs the address, the link, the secret or its hash on any failure path", async () => {
    const failures: (() => void)[] = [
      () => vi.mocked(sendAccessLinkEmail).mockRejectedValueOnce(new Error("email send failed: x")),
      () => vi.mocked(audit.log).mockRejectedValueOnce(new Error("audit down")),
      () =>
        vi
          .mocked(checkRateLimit)
          .mockResolvedValueOnce({ allowed: false, limit: 5, remaining: 0, retryAfterSeconds: 1 }),
      () => {
        db = fakeDb({ data: null, error: { code: "LV422", message: "SCOPE_EMPTY" } });
        vi.mocked(createUserClient).mockResolvedValue(db as never);
      },
    ];
    for (const fail of failures) {
      fail();
      await issueDocumentShareLink(user, BENEFICIARY_ID, "corr");
    }

    const logged = JSON.stringify([
      ...vi.mocked(logger.error).mock.calls,
      ...vi.mocked(logger.warn).mock.calls,
    ]);
    const secrets = vi
      .mocked(sendAccessLinkEmail)
      .mock.calls.map((call) => new URL(call[0].link).searchParams.get("t") ?? "");
    const hashes = db.rpc.mock.calls.map(
      (call) => ((call as unknown[])[1] as { p_token_hash: string }).p_token_hash,
    );
    for (const leaked of [ADDRESS, "/access?t=", ...secrets, ...hashes]) {
      expect(logged).not.toContain(leaked);
    }
  });

  it("reports a failed email without throwing or logging the address or link", async () => {
    vi.mocked(sendAccessLinkEmail).mockRejectedValue(new Error("email send failed: unauthorized"));

    await expect(issueDocumentShareLink(user, BENEFICIARY_ID, "corr")).resolves.toEqual({
      emailSent: false,
    });
    const logged = JSON.stringify(vi.mocked(logger.error).mock.calls);
    expect(logged).not.toContain(ADDRESS);
    expect(logged).not.toContain("/access?t=");
  });

  it("sends nothing when the mint is refused", async () => {
    db = fakeDb({ data: null, error: { code: "LV422", message: "BENEFICIARY_INACTIVE" } });
    vi.mocked(createUserClient).mockResolvedValue(db as never);

    await expect(issueDocumentShareLink(user, BENEFICIARY_ID, "corr")).resolves.toEqual({
      emailSent: false,
    });
    expect(sendAccessLinkEmail).not.toHaveBeenCalled();
  });

  it("mints nothing when email is not configured", async () => {
    vi.mocked(emailConfigured).mockReturnValueOnce(false);

    await expect(issueDocumentShareLink(user, BENEFICIARY_ID, "corr")).resolves.toEqual({
      emailSent: false,
    });
    expect(db.rpc).not.toHaveBeenCalled();
    expect(checkRateLimit).not.toHaveBeenCalled();
  });

  it("mints and sends nothing when the third-party email budget is spent", async () => {
    vi.mocked(checkRateLimit).mockResolvedValue({
      allowed: false,
      limit: 5,
      remaining: 0,
      retryAfterSeconds: 60,
    });

    await expect(issueDocumentShareLink(user, BENEFICIARY_ID, "corr")).resolves.toEqual({
      emailSent: false,
    });
    expect(db.rpc).not.toHaveBeenCalled();
    expect(sendAccessLinkEmail).not.toHaveBeenCalled();
  });
});
