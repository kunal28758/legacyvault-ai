// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "@/lib/api/errors";
import type { AppUser } from "@/lib/auth/ensure-app-user";
import { setRateLimitStore } from "@/lib/security/rate-limit";

import { POST as createPlan } from "@/app/api/v1/legacy-plans/route";
import { POST as openCurrentDraft } from "@/app/api/v1/legacy-plans/current/route";
import { GET as getPlan } from "@/app/api/v1/legacy-plans/[id]/route";
import { POST as finalizePlan } from "@/app/api/v1/legacy-plans/[id]/finalize/route";
import { POST as reviewPlan } from "@/app/api/v1/legacy-plans/[id]/review/route";
import { POST as createNewDraft } from "@/app/api/v1/legacy-plans/[id]/new-draft/route";
import { GET as getVersion } from "@/app/api/v1/legacy-plans/[id]/versions/[versionId]/route";
import { PATCH as saveStep } from "@/app/api/v1/legacy-plans/[id]/steps/[step]/route";

const session = vi.hoisted(() => ({ user: null as AppUser | null }));
const calls = vi.hoisted(() => ({
  create: 0,
  current: 0,
  save: 0,
  newDraft: 0,
  finalize: 0,
  review: 0,
  get: 0,
  version: 0,
}));

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

vi.mock("@/lib/services/legacy-plan.service", () => ({
  createPlan: async () => {
    calls.create += 1;
    return {};
  },
  getOrCreateDraft: async () => {
    calls.current += 1;
    return {};
  },
  savePlanStep: async () => {
    calls.save += 1;
    return {};
  },
  createNewDraft: async () => {
    calls.newDraft += 1;
    return {};
  },
  finalizePlan: async () => {
    calls.finalize += 1;
    return {};
  },
  reviewPlan: async () => {
    calls.review += 1;
    return {};
  },
  getPlan: async () => {
    calls.get += 1;
    return {};
  },
  getVersion: async () => {
    calls.version += 1;
    return {};
  },
}));

const USER: AppUser = {
  id: "11111111-1111-4111-8111-111111111111",
  clerkUserId: "user_maintenance",
  email: "maintenance@example.com",
  emailVerified: true,
  name: "Maintenance",
  mfaEnabled: false,
  role: "USER",
  onboardingCompletedAt: new Date().toISOString(),
  deletionRequestedAt: null,
};

const PLAN_ID = "22222222-2222-4222-8222-222222222222";
const VERSION_ID = "33333333-3333-4333-8333-333333333333";

beforeEach(() => {
  process.env.LEGACY_PLAN_MAINTENANCE_MODE = "enabled";
  session.user = USER;
  for (const key of Object.keys(calls) as (keyof typeof calls)[]) calls[key] = 0;
  setRateLimitStore({ hit: async () => ({ allowed: true, count: 1 }) });
});

afterEach(() => {
  delete process.env.LEGACY_PLAN_MAINTENANCE_MODE;
});

function request(method: string, url: string, body?: unknown) {
  return new Request(`http://localhost:3000${url}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      "sec-fetch-site": "same-origin",
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

function params(values: Record<string, string>) {
  return { params: Promise.resolve(values) };
}

async function errorCode(response: Response) {
  return ((await response.json()) as { error: { code: string } }).error.code;
}

describe("legacy-plan maintenance gate", () => {
  it("blocks every Will mutation while enabled", async () => {
    const responses = await Promise.all([
      createPlan(request("POST", "/api/v1/legacy-plans")),
      openCurrentDraft(request("POST", "/api/v1/legacy-plans/current")),
      saveStep(
        request("PATCH", `/api/v1/legacy-plans/${PLAN_ID}/steps/personal-details`, {
          data: {},
          lockVersion: 0,
        }),
        params({ id: PLAN_ID, step: "personal-details" }),
      ),
      createNewDraft(
        request("POST", `/api/v1/legacy-plans/${PLAN_ID}/new-draft`, {
          confirmed: true,
        }),
        params({ id: PLAN_ID }),
      ),
      finalizePlan(
        request("POST", `/api/v1/legacy-plans/${PLAN_ID}/finalize`, {
          confirmed: true,
          lockVersion: 0,
        }),
        params({ id: PLAN_ID }),
      ),
    ]);

    expect(await Promise.all(responses.map((response) => errorCode(response)))).toEqual([
      "MAINTENANCE",
      "MAINTENANCE",
      "MAINTENANCE",
      "MAINTENANCE",
      "MAINTENANCE",
    ]);
    expect(responses.every((response) => response.status === 503)).toBe(true);
    expect(Object.values(calls).slice(0, 5)).toEqual([0, 0, 0, 0, 0]);
  });

  it("keeps authentication ahead of the maintenance response", async () => {
    session.user = null;
    const response = await createPlan(request("POST", "/api/v1/legacy-plans"));

    expect(response.status).toBe(401);
    expect(await errorCode(response)).toBe("UNAUTHENTICATED");
  });

  it("keeps read-only plan, Snapshot, and review requests available", async () => {
    const plan = await getPlan(
      request("GET", `/api/v1/legacy-plans/${PLAN_ID}`),
      params({ id: PLAN_ID }),
    );
    const version = await getVersion(
      request("GET", `/api/v1/legacy-plans/${PLAN_ID}/versions/${VERSION_ID}`),
      params({ id: PLAN_ID, versionId: VERSION_ID }),
    );
    const review = await reviewPlan(
      request("POST", `/api/v1/legacy-plans/${PLAN_ID}/review`),
      params({ id: PLAN_ID }),
    );

    expect(plan.status).toBe(200);
    expect(version.status).toBe(200);
    expect(review.status).toBe(200);
    expect(calls.get).toBe(1);
    expect(calls.version).toBe(1);
    expect(calls.review).toBe(1);
  });

  it("allows all five mutations when explicitly disabled", async () => {
    process.env.LEGACY_PLAN_MAINTENANCE_MODE = "disabled";

    const responses = await Promise.all([
      createPlan(request("POST", "/api/v1/legacy-plans")),
      openCurrentDraft(request("POST", "/api/v1/legacy-plans/current")),
      saveStep(
        request("PATCH", `/api/v1/legacy-plans/${PLAN_ID}/steps/personal-details`, {
          data: {},
          lockVersion: 0,
        }),
        params({ id: PLAN_ID, step: "personal-details" }),
      ),
      createNewDraft(
        request("POST", `/api/v1/legacy-plans/${PLAN_ID}/new-draft`, {
          confirmed: true,
        }),
        params({ id: PLAN_ID }),
      ),
      finalizePlan(
        request("POST", `/api/v1/legacy-plans/${PLAN_ID}/finalize`, {
          confirmed: true,
          lockVersion: 0,
        }),
        params({ id: PLAN_ID }),
      ),
    ]);

    expect(responses.every((response) => response.status === 200)).toBe(true);
    expect(Object.values(calls).slice(0, 5)).toEqual([1, 1, 1, 1, 1]);
  });

  it("fails closed for invalid configuration without exposing it", async () => {
    process.env.LEGACY_PLAN_MAINTENANCE_MODE = "unexpected-secret-value";
    const response = await createPlan(request("POST", "/api/v1/legacy-plans"));
    const body = await response.text();

    expect(response.status).toBe(503);
    expect(body).toContain("MAINTENANCE");
    expect(body).not.toContain("unexpected-secret-value");
  });
});
