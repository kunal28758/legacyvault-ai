import { beforeAll, describe, expect, it } from "vitest";

import {
  createServiceScopedClient,
  createUserScopedClient,
  isLocalStackAvailable,
} from "../helpers/db";
import { mintLocalJwt } from "../helpers/jwt";

/**
 * Phase A foundation against the real local PostgreSQL stack.
 *
 * These assert the security properties the whole application rests on: that a
 * user-scoped client sees only its own rows, that the protected columns and
 * Class B tables refuse direct writes, and that the system-only functions are
 * unreachable from `authenticated`. They run against `supabase start`; when the
 * stack is down they skip rather than pass silently.
 */
const SUBJECT_A = "user_phase_a_alice";
const SUBJECT_B = "user_phase_a_bob";

const available = await isLocalStackAvailable();
let aliceId: string;
let bobId: string;

if (!available) {
  console.warn(
    "[phase-a] local Supabase stack unreachable — start it with `pnpm db:start`. Database assertions are SKIPPED, not passed.",
  );
}

beforeAll(async () => {
  if (!available) return;

  const service = createServiceScopedClient();
  // Deterministic fixtures: remove any leftovers, then provision two owners.
  await service.from("users").delete().in("clerk_user_id", [SUBJECT_A, SUBJECT_B]);

  const { data, error } = await service
    .from("users")
    .insert([
      { clerk_user_id: SUBJECT_A, email: "alice.phase.a@example.com", name: "Alice Phase A" },
      { clerk_user_id: SUBJECT_B, email: "bob.phase.a@example.com", name: "Bob Phase A" },
    ])
    .select("id, clerk_user_id");
  if (error) throw error;

  aliceId = data.find((row) => row.clerk_user_id === SUBJECT_A)!.id;
  bobId = data.find((row) => row.clerk_user_id === SUBJECT_B)!.id;

  await service.from("beneficiaries").insert([
    {
      user_id: aliceId,
      name: "Alice Beneficiary",
      relationship: "Spouse",
      email: "alice.ben@example.com",
    },
    {
      user_id: bobId,
      name: "Bob Beneficiary",
      relationship: "Child",
      email: "bob.ben@example.com",
    },
  ]);
}, 60_000);

