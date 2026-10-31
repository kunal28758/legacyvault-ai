import { beforeAll, beforeEach, describe, expect, it } from "vitest";

import type { TypedSupabaseClient } from "@/lib/db/server";
import * as planRepository from "@/lib/repositories/legacy-plan.repository";

import {
  createServiceScopedClient,
  createUserScopedClient,
  isLocalStackAvailable,
} from "../helpers/db";

/**
 * Legacy-plan lifecycle against the real local PostgreSQL stack.
 *
 * The properties asserted here are the ones the UI is not allowed to be the
 * only guard for: a single draft per user, optimistic locking on auto-save, and
 * a finalized plan that cannot be modified by any statement an authenticated
 * caller can issue — `legacy_plans` has no UPDATE grant at all, so immutability
 * is a privilege fact rather than a disabled button.
 */
const SUBJECT_A = "user_plan_alice";
const SUBJECT_B = "user_plan_bob";

const available = await isLocalStackAvailable();
let aliceId: string;
let bobId: string;
let alice: TypedSupabaseClient;
let bob: TypedSupabaseClient;

if (!available) {
  console.warn(
    "[legacy-plan] local Supabase stack unreachable — start it with `pnpm db:start`. Database assertions are SKIPPED, not passed.",
  );
}

const COMPLETE_PERSONAL = {
  legalName: "Priya Sharma",
  dateOfBirth: "1980-04-02",
  addressLine: "12 Marine Drive",
  city: "Mumbai",
  country: "India",
  isComplete: true,
};

beforeAll(async () => {
  if (!available) return;

  const service = createServiceScopedClient();
  await service.from("users").delete().in("clerk_user_id", [SUBJECT_A, SUBJECT_B]);
  const { data, error } = await service
    .from("users")
    .insert([
      { clerk_user_id: SUBJECT_A, email: "alice.plan@example.com", name: "Alice" },
      { clerk_user_id: SUBJECT_B, email: "bob.plan@example.com", name: "Bob" },
    ])
    .select("id, clerk_user_id");
  if (error) throw error;

  aliceId = data.find((row) => row.clerk_user_id === SUBJECT_A)!.id;
  bobId = data.find((row) => row.clerk_user_id === SUBJECT_B)!.id;
  alice = (await createUserScopedClient(SUBJECT_A)) as unknown as TypedSupabaseClient;
  bob = (await createUserScopedClient(SUBJECT_B)) as unknown as TypedSupabaseClient;
}, 60_000);

beforeEach(async () => {
  if (!available) return;
  const service = createServiceScopedClient();
  await service.from("legacy_plans").delete().in("user_id", [aliceId, bobId]);
  await service.from("beneficiaries").delete().in("user_id", [aliceId, bobId]);
  await service.from("financial_assets").delete().in("user_id", [aliceId, bobId]);
});

async function createDraft(client: TypedSupabaseClient): Promise<string> {
  const { data, error } = await client.rpc("create_legacy_plan", {});
  if (error) throw error;
  return data as string;
}

