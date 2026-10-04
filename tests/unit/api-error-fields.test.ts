// @vitest-environment node
import { createHash } from "node:crypto";

import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "@/lib/api/errors";
import type { AppUser } from "@/lib/auth/ensure-app-user";
import { errorFields, supabaseClientFields } from "@/lib/observability/error-fields";

import { GET } from "@/app/api/v1/users/me/route";

/**
 * The 5xx log line must say what failed even where a log viewer collapses the
 * nested `err` object — and which Supabase project and publishable key the
 * build was compiled with — without ever logging the key, a token or row data.
 */
const KEY = "sb_publishable_abcdefghijklmnopqrstuvwxyz0123";
const state = vi.hoisted(() => ({
  publicEnv: null as null | Record<string, string>,
  logged: [] as Record<string, unknown>[],
  failure: null as unknown,
}));

vi.mock("@/lib/config/public-env", () => ({
  getPublicEnv: () => {
    if (!state.publicEnv) throw new Error("Invalid public environment configuration");
    return state.publicEnv;
  },
  isClerkConfigured: () => true,
}));
vi.mock("@/lib/observability/logger", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/observability/logger")>();
  const sink = {
    error: (fields: Record<string, unknown>) => state.logged.push(fields),
    warn: () => undefined,
    info: () => undefined,
  };
  return { ...actual, requestLogger: () => sink };
});
vi.mock("@/lib/auth/require-user", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth/require-user")>();
  return { ...actual, requireUser: async () => USER };
});
vi.mock("@/lib/audit/audit.service", () => ({
  audit: { log: async () => undefined, diff: () => ({}), redact: (value: unknown) => value },
  recordAudit: async () => undefined,
}));
vi.mock("@/lib/services/user.service", () => ({
  getMe: async () => {
    throw state.failure;
  },
}));

const USER: AppUser = {
  id: "11111111-1111-4111-8111-111111111111",
  clerkUserId: "user_fields",
  email: "fields@example.com",
  emailVerified: true,
  name: "Fields",
  mfaEnabled: false,
  role: "USER",
  onboardingCompletedAt: null,
  deletionRequestedAt: null,
};

beforeEach(() => {
  state.logged.length = 0;
  state.publicEnv = {
    NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: "pk_test_x",
    NEXT_PUBLIC_SUPABASE_URL: "https://example-ref.supabase.co",
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: KEY,
  };
});

describe("5xx log fields", () => {
  it("logs a Supabase gateway refusal as flat fields, with the build's client identity", async () => {
    // The exact shape supabase-js returns when the gateway rejects the key.
    state.failure = {
      message: "Invalid API key",
      hint: "Double check the provided API key for typos. This API key might also be owned by another Supabase project.",
    };

    const response = await GET(new Request("https://app.example/api/v1/users/me"));

    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body.error.code).toBe("INTERNAL_ERROR");
    expect(JSON.stringify(body)).not.toContain("Invalid API key");

    expect(state.logged).toHaveLength(1);
    expect(state.logged[0]).toMatchObject({
      code: "INTERNAL_ERROR",
      errorName: "Object",
      errorMessage: "Invalid API key",
      errorHint: expect.stringContaining("another Supabase project"),
      supabaseHost: "example-ref.supabase.co",
      supabaseKeyKind: "publishable",
      supabaseKeyFingerprint: createHash("sha256").update(KEY).digest("hex").slice(0, 12),
      supabaseKeyClean: "yes",
    });
    expect(JSON.stringify(state.logged[0])).not.toContain(KEY);
  });

  it("does not log a 4xx as a failure", async () => {
    state.failure = ApiError.notFound();
    const response = await GET(new Request("https://app.example/api/v1/users/me"));
    expect(response.status).toBe(404);
    expect(state.logged).toHaveLength(0);
  });
});

describe("errorFields", () => {
  it("copies code, message and hint but never details", () => {
    const fields = errorFields({
      code: "23502",
      message: 'null value in column "phone" violates not-null constraint',
      details: "Failing row contains (fields@example.com, ...)",
      hint: null,
    });
    expect(fields).toEqual({
      errorName: "Object",
      errorCode: "23502",
      errorMessage: 'null value in column "phone" violates not-null constraint',
    });
    expect(JSON.stringify(fields)).not.toContain("@example.com");
  });

  it("names Error subclasses and handles non-objects", () => {
    expect(errorFields(new TypeError("fetch failed"))).toEqual({
      errorName: "TypeError",
      errorMessage: "fetch failed",
    });
    expect(errorFields("boom")).toEqual({ errorMessage: "boom" });
  });
});

describe("supabaseClientFields", () => {
  it("flags a key pasted with quotes or whitespace without revealing it", () => {
    state.publicEnv!.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = `"${KEY}" `;
    const fields = supabaseClientFields();
    expect(fields).toMatchObject({ supabaseKeyKind: "unrecognised", supabaseKeyClean: "no" });
    expect(JSON.stringify(fields)).not.toContain(KEY);
  });

  it("recognises a legacy JWT key", () => {
    state.publicEnv!.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = "aaa.bbb.ccc";
    expect(supabaseClientFields().supabaseKeyKind).toBe("legacy-jwt");
  });

  it("reports an invalid public environment instead of throwing", () => {
    state.publicEnv = null;
    expect(supabaseClientFields()).toEqual({ supabaseHost: "public-env-invalid" });
  });
});