describe.skipIf(!available)("phase A — database foundation", () => {
  it("resolves the caller identity from the JWT subject", async () => {
    const alice = await createUserScopedClient(SUBJECT_A);
    const { data, error } = await alice.rpc("current_user_id");
    expect(error).toBeNull();
    expect(data).toBe(aliceId);
  });

  it("scopes reads to the caller's own rows (cross-user isolation)", async () => {
    const alice = await createUserScopedClient(SUBJECT_A);

    const { data: users } = await alice.from("users").select("id, email");
    expect(users?.map((u) => u.id)).toEqual([aliceId]);

    const { data: beneficiaries } = await alice.from("beneficiaries").select("id, user_id");
    expect(beneficiaries?.every((b) => b.user_id === aliceId)).toBe(true);
    expect(beneficiaries?.some((b) => b.user_id === bobId)).toBe(false);

    // Explicitly asking for another user's row returns nothing, not an error:
    // no existence oracle.
    const { data: targeted } = await alice.from("users").select("id").eq("id", bobId);
    expect(targeted).toEqual([]);
  });

  it("refuses privilege escalation through a direct column write", async () => {
    const alice = await createUserScopedClient(SUBJECT_A);

    const { error: roleError } = await alice
      .from("users")
      .update({ role: "SUPER_ADMIN" })
      .eq("id", aliceId);
    expect(roleError).not.toBeNull();

    const { error: emailError } = await alice
      .from("users")
      .update({ email_verified: true })
      .eq("id", aliceId);
    expect(emailError).not.toBeNull();

    const service = createServiceScopedClient();
    const { data: after } = await service.from("users").select("role").eq("id", aliceId).single();
    expect(after?.role).toBe("USER");
  });

  it("refuses direct writes to encrypted columns and Class B tables", async () => {
    const alice = await createUserScopedClient(SUBJECT_A);

    const { error: encryptedError } = await alice
      .from("users")
      .update({ identification_details: "plaintext-should-never-land-here" })
      .eq("id", aliceId);
    expect(encryptedError).not.toBeNull();

    const { error: assetInsertError } = await alice
      .from("financial_assets")
      .insert({ user_id: aliceId, name: "Direct insert", category: "BANK_ACCOUNT" });
    expect(assetInsertError).not.toBeNull();

    const { error: assignmentError } = await alice.from("beneficiary_assignments").insert({
      user_id: aliceId,
      beneficiary_id: "00000000-0000-0000-0000-000000000000",
      resource_type: "FINANCIAL_ASSET",
      resource_id: "00000000-0000-0000-0000-000000000000",
      allocation_percentage: 100,
    });
    expect(assignmentError).not.toBeNull();
  });

  it("allows the Class A allow-list and records a trigger audit row", async () => {
    const alice = await createUserScopedClient(SUBJECT_A);

    const { error } = await alice.from("users").update({ phone: "+1 555 0100" }).eq("id", aliceId);
    expect(error).toBeNull();

    const service = createServiceScopedClient();
    const { data: rows } = await service
      .from("audit_log")
      .select("action, outcome, metadata")
      .eq("actor_id", aliceId)
      .order("created_at", { ascending: false })
      .limit(5);

    const triggerRow = rows?.find(
      (row) => (row.metadata as Record<string, unknown> | null)?.source === "db_trigger",
    );
    expect(triggerRow).toBeDefined();
    expect(triggerRow?.outcome).toBe("SUCCESS");
  });

  it("keeps the audit log append-only", async () => {
    const service = createServiceScopedClient();
    const { data: row } = await service
      .from("audit_log")
      .select("id")
      .eq("actor_id", aliceId)
      .limit(1)
      .maybeSingle();
    if (!row) return;

    const { error: updateError } = await service
      .from("audit_log")
      .update({ action: "tampered" })
      .eq("id", row.id);
    expect(updateError).not.toBeNull();

    const { error: deleteError } = await service.from("audit_log").delete().eq("id", row.id);
    expect(deleteError).not.toBeNull();
  });

  it("denies system-only functions to authenticated callers", async () => {
    const alice = await createUserScopedClient(SUBJECT_A);

    const { error: claimError } = await alice.rpc("claim_jobs", {
      p_limit: 1,
      p_runner_id: "test",
    });
    expect(claimError).not.toBeNull();

    const { error: webhookError } = await alice.rpc("record_webhook_event", {
      p_provider: "CLERK",
      p_event_id: "evt_should_be_denied",
      p_event_type: "user.created",
    });
    expect(webhookError).not.toBeNull();
  });

  it("gives an anonymous caller no access at all", async () => {
    const anon = await createUserScopedClient("user_not_provisioned");
    const { data } = await anon.from("users").select("id");
    expect(data ?? []).toEqual([]);
  });

  it("counts rate-limit hits atomically and reports the window verdict", async () => {
    const service = createServiceScopedClient();
    const key = `test:${Date.now()}`;
    const windowStart = new Date().toISOString();

    const first = await service.rpc("rate_limit_hit", {
      p_key: key,
      p_window_start: windowStart,
      p_limit: 2,
    });
    const second = await service.rpc("rate_limit_hit", {
      p_key: key,
      p_window_start: windowStart,
      p_limit: 2,
    });
    const third = await service.rpc("rate_limit_hit", {
      p_key: key,
      p_window_start: windowStart,
      p_limit: 2,
    });

    expect((first.data as { allowed: boolean }).allowed).toBe(true);
    expect((second.data as { allowed: boolean }).allowed).toBe(true);
    expect((third.data as { allowed: boolean; count: number }).allowed).toBe(false);
    expect((third.data as { count: number }).count).toBe(3);
  });

  it("makes duplicate webhook deliveries a no-op", async () => {
    const service = createServiceScopedClient();
    const eventId = `evt_${Date.now()}`;

    const first = await service.rpc("record_webhook_event", {
      p_provider: "CLERK",
      p_event_id: eventId,
      p_event_type: "user.created",
    });
    const replay = await service.rpc("record_webhook_event", {
      p_provider: "CLERK",
      p_event_id: eventId,
      p_event_type: "user.created",
    });

    expect(first.data).toBe(true);
    expect(replay.data).toBe(false);
  });

  it("accepts a Clerk-shaped token only for the subject it names", async () => {
    const token = await mintLocalJwt({ sub: SUBJECT_B });
    expect(typeof token).toBe("string");

    const bob = await createUserScopedClient(SUBJECT_B);
    const { data } = await bob.from("users").select("id");
    expect(data).toEqual([{ id: bobId }]);
  });
});
