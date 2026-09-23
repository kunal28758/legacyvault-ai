import { beforeAll, beforeEach, describe, expect, it } from "vitest";

import type { TypedSupabaseClient } from "@/lib/db/server";
import { mintAccessToken } from "@/lib/security/access-token";
import * as portal from "@/lib/services/access-portal.service";

import {
  createServiceScopedClient,
  createUserScopedClient,
  isLocalStackAvailable,
} from "../helpers/db";

/**
 * The beneficiary side of an access link, against the real database.
 *
 * This is the one surface where a stranger holds a credential, so the
 * assertions are about what it cannot do: nothing outside the scope, nothing
 * encrypted, nothing after revocation, and nothing belonging to another owner.
 */
const SECRET = "1234567890123456";
const SUBJECT_A = "user_portal_alice";
const SUBJECT_B = "user_portal_bob";

const available = await isLocalStackAvailable();
let aliceId: string;
let bobId: string;
let alice: TypedSupabaseClient;
let service: TypedSupabaseClient;

if (!available) {
  console.warn(
    "[access-portal] local Supabase stack unreachable — start it with `pnpm db:start`. Assertions are SKIPPED, not passed.",
  );
}

beforeAll(async () => {
  if (!available) return;
  process.env.ACCESS_COOKIE_KEY ??= Buffer.from(new Uint8Array(32).fill(3)).toString("base64");

  service = createServiceScopedClient() as unknown as TypedSupabaseClient;
  await service.from("users").delete().in("clerk_user_id", [SUBJECT_A, SUBJECT_B]);
  const { data, error } = await service
    .from("users")
    .insert([
      { clerk_user_id: SUBJECT_A, email: "alice.portal@example.com", name: "Alice Owner" },
      { clerk_user_id: SUBJECT_B, email: "bob.portal@example.com", name: "Bob" },
    ])
    .select("id, clerk_user_id");
  if (error) throw error;

  aliceId = data.find((row) => row.clerk_user_id === SUBJECT_A)!.id;
  bobId = data.find((row) => row.clerk_user_id === SUBJECT_B)!.id;
  alice = (await createUserScopedClient(SUBJECT_A)) as unknown as TypedSupabaseClient;
}, 60_000);

beforeEach(async () => {
  if (!available) return;
  await service.from("access_tokens").delete().in("owner_user_id", [aliceId, bobId]);
  await service.from("beneficiaries").delete().in("user_id", [aliceId, bobId]);
  await service.from("financial_assets").delete().in("user_id", [aliceId, bobId]);
  await service.from("digital_assets").delete().in("user_id", [aliceId, bobId]);
});

/** An asset assigned to a new beneficiary, plus a live link covering it. */
async function shareOne(options: { status?: "PENDING" | "ACTIVE" } = {}) {
  // `status` is not in the insert allow-list — it moves through the guarded
  // function, exactly as the application does it.
  const { data: beneficiary, error: beneficiaryError } = await alice
    .from("beneficiaries")
    .insert({
      user_id: aliceId,
      name: "Trusted Person",
      relationship: "Sibling",
      email: `portal-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`,
    })
    .select("id")
    .single();
  if (beneficiaryError) throw beneficiaryError;
  if (options.status === "ACTIVE") {
    const { error } = await alice.rpc("set_beneficiary_status", {
      p_beneficiary_id: beneficiary.id,
      p_status: "ACTIVE",
    });
    if (error) throw error;
  }

  const { data: assetId } = await alice.rpc("create_asset", {
    p_resource_type: "FINANCIAL_ASSET",
    p_plain: { name: "Joint savings", category: "BANK_ACCOUNT", currency: "INR" } as never,
  });
  const { data: secretId } = await alice.rpc("create_asset", {
    p_resource_type: "FINANCIAL_ASSET",
    p_plain: { name: "Private account", category: "BANK_ACCOUNT", currency: "INR" } as never,
  });

  await alice.rpc("assign_beneficiary", {
    p_beneficiary_id: beneficiary.id,
    p_resource_type: "FINANCIAL_ASSET",
    p_resource_id: assetId as string,
  });

  const minted = mintAccessToken();
  const { data: tokenId, error } = await alice.rpc("issue_access_token", {
    p_beneficiary_id: beneficiary.id,
    p_scope: {
      documents: [],
      assets: [{ type: "FINANCIAL_ASSET", id: assetId as string }],
      videos: [],
      planSections: [],
    } as never,
    p_token_hash: minted.hash,
    p_expires_at: new Date(Date.now() + 7 * 86_400_000).toISOString(),
  });
  if (error) throw error;

  return {
    beneficiaryId: beneficiary.id,
    assetId: assetId as string,
    unsharedAssetId: secretId as string,
    tokenId: tokenId as string,
    plaintext: minted.plaintext,
  };
}