describe.skipIf(!available)("legacy plan — draft lifecycle", () => {
  it("creates a draft and refuses a second one", async () => {
    const planId = await createDraft(alice);
    const plan = await planRepository.findById(alice, aliceId, planId);
    expect(plan?.status).toBe("DRAFT");
    expect(plan?.version).toBe(1);
    expect(plan?.lockVersion).toBe(0);

    const { error } = await alice.rpc("create_legacy_plan", {});
    expect(error?.code).toBe("LV409");
    expect(error?.message).toContain("DRAFT_EXISTS");
  });

  it("refuses every direct write to legacy_plans", async () => {
    const planId = await createDraft(alice);

    const { error: updateError } = await alice
      .from("legacy_plans")
      .update({ status: "FINALIZED" })
      .eq("id", planId);
    expect(updateError).not.toBeNull();

    const { error: insertError } = await alice
      .from("legacy_plans")
      .insert({ user_id: aliceId, status: "DRAFT" });
    expect(insertError).not.toBeNull();

    const { error: deleteError } = await alice.from("legacy_plans").delete().eq("id", planId);
    expect(deleteError).not.toBeNull();
  });

  it("saves a section, advances the lock version and records completeness", async () => {
    const planId = await createDraft(alice);

    const { data, error } = await alice.rpc("save_plan_step", {
      p_plan_id: planId,
      p_step: "personal-details",
      p_data: COMPLETE_PERSONAL,
      p_expected_lock_version: 0,
    });
    expect(error).toBeNull();
    expect(data).toMatchObject({ lockVersion: 1, step: "personal-details", complete: true });

    const plan = await planRepository.findById(alice, aliceId, planId);
    expect(plan?.lockVersion).toBe(1);
    expect(plan?.completionStatus["personal-details"]).toBe(true);
    // `isComplete` is a control flag, not stored data.
    expect(plan?.stepsData["personal-details"]).not.toHaveProperty("isComplete");
    expect(plan?.stepsData["personal-details"]).toMatchObject({ legalName: "Priya Sharma" });
  });

  it("refuses a stale lock version instead of overwriting", async () => {
    const planId = await createDraft(alice);
    await alice.rpc("save_plan_step", {
      p_plan_id: planId,
      p_step: "personal-details",
      p_data: COMPLETE_PERSONAL,
      p_expected_lock_version: 0,
    });

    const { error } = await alice.rpc("save_plan_step", {
      p_plan_id: planId,
      p_step: "special-wishes",
      p_data: { instructions: "Second tab", isComplete: true },
      p_expected_lock_version: 0,
    });
    expect(error?.code).toBe("LV409");
    expect(error?.message).toContain("LOCK_CONFLICT");
  });

  it("rejects an unknown section key", async () => {
    const planId = await createDraft(alice);
    const { error } = await alice.rpc("save_plan_step", {
      p_plan_id: planId,
      p_step: "executor-details",
      p_data: { any: "thing" },
      p_expected_lock_version: 0,
    });
    expect(error?.code).toBe("LV422");
    expect(error?.message).toContain("INVALID_STEP");
  });

  it("never lets one owner touch another owner's plan", async () => {
    const planId = await createDraft(bob);

    expect(await planRepository.findById(alice, aliceId, planId)).toBeNull();
    expect(await planRepository.list(alice, aliceId)).toHaveLength(0);

    const { error } = await alice.rpc("save_plan_step", {
      p_plan_id: planId,
      p_step: "personal-details",
      p_data: COMPLETE_PERSONAL,
      p_expected_lock_version: 0,
    });
    expect(error?.code).toBe("42501");
  });
});

