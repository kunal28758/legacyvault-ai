import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db/server", () => ({
  createUserClient: vi.fn(),
  createServiceClient: vi.fn(),
}));
vi.mock("@/lib/auth/require-user", () => ({
  assertAccountActive: vi.fn(),
}));
vi.mock("@/lib/repositories/document.repository", () => ({
  findById: vi.fn(),
}));
vi.mock("@/lib/services/access.service", () => ({
  issueDocumentShareLink: vi.fn(),
}));

import { createUserClient } from "@/lib/db/server";
import type { AppUser } from "@/lib/auth/ensure-app-user";
import * as documentRepository from "@/lib/repositories/document.repository";
import * as accessService from "@/lib/services/access.service";
import { shareDocument } from "@/lib/services/document.service";

/**
 * Sharing a document (POST /documents/:id/share).
 *
 * The share is recorded first, then the beneficiary is emailed a link that
 * follows their shares. Asserted: a second share needs nothing manual, a failed
 * email never undoes the share, and nothing is issued for a beneficiary the
 * caller does not own or has deactivated.
 */
const DOCUMENT_ID = "11111111-1111-4111-8111-111111111111";
const BENEFICIARY_ID = "33333333-3333-4333-8333-333333333333";
const user = {
  id: "22222222-2222-4222-8222-222222222222",
  name: "Priya Sharma",
  role: "USER",
  deletionRequestedAt: null,
} as unknown as AppUser;

type Result = { data: unknown; error: unknown };

/** A PostgREST-shaped client: each `from(table)` answers with the next queued result. */
function fakeDb(tables: Record<string, Result[]>, rpcError: unknown = null) {
  const from = vi.fn((table: string) => {
    const result = tables[table]?.shift() ?? { data: null, error: null };
    const chain: object = new Proxy(
      {},
      {
        get: (_target, prop) =>
          prop === "then"
            ? (resolve: (value: Result) => void) => resolve(result)
            : prop === "maybeSingle" || prop === "single"
              ? () => Promise.resolve(result)
              : () => chain,
      },
    );
    return chain;
  });
  const rpc = vi.fn(async () => ({ data: null, error: rpcError }));
  return { from, rpc };
}

function sharedDb(status = "PENDING", rpcError: unknown = null) {
  return fakeDb(
    {
      beneficiaries: [
        { data: status ? { id: BENEFICIARY_ID, status } : null, error: null },
        { data: [{ id: BENEFICIARY_ID, name: "Asha Rao" }], error: null },
      ],
      beneficiary_assignments: [
        {
          data: [{ id: "a1", beneficiary_id: BENEFICIARY_ID, created_at: "2026-10-05" }],
          error: null,
        },
      ],
    },
    rpcError,
  );
}

beforeEach(() => {
  vi.mocked(documentRepository.findById).mockResolvedValue({ id: DOCUMENT_ID } as never);
  vi.mocked(accessService.issueDocumentShareLink).mockResolvedValue({ emailSent: true });
});

describe("shareDocument", () => {
  it("records the share, then emails the beneficiary's link", async () => {
    const db = sharedDb();
    vi.mocked(createUserClient).mockResolvedValue(db as never);

    const result = await shareDocument(user, DOCUMENT_ID, BENEFICIARY_ID, "corr");

    expect(db.rpc).toHaveBeenCalledWith("assign_beneficiary", {
      p_beneficiary_id: BENEFICIARY_ID,
      p_resource_type: "DOCUMENT",
      p_resource_id: DOCUMENT_ID,
      p_corr: "corr",
    });
    expect(accessService.issueDocumentShareLink).toHaveBeenCalledWith(user, BENEFICIARY_ID, "corr");
    expect(result).toEqual({
      shares: [
        {
          assignmentId: "a1",
          beneficiaryId: BENEFICIARY_ID,
          beneficiaryName: "Asha Rao",
          createdAt: "2026-10-05",
        },
      ],
      accessEmailSent: true,
    });
  });

  it("emails again for a second document with no manual step", async () => {
    vi.mocked(createUserClient).mockResolvedValueOnce(sharedDb() as never);
    await shareDocument(user, DOCUMENT_ID, BENEFICIARY_ID, "corr-1");
    vi.mocked(createUserClient).mockResolvedValueOnce(sharedDb() as never);
    await shareDocument(user, "44444444-4444-4444-8444-444444444444", BENEFICIARY_ID, "corr-2");

    expect(accessService.issueDocumentShareLink).toHaveBeenCalledTimes(2);
  });

  it("keeps the share when the email cannot be sent", async () => {
    vi.mocked(createUserClient).mockResolvedValue(sharedDb() as never);
    vi.mocked(accessService.issueDocumentShareLink).mockResolvedValue({ emailSent: false });

    const result = await shareDocument(user, DOCUMENT_ID, BENEFICIARY_ID, "corr");

    expect(result.accessEmailSent).toBe(false);
    expect(result.shares).toHaveLength(1);
  });

  it.each([
    ["is not the caller's", null, 404],
    ["is inactive", "INACTIVE", 422],
  ])("issues nothing when the beneficiary %s", async (_, status, httpStatus) => {
    const db = sharedDb(status as string);
    vi.mocked(createUserClient).mockResolvedValue(db as never);

    await expect(shareDocument(user, DOCUMENT_ID, BENEFICIARY_ID, "corr")).rejects.toMatchObject({
      status: httpStatus,
    });
    expect(db.rpc).not.toHaveBeenCalled();
    expect(accessService.issueDocumentShareLink).not.toHaveBeenCalled();
  });

  it("issues nothing when the document is not the caller's", async () => {
    vi.mocked(createUserClient).mockResolvedValue(sharedDb() as never);
    vi.mocked(documentRepository.findById).mockResolvedValue(null);

    await expect(shareDocument(user, DOCUMENT_ID, BENEFICIARY_ID, "corr")).rejects.toMatchObject({
      status: 404,
    });
    expect(accessService.issueDocumentShareLink).not.toHaveBeenCalled();
  });

  it("issues nothing when the share itself is refused", async () => {
    vi.mocked(createUserClient).mockResolvedValue(
      sharedDb("PENDING", { code: "LV409", message: "ALREADY_ASSIGNED" }) as never,
    );

    await expect(shareDocument(user, DOCUMENT_ID, BENEFICIARY_ID, "corr")).rejects.toBeTruthy();
    expect(accessService.issueDocumentShareLink).not.toHaveBeenCalled();
  });
});
