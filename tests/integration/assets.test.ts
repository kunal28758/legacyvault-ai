import { beforeAll, beforeEach, describe, expect, it } from "vitest";

import type { TypedSupabaseClient } from "@/lib/db/server";
import * as assetRepository from "@/lib/repositories/asset.repository";
import { decrypt, encrypt } from "@/lib/security/encryption";

import {
  createServiceScopedClient,
  createUserScopedClient,
  isLocalStackAvailable,
} from "../helpers/db";

/**
 * Asset domain against the real local PostgreSQL stack.
 *
 * The assertions cover the boundaries the application depends on: assets can be
 * created only through `create_asset()`, the ENCRYPTED columns accept only a
 * well-formed envelope and only through the guarded functions, deletion is an
 * atomic cascade, and `assign_beneficiary()` holds the Σ ≤ 100 invariant under
 * a row lock.
 *
 * The envelope is produced by the application's own `encrypt()`, so this is
 * also the check that `lib/security/encryption` and `lv_is_envelope()` agree.
 */
const SUBJECT_A = "user_assets_alice";
const SUBJECT_B = "user_assets_bob";

const available = await isLocalStackAvailable();
let aliceId: string;
let bobId: string;
let alice: TypedSupabaseClient;
let bob: TypedSupabaseClient;

if (!available) {
  console.warn(
    "[assets] local Supabase stack unreachable — start it with `pnpm db:start`. Database assertions are SKIPPED, not passed.",
  );
}