describe.skipIf(!available)("legacy plan — finalization", () => {
  it("refuses to finalize without personal details", async () => {
    const planId = await createDraft(alice);
    const { error } = await alice.rpc("finalize_legacy_plan", {
      p_plan_id: planId,
      p_expected_lock_version: 0,
      p_acknowledge_incomplete: true,
    });
    expect(error?.code).toBe("LV422");
    expect(error?.message).toContain("PERSONAL_DETAILS_REQUIRED");
  });

  it("refuses incomplete sections unless they are acknowledged", async () => {
    const planId = await createDraft(alice);
    await alice.rpc("save_plan_step", {
      p_plan_id: planId,
      p_step: "personal-details",
      p_data: COMPLETE_PERSONAL,
      p_expected_lock_version: 0,
    });

    const { error } = await alice.rpc("finalize_legacy_plan", {
      p_plan_id: planId,
      p_expected_lock_version: 1,
      p_acknowledge_incomplete: false,
    });
    expect(error?.code).toBe("LV422");
    expect(error?.message).toContain("PLAN_INCOMPLETE");
    expect(error?.details).toContain("incompleteSections");
  });

  it("finalizes with an acknowledgement, snapshots, and locks the plan", async () => {
    const planId = await createDraft(alice);
    const { data: beneficiary } = await alice
      .from("beneficiaries")
      .insert({
        user_id: aliceId,
        name: "Rohan Mehta",
        relationship: "Son",
        email: "rohan.plan@example.com",
      })
      .select("id")
      .single();
    if (!beneficiary?.id) throw new Error("beneficiary was not created");
    await alice.rpc("save_plan_step", {
      p_plan_id: planId,
      p_step: "personal-details",
      p_data: COMPLETE_PERSONAL,
      p_expected_lock_version: 0,
    });
    await alice.rpc("save_plan_step", {
      p_plan_id: planId,
      p_step: "beneficiaries",
      p_data: { beneficiaryIds: [beneficiary.id] },
      p_expected_lock_version: 1,
    });

    const { data: versionId, error } = await alice.rpc("finalize_legacy_plan", {
      p_plan_id: planId,
      p_expected_lock_version: 2,
      p_acknowledge_incomplete: true,
      p_corr: "22222222-2222-4222-8222-222222222222",
    });
    expect(error).toBeNull();

    const plan = await planRepository.findById(alice, aliceId, planId);
    expect(plan?.status).toBe("FINALIZED");
    expect(plan?.finalizedAt).not.toBeNull();

    const version = await planRepository.findVersion(alice, aliceId, planId, versionId as string);
    expect(version?.versionNumber).toBe(1);
    expect(version?.acknowledgedIncomplete).toBe(true);
    expect(version?.incompleteSections).toContain("beneficiaries");
    // Resolved by value: the beneficiary is copied into the snapshot.
    expect(JSON.stringify(version?.snapshotData)).toContain("Rohan Mehta");

    const service = createServiceScopedClient();
    const { data: rows } = await service
      .from("audit_log")
      .select("action, correlation_id")
      .eq("resource_id", planId)
      .eq("action", "plan.finalized");
    expect(rows?.[0]?.correlation_id).toBe("22222222-2222-4222-8222-222222222222");
  });

  it("makes a finalized plan immutable in the database, not just in the UI", async () => {
    const planId = await createDraft(alice);
    await alice.rpc("save_plan_step", {
      p_plan_id: planId,
      p_step: "personal-details",
      p_data: COMPLETE_PERSONAL,
      p_expected_lock_version: 0,
    });
    await alice.rpc("finalize_legacy_plan", {
      p_plan_id: planId,
      p_expected_lock_version: 1,
      p_acknowledge_incomplete: true,
    });

    const { error: stepError } = await alice.rpc("save_plan_step", {
      p_plan_id: planId,
      p_step: "special-wishes",
      p_data: { instructions: "Sneaking a change in", isComplete: true },
      p_expected_lock_version: 2,
    });
    expect(stepError?.code).toBe("LV409");
    expect(stepError?.message).toContain("PLAN_NOT_DRAFT");

    const { error: directError } = await alice
      .from("legacy_plans")
      .update({ steps_data: { hacked: true } })
      .eq("id", planId);
    expect(directError).not.toBeNull();

    const { error: versionError } = await alice
      .from("legacy_plan_versions")
      .update({ snapshot_data: { hacked: true } })
      .eq("legacy_plan_id", planId);
    expect(versionError).not.toBeNull();
  });

  it("opens the next draft only from a finalized plan", async () => {
    const draftId = await createDraft(alice);

    const { error: tooEarly } = await alice.rpc("create_plan_draft", {
      p_from_plan_id: draftId,
    });
    expect(tooEarly?.code).toBe("LV409");
    expect(tooEarly?.message).toContain("PLAN_NOT_FINALIZED");

    await alice.rpc("save_plan_step", {
      p_plan_id: draftId,
      p_step: "personal-details",
      p_data: COMPLETE_PERSONAL,
      p_expected_lock_version: 0,
    });
    await alice.rpc("finalize_legacy_plan", {
      p_plan_id: draftId,
      p_expected_lock_version: 1,
      p_acknowledge_incomplete: true,
    });

    const { data: nextId, error } = await alice.rpc("create_plan_draft", {
      p_from_plan_id: draftId,
    });
    expect(error).toBeNull();

    const next = await planRepository.findById(alice, aliceId, nextId as string);
    expect(next?.status).toBe("DRAFT");
    expect(next?.version).toBe(2);
    // The steps carry forward, so the new draft starts from the finalized state.
    expect(next?.stepsData["personal-details"]).toMatchObject({ legalName: "Priya Sharma" });

    const plans = await planRepository.list(alice, aliceId);
    expect(plans).toHaveLength(2);
    expect(await planRepository.findDraft(alice, aliceId)).toMatchObject({ version: 2 });
  });
});
