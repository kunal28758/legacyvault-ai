// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { setAIProviderForTesting } from "@/lib/ai";
import type { AIProvider } from "@/lib/ai/provider";
import { ApiError } from "@/lib/api/errors";
import type { AppUser } from "@/lib/auth/ensure-app-user";
import { RATE_LIMIT_POLICIES, setRateLimitStore } from "@/lib/security/rate-limit";

import { POST } from "@/app/api/v1/ai/assistant/message/route";

/**
 * The assistant route's guards, run through the real `withApi()` pipeline:
 * authentication, the same-origin check, the `ai` rate limit and validation
 * all refuse a request before any model is asked. Only the Clerk session
 * lookup, the audit sink and the limiter's store are replaced.
 */
const session = vi.hoisted(() => ({ user: null as AppUser | null }));
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
vi.mock("@/lib/audit/audit.service", () => ({
  audit: { log: async () => undefined, diff: () => ({}), redact: (value: unknown) => value },
  recordAudit: async () => undefined,
}));

const asked: string[] = [];
const provider: AIProvider = {
  name: "gemini",
  model: "scripted",
  capabilities: { imageTypes: [], maxImages: 0, maxInlineBytes: 0, pdf: false, structured: false },
  generateText: async () => {
    throw new Error("not used");
  },
  generateStructured: async () => {
    throw new Error("not used");
  },
  stream: async () => {
    asked.push("stream");
    throw new Error("the guards should have refused this request");
  },
  ping: async () => undefined,
};

const counts = new Map<string, number>();
const USER: AppUser = {
  id: "11111111-1111-4111-8111-111111111111",
  clerkUserId: "user_guard",
  email: "guard@example.com",
  emailVerified: true,
  name: "Guard",
  mfaEnabled: false,
  role: "USER",
  onboardingCompletedAt: new Date().toISOString(),
  deletionRequestedAt: null,
};

beforeEach(() => {
  asked.length = 0;
  counts.clear();
  session.user = USER;
  setAIProviderForTesting(provider);
  setRateLimitStore({
    async hit(key, _windowStart, limit) {
      const count = (counts.get(key) ?? 0) + 1;
      counts.set(key, count);
      return { allowed: count <= limit, count };
    },
  });
});

afterEach(() => {
  setAIProviderForTesting(null);
});

function post(
  body: unknown,
  headers: Record<string, string> = { "sec-fetch-site": "same-origin" },
) {
  return POST(
    new Request("http://localhost:3000/api/v1/ai/assistant/message", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body: JSON.stringify(body),
    }),
  );
}

async function errorOf(response: Response) {
  return ((await response.json()) as { error: { code: string } }).error.code;
}

describe("assistant route guards", () => {
  it("refuses a request without a session", async () => {
    session.user = null;
    const response = await post({ message: "hello" });
    expect(response.status).toBe(401);
    expect(await errorOf(response)).toBe("UNAUTHENTICATED");
    expect(asked).toEqual([]);
  });

  it("refuses a cross-site request", async () => {
    const response = await post({ message: "hello" }, { "sec-fetch-site": "cross-site" });
    expect(response.status).toBe(403);
    expect(asked).toEqual([]);
  });

  it("refuses a forged attachment reference before anything is read", async () => {
    const response = await post({ message: "hello", attachmentIds: ["../other-user/will.pdf"] });
    // The API contract answers invalid input with 422 VALIDATION_ERROR.
    expect(response.status).toBe(422);
    expect(await errorOf(response)).toBe("VALIDATION_ERROR");
    expect(asked).toEqual([]);
  });

  it("stops at the ai rate limit with Retry-After, without asking a model", async () => {
    counts.set(`ai:${USER.id}`, RATE_LIMIT_POLICIES.ai.limit);
    const response = await post({ message: "hello" });
    expect(response.status).toBe(429);
    expect(Number(response.headers.get("Retry-After"))).toBeGreaterThan(0);
    expect(asked).toEqual([]);
  });

  it("charges every extra attachment to the same ai budget", async () => {
    counts.set(`ai:${USER.id}`, RATE_LIMIT_POLICIES.ai.limit - 2);
    const response = await post({
      message: "Compare these",
      attachmentIds: [
        "00000000-0000-4000-8000-000000000001",
        "00000000-0000-4000-8000-000000000002",
        "00000000-0000-4000-8000-000000000003",
      ],
    });
    // One hit for the request, then two more for the extra files: over budget.
    expect(response.status).toBe(429);
    expect(asked).toEqual([]);
  });
});