beforeAll(async () => {
  if (!available) return;

  const service = createServiceScopedClient();
  await service.from("users").delete().in("clerk_user_id", [SUBJECT_A, SUBJECT_B]);
  const { data, error } = await service
    .from("users")
    .insert([
      { clerk_user_id: SUBJECT_A, email: "alice.assets@example.com", name: "Alice" },
      { clerk_user_id: SUBJECT_B, email: "bob.assets@example.com", name: "Bob" },
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
  await service.from("financial_assets").delete().in("user_id", [aliceId, bobId]);
  await service.from("physical_assets").delete().in("user_id", [aliceId, bobId]);
  await service.from("digital_assets").delete().in("user_id", [aliceId, bobId]);
  await service.from("beneficiaries").delete().in("user_id", [aliceId, bobId]);
});

async function createFinancial(
  client: TypedSupabaseClient,
  plain: Record<string, unknown> = {},
  encrypted: Record<string, unknown> = {},
): Promise<string> {
  const { data, error } = await client.rpc("create_asset", {
    p_resource_type: "FINANCIAL_ASSET",
    p_plain: { name: "Savings", category: "BANK_ACCOUNT", currency: "INR", ...plain } as never,
    p_encrypted: encrypted as never,
  });
  if (error) throw error;
  return data as string;
}

async function createBeneficiary(
  client: TypedSupabaseClient,
  userId: string,
  email: string,
): Promise<string> {
  const { data, error } = await client
    .from("beneficiaries")
    .insert({ user_id: userId, name: "Recipient", relationship: "Sibling", email })
    .select("id")
    .single();
  if (error) throw error;
  return data.id;
}

describe.skipIf(!available)("assets — creation", () => {
  it("creates through the guarded function and refuses a direct insert", async () => {
    const id = await createFinancial(alice, { institution: "State Bank", estimatedValue: 250000 });

    const asset = await assetRepository.findById(alice, aliceId, "FINANCIAL_ASSET", id);
    expect(asset).toMatchObject({ name: "Savings", currency: "INR", kind: "FINANCIAL_ASSET" });
    expect(asset?.estimatedValue).toBe(250000);

    const { error } = await alice
      .from("financial_assets")
      .insert({ user_id: aliceId, name: "Direct", category: "BANK_ACCOUNT" });
    expect(error).not.toBeNull();
  });

  it("rejects a field outside the class allow-list", async () => {
    const { error } = await alice.rpc("create_asset", {
      p_resource_type: "FINANCIAL_ASSET",
      p_plain: { name: "Odd", category: "BANK_ACCOUNT", location: "nowhere" } as never,
    });
    expect(error?.code).toBe("LV422");
    expect(error?.message).toContain("INVALID_INPUT");
  });

  it("stores an application envelope and never plaintext", async () => {
    const accountNumber = "4111111111114821";
    const id = await createFinancial(alice, {}, { accountNumber: encrypt(accountNumber) });

    // A normal read reports presence only.
    const asset = await assetRepository.findById(alice, aliceId, "FINANCIAL_ASSET", id);
    expect(asset).toMatchObject({ hasAccountNumber: true, hasPolicyNumber: false });
    expect(JSON.stringify(asset)).not.toContain(accountNumber);

    // The stored column is the envelope, and it round-trips through our own key.
    const envelopes = await assetRepository.findEncrypted(alice, aliceId, "FINANCIAL_ASSET", id);
    const stored = envelopes?.accountNumber as string;
    expect(stored).not.toContain(accountNumber);
    expect(decrypt(JSON.parse(stored))).toBe(accountNumber);
  });

  it("refuses plaintext in an encrypted field", async () => {
    const { error } = await alice.rpc("create_asset", {
      p_resource_type: "FINANCIAL_ASSET",
      p_plain: { name: "Plain", category: "BANK_ACCOUNT" } as never,
      p_encrypted: { accountNumber: "4111111111114821" } as never,
    });
    expect(error?.code).toBe("LV422");
    expect(error?.message).toContain("INVALID_ENCRYPTION_ENVELOPE");
  });

  it("refuses a direct write to an encrypted column", async () => {
    const id = await createFinancial(alice);
    const { error } = await alice
      .from("financial_assets")
      .update({ account_number: "4111111111114821" })
      .eq("id", id);
    expect(error).not.toBeNull();
  });
});

describe.skipIf(!available)("assets — update and delete", () => {
  it("updates the plain allow-list and writes a trigger audit row", async () => {
    const id = await createFinancial(alice);
    const updated = await assetRepository.update(alice, aliceId, "FINANCIAL_ASSET", id, {
      name: "Renamed savings",
      institution: "HDFC",
    });
    expect(updated.name).toBe("Renamed savings");

    const service = createServiceScopedClient();
    const { data: rows } = await service
      .from("audit_log")
      .select("action, metadata")
      .eq("resource_id", id);
    const trigger = rows?.find(
      (row) => (row.metadata as Record<string, unknown> | null)?.source === "db_trigger",
    );
    expect(trigger?.action).toBe("financial_assets.row_changed");
  });

  it("replaces an encrypted field only through set_encrypted_fields()", async () => {
    const id = await createFinancial(alice, {}, { accountNumber: encrypt("1111") });

    const { error } = await alice.rpc("set_encrypted_fields", {
      p_resource_type: "FINANCIAL_ASSET",
      p_resource_id: id,
      p_fields: { accountNumber: encrypt("2222") } as never,
    });
    expect(error).toBeNull();

    const envelopes = await assetRepository.findEncrypted(alice, aliceId, "FINANCIAL_ASSET", id);
    expect(decrypt(JSON.parse(envelopes?.accountNumber as string))).toBe("2222");
    // The untouched field keeps its value.
    expect(envelopes?.policyNumber).toBeNull();

    const service = createServiceScopedClient();
    const { data: rows } = await service
      .from("audit_log")
      .select("action, metadata")
      .eq("resource_id", id)
      .eq("action", "asset.encrypted_fields_updated");
    expect(rows?.length).toBe(1);
    // The audit row names the field, never the value.
    expect(JSON.stringify(rows?.[0]?.metadata)).toContain("[encrypted]");
    expect(JSON.stringify(rows?.[0]?.metadata)).not.toContain("2222");
  });

  it("refuses another owner's asset through the guarded functions", async () => {
    const id = await createFinancial(bob);

    expect(await assetRepository.findById(alice, aliceId, "FINANCIAL_ASSET", id)).toBeNull();

    const { error: encryptedError } = await alice.rpc("set_encrypted_fields", {
      p_resource_type: "FINANCIAL_ASSET",
      p_resource_id: id,
      p_fields: { accountNumber: encrypt("9999") } as never,
    });
    expect(encryptedError?.code).toBe("42501");

    const { error: deleteError } = await alice.rpc("delete_asset", {
      p_resource_type: "FINANCIAL_ASSET",
      p_asset_id: id,
    });
    expect(deleteError?.code).toBe("42501");
  });

  it("soft-deletes with its assignments in one transaction", async () => {
    const assetId = await createFinancial(alice);
    const beneficiaryId = await createBeneficiary(alice, aliceId, "cascade@example.com");
    await alice.rpc("assign_beneficiary", {
      p_beneficiary_id: beneficiaryId,
      p_resource_type: "FINANCIAL_ASSET",
      p_resource_id: assetId,
      p_allocation: 40,
    });

    const { error } = await alice.rpc("delete_asset", {
      p_resource_type: "FINANCIAL_ASSET",
      p_asset_id: assetId,
    });
    expect(error).toBeNull();

    expect(await assetRepository.findById(alice, aliceId, "FINANCIAL_ASSET", assetId)).toBeNull();
    expect(
      await assetRepository.listAssignmentsByKind(alice, aliceId, "FINANCIAL_ASSET", assetId),
    ).toHaveLength(0);

    const service = createServiceScopedClient();
    const { data: row } = await service
      .from("financial_assets")
      .select("deleted_at")
      .eq("id", assetId)
      .single();
    expect(row?.deleted_at).not.toBeNull();

    const { data: audit } = await service
      .from("audit_log")
      .select("action, metadata")
      .eq("resource_id", assetId)
      .eq("action", "asset.deleted");
    expect((audit?.[0]?.metadata as Record<string, unknown>)?.assignmentsRemoved).toBe(1);
  });

  it("refuses a direct deleted_at write", async () => {
    const id = await createFinancial(alice);
    const { error } = await alice
      .from("financial_assets")
      .update({ deleted_at: new Date().toISOString() })
      .eq("id", id);
    expect(error).not.toBeNull();
  });
});

describe.skipIf(!available)("assets — beneficiary assignment", () => {
  it("assigns, reports the allocation and unassigns", async () => {
    const assetId = await createFinancial(alice);
    const beneficiaryId = await createBeneficiary(alice, aliceId, "assign@example.com");

    const { data: assignmentId, error } = await alice.rpc("assign_beneficiary", {
      p_beneficiary_id: beneficiaryId,
      p_resource_type: "FINANCIAL_ASSET",
      p_resource_id: assetId,
      p_allocation: 60,
    });
    expect(error).toBeNull();

    const assignments = await assetRepository.listAssignmentsByKind(
      alice,
      aliceId,
      "FINANCIAL_ASSET",
      assetId,
    );
    expect(assignments).toHaveLength(1);
    expect(assignments[0]?.allocationPercentage).toBe(60);

    const names = await assetRepository.beneficiaryNames(alice, aliceId, [beneficiaryId]);
    expect(names.get(beneficiaryId)).toBe("Recipient");

    const { error: unassignError } = await alice.rpc("unassign_beneficiary", {
      p_assignment_id: assignmentId as string,
    });
    expect(unassignError).toBeNull();
    expect(
      await assetRepository.listAssignmentsByKind(alice, aliceId, "FINANCIAL_ASSET", assetId),
    ).toHaveLength(0);
  });

  it("holds Σ allocation ≤ 100 and reports what is left", async () => {
    const assetId = await createFinancial(alice);
    const first = await createBeneficiary(alice, aliceId, "first@example.com");
    const second = await createBeneficiary(alice, aliceId, "second@example.com");

    await alice.rpc("assign_beneficiary", {
      p_beneficiary_id: first,
      p_resource_type: "FINANCIAL_ASSET",
      p_resource_id: assetId,
      p_allocation: 70,
    });

    const { error } = await alice.rpc("assign_beneficiary", {
      p_beneficiary_id: second,
      p_resource_type: "FINANCIAL_ASSET",
      p_resource_id: assetId,
      p_allocation: 40,
    });
    expect(error?.code).toBe("LV422");
    expect(error?.message).toContain("ALLOCATION_EXCEEDED");
    expect(error?.details).toContain("30");

    // Exactly the remainder is accepted.
    const { error: fits } = await alice.rpc("assign_beneficiary", {
      p_beneficiary_id: second,
      p_resource_type: "FINANCIAL_ASSET",
      p_resource_id: assetId,
      p_allocation: 30,
    });
    expect(fits).toBeNull();
  });

  it("refuses a duplicate, an inactive beneficiary and an out-of-range allocation", async () => {
    const assetId = await createFinancial(alice);
    const beneficiaryId = await createBeneficiary(alice, aliceId, "rules@example.com");
    await alice.rpc("assign_beneficiary", {
      p_beneficiary_id: beneficiaryId,
      p_resource_type: "FINANCIAL_ASSET",
      p_resource_id: assetId,
      p_allocation: 10,
    });

    const { error: duplicate } = await alice.rpc("assign_beneficiary", {
      p_beneficiary_id: beneficiaryId,
      p_resource_type: "FINANCIAL_ASSET",
      p_resource_id: assetId,
      p_allocation: 10,
    });
    expect(duplicate?.message).toContain("ALREADY_ASSIGNED");

    const { error: outOfRange } = await alice.rpc("assign_beneficiary", {
      p_beneficiary_id: beneficiaryId,
      p_resource_type: "FINANCIAL_ASSET",
      p_resource_id: assetId,
      p_allocation: 150,
    });
    expect(outOfRange?.message).toContain("INVALID_ALLOCATION");

    await alice.rpc("set_beneficiary_status", {
      p_beneficiary_id: beneficiaryId,
      p_status: "INACTIVE",
    });
    const other = await createFinancial(alice, { name: "Second asset" });
    const { error: inactive } = await alice.rpc("assign_beneficiary", {
      p_beneficiary_id: beneficiaryId,
      p_resource_type: "FINANCIAL_ASSET",
      p_resource_id: other,
      p_allocation: 10,
    });
    expect(inactive?.message).toContain("BENEFICIARY_INACTIVE");
  });

  it("refuses to assign across owners in either direction", async () => {
    const aliceAsset = await createFinancial(alice);
    const bobAsset = await createFinancial(bob);
    const aliceBeneficiary = await createBeneficiary(alice, aliceId, "a@example.com");
    const bobBeneficiary = await createBeneficiary(bob, bobId, "b@example.com");

    const { error: foreignAsset } = await alice.rpc("assign_beneficiary", {
      p_beneficiary_id: aliceBeneficiary,
      p_resource_type: "FINANCIAL_ASSET",
      p_resource_id: bobAsset,
      p_allocation: 10,
    });
    expect(foreignAsset?.code).toBe("42501");

    const { error: foreignBeneficiary } = await alice.rpc("assign_beneficiary", {
      p_beneficiary_id: bobBeneficiary,
      p_resource_type: "FINANCIAL_ASSET",
      p_resource_id: aliceAsset,
      p_allocation: 10,
    });
    expect(foreignBeneficiary?.code).toBe("42501");
  });

  it("keeps assignments invisible across owners", async () => {
    const bobAsset = await createFinancial(bob);
    const bobBeneficiary = await createBeneficiary(bob, bobId, "hidden@example.com");
    await bob.rpc("assign_beneficiary", {
      p_beneficiary_id: bobBeneficiary,
      p_resource_type: "FINANCIAL_ASSET",
      p_resource_id: bobAsset,
      p_allocation: 50,
    });

    expect(
      await assetRepository.listAssignmentsByKind(alice, aliceId, "FINANCIAL_ASSET"),
    ).toHaveLength(0);
  });
});

describe.skipIf(!available)("assets — listing", () => {
  it("filters by category, searches and stays scoped to the owner", async () => {
    await createFinancial(alice, { name: "Alice bank", category: "BANK_ACCOUNT" });
    await createFinancial(alice, { name: "Alice fund", category: "MUTUAL_FUND" });
    await createFinancial(bob, { name: "Bob bank", category: "BANK_ACCOUNT" });

    const all = await assetRepository.list(alice, aliceId, "FINANCIAL_ASSET", {
      page: 1,
      limit: 50,
    });
    expect(all.total).toBe(2);

    const funds = await assetRepository.list(alice, aliceId, "FINANCIAL_ASSET", {
      category: "MUTUAL_FUND",
      page: 1,
      limit: 50,
    });
    expect(funds.rows.map((row) => row.name)).toEqual(["Alice fund"]);

    const searched = await assetRepository.list(alice, aliceId, "FINANCIAL_ASSET", {
      search: "bank",
      page: 1,
      limit: 50,
    });
    expect(searched.rows.map((row) => row.name)).toEqual(["Alice bank"]);

    const injected = await assetRepository.list(alice, aliceId, "FINANCIAL_ASSET", {
      search: "x),name.neq.zzz,(name.ilike.*",
      page: 1,
      limit: 50,
    });
    expect(injected.rows).toHaveLength(0);
  });

  it("covers the physical and digital classes with their own columns", async () => {
    const { data: physicalId, error: physicalError } = await alice.rpc("create_asset", {
      p_resource_type: "PHYSICAL_ASSET",
      p_plain: {
        name: "Flat 4B",
        category: "REAL_ESTATE",
        location: "Pune",
        ownershipDetails: "Sole owner",
      } as never,
    });
    expect(physicalError).toBeNull();

    const physical = await assetRepository.findById(
      alice,
      aliceId,
      "PHYSICAL_ASSET",
      physicalId as string,
    );
    expect(physical).toMatchObject({ location: "Pune", ownershipDetails: "Sole owner" });

    const { data: digitalId } = await alice.rpc("create_asset", {
      p_resource_type: "DIGITAL_ASSET",
      p_plain: { name: "Domain", category: "DOMAIN", platform: "GoDaddy" } as never,
      p_encrypted: { credentials: encrypt("hunter2") } as never,
    });

    const digital = await assetRepository.findById(
      alice,
      aliceId,
      "DIGITAL_ASSET",
      digitalId as string,
    );
    expect(digital).toMatchObject({
      platform: "GoDaddy",
      hasCredentials: true,
      hasRecoveryInfo: false,
    });
    expect(JSON.stringify(digital)).not.toContain("hunter2");

    // Physical assets have no encrypted fields at all.
    expect(
      await assetRepository.findEncrypted(alice, aliceId, "PHYSICAL_ASSET", physicalId as string),
    ).toEqual({});
  });
});