describe.skipIf(!available)("access portal", () => {
  it("exchanges a link, names the owner and activates a pending beneficiary", async () => {
    const share = await shareOne();

    const result = await portal.exchange(share.plaintext, "test-exchange");
    expect(result.grant.ownerName).toBe("Alice Owner");
    expect(result.grant.grantType).toBe("DIRECT_SHARE");
    expect(result.grant.counts.assets).toBe(1);
    expect(result.cookie.value.split(".")).toHaveLength(3);
    // The cookie never outlives the token.
    expect(result.cookie.maxAge).toBeLessThanOrEqual(30 * 60);

    const { data: beneficiary } = await service
      .from("beneficiaries")
      .select("status, activated_at")
      .eq("id", share.beneficiaryId)
      .single();
    expect(beneficiary?.status).toBe("ACTIVE");
    expect(beneficiary?.activated_at).not.toBeNull();

    const { data: token } = await service
      .from("access_tokens")
      .select("used_at, last_used_at")
      .eq("id", share.tokenId)
      .single();
    expect(token?.used_at).not.toBeNull();
    expect(token?.last_used_at).not.toBeNull();
  });

  it("refuses an unknown, revoked or expired secret", async () => {
    const share = await shareOne();

    await expect(portal.exchange("not-a-real-token", "test")).rejects.toMatchObject({
      status: 401,
    });

    await alice.rpc("revoke_access_token", { p_token_id: share.tokenId });
    await expect(portal.exchange(share.plaintext, "test")).rejects.toMatchObject({ status: 401 });

    const fresh = await shareOne();
    await service
      .from("access_tokens")
      .update({ expires_at: new Date(Date.now() - 1000).toISOString() })
      .eq("id", fresh.tokenId);
    await expect(portal.exchange(fresh.plaintext, "test")).rejects.toMatchObject({ status: 401 });
  });

  it("ends the session the moment the link is revoked", async () => {
    const share = await shareOne();
    await portal.exchange(share.plaintext, "test");
    await expect(portal.requireGrant(share.tokenId)).resolves.toMatchObject({
      tokenId: share.tokenId,
    });

    await alice.rpc("revoke_access_token", { p_token_id: share.tokenId });
    await expect(portal.requireGrant(share.tokenId)).rejects.toMatchObject({ status: 401 });
  });

  it("ends the session when the beneficiary is deactivated", async () => {
    const share = await shareOne({ status: "ACTIVE" });
    await portal.exchange(share.plaintext, "test");

    await alice.rpc("set_beneficiary_status", {
      p_beneficiary_id: share.beneficiaryId,
      p_status: "INACTIVE",
    });
    await expect(portal.requireGrant(share.tokenId)).rejects.toMatchObject({ status: 401 });
  });

  it("shows only what the scope names, and never an encrypted field", async () => {
    const share = await shareOne();
    // Give the shared asset a secret; it must not appear in any response.
    const { encrypt } = await import("@/lib/security/encryption");
    const { error: encryptError } = await alice.rpc("set_encrypted_fields", {
      p_resource_type: "FINANCIAL_ASSET",
      p_resource_id: share.assetId,
      p_fields: { accountNumber: encrypt(SECRET) } as never,
    });
    expect(encryptError).toBeNull();

    await portal.exchange(share.plaintext, "test");
    const grant = await portal.requireGrant(share.tokenId);

    const resources = await portal.listResources(grant, "test");
    expect(JSON.stringify(resources)).not.toContain(SECRET);
    expect(resources.assets).toHaveLength(1);
    expect(resources.assets[0].id).toBe(share.assetId);
    expect(resources.documents).toHaveLength(0);

    const view = await portal.assetView(grant, "FINANCIAL_ASSET", share.assetId, "test");
    expect(view.name).toBe("Joint savings");
    expect(JSON.stringify(view)).not.toContain(SECRET);
    expect(JSON.stringify(view)).not.toContain("accountNumber");

    // An asset the owner has, but this link does not name.
    await expect(
      portal.assetView(grant, "FINANCIAL_ASSET", share.unsharedAssetId, "test"),
    ).rejects.toMatchObject({ status: 404 });

    // A document id that is not in the scope at all.
    await expect(
      portal.documentDetail(grant, "22222222-2222-4222-8222-222222222222", "test"),
    ).rejects.toMatchObject({ status: 404 });
  });

  it("audits every access with the beneficiary as the actor", async () => {
    const share = await shareOne();
    // The audit log is append-only, so a run must not read a previous run's rows.
    const correlationId = `audit-test-${crypto.randomUUID()}`;
    await portal.exchange(share.plaintext, correlationId);
    const grant = await portal.requireGrant(share.tokenId);
    await portal.assetView(grant, "FINANCIAL_ASSET", share.assetId, correlationId);

    const { data: rows } = await service
      .from("audit_log")
      .select("action, actor_id, outcome")
      .eq("correlation_id", correlationId);
    const actions = (rows ?? []).map((row) => row.action);
    expect(actions).toContain("access.exchanged");
    expect(actions).toContain("access.asset_viewed");
    for (const row of rows ?? []) {
      expect(row.actor_id).toBe(share.beneficiaryId);
      expect(row.outcome).toBe("SUCCESS");
    }
  });
});
