import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db/server", () => ({
  createUserClient: vi.fn(),
  createServiceClient: vi.fn(),
}));
vi.mock("@/lib/auth/require-user", () => ({
  assertAccountActive: vi.fn(),
}));
vi.mock("@/lib/repositories/legacy-plan.repository", () => ({
  findById: vi.fn(),
  findDraft: vi.fn(),
  list: vi.fn(),
  listVersions: vi.fn(),
  findVersion: vi.fn(),
}));

import { createUserClient } from "@/lib/db/server";
import * as planRepository from "@/lib/repositories/legacy-plan.repository";
import { finalizePlan, savePlanStep } from "@/lib/services/legacy-plan.service";
import type { AppUser } from "@/lib/auth/ensure-app-user";
import type { LegacyPlan } from "@/lib/types/legacy-plan";

/**
 * Legacy-plan service guards (tasks T065/T069).
 *
 * Finalization writes a permanent snapshot, so the optimistic-concurrency check
 * has to happen in the service: the plan is re-read and its completeness
 * re-saved before `finalize_legacy_plan()` runs, which advances `lockVersion`
 * and would make the guarded function's own comparison always succeed. These
 * assert that a stale caller is refused *before* anything is written.
 */
const PLAN_ID = "11111111-1111-4111-8111-111111111111";

const user = {
  id: "22222222-2222-4222-8222-222222222222",
  role: "USER",
  deletionRequestedAt: null,
} as unknown as AppUser;

function plan(overrides: Partial<LegacyPlan> = {}): LegacyPlan {
  return {
    id: PLAN_ID,
    status: "DRAFT",
    version: 1,
    currentStep: 1,
    stepsData: {},
    completionStatus: {},
    lockVersion: 5,
    finalizedAt: null,
    createdAt: "2026-09-01T00:00:00.000Z",
    updatedAt: "2026-09-01T00:00:00.000Z",
    ...overrides,
  };
}

const rpc = vi.fn();

beforeEach(() => {
  rpc.mockReset();
  vi.mocked(createUserClient).mockResolvedValue({
    rpc,
    from: vi.fn(),
  } as never);
});

describe("finalizePlan", () => {
  it("refuses a stale lock version and writes nothing", async () => {
    vi.mocked(planRepository.findById).mockResolvedValue(plan({ lockVersion: 7 }));

    await expect(
      finalizePlan(user, PLAN_ID, { confirmed: true, lockVersion: 5 }, "corr"),
    ).rejects.toMatchObject({ status: 409, code: "LOCK_CONFLICT" });

    // Nothing was saved, nothing was finalized.
    expect(rpc).not.toHaveBeenCalled();
  });

  it("tells the caller the version it needs to catch up to", async () => {
    vi.mocked(planRepository.findById).mockResolvedValue(plan({ lockVersion: 9 }));

    await expect(
      finalizePlan(user, PLAN_ID, { confirmed: true, lockVersion: 2 }, "corr"),
    ).rejects.toMatchObject({ details: { lockVersion: 9 } });
  });

  it("refuses a plan that is not the caller's", async () => {
    vi.mocked(planRepository.findById).mockResolvedValue(null);

    await expect(
      finalizePlan(user, PLAN_ID, { confirmed: true, lockVersion: 0 }, "corr"),
    ).rejects.toMatchObject({ status: 404 });
    expect(rpc).not.toHaveBeenCalled();
  });
});

describe("savePlanStep", () => {
  it("refuses to edit a finalized plan before reaching the database", async () => {
    vi.mocked(planRepository.findById).mockResolvedValue(
      plan({ status: "FINALIZED", finalizedAt: "2026-09-02T00:00:00.000Z" }),
    );

    await expect(
      savePlanStep(
        user,
        PLAN_ID,
        "special-wishes",
        { data: { instructions: "late edit" }, lockVersion: 5 },
        "corr",
      ),
    ).rejects.toMatchObject({ status: 409 });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("refuses a plan the caller does not own", async () => {
    vi.mocked(planRepository.findById).mockResolvedValue(null);

    await expect(
      savePlanStep(user, PLAN_ID, "personal-details", { data: {}, lockVersion: 0 }, "corr"),
    ).rejects.toMatchObject({ status: 404 });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("reads no cross-entity records for a section that references none", async () => {
    vi.mocked(planRepository.findById).mockResolvedValue(plan());
    const from = vi.fn();
    vi.mocked(createUserClient).mockResolvedValue({ rpc, from } as never);
    rpc.mockResolvedValue({ data: { lockVersion: 6, complete: true }, error: null });

    const result = await savePlanStep(
      user,
      PLAN_ID,
      "personal-details",
      {
        data: {
          legalName: "Priya Sharma",
          dateOfBirth: "1980-04-02",
          addressLine: "12 Marine Drive",
          city: "Mumbai",
          country: "India",
        },
        lockVersion: 5,
      },
      "corr",
    );

    expect(result).toMatchObject({ lockVersion: 6, complete: true });
    // Auto-save is the hottest write path: personal details cannot depend on
    // beneficiaries, assets or documents, so none of them are queried.
    expect(from).not.toHaveBeenCalled();
    expect(rpc).toHaveBeenCalledWith(
      "save_plan_step",
      expect.objectContaining({ p_expected_lock_version: 5 }),
    );
  });
});
