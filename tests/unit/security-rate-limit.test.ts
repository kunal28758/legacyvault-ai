import { afterEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "@/lib/api/errors";
import {
  RATE_LIMIT_POLICIES,
  checkRateLimit,
  clientIpFrom,
  enforceRateLimit,
  setRateLimitStore,
  type RateLimitStore,
} from "@/lib/security/rate-limit";

/**
 * Rate limiting (task T025, ADR-007, FR-Q008).
 *
 * The PostgreSQL store itself is exercised by the integration suite; here the
 * store is replaced so the policy arithmetic, the window boundary and the
 * fail-open behaviour can be asserted deterministically.
 */
function countingStore(
  counts = new Map<string, number>(),
): RateLimitStore & { counts: typeof counts } {
  return {
    counts,
    async hit(key, windowStart, limit) {
      const bucket = `${key}@${windowStart.toISOString()}`;
      const count = (counts.get(bucket) ?? 0) + 1;
      counts.set(bucket, count);
      return { allowed: count <= limit, count };
    },
  };
}

afterEach(() => {
  // Restore the real store so no test leaks its double.
  vi.restoreAllMocks();
});

describe("rate limit policies", () => {
  it("matches the limits published in the API contract", () => {
    expect(RATE_LIMIT_POLICIES.default).toEqual({ limit: 100, windowSeconds: 900 });
    expect(RATE_LIMIT_POLICIES.sensitive).toEqual({ limit: 5, windowSeconds: 900 });
    expect(RATE_LIMIT_POLICIES.ai).toEqual({ limit: 20, windowSeconds: 3600 });
    expect(RATE_LIMIT_POLICIES.publicEmergency).toEqual({ limit: 5, windowSeconds: 3600 });
    expect(RATE_LIMIT_POLICIES.accessExchange).toEqual({ limit: 10, windowSeconds: 900 });
    expect(RATE_LIMIT_POLICIES.tokenAccess).toEqual({ limit: 60, windowSeconds: 900 });
  });

  it("allows up to the limit then refuses with a Retry-After hint", async () => {
    setRateLimitStore(countingStore());
    const now = new Date("2026-09-23T10:00:00.000Z");

    for (let i = 0; i < 5; i += 1) {
      const result = await checkRateLimit({ policy: "sensitive", subject: "user-1", now });
      expect(result.allowed).toBe(true);
    }

    const blocked = await checkRateLimit({ policy: "sensitive", subject: "user-1", now });
    expect(blocked.allowed).toBe(false);
    expect(blocked.remaining).toBe(0);
    expect(blocked.retryAfterSeconds).toBeGreaterThan(0);

    await expect(
      enforceRateLimit({ policy: "sensitive", subject: "user-1", now }),
    ).rejects.toBeInstanceOf(ApiError);
  });

  it("keeps subjects in separate buckets", async () => {
    setRateLimitStore(countingStore());
    const now = new Date("2026-09-23T10:00:00.000Z");
    for (let i = 0; i < 5; i += 1)
      await checkRateLimit({ policy: "sensitive", subject: "user-1", now });

    const other = await checkRateLimit({ policy: "sensitive", subject: "user-2", now });
    expect(other.allowed).toBe(true);
  });

  it("starts a fresh window once the period rolls over", async () => {
    setRateLimitStore(countingStore());
    const first = new Date("2026-09-23T10:00:00.000Z");
    for (let i = 0; i < 6; i += 1)
      await checkRateLimit({ policy: "sensitive", subject: "user-1", now: first });

    const nextWindow = new Date("2026-09-23T10:16:00.000Z");
    const result = await checkRateLimit({
      policy: "sensitive",
      subject: "user-1",
      now: nextWindow,
    });
    expect(result.allowed).toBe(true);
  });

  it("fails open when the store is unavailable, so an outage is not a lockout", async () => {
    setRateLimitStore({
      async hit() {
        throw new Error("store offline");
      },
    });
    const result = await checkRateLimit({ policy: "default", subject: "user-1" });
    expect(result.allowed).toBe(true);
  });
});

describe("client IP resolution", () => {
  it("uses the first entry of the platform-provided header", () => {
    const headers = new Headers({ "x-forwarded-for": "203.0.113.5, 70.41.3.18" });
    expect(clientIpFrom(headers)).toBe("203.0.113.5");
  });

  it("falls back predictably when no header is present", () => {
    expect(clientIpFrom(new Headers())).toBe("unknown");
  });
});
