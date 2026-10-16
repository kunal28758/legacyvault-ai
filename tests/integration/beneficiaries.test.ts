import { beforeAll, beforeEach, describe, expect, it } from "vitest";

import type { TypedSupabaseClient } from "@/lib/db/server";
import * as beneficiaryRepository from "@/lib/repositories/beneficiary.repository";

import {
  createServiceScopedClient,
  createUserScopedClient,
  isLocalStackAvailable,
} from "../helpers/db";

/**
 * Beneficiary domain against the real local PostgreSQL stack.
 *
 * The repository is exercised with the same user-scoped client the application
 * builds, so RLS, the Class A column grants and the guarded functions all apply
 * exactly as they do in production. What is asserted here is behaviour the
 * service layer depends on and cannot verify for itself: cross-user isolation,
 * the refusal of non-grantable columns, and the cascades inside
 * `set_beneficiary_status()`, `assign_beneficiary()`, `unassign_beneficiary()`
 * and `remove_beneficiary()`.
 */
const SUBJECT_A = "user_beneficiaries_alice";
const SUBJECT_B = "user_beneficiaries_bob";

const available = await isLocalStackAvailable();
let aliceId: string;
let bobId: string;
let alice: TypedSupabaseClient;
let bob: TypedSupabaseClient;

if (!available) {
  console.warn(
    "[beneficiaries] local Supabase stack unreachable — start it with `pnpm db:start`. Database assertions are SKIPPED, not passed.",
  );
}

