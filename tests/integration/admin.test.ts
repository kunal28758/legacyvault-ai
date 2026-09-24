import { beforeAll, beforeEach, describe, expect, it } from "vitest";

import type { AppUser } from "@/lib/auth/ensure-app-user";
import type { TypedSupabaseClient } from "@/lib/db/server";
import * as adminService from "@/lib/services/admin.service";
import { mintAccessToken } from "@/lib/security/access-token";

import {
  createServiceScopedClient,
  createUserScopedClient,
  isLocalStackAvailable,
} from "../helpers/db";

/**
 * The operator surface against the real database (FR-P002–P012).
 *
 * Two things are being pinned down. The first is that an operator sees **how
 * much** an account holds and never **what** it holds. The second is that the
 * dangerous action — changing who else is an operator — refuses the two moves
 * that would lock the platform out or let someone promote themselves.
 */
const ADMIN_SUBJECT = "user_admin_root";
const MEMBER_SUBJECT = "user_admin_member";

const available = await isLocalStackAvailable();
let service: TypedSupabaseClient;
let admin: AppUser;
let memberId: string;
let member: TypedSupabaseClient;

if (!available) {
  console.warn(
    "[admin] local Supabase stack unreachable — start it with `pnpm db:start`. Assertions are SKIPPED, not passed.",
  );
}

function asAppUser(row: {
  id: string;
  clerk_user_id: string;
  email: string;
  name: string;
}): AppUser {
  return {
    id: row.id,
    clerkUserId: row.clerk_user_id,
    email: row.email,
    emailVerified: true,
    name: row.name,
    mfaEnabled: false,
    role: "SUPER_ADMIN",
    onboardingCompletedAt: new Date().toISOString(),
    deletionRequestedAt: null,
  };
}

beforeAll(async () => {
  if (!available) return;

  service = createServiceScopedClient() as unknown as TypedSupabaseClient;
  await service.from("users").delete().in("clerk_user_id", [ADMIN_SUBJECT, MEMBER_SUBJECT]);
  const { data, error } = await service
    .from("users")
    .insert([
      {
        clerk_user_id: ADMIN_SUBJECT,
        email: "root.admin@example.com",
        name: "Root Operator",
        role: "SUPER_ADMIN",
      },
      // Both rows spell out `role`: a bulk insert sends one column set, so a
      // key missing from the second row arrives as NULL rather than a default.
      {
        clerk_user_id: MEMBER_SUBJECT,
        email: "member.admin@example.com",
        name: "A Member",
        role: "USER",
      },
    ])
    .select("id, clerk_user_id, email, name");
  if (error) throw error;

  admin = asAppUser(data.find((row) => row.clerk_user_id === ADMIN_SUBJECT)!);
  memberId = data.find((row) => row.clerk_user_id === MEMBER_SUBJECT)!.id;
  member = (await createUserScopedClient(MEMBER_SUBJECT)) as unknown as TypedSupabaseClient;
}, 60_000);

beforeEach(async () => {
  if (!available) return;
  await service.from("access_tokens").delete().in("owner_user_id", [admin.id, memberId]);
  await service.from("financial_assets").delete().in("user_id", [admin.id, memberId]);
  await service.from("beneficiaries").delete().in("user_id", [admin.id, memberId]);
  await service.from("users").update({ role: "USER" }).eq("id", memberId);
});

