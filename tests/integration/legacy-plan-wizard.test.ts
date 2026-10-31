import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { mapDatabaseError } from "@/lib/api/errors";
import type { AppUser } from "@/lib/auth/ensure-app-user";
import * as planService from "@/lib/services/legacy-plan.service";

import {
  createServiceScopedClient,
  createUserScopedClient,
  ensureTestUser,
  isLocalStackAvailable,
} from "../helpers/db";

/**
 * The Create Will wizard's persistence, through the real service and the real
 * guarded functions: auto-save with server-side shape validation, "Skip for
 * now" recorded on the section, resume from a fresh session, finalization with
 * acknowledgement, and isolation between owners.
 */
const ALICE = "user_wizard_alice";
const BOB = "user_wizard_bob";

const clients = vi.hoisted(() => ({ current: null as unknown }));
vi.mock("@/lib/db/server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/db/server")>();
  return { ...actual, createUserClient: async () => clients.current };
});

const available = await isLocalStackAvailable();
if (!available) {
  console.warn(
    "[legacy-plan-wizard] local Supabase stack unreachable — assertions are SKIPPED, not passed.",
  );
}

let alice: AppUser;
let bob: AppUser;

function appUser(id: string, clerkUserId: string): AppUser {
  return {
    id,
    clerkUserId,
    email: `${clerkUserId}@example.com`,
    emailVerified: true,
    name: clerkUserId,
    mfaEnabled: false,
    role: "USER",
    onboardingCompletedAt: new Date().toISOString(),
    deletionRequestedAt: null,
  };
}

/** What the route would answer: the same mapping `withApi()` applies. */
function viaApi<T>(promise: Promise<T>): Promise<T> {
  return promise.catch((error: unknown) => {
    throw mapDatabaseError(error);
  });
}

async function as(user: AppUser) {
  clients.current = await createUserScopedClient(user.clerkUserId);
}

beforeAll(async () => {
  if (!available) return;
  const service = createServiceScopedClient();
  alice = appUser(await ensureTestUser(service, ALICE), ALICE);
  bob = appUser(await ensureTestUser(service, BOB), BOB);
}, 60_000);

beforeEach(async () => {
  if (!available) return;
  const service = createServiceScopedClient();
  await service.from("legacy_plans").delete().in("user_id", [alice.id, bob.id]);
});