beforeAll(async () => {
  if (!available) return;

  const service = createServiceScopedClient();
  await service.from("users").delete().in("clerk_user_id", [SUBJECT_A, SUBJECT_B]);

  const { data, error } = await service
    .from("users")
    .insert([
      { clerk_user_id: SUBJECT_A, email: "alice.beneficiaries@example.com", name: "Alice" },
      { clerk_user_id: SUBJECT_B, email: "bob.beneficiaries@example.com", name: "Bob" },
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
  // Hard delete between tests so the live-email unique index starts clean.
  await service.from("beneficiaries").delete().in("user_id", [aliceId, bobId]);
  await service.from("financial_assets").delete().in("user_id", [aliceId, bobId]);
});

function seed(overrides: Partial<beneficiaryRepository.BeneficiaryInsert> = {}) {
  return {
    name: "Priya Sharma",
    relationship: "Spouse",
    email: "priya@example.com",
    phone: null,
    notes: null,
    ...overrides,
  };
}

describe.skipIf(!available)("beneficiaries — Class A writes", () => {
  it("creates a beneficiary through the column allow-list and reads it back", async () => {
    const created = await beneficiaryRepository.insert(alice, aliceId, seed());

    expect(created.status).toBe("PENDING");
    expect(created.invitedAt).toBeNull();
    expect(created.activatedAt).toBeNull();

    const found = await beneficiaryRepository.findById(alice, aliceId, created.id);
    expect(found?.email).toBe("priya@example.com");
  });

  it("refuses a second live beneficiary with the same email", async () => {
    await beneficiaryRepository.insert(alice, aliceId, seed());
    await expect(beneficiaryRepository.insert(alice, aliceId, seed())).rejects.toMatchObject({
      code: "23505",
    });
  });

  it("refuses to write columns outside the allow-list", async () => {
    const created = await beneficiaryRepository.insert(alice, aliceId, seed());

    const { error: statusError } = await alice
      .from("beneficiaries")
      .update({ status: "ACTIVE" })
      .eq("id", created.id);
    expect(statusError).not.toBeNull();

    const { error: invitedError } = await alice
      .from("beneficiaries")
      .update({ invited_at: new Date().toISOString() })
      .eq("id", created.id);
    expect(invitedError).not.toBeNull();
  });

  it("updates contact fields and records a trigger audit row", async () => {
    const created = await beneficiaryRepository.insert(alice, aliceId, seed());
    const updated = await beneficiaryRepository.update(alice, aliceId, created.id, {
      name: "Priya S.",
      phone: "+91 90000 00000",
    });
    expect(updated.name).toBe("Priya S.");

    const service = createServiceScopedClient();
    const { data: rows } = await service
      .from("audit_log")
      .select("action, metadata")
      .eq("resource_id", created.id)
      .order("created_at", { ascending: false });

    const trigger = rows?.find(
      (row) => (row.metadata as Record<string, unknown> | null)?.source === "db_trigger",
    );
    expect(trigger?.action).toBe("beneficiaries.row_changed");

    // 0013: the row says which fields changed, never their personal values.
    const metadata = trigger?.metadata as {
      changed: string[];
      previous: Record<string, unknown>;
      new: Record<string, unknown>;
    };
    expect(metadata.changed).toEqual(expect.arrayContaining(["name", "phone"]));
    expect(metadata.previous.name).toBe("[protected]");
    expect(metadata.new.phone).toBe("[protected]");
    const serialized = JSON.stringify(rows);
    for (const value of ["Priya", "+91 90000 00000", "priya@example.com", "Spouse"]) {
      expect(serialized).not.toContain(value);
    }
  });

  it("keeps the values of non-personal state changes in the trigger row", async () => {
    const created = await beneficiaryRepository.insert(alice, aliceId, seed());
    const service = createServiceScopedClient();
    const { error } = await service
      .from("beneficiaries")
      .update({ status: "ACTIVE" })
      .eq("id", created.id);
    expect(error).toBeNull();

    const { data: rows } = await service
      .from("audit_log")
      .select("action, metadata")
      .eq("resource_id", created.id)
      .eq("action", "beneficiaries.row_changed");
    const metadata = rows?.at(-1)?.metadata as { new: Record<string, unknown> } | undefined;
    expect(metadata?.new.status).toBe("ACTIVE");
  });

  it("stamps invitedAt only through the service client", async () => {
    const created = await beneficiaryRepository.insert(alice, aliceId, seed());
    const service = createServiceScopedClient() as unknown as TypedSupabaseClient;

    const invited = await beneficiaryRepository.markInvited(
      service,
      aliceId,
      created.id,
      new Date().toISOString(),
    );
    expect(invited.invitedAt).not.toBeNull();
    expect(invited.status).toBe("PENDING");
  });

  it("records the first invitation once, however many requests race for it", async () => {
    const created = await beneficiaryRepository.insert(alice, aliceId, seed());
    const service = createServiceScopedClient() as unknown as TypedSupabaseClient;
    const at = new Date().toISOString();

    const attempts = await Promise.all(
      [1, 2, 3].map(() =>
        beneficiaryRepository.markInvitedIfUninvited(service, aliceId, created.id, at),
      ),
    );

    // Exactly one request stamps it — and only that one goes on to send.
    expect(attempts.filter(Boolean)).toHaveLength(1);
    await expect(
      beneficiaryRepository.markInvitedIfUninvited(service, aliceId, created.id, at),
    ).resolves.toBeNull();
    // Never through somebody else's scope.
    await expect(
      beneficiaryRepository.markInvitedIfUninvited(service, bobId, created.id, at),
    ).resolves.toBeNull();
  });
});

describe.skipIf(!available)("beneficiaries — isolation", () => {
  it("never returns another owner's beneficiary", async () => {
    const created = await beneficiaryRepository.insert(
      bob,
      bobId,
      seed({ email: "b@example.com" }),
    );

    // Even asking with the true owner id: RLS scopes the statement to the caller.
    expect(await beneficiaryRepository.findById(alice, bobId, created.id)).toBeNull();
    expect(await beneficiaryRepository.findById(alice, aliceId, created.id)).toBeNull();

    const { rows } = await beneficiaryRepository.list(alice, aliceId, { page: 1, limit: 50 });
    expect(rows).toHaveLength(0);
  });

  it("refuses to update another owner's beneficiary", async () => {
    const created = await beneficiaryRepository.insert(
      bob,
      bobId,
      seed({ email: "b@example.com" }),
    );
    await expect(
      beneficiaryRepository.update(alice, aliceId, created.id, { name: "hijacked" }),
    ).rejects.toBeTruthy();
  });

  it("refuses the guarded functions for a beneficiary that is not the caller's", async () => {
    const created = await beneficiaryRepository.insert(
      bob,
      bobId,
      seed({ email: "b@example.com" }),
    );

    const { error: statusError } = await alice.rpc("set_beneficiary_status", {
      p_beneficiary_id: created.id,
      p_status: "INACTIVE",
    });
    expect(statusError?.code).toBe("42501");

    const { error: removeError } = await alice.rpc("remove_beneficiary", {
      p_beneficiary_id: created.id,
    });
    expect(removeError?.code).toBe("42501");
  });
});

describe.skipIf(!available)("beneficiaries — listing", () => {
  it("filters by status, searches and paginates", async () => {
    const first = await beneficiaryRepository.insert(alice, aliceId, seed());
    await beneficiaryRepository.insert(
      alice,
      aliceId,
      seed({ name: "Rohan Mehta", relationship: "Son", email: "rohan@example.com" }),
    );
    await alice.rpc("set_beneficiary_status", {
      p_beneficiary_id: first.id,
      p_status: "ACTIVE",
    });

    const active = await beneficiaryRepository.list(alice, aliceId, {
      status: "ACTIVE",
      page: 1,
      limit: 50,
    });
    expect(active.rows.map((row) => row.id)).toEqual([first.id]);

    const searched = await beneficiaryRepository.list(alice, aliceId, {
      search: "rohan",
      page: 1,
      limit: 50,
    });
    expect(searched.rows).toHaveLength(1);
    expect(searched.rows[0]?.name).toBe("Rohan Mehta");

    const paged = await beneficiaryRepository.list(alice, aliceId, { page: 1, limit: 1 });
    expect(paged.rows).toHaveLength(1);
    expect(paged.total).toBe(2);
  });

  it("ignores PostgREST grammar in the search term instead of obeying it", async () => {
    await beneficiaryRepository.insert(alice, aliceId, seed());

    const injected = await beneficiaryRepository.list(alice, aliceId, {
      search: "x),name.neq.zzz,(name.ilike.*",
      page: 1,
      limit: 50,
    });
    // The crafted term must not widen the result set back to everything.
    expect(injected.rows).toHaveLength(0);
  });
});

describe.skipIf(!available)("beneficiaries — guarded lifecycle", () => {
  it("activates, deactivates and audits inside the function", async () => {
    const created = await beneficiaryRepository.insert(alice, aliceId, seed());

    await alice.rpc("set_beneficiary_status", { p_beneficiary_id: created.id, p_status: "ACTIVE" });
    const activated = await beneficiaryRepository.findById(alice, aliceId, created.id);
    expect(activated?.status).toBe("ACTIVE");
    expect(activated?.activatedAt).not.toBeNull();

    await alice.rpc("set_beneficiary_status", {
      p_beneficiary_id: created.id,
      p_status: "INACTIVE",
      p_corr: "11111111-1111-4111-8111-111111111111",
    });
    const deactivated = await beneficiaryRepository.findById(alice, aliceId, created.id);
    expect(deactivated?.status).toBe("INACTIVE");

    const service = createServiceScopedClient();
    const { data: rows } = await service
      .from("audit_log")
      .select("action, outcome, correlation_id")
      .eq("resource_id", created.id)
      .eq("action", "beneficiary.status_changed");
    expect(rows?.length).toBeGreaterThanOrEqual(2);
    expect(rows?.some((row) => row.correlation_id === "11111111-1111-4111-8111-111111111111")).toBe(
      true,
    );
  });

  it("refuses PENDING as a target status", async () => {
    const created = await beneficiaryRepository.insert(alice, aliceId, seed());
    const { error } = await alice.rpc("set_beneficiary_status", {
      p_beneficiary_id: created.id,
      p_status: "PENDING",
    });
    expect(error?.code).toBe("LV422");
  });

  it("assigns a resource, reports the allocation and unassigns again", async () => {
    const created = await beneficiaryRepository.insert(alice, aliceId, seed());
    const service = createServiceScopedClient();
    const { data: asset, error: assetError } = await service
      .from("financial_assets")
      .insert({ user_id: aliceId, name: "Savings", category: "BANK_ACCOUNT" })
      .select("id")
      .single();
    if (assetError) throw assetError;

    const { data: assignmentId, error } = await alice.rpc("assign_beneficiary", {
      p_beneficiary_id: created.id,
      p_resource_type: "FINANCIAL_ASSET",
      p_resource_id: asset.id,
      p_allocation: 60,
    });
    expect(error).toBeNull();

    const assignments = await beneficiaryRepository.listAssignments(alice, aliceId, created.id);
    expect(assignments).toHaveLength(1);
    expect(assignments[0]?.allocationPercentage).toBe(60);

    const found = await beneficiaryRepository.findAssignmentById(
      alice,
      aliceId,
      assignments[0]!.id,
    );
    expect(found?.beneficiaryId).toBe(created.id);
    // Another owner cannot resolve the same assignment id.
    expect(
      await beneficiaryRepository.findAssignmentById(bob, bobId, assignments[0]!.id),
    ).toBeNull();

    const { error: unassignError } = await alice.rpc("unassign_beneficiary", {
      p_assignment_id: assignmentId as string,
    });
    expect(unassignError).toBeNull();
    expect(await beneficiaryRepository.listAssignments(alice, aliceId, created.id)).toHaveLength(0);
  });

  it("refuses an assignment that would exceed 100% and one to an INACTIVE beneficiary", async () => {
    const first = await beneficiaryRepository.insert(alice, aliceId, seed());
    const second = await beneficiaryRepository.insert(
      alice,
      aliceId,
      seed({ name: "Second", email: "second@example.com" }),
    );
    const service = createServiceScopedClient();
    const { data: asset, error: assetError } = await service
      .from("financial_assets")
      .insert({ user_id: aliceId, name: "Brokerage", category: "STOCK" })
      .select("id")
      .single();
    if (assetError) throw assetError;

    await alice.rpc("assign_beneficiary", {
      p_beneficiary_id: first.id,
      p_resource_type: "FINANCIAL_ASSET",
      p_resource_id: asset!.id,
      p_allocation: 70,
    });

    const { error: exceeded } = await alice.rpc("assign_beneficiary", {
      p_beneficiary_id: second.id,
      p_resource_type: "FINANCIAL_ASSET",
      p_resource_id: asset!.id,
      p_allocation: 40,
    });
    expect(exceeded?.code).toBe("LV422");
    expect(exceeded?.message).toContain("ALLOCATION_EXCEEDED");

    await alice.rpc("set_beneficiary_status", {
      p_beneficiary_id: second.id,
      p_status: "INACTIVE",
    });
    const { error: inactive } = await alice.rpc("assign_beneficiary", {
      p_beneficiary_id: second.id,
      p_resource_type: "FINANCIAL_ASSET",
      p_resource_id: asset!.id,
      p_allocation: 10,
    });
    expect(inactive?.message).toContain("BENEFICIARY_INACTIVE");
  });

  it("removes a beneficiary with its assignments in one transaction", async () => {
    const created = await beneficiaryRepository.insert(alice, aliceId, seed());
    const service = createServiceScopedClient();
    const { data: asset, error: assetError } = await service
      .from("financial_assets")
      .insert({ user_id: aliceId, name: "Property fund", category: "MUTUAL_FUND" })
      .select("id")
      .single();
    if (assetError) throw assetError;
    await alice.rpc("assign_beneficiary", {
      p_beneficiary_id: created.id,
      p_resource_type: "FINANCIAL_ASSET",
      p_resource_id: asset!.id,
      p_allocation: 25,
    });

    const { error } = await alice.rpc("remove_beneficiary", { p_beneficiary_id: created.id });
    expect(error).toBeNull();

    expect(await beneficiaryRepository.findById(alice, aliceId, created.id)).toBeNull();
    expect(await beneficiaryRepository.listAssignments(alice, aliceId, created.id)).toHaveLength(0);

    // Soft delete, not a hard delete: the row survives for the audit trail.
    const { data: row } = await service
      .from("beneficiaries")
      .select("deleted_at, status")
      .eq("id", created.id)
      .single();
    expect(row?.deleted_at).not.toBeNull();
    expect(row?.status).toBe("INACTIVE");

    // The email is free again once the row is soft deleted.
    const recreated = await beneficiaryRepository.insert(alice, aliceId, seed());
    expect(recreated.id).not.toBe(created.id);
  });
});

describe.skipIf(!available)("beneficiaries — contact roles", () => {
  it("reports no trusted or emergency roles when none are configured", async () => {
    await beneficiaryRepository.insert(alice, aliceId, seed());
    expect(await beneficiaryRepository.listTrustedContactIds(alice, aliceId)).toEqual([]);
    expect(await beneficiaryRepository.listEmergencyContactIds(alice, aliceId)).toEqual([]);
  });

  it("reports an active emergency-access designation", async () => {
    const created = await beneficiaryRepository.insert(alice, aliceId, seed());
    const service = createServiceScopedClient();
    await service.from("emergency_access_configs").insert({
      user_id: aliceId,
      beneficiary_id: created.id,
      access_scope: { documents: [] },
    });

    expect(await beneficiaryRepository.listEmergencyContactIds(alice, aliceId)).toEqual([
      created.id,
    ]);
    // Another owner sees nothing of it.
    expect(await beneficiaryRepository.listEmergencyContactIds(bob, bobId)).toEqual([]);
  });
});
