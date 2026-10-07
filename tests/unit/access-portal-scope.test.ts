import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db/server", () => ({
  createServiceClient: vi.fn(),
}));

import { createServiceClient } from "@/lib/db/server";
import { requireGrant } from "@/lib/services/access-portal.service";

/**
 * Which documents a link may open (migration 0007).
 *
 * Only DIRECT_SHARE links consult the live shares: a link minted by sharing
 * shows every current share, any other DIRECT_SHARE link keeps its fixed list
 * minus what was unshared, and DMS and emergency grants keep exactly what was
 * released — the shares table is not even read for them.
 */
const SHARED_NOW = ["doc-will", "doc-deed"];

let assignmentReads = 0;

function fakeDb(
  token: Record<string, unknown>,
  state: { switchStatus?: string; requestStatus?: string } = {},
) {
  const rows: Record<string, unknown> = {
    access_tokens: token,
    beneficiaries: {
      id: "b1",
      name: "Asha",
      email: "asha@example.com",
      status: "ACTIVE",
      deleted_at: null,
      user_id: "u1",
    },
    users: { id: "u1", name: "Priya", deleted_at: null },
    // The grant behind a system link must still stand (migration 0009).
    dead_man_switches: { status: state.switchStatus ?? "RELEASED" },
    emergency_access_requests: { status: state.requestStatus ?? "ACTIVE" },
  };
  return {
    from: (table: string) => {
      if (table === "beneficiary_assignments") assignmentReads += 1;
      const result =
        table === "beneficiary_assignments"
          ? { data: SHARED_NOW.map((id) => ({ resource_id: id })), error: null }
          : { data: rows[table], error: null };
      const chain: object = new Proxy(
        {},
        {
          get: (_target, prop) =>
            prop === "then"
              ? (resolve: (value: unknown) => void) => resolve(result)
              : prop === "maybeSingle"
                ? () => Promise.resolve(result)
                : () => chain,
        },
      );
      return chain;
    },
  };
}

function token(grantType: string, documents: string[], followsShares = false) {
  return {
    id: "t1",
    owner_user_id: "u1",
    beneficiary_id: "b1",
    grant_type: grantType,
    scope: { documents, assets: [], videos: [], planSections: [] },
    expires_at: new Date(Date.now() + 86_400_000).toISOString(),
    revoked_at: null,
    used_at: null,
    follows_document_shares: followsShares,
    dead_man_switch_id: grantType === "DMS_RELEASE" ? "s1" : null,
    emergency_request_id: grantType === "EMERGENCY_ACCESS" ? "r1" : null,
    created_at: new Date().toISOString(),
    // A release session exists only after the contact confirmed a code.
    verified_at: grantType === "DMS_RELEASE" ? new Date().toISOString() : null,
  };
}

beforeEach(() => {
  assignmentReads = 0;
});

describe("document scope by link kind", () => {
  it.each([
    [
      "a share-following link shows every current share",
      token("DIRECT_SHARE", ["doc-will"], true),
      SHARED_NOW,
      1,
    ],
    [
      "a fixed DIRECT_SHARE link never gains a share",
      token("DIRECT_SHARE", ["doc-will", "doc-gone"]),
      ["doc-will"],
      1,
    ],
    ["a fixed DIRECT_SHARE link with no documents stays empty", token("DIRECT_SHARE", []), [], 0],
    [
      "a DMS release keeps what was released",
      token("DMS_RELEASE", ["doc-released"]),
      ["doc-released"],
      0,
    ],
    [
      "an emergency grant keeps what was released",
      token("EMERGENCY_ACCESS", ["doc-released"]),
      ["doc-released"],
      0,
    ],
  ])("%s", async (_, row, expected, reads) => {
    vi.mocked(createServiceClient).mockReturnValue(fakeDb(row) as never);

    const grant = await requireGrant("t1");

    expect(grant.scope.documents).toEqual(expected);
    expect(assignmentReads).toBe(reads);
  });
});

describe("system links work only while their grant stands", () => {
  it("refuses a release link whose contact never confirmed a code", async () => {
    vi.mocked(createServiceClient).mockReturnValue(
      fakeDb({ ...token("DMS_RELEASE", ["doc-released"]), verified_at: null }) as never,
    );
    await expect(requireGrant("t1")).rejects.toMatchObject({ status: 401 });
  });

  it.each(["ACTIVE", "PAUSED", "INACTIVE", "ESCALATING"])(
    "refuses a release link once the switch is %s again",
    async (switchStatus) => {
      vi.mocked(createServiceClient).mockReturnValue(
        fakeDb(token("DMS_RELEASE", ["doc-released"]), { switchStatus }) as never,
      );
      await expect(requireGrant("t1")).rejects.toMatchObject({ status: 401 });
    },
  );

  it.each(["REVOKED", "EXPIRED", "DENIED"])(
    "refuses an emergency link once the request is %s",
    async (requestStatus) => {
      vi.mocked(createServiceClient).mockReturnValue(
        fakeDb(token("EMERGENCY_ACCESS", ["doc-released"]), { requestStatus }) as never,
      );
      await expect(requireGrant("t1")).rejects.toMatchObject({ status: 401 });
    },
  );
});
