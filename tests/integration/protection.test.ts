import { beforeAll, beforeEach, describe, expect, it } from "vitest";

import type { TypedSupabaseClient } from "@/lib/db/server";
import { runDmsScan } from "@/lib/jobs/handlers/dms-scan";
import * as jobRepository from "@/lib/repositories/job.repository";
import { hashAccessToken, mintAccessToken } from "@/lib/security/access-token";

import {
  createServiceScopedClient,
  createUserScopedClient,
  isLocalStackAvailable,
} from "../helpers/db";

/**
 * Protection mechanisms against the real local PostgreSQL stack.
 *
 * These are the guarantees a family ultimately depends on: the Dead Man's
 * Switch advances only through its legal transitions and only from the system
 * side, emergency access needs a verified code *and* an owner decision, access
 * links are stored hash-only and scoped to what is actually assigned, and the
 * job queue hands a unit of work to exactly one runner.
 */
const SUBJECT_A = "user_protection_alice";
const SUBJECT_B = "user_protection_bob";

const available = await isLocalStackAvailable();
let aliceId: string;
let bobId: string;
let alice: TypedSupabaseClient;
let bob: TypedSupabaseClient;
let service: TypedSupabaseClient;

if (!available) {
  console.warn(
    "[protection] local Supabase stack unreachable — start it with `pnpm db:start`. Database assertions are SKIPPED, not passed.",
  );
}