describe.skipIf(!available)("admin — accounts", () => {
  it("lists and searches accounts, and records the search", async () => {
    const all = await adminService.listUsers(admin, { page: 1, limit: 50 });
    expect(all.items.some((row) => row.id === memberId)).toBe(true);

    const found = await adminService.listUsers(admin, {
      q: "member.admin",
      page: 1,
      limit: 25,
    });
    expect(found.items.map((row) => row.email)).toEqual(["member.admin@example.com"]);

    const { data: trail } = await service
      .from("audit_log")
      .select("action, actor_id, metadata")
      .eq("actor_id", admin.id)
      .eq("action", "admin.users_listed")
      .order("created_at", { ascending: false })
      .limit(1);
    expect(trail?.[0]?.metadata).toMatchObject({ search: "member.admin" });
  });

  it("shows how much an account holds and never what it holds", async () => {
    // Real content for the member, including an encrypted field.
    const { encrypt } = await import("@/lib/security/encryption");
    const { data: assetId } = await member.rpc("create_asset", {
      p_resource_type: "FINANCIAL_ASSET",
      p_plain: { name: "Very Secret Account Name", category: "BANK_ACCOUNT" } as never,
    });
    await member.rpc("set_encrypted_fields", {
      p_resource_type: "FINANCIAL_ASSET",
      p_resource_id: assetId as string,
      p_fields: { accountNumber: encrypt("9876543210987654") } as never,
    });
    await member
      .from("beneficiaries")
      .insert({
        user_id: memberId,
        name: "Their Person",
        relationship: "Sibling",
        email: "their.person@example.com",
      })
      .select("id")
      .single();

    const detail = await adminService.getUser(admin, memberId);
    expect(detail.counts.assets).toBe(1);
    expect(detail.counts.beneficiaries).toBe(1);

    // The Class A triggers record changed values so an owner can read their own
    // history. None of those values may reach an operator — only the shape.
    const serialized = JSON.stringify(detail);
    expect(serialized).not.toContain("Very Secret Account Name");
    expect(serialized).not.toContain("9876543210987654");
    expect(serialized).not.toContain("Their Person");
    expect(serialized).not.toContain("their.person@example.com");
    expect(serialized).not.toContain('"new"');
    expect(serialized).not.toContain('"previous"');

    // What remains is useful and safe: which fields changed, and that the
    // redaction happened at all.
    const encryptedEvent = detail.recentActivity.find(
      (row) => row.action === "asset.encrypted_fields_updated",
    );
    expect(encryptedEvent?.metadata).toMatchObject({ changed: ["accountNumber"] });
    expect(encryptedEvent?.metadata.redactedKeys).toBeGreaterThan(0);
  });

  it("refuses to change your own role, or to remove the last operator", async () => {
    await expect(adminService.setRole(admin, admin.id, "USER", "test")).rejects.toMatchObject({
      status: 422,
    });

    // Promote, then demote — allowed, because another operator remains.
    await adminService.setRole(admin, memberId, "SUPER_ADMIN", "test");
    const { data: promoted } = await service
      .from("users")
      .select("role")
      .eq("id", memberId)
      .single();
    expect(promoted?.role).toBe("SUPER_ADMIN");

    await adminService.setRole(admin, memberId, "USER", "test");
    const { data: demoted } = await service
      .from("users")
      .select("role")
      .eq("id", memberId)
      .single();
    expect(demoted?.role).toBe("USER");

    const { data: trail } = await service
      .from("audit_log")
      .select("action, metadata")
      .eq("actor_id", admin.id)
      .eq("action", "admin.role_changed")
      .order("created_at", { ascending: false })
      .limit(2);
    expect(trail).toHaveLength(2);
    expect(trail?.[0]?.metadata).toMatchObject({ from: "SUPER_ADMIN", to: "USER" });

    // And the affected person was told.
    const { data: notifications } = await service
      .from("notifications")
      .select("type")
      .eq("user_id", memberId)
      .eq("type", "admin.role_changed");
    expect((notifications ?? []).length).toBeGreaterThan(0);
  });

  it("is not reachable by a member's own database client", async () => {
    // The role guard lives in the API, but the columns behind it are refused
    // by the database as well: a member cannot read another account's row.
    const { data } = await member.from("users").select("id").eq("id", admin.id);
    expect(data ?? []).toHaveLength(0);

    // Nor can they promote themselves.
    const { error } = await member.from("users").update({ role: "SUPER_ADMIN" }).eq("id", memberId);
    expect(error).not.toBeNull();
  });
});

describe.skipIf(!available)("admin — platform views", () => {
  it("reports analytics without touching vault contents", async () => {
    const analytics = await adminService.analytics(admin, 30);
    expect(analytics.users.total).toBeGreaterThan(0);
    expect(analytics.registrations.length).toBe(30);
    expect(analytics.storage.documents.bytes).toBeGreaterThanOrEqual(0);
    expect(analytics.jobs.queued).toBeGreaterThanOrEqual(0);
  });

  it("filters the platform audit trail by action prefix", async () => {
    await adminService.listUsers(admin, { page: 1, limit: 5 });
    const audit = await adminService.listAudit(admin, { action: "admin.", page: 1, limit: 20 });
    expect(audit.items.length).toBeGreaterThan(0);
    expect(audit.items.every((row) => row.action.startsWith("admin."))).toBe(true);
  });

  it("lists what needs attention and refuses to resend a direct share", async () => {
    const { data: beneficiary } = await member
      .from("beneficiaries")
      .insert({
        user_id: memberId,
        name: "Link Holder",
        relationship: "Friend",
        email: `admin-resend-${Date.now()}@example.com`,
      })
      .select("id")
      .single();
    const { data: assetId } = await member.rpc("create_asset", {
      p_resource_type: "FINANCIAL_ASSET",
      p_plain: { name: "Shared", category: "BANK_ACCOUNT" } as never,
    });
    await member.rpc("assign_beneficiary", {
      p_beneficiary_id: beneficiary!.id,
      p_resource_type: "FINANCIAL_ASSET",
      p_resource_id: assetId as string,
    });
    const { data: tokenId } = await member.rpc("issue_access_token", {
      p_beneficiary_id: beneficiary!.id,
      p_scope: {
        documents: [],
        assets: [{ type: "FINANCIAL_ASSET", id: assetId as string }],
        videos: [],
        planSections: [],
      } as never,
      p_token_hash: mintAccessToken().hash,
      p_expires_at: new Date(Date.now() + 86_400_000).toISOString(),
    });

    const operations = await adminService.operations(admin);
    // A direct share is the owner's to resend, so it is not on the operator's list.
    expect(operations.undeliveredTokens.some((token) => token.id === tokenId)).toBe(false);

    await expect(
      adminService.resendAccessToken(admin, tokenId as string, "test"),
    ).rejects.toMatchObject({ status: 422 });
  });
});