describe.skipIf(!available)("create will — persistence", () => {
  it("auto-saves partial steps, records skips and resumes from a new session", async () => {
    await as(alice);
    const draft = await planService.getOrCreateDraft(alice, "test");
    expect(draft.status).toBe("DRAFT");

    // Step 1, half-typed: saves, but is not complete.
    const first = await planService.savePlanStep(
      alice,
      draft.id,
      "personal-details",
      { data: { legalName: "Priya Sharma", city: "Mumbai" }, lockVersion: draft.lockVersion },
      "test",
    );
    expect(first.complete).toBe(false);

    // A data section can be skipped while preserving the explicit draft marker.
    const skipped = await planService.savePlanStep(
      alice,
      draft.id,
      "family-information",
      { data: { skipped: true }, lockVersion: first.lockVersion },
      "test",
    );
    expect(skipped.complete).toBe(false);

    const second = await planService.savePlanStep(
      alice,
      draft.id,
      "special-wishes",
      { data: { skipped: true }, lockVersion: skipped.lockVersion },
      "test",
    );
    expect(second.complete).toBe(false);

    // "Log out and back in": a brand-new client for the same subject.
    await as(alice);
    const resumed = await planService.getOrCreateDraft(alice, "test");
    expect(resumed.id).toBe(draft.id);
    expect(resumed.stepsData["personal-details"]).toEqual({
      legalName: "Priya Sharma",
      city: "Mumbai",
    });
    expect(resumed.stepsData["family-information"]).toEqual({ skipped: true });
    expect(resumed.stepsData["special-wishes"]).toEqual({ skipped: true });
    // Resume lands on the furthest step reached.
    expect(resumed.currentStep).toBe(4);
    expect(resumed.lockVersion).toBe(second.lockVersion);

    const review = await planService.reviewPlan(alice, draft.id);
    expect(review.sections["special-wishes"]).toMatchObject({ complete: false, skipped: true });
    expect(review.canFinalize).toBe(false); // personal details still incomplete
  });

  it("validates the shape of an auto-save on the server", async () => {
    await as(alice);
    const draft = await planService.getOrCreateDraft(alice, "test");

    await expect(
      viaApi(
        planService.savePlanStep(
          alice,
          draft.id,
          "beneficiaries",
          { data: { beneficiaryIds: ["'; drop table users; --"] }, lockVersion: draft.lockVersion },
          "test",
        ),
      ),
    ).rejects.toMatchObject({ status: 422, code: "VALIDATION_ERROR" });

    await expect(
      viaApi(
        planService.savePlanStep(
          alice,
          draft.id,
          "special-wishes",
          { data: { instructions: "x".repeat(10_000) }, lockVersion: draft.lockVersion },
          "test",
        ),
      ),
    ).rejects.toMatchObject({ status: 422 });

    // Unknown keys are dropped, not stored.
    const saved = await planService.savePlanStep(
      alice,
      draft.id,
      "special-wishes",
      {
        data: { instructions: "Plant a tree", injected: { big: "payload" } },
        lockVersion: draft.lockVersion,
      },
      "test",
    );
    const plan = await planService.getPlan(alice, draft.id);
    expect(plan.stepsData["special-wishes"]).toEqual({ instructions: "Plant a tree" });
    expect(saved.complete).toBe(true);
  });

  it("refuses a stale lock version instead of overwriting", async () => {
    await as(alice);
    const draft = await planService.getOrCreateDraft(alice, "test");
    await planService.savePlanStep(
      alice,
      draft.id,
      "family-information",
      { data: { maritalStatus: "married" }, lockVersion: draft.lockVersion },
      "test",
    );
    await expect(
      viaApi(
        planService.savePlanStep(
          alice,
          draft.id,
          "family-information",
          { data: { maritalStatus: "single" }, lockVersion: draft.lockVersion },
          "test",
        ),
      ),
    ).rejects.toMatchObject({ status: 409, code: "LOCK_CONFLICT" });
  });

  it("finalizes with skipped sections acknowledged and keeps them in the snapshot", async () => {
    await as(alice);
    const draft = await planService.getOrCreateDraft(alice, "test");
    const personal = await planService.savePlanStep(
      alice,
      draft.id,
      "personal-details",
      {
        data: {
          legalName: "Priya Sharma",
          dateOfBirth: "1980-04-02",
          addressLine: "12 Marine Drive",
          city: "Mumbai",
          country: "India",
        },
        lockVersion: draft.lockVersion,
      },
      "test",
    );
    const skipped = await planService.savePlanStep(
      alice,
      draft.id,
      "family-information",
      { data: { skipped: true }, lockVersion: personal.lockVersion },
      "test",
    );

    await expect(
      viaApi(
        planService.finalizePlan(
          alice,
          draft.id,
          { confirmed: true, lockVersion: skipped.lockVersion },
          "test",
        ),
      ),
    ).rejects.toMatchObject({ status: 422, code: "PLAN_INCOMPLETE" });

    const result = await planService.finalizePlan(
      alice,
      draft.id,
      { confirmed: true, lockVersion: skipped.lockVersion, acknowledgeIncomplete: true },
      "test",
    );
    expect(result.plan.status).toBe("FINALIZED");
    const version = await planService.getVersion(alice, draft.id, result.versionId);
    expect(version.acknowledgedIncomplete).toBe(true);
    expect(version.incompleteSections).toContain("family-information");
    expect(
      (version.snapshotData.stepsData as Record<string, unknown>)["family-information"],
    ).toEqual({ skipped: true });
  });

  it("keeps one owner's draft out of another's reach", async () => {
    await as(alice);
    const draft = await planService.getOrCreateDraft(alice, "test");

    await as(bob);
    await expect(viaApi(planService.getPlan(bob, draft.id))).rejects.toMatchObject({ status: 404 });
    await expect(
      viaApi(
        planService.savePlanStep(
          bob,
          draft.id,
          "special-wishes",
          { data: { instructions: "Hijack" }, lockVersion: draft.lockVersion },
          "test",
        ),
      ),
    ).rejects.toMatchObject({ status: 404 });
  });
});