beforeAll(async () => {
  if (!available) return;

  service = createServiceScopedClient() as unknown as TypedSupabaseClient;
  await service.from("users").delete().in("clerk_user_id", [SUBJECT_A, SUBJECT_B]);
  const { data, error } = await service
    .from("users")
    .insert([
      { clerk_user_id: SUBJECT_A, email: "alice.protection@example.com", name: "Alice" },
      { clerk_user_id: SUBJECT_B, email: "bob.protection@example.com", name: "Bob" },
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
  await service.from("access_tokens").delete().in("owner_user_id", [aliceId, bobId]);
  await service.from("emergency_access_configs").delete().in("user_id", [aliceId, bobId]);
  await service.from("dead_man_switches").delete().in("user_id", [aliceId, bobId]);
  await service.from("notifications").delete().in("user_id", [aliceId, bobId]);
  await service.from("beneficiaries").delete().in("user_id", [aliceId, bobId]);
  await service.from("financial_assets").delete().in("user_id", [aliceId, bobId]);
  // This file is the only integration suite that uses the queue.
  await service.from("jobs").delete().not("id", "is", null);
});

async function beneficiary(email: string): Promise<string> {
  const { data, error } = await alice
    .from("beneficiaries")
    .insert({ user_id: aliceId, name: "Trusted Person", relationship: "Sibling", email })
    .select("id")
    .single();
  if (error) throw error;
  return data.id;
}

/** Assets are created only through the guarded function, here as elsewhere. */
async function asset(client: TypedSupabaseClient, name: string): Promise<string> {
  const { data, error } = await client.rpc("create_asset", {
    p_resource_type: "FINANCIAL_ASSET",
    p_plain: { name, category: "BANK_ACCOUNT", currency: "INR" } as never,
  });
  if (error) throw error;
  return data as string;
}

function scopeOf(assetId: string) {
  return {
    documents: [],
    assets: [{ type: "FINANCIAL_ASSET", id: assetId }],
    videos: [],
    planSections: [],
  };
}

async function configureSwitch(contactIds: string[], assetId: string): Promise<string> {
  const { data, error } = await alice.rpc("dms_configure", {
    p_config: {
      inactivityPeriodDays: 30,
      checkInFrequencyDays: 7,
      escalationDelayHours: 24,
      escalationRules: { steps: 1 },
    } as never,
    p_contact_beneficiary_ids: contactIds,
    p_release_scope: scopeOf(assetId) as never,
  });
  if (error) throw error;
  return data as string;
}

describe.skipIf(!available)("dead man switch", () => {
  it("configures, refuses bad input and records the schedule", async () => {
    const contact = await beneficiary("dms-contact@example.com");
    const savings = await asset(alice, "Savings");
    const switchId = await configureSwitch([contact], savings);

    const { data: row } = await alice
      .from("dead_man_switches")
      .select("status, check_in_frequency_days, next_check_in_at")
      .eq("id", switchId)
      .single();
    expect(row?.status).toBe("ACTIVE");
    expect(row?.check_in_frequency_days).toBe(7);
    expect(Date.parse(row!.next_check_in_at!)).toBeGreaterThan(Date.now());

    const { data: contacts } = await alice
      .from("dead_man_switch_contacts")
      .select("beneficiary_id")
      .eq("dead_man_switch_id", switchId);
    expect(contacts?.map((c) => c.beneficiary_id)).toEqual([contact]);

    const { error: noContacts } = await alice.rpc("dms_configure", {
      p_config: { inactivityPeriodDays: 30, checkInFrequencyDays: 7 } as never,
      p_contact_beneficiary_ids: [],
      p_release_scope: scopeOf(savings) as never,
    });
    expect(noContacts?.message).toContain("CONTACTS_REQUIRED");

    const { error: badRange } = await alice.rpc("dms_configure", {
      p_config: { inactivityPeriodDays: 3, checkInFrequencyDays: 7 } as never,
      p_contact_beneficiary_ids: [contact],
      p_release_scope: scopeOf(savings) as never,
    });
    expect(badRange?.code).toBe("LV422");
  });

  it("refuses a contact who is not an eligible beneficiary of the caller", async () => {
    const savings = await asset(alice, "Savings");
    const { data: foreign } = await bob
      .from("beneficiaries")
      .insert({
        user_id: bobId,
        name: "Bob's person",
        relationship: "Friend",
        email: "bp@example.com",
      })
      .select("id")
      .single();

    const { error } = await alice.rpc("dms_configure", {
      p_config: { inactivityPeriodDays: 30, checkInFrequencyDays: 7 } as never,
      p_contact_beneficiary_ids: [foreign!.id],
      p_release_scope: scopeOf(savings) as never,
    });
    expect(error?.message).toContain("CONTACT_NOT_ELIGIBLE");
  });

  it("refuses a release scope containing someone else's asset", async () => {
    const contact = await beneficiary("dms-scope@example.com");
    const bobsAsset = await asset(bob, "Bob's account");

    const { error } = await alice.rpc("dms_configure", {
      p_config: { inactivityPeriodDays: 30, checkInFrequencyDays: 7 } as never,
      p_contact_beneficiary_ids: [contact],
      p_release_scope: scopeOf(bobsAsset) as never,
    });
    expect(error?.code).toBe("42501");
  });

  it("checks in, pauses and resumes", async () => {
    const contact = await beneficiary("dms-cycle@example.com");
    const switchId = await configureSwitch([contact], await asset(alice, "Savings"));

    expect((await alice.rpc("dms_check_in", {})).error).toBeNull();
    expect((await alice.rpc("dms_pause", {})).error).toBeNull();

    const { data: paused } = await alice
      .from("dead_man_switches")
      .select("status")
      .eq("id", switchId)
      .single();
    expect(paused?.status).toBe("PAUSED");

    // A paused switch has no running deadline, so checking in is not a legal move.
    expect((await alice.rpc("dms_check_in", {})).error?.code).toBe("LV409");

    expect((await alice.rpc("dms_resume", {})).error).toBeNull();
    const { data: resumed } = await alice
      .from("dead_man_switches")
      .select("status, current_escalation_step")
      .eq("id", switchId)
      .single();
    expect(resumed?.status).toBe("ACTIVE");
    expect(resumed?.current_escalation_step).toBe(0);
  });

  it("refuses an illegal transition, and the owner cannot drive transitions at all", async () => {
    const contact = await beneficiary("dms-illegal@example.com");
    const switchId = await configureSwitch([contact], await asset(alice, "Savings"));

    // ACTIVE cannot jump straight to RELEASED.
    const { error: illegal } = await service.rpc("dms_transition", {
      p_switch_id: switchId,
      p_from: "ACTIVE",
      p_to: "RELEASED",
      p_event_type: "RELEASE",
    });
    expect(illegal?.code).toBe("LV409");

    const { error: denied } = await alice.rpc("dms_transition", {
      p_switch_id: switchId,
      p_from: "ACTIVE",
      p_to: "REMINDER_SENT",
      p_event_type: "MISSED_CHECK_IN",
    });
    expect(denied).not.toBeNull();
  });

  it("advances a due switch through the scan and queues delivery on release", async () => {
    const contact = await beneficiary("dms-release@example.com");
    const switchId = await configureSwitch([contact], await asset(alice, "Savings"));

    // Make the schedule overdue so the scan has work to do.
    const past = new Date(Date.now() - 400 * 24 * 3_600_000).toISOString();
    await service
      .from("dead_man_switches")
      .update({ last_check_in_at: past, next_check_in_at: past })
      .eq("id", switchId);

    const statuses: string[] = [];
    for (let tick = 0; tick < 8; tick += 1) {
      await runDmsScan(service, new Date());
      const { data } = await service
        .from("dead_man_switches")
        .select("status")
        .eq("id", switchId)
        .single();
      statuses.push(data!.status);
      if (data!.status === "RELEASED") break;
      // Each transition schedules the next action; bring it forward for the next tick.
      await service
        .from("dead_man_switches")
        .update({ next_check_in_at: new Date(Date.now() - 1000).toISOString() })
        .eq("id", switchId);
    }

    expect(statuses).toEqual([
      "REMINDER_SENT",
      "GRACE_PERIOD",
      "ESCALATING",
      "RELEASING",
      "RELEASED",
    ]);

    // Release enqueues one delivery job per eligible contact, and mints nothing:
    // the token is created inside the job (ADR-014 § 6).
    const { data: deliveries } = await service
      .from("jobs")
      .select("type, payload")
      .eq("type", "access.deliver");
    expect(deliveries).toHaveLength(1);
    const payload = deliveries![0].payload as Record<string, unknown>;
    expect(payload.beneficiaryId).toBe(contact);
    expect(payload.grantType).toBe("DMS_RELEASE");

    const { data: tokens } = await service
      .from("access_tokens")
      .select("id")
      .eq("owner_user_id", aliceId);
    expect(tokens ?? []).toHaveLength(0);

    // The owner was told, through the queue rather than an inline email.
    const { data: notifications } = await service
      .from("notifications")
      .select("type")
      .eq("user_id", aliceId);
    expect(notifications?.map((n) => n.type)).toContain("dms.released");

    // Recovery is possible even after release.
    expect((await alice.rpc("dms_cancel_escalation", {})).error).toBeNull();
    const { data: recovered } = await service
      .from("dead_man_switches")
      .select("status, current_escalation_step")
      .eq("id", switchId)
      .single();
    expect(recovered?.status).toBe("ACTIVE");
    expect(recovered?.current_escalation_step).toBe(0);
  }, 60_000);
});

describe.skipIf(!available)("access links", () => {
  async function assignedAsset(beneficiaryId: string, name: string): Promise<string> {
    const id = await asset(alice, name);
    const { error } = await alice.rpc("assign_beneficiary", {
      p_beneficiary_id: beneficiaryId,
      p_resource_type: "FINANCIAL_ASSET",
      p_resource_id: id,
    });
    if (error) throw error;
    return id;
  }

  it("stores a hash, never the secret, and refuses a malformed one", async () => {
    const contact = await beneficiary("link@example.com");
    const assetId = await assignedAsset(contact, "Shared savings");

    const minted = mintAccessToken();
    const expiresAt = new Date(Date.now() + 7 * 24 * 3_600_000).toISOString();
    const { data: tokenId, error } = await alice.rpc("issue_access_token", {
      p_beneficiary_id: contact,
      p_scope: scopeOf(assetId) as never,
      p_token_hash: minted.hash,
      p_expires_at: expiresAt,
    });
    expect(error).toBeNull();

    const { data: stored } = await service
      .from("access_tokens")
      .select("token_hash, grant_type")
      .eq("id", tokenId as string)
      .single();
    expect(stored?.token_hash).toBe(hashAccessToken(minted.plaintext));
    expect(stored?.token_hash).not.toContain(minted.plaintext);
    expect(stored?.grant_type).toBe("DIRECT_SHARE");

    // The owner's own client cannot read the hash column at all.
    const { error: hashDenied } = await alice.from("access_tokens").select("token_hash");
    expect(hashDenied).not.toBeNull();

    const { error: badHash } = await alice.rpc("issue_access_token", {
      p_beneficiary_id: contact,
      p_scope: scopeOf(assetId) as never,
      p_token_hash: "not-a-sha256",
      p_expires_at: expiresAt,
    });
    expect(badHash?.message).toContain("INVALID_TOKEN_HASH");
  });

  it("refuses a scope the beneficiary is not assigned, and an expiry beyond 30 days", async () => {
    const contact = await beneficiary("scope@example.com");
    const unassigned = await asset(alice, "Unassigned");

    const { error: notAssigned } = await alice.rpc("issue_access_token", {
      p_beneficiary_id: contact,
      p_scope: scopeOf(unassigned) as never,
      p_token_hash: mintAccessToken().hash,
      p_expires_at: new Date(Date.now() + 86_400_000).toISOString(),
    });
    expect(notAssigned?.message).toContain("SCOPE_NOT_ASSIGNED");

    const assigned = await assignedAsset(contact, "Assigned");
    const { error: tooLong } = await alice.rpc("issue_access_token", {
      p_beneficiary_id: contact,
      p_scope: scopeOf(assigned) as never,
      p_token_hash: mintAccessToken().hash,
      p_expires_at: new Date(Date.now() + 40 * 24 * 3_600_000).toISOString(),
    });
    expect(tooLong?.message).toContain("INVALID_EXPIRY");
  });

  it("resends as a replacement and revokes, and refuses another owner's token", async () => {
    const contact = await beneficiary("revoke@example.com");
    const assetId = await assignedAsset(contact, "Shared savings");
    const expiresAt = new Date(Date.now() + 86_400_000).toISOString();

    const { data: tokenId } = await alice.rpc("issue_access_token", {
      p_beneficiary_id: contact,
      p_scope: scopeOf(assetId) as never,
      p_token_hash: mintAccessToken().hash,
      p_expires_at: expiresAt,
    });

    // A resend revokes the old link and mints exactly one replacement.
    const replacement = mintAccessToken();
    const { data: newId, error: resendError } = await alice.rpc("resend_access_token", {
      p_token_id: tokenId as string,
      p_token_hash: replacement.hash,
      p_expires_at: expiresAt,
    });
    expect(resendError).toBeNull();

    const { data: previous } = await service
      .from("access_tokens")
      .select("revoked_reason")
      .eq("id", tokenId as string)
      .single();
    expect(previous?.revoked_reason).toBe("RESENT");

    const { data: current } = await service
      .from("access_tokens")
      .select("replaces_token_id, revoked_at")
      .eq("id", newId as string)
      .single();
    expect(current?.replaces_token_id).toBe(tokenId);
    expect(current?.revoked_at).toBeNull();

    expect(
      (await bob.rpc("revoke_access_token", { p_token_id: newId as string })).error?.code,
    ).toBe("42501");

    expect(
      (await alice.rpc("revoke_access_token", { p_token_id: newId as string })).error,
    ).toBeNull();
    const { data: revoked } = await service
      .from("access_tokens")
      .select("revoked_at, revoked_reason")
      .eq("id", newId as string)
      .single();
    expect(revoked?.revoked_at).not.toBeNull();
    expect(revoked?.revoked_reason).toBe("OWNER");
  });

  it("refuses an inactive beneficiary", async () => {
    const contact = await beneficiary("inactive-link@example.com");
    const assetId = await assignedAsset(contact, "Shared savings");
    await alice.rpc("set_beneficiary_status", { p_beneficiary_id: contact, p_status: "INACTIVE" });

    const { error } = await alice.rpc("issue_access_token", {
      p_beneficiary_id: contact,
      p_scope: scopeOf(assetId) as never,
      p_token_hash: mintAccessToken().hash,
      p_expires_at: new Date(Date.now() + 86_400_000).toISOString(),
    });
    expect(error?.message).toContain("BENEFICIARY_INACTIVE");
  });
});

describe.skipIf(!available)("emergency access", () => {
  async function configure(email: string): Promise<{ configId: string; contact: string }> {
    const contact = await beneficiary(email);
    const assetId = await asset(alice, "Emergency savings");
    const { data, error } = await alice.rpc("ea_configure_contact", {
      p_beneficiary_id: contact,
      p_access_scope: scopeOf(assetId) as never,
      p_on_timeout: "WAIT",
    });
    if (error) throw error;
    return { configId: data as string, contact };
  }

  it("configures a contact and refuses a duplicate", async () => {
    const { configId, contact } = await configure("ea@example.com");
    expect(configId).toBeTruthy();

    const { error: duplicate } = await alice.rpc("ea_configure_contact", {
      p_beneficiary_id: contact,
      p_access_scope: scopeOf(await asset(alice, "Another")) as never,
      p_on_timeout: "WAIT",
    });
    expect(duplicate?.code).toBe("LV409");
    expect(duplicate?.message).toContain("CONTACT_ALREADY_CONFIGURED");
  });

  it("requires a verified code and an owner decision before access is granted", async () => {
    const { configId } = await configure("ea-flow@example.com");

    // The public request path is service-role only.
    expect(
      (
        await alice.rpc("ea_request_access", {
          p_config_id: configId,
          p_requester_email: "ea-flow@example.com",
          p_otp_hash: hashAccessToken("123456"),
        })
      ).error,
    ).not.toBeNull();

    // A requester who is not the designated beneficiary gets nothing back.
    const { data: wrongEmail } = await service.rpc("ea_request_access", {
      p_config_id: configId,
      p_requester_email: "someone-else@example.com",
      p_otp_hash: hashAccessToken("123456"),
    });
    expect(wrongEmail).toBeNull();

    const { data: requestId, error: requestError } = await service.rpc("ea_request_access", {
      p_config_id: configId,
      p_requester_email: "ea-flow@example.com",
      p_otp_hash: hashAccessToken("123456"),
    });
    expect(requestError).toBeNull();
    expect(requestId).toBeTruthy();

    // Deciding before verification is refused.
    const { error: tooEarly } = await alice.rpc("ea_decide_request", {
      p_request_id: requestId as string,
      p_decision: "APPROVE",
    });
    expect(tooEarly?.code).toBe("LV409");

    // A wrong code does not verify.
    const wrong = await service.rpc("ea_verify_otp", {
      p_request_id: requestId as string,
      p_otp_hash: hashAccessToken("999999"),
    });
    expect(wrong.data).toBe("VERIFYING");

    const right = await service.rpc("ea_verify_otp", {
      p_request_id: requestId as string,
      p_otp_hash: hashAccessToken("123456"),
    });
    expect(right.data).toBe("VERIFIED");

    // Another owner still cannot decide it.
    expect(
      (
        await bob.rpc("ea_decide_request", {
          p_request_id: requestId as string,
          p_decision: "APPROVE",
        })
      ).error?.code,
    ).toBe("42501");

    expect(
      (
        await alice.rpc("ea_decide_request", {
          p_request_id: requestId as string,
          p_decision: "APPROVE",
        })
      ).error,
    ).toBeNull();

    // Approval queues delivery rather than minting a link inline.
    const { data: jobs } = await service
      .from("jobs")
      .select("payload")
      .eq("type", "access.deliver");
    expect(jobs).toHaveLength(1);
    const payload = jobs![0].payload as Record<string, unknown>;
    expect(payload.requestId).toBe(requestId);
    expect(payload.grantType).toBe("EMERGENCY_ACCESS");
  });

  it("fails the request after three wrong codes", async () => {
    const { configId } = await configure("ea-otp@example.com");
    const { data: requestId } = await service.rpc("ea_request_access", {
      p_config_id: configId,
      p_requester_email: "ea-otp@example.com",
      p_otp_hash: hashAccessToken("123456"),
    });

    const results: unknown[] = [];
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const { data } = await service.rpc("ea_verify_otp", {
        p_request_id: requestId as string,
        p_otp_hash: hashAccessToken(`bad-${attempt}`),
      });
      results.push(data);
    }
    expect(results).toEqual(["VERIFYING", "VERIFYING", "FAILED"]);

    // The right code no longer helps once the request has failed.
    const { data: afterFailure } = await service.rpc("ea_verify_otp", {
      p_request_id: requestId as string,
      p_otp_hash: hashAccessToken("123456"),
    });
    expect(afterFailure).toBe("FAILED");
  });

  it("never exposes the OTP hash to the owner", async () => {
    const { error } = await alice.from("emergency_access_requests").select("otp_hash");
    expect(error).not.toBeNull();
  });
});

describe.skipIf(!available)("job queue", () => {
  it("deduplicates on the idempotency key and claims exclusively", async () => {
    const key = `dms.scan:test-${Date.now()}`;
    const first = await jobRepository.enqueue(service, "dms.scan", { hour: "test" }, key);
    const second = await jobRepository.enqueue(service, "dms.scan", { hour: "test" }, key);
    expect(first).toBeTruthy();
    // The same work queued twice is the same row, not two.
    expect(second).toBeNull();

    const claimed = await jobRepository.claim(service, "runner-a", 10);
    const mine = claimed.find((job) => job.id === first);
    expect(mine?.attempts).toBe(1);
    expect(mine?.locked_by).toBe("runner-a");

    // A second runner cannot take the same job.
    const again = await jobRepository.claim(service, "runner-b", 10);
    expect(again.some((job) => job.id === first)).toBe(false);

    await jobRepository.markSucceeded(service, first!);
    const { data: done } = await service
      .from("jobs")
      .select("status, finished_at")
      .eq("id", first!)
      .single();
    expect(done?.status).toBe("SUCCEEDED");
    expect(done?.finished_at).not.toBeNull();
  });

  it("retries with back-off and eventually gives up visibly", async () => {
    const key = `notification.deliver:test-${Date.now()}`;
    const id = await jobRepository.enqueue(service, "notification.deliver", {}, key);
    const claimed = await jobRepository.claim(service, "runner-c", 10);
    const job = claimed.find((row) => row.id === id)!;
    expect(job).toBeDefined();

    await jobRepository.markFailed(service, job, "provider unavailable");
    const { data: retried } = await service
      .from("jobs")
      .select("status, last_error, run_at, locked_by")
      .eq("id", id!)
      .single();
    expect(retried?.status).toBe("QUEUED");
    expect(retried?.last_error).toBe("provider unavailable");
    expect(retried?.locked_by).toBeNull();
    expect(Date.parse(retried!.run_at)).toBeGreaterThan(Date.now());

    await jobRepository.markFailed(
      service,
      { ...job, attempts: job.max_attempts },
      "still unavailable",
    );
    const { data: dead } = await service
      .from("jobs")
      .select("status, finished_at")
      .eq("id", id!)
      .single();
    expect(dead?.status).toBe("DEAD");
    expect(dead?.finished_at).not.toBeNull();
  });

  it("is unreachable from an authenticated client", async () => {
    expect((await alice.from("jobs").select("id")).error).not.toBeNull();
    expect((await alice.rpc("claim_jobs", { p_limit: 1 })).error).not.toBeNull();
  });
});
