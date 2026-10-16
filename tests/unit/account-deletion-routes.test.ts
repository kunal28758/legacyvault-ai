// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "@/lib/api/errors";
import type { AppUser } from "@/lib/auth/ensure-app-user";
import { setRateLimitStore } from "@/lib/security/rate-limit";

import { POST as deleteNow } from "@/app/api/v1/users/me/delete-now/route";
import { DELETE as scheduleDeletion } from "@/app/api/v1/users/me/route";

/**
 * Both deletion routes through the real `withApi()` pipeline. Only the session
 * lookup, Clerk's step-up check, the audit sink, the limiter's store and the
 * service (to record what reached it) are replaced. Asserted: neither route
 * runs without a session, a same-origin request, a fresh re-verification and
 * the exact confirmation; the account is always the session's own; and the
 * immediate route asks for Clerk's MFA-aware level while the scheduled one
 * keeps `strict`.
 */
const session = vi.hoisted(() => ({
  user: null as AppUser | null,
  fresh: new Set<string>(),
  asked: [] as string[],
}));
const calls = vi.hoisted(() => ({ now: [] as string[], scheduled: [] as string[] }));

vi.mock("@/lib/auth/require-user", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth/require-user")>();
  return {
    ...actual,
    requireUser: async () => {
      if (!session.user) throw ApiError.unauthenticated();
      return session.user;
    },
  };
});
vi.mock("@clerk/nextjs/server", () => ({
  auth: async () => ({
    has: ({ reverification }: { reverification: string }) => {
      session.asked.push(reverification);
      return session.fresh.has(reverification);
    },
  }),
}));
vi.mock("@/lib/audit/audit.service", () => ({
  audit: { log: async () => undefined, diff: () => ({}), redact: (value: unknown) => value },
  recordAudit: async () => undefined,
}));
vi.mock("@/lib/services/account.service", () => ({
  deleteAccountNow: async (user: AppUser) => {
    calls.now.push(user.id);
    return { status: "DELETED" };
  },
  requestDeletion: async (user: AppUser) => {
    calls.scheduled.push(user.id);
    return {
      deletionRequestedAt: "2026-10-14T00:00:00.000Z",
      deletesAt: "2026-11-13T00:00:00.000Z",
    };
  },
}));

const OWNER: AppUser = {
  id: "11111111-1111-4111-8111-111111111111",
  clerkUserId: "user_owner",
  email: "owner@example.com",
  emailVerified: true,
  name: "Owner",
  mfaEnabled: true,
  role: "USER",
  onboardingCompletedAt: new Date().toISOString(),
  deletionRequestedAt: null,
};
const OTHER_ID = "22222222-2222-4222-8222-222222222222";

beforeEach(() => {
  session.user = OWNER;
  session.fresh = new Set(["strict_mfa", "strict"]);
  session.asked.length = 0;
  calls.now.length = 0;
  calls.scheduled.length = 0;
  setRateLimitStore({ hit: async () => ({ allowed: true, count: 1 }) });
});

function request(method: string, body: unknown, site = "same-origin") {
  return new Request("http://localhost:3000/api/v1/users/me/delete-now", {
    method,
    headers: { "Content-Type": "application/json", "sec-fetch-site": site },
    body: JSON.stringify(body),
  });
}

async function codeOf(response: Response) {
  return ((await response.json()) as { error: { code: string } }).error.code;
}

describe("POST /users/me/delete-now", () => {
  const valid = { confirmation: "DELETE PERMANENTLY" };

  it("deletes the session's own account when every check passes", async () => {
    const response = await deleteNow(request("POST", valid));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ success: true, data: { status: "DELETED" } });
    expect(calls.now).toEqual([OWNER.id]);
    expect(session.asked).toEqual(["strict_mfa"]);
  });

  it("refuses a request without a session", async () => {
    session.user = null;
    const response = await deleteNow(request("POST", valid));
    expect(response.status).toBe(401);
    expect(calls.now).toEqual([]);
  });

  it("refuses a cross-site request", async () => {
    const response = await deleteNow(request("POST", valid, "cross-site"));
    expect(response.status).toBe(403);
    expect(calls.now).toEqual([]);
  });

  it("asks for a fresh multi-factor re-verification", async () => {
    session.fresh = new Set(["strict"]);
    const response = await deleteNow(request("POST", valid));
    expect(response.status).toBe(403);
    const body = (await response.json()) as {
      error: { code: string; details?: { level?: string } };
    };
    expect(body.error.code).toBe("REVERIFICATION_REQUIRED");
    expect(JSON.stringify(body)).toContain("multi_factor");
    expect(calls.now).toEqual([]);
  });

  it.each([
    [{}],
    [{ confirmation: "delete permanently" }],
    [{ confirmation: "DELETE" }],
    [{ confirmed: true }],
  ])("refuses a missing or wrong confirmation: %j", async (body) => {
    const response = await deleteNow(request("POST", body));
    expect(response.status).toBe(422);
    expect(await codeOf(response)).toBe("VALIDATION_ERROR");
    expect(calls.now).toEqual([]);
  });

  it("refuses a body that names an account, so no other account can be targeted", async () => {
    for (const forged of [{ userId: OTHER_ID }, { mfaVerified: true }, { confirmed: true }]) {
      const response = await deleteNow(request("POST", { ...valid, ...forged }));
      expect(response.status).toBe(422);
    }
    expect(calls.now).toEqual([]);
  });

  it("applies the sensitive rate limit: a sixth attempt in 15 minutes is refused", async () => {
    const counts = new Map<string, number>();
    setRateLimitStore({
      async hit(key, _windowStart, limit) {
        const count = (counts.get(key) ?? 0) + 1;
        counts.set(key, count);
        return { allowed: count <= limit, count };
      },
    });
    const statuses: number[] = [];
    for (let attempt = 0; attempt < 6; attempt += 1) {
      statuses.push((await deleteNow(request("POST", valid))).status);
    }
    expect(statuses).toEqual([200, 200, 200, 200, 200, 429]);
    expect(calls.now).toHaveLength(5);
  });

  it("is not reachable through the scheduled route's method", async () => {
    // The scheduled route takes `confirmed: true`; the phrase alone never schedules.
    const response = await scheduleDeletion(request("DELETE", valid));
    expect(response.status).toBe(422);
    expect(calls.scheduled).toEqual([]);
    expect(calls.now).toEqual([]);
  });
});

describe("DELETE /users/me (scheduled)", () => {
  it("schedules for the session's own account and never deletes now", async () => {
    const response = await scheduleDeletion(
      request("DELETE", { confirmed: true, userId: OTHER_ID }),
    );
    expect(response.status).toBe(200);
    expect(calls.scheduled).toEqual([OWNER.id]);
    expect(calls.now).toEqual([]);
    expect(session.asked).toEqual(["strict"]);
  });

  it("requires a fresh re-verification", async () => {
    session.fresh = new Set();
    const response = await scheduleDeletion(request("DELETE", { confirmed: true }));
    expect(response.status).toBe(403);
    expect(await codeOf(response)).toBe("REVERIFICATION_REQUIRED");
    expect(calls.scheduled).toEqual([]);
  });
});
