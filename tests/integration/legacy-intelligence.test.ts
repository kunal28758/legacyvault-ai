import { beforeAll, beforeEach, describe, expect, it } from "vitest";

import type { TypedSupabaseClient } from "@/lib/db/server";
import * as assetRepository from "@/lib/repositories/asset.repository";
import * as documentRepository from "@/lib/repositories/document.repository";
import { mintAccessToken } from "@/lib/security/access-token";
import * as portal from "@/lib/services/access-portal.service";
import { mergeAssetProfile } from "@/lib/validators/asset-profile";

import {
  createServiceScopedClient,
  createUserScopedClient,
  isLocalStackAvailable,
} from "../helpers/db";

/**
 * Milestone 3 boundaries against the real database: the asset profile lives in
 * owner-only metadata, supporting-document links and the per-record activity
 * filter stay owner-scoped under RLS, and a beneficiary's portal view never
 * carries the owner's legacy details (nominee, instructions, status).
 *
 * The relationship graph and findings are computed only from these
 * owner-scoped reads, so proving the reads cannot cross owners proves the
 * intelligence cannot either.
 */
const SUBJECT_A = "user_intel_alice";
const SUBJECT_B = "user_intel_bob";
const NOMINEE = "Nominee Meera Intel";
const INSTRUCTIONS = "Transfer to my daughter; statements are in the blue folder.";

const available = await isLocalStackAvailable();
let aliceId: string;
let bobId: string;
let alice: TypedSupabaseClient;
let bob: TypedSupabaseClient;
let service: TypedSupabaseClient;

if (!available) {
  console.warn(
    "[legacy-intelligence] local Supabase stack unreachable — start it with `pnpm db:start`. Assertions are SKIPPED, not passed.",
  );
}

beforeAll(async () => {
  if (!available) return;
  process.env.ACCESS_COOKIE_KEY ??= Buffer.from(new Uint8Array(32).fill(5)).toString("base64");
  service = createServiceScopedClient() as unknown as TypedSupabaseClient;
  await service.from("users").delete().in("clerk_user_id", [SUBJECT_A, SUBJECT_B]);
  const { data, error } = await service
    .from("users")
    .insert([
      { clerk_user_id: SUBJECT_A, email: "alice.intel@example.com", name: "Alice Intel" },
      { clerk_user_id: SUBJECT_B, email: "bob.intel@example.com", name: "Bob Intel" },
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
  await service.from("document_attachments").delete().in("user_id", [aliceId, bobId]);
  await service.from("beneficiary_assignments").delete().in("user_id", [aliceId, bobId]);
  await service.from("beneficiaries").delete().in("user_id", [aliceId, bobId]);
  await service.from("documents").delete().in("user_id", [aliceId, bobId]);
  await service.from("physical_assets").delete().in("user_id", [aliceId, bobId]);
});

async function propertyWithProfile(client: TypedSupabaseClient): Promise<string> {
  const { data, error } = await client.rpc("create_asset", {
    p_resource_type: "PHYSICAL_ASSET",
    p_plain: {
      name: "Family house",
      category: "REAL_ESTATE",
      currency: "INR",
      metadata: { profile: { nominee: { name: NOMINEE }, instructions: INSTRUCTIONS } },
    } as never,
  });
  if (error) throw error;
  return data as string;
}

async function documentFor(userId: string, name: string): Promise<string> {
  const { data, error } = await service
    .from("documents")
    .insert({
      user_id: userId,
      name,
      mime_type: "application/pdf",
      size_bytes: 2048,
      storage_key: `${userId}/${crypto.randomUUID()}.pdf`,
    })
    .select("id")
    .single();
  if (error) throw error;
  return data.id;
}

describe.skipIf(!available)("legacy intelligence boundaries", () => {
  it("stores the asset profile through create_asset() and the owner's metadata write", async () => {
    const id = await propertyWithProfile(alice);
    const created = await assetRepository.findById(alice, aliceId, "PHYSICAL_ASSET", id);
    expect(created?.profile).toEqual({ nominee: { name: NOMINEE }, instructions: INSTRUCTIONS });

    const metadata = await assetRepository.findMetadata(alice, aliceId, "PHYSICAL_ASSET", id);
    const merged = mergeAssetProfile(metadata, { status: "SOLD", lastReviewedOn: "2026-10-01" });
    const updated = await assetRepository.update(alice, aliceId, "PHYSICAL_ASSET", id, {
      metadata: merged as never,
    });
    expect(updated.profile).toEqual({ status: "SOLD", lastReviewedOn: "2026-10-01" });
  });

  it("keeps one owner's assets and their profile invisible and unwritable to another", async () => {
    const id = await propertyWithProfile(alice);
    expect(await assetRepository.findById(bob, bobId, "PHYSICAL_ASSET", id)).toBeNull();
    // Even querying by id without the owner filter, RLS returns nothing.
    const { data: rows } = await bob.from("physical_assets").select("metadata").eq("id", id);
    expect(rows).toEqual([]);

    const { data: written } = await bob
      .from("physical_assets")
      .update({ metadata: { profile: { instructions: "hijacked" } } as never })
      .eq("id", id)
      .select("id");
    expect(written ?? []).toEqual([]);
    const still = await assetRepository.findById(alice, aliceId, "PHYSICAL_ASSET", id);
    expect(still?.profile?.instructions).toBe(INSTRUCTIONS);
  });

  it("links supporting documents only between one owner's own records", async () => {
    const assetId = await propertyWithProfile(alice);
    const aliceDoc = await documentFor(aliceId, "Deed.pdf");
    const bobDoc = await documentFor(bobId, "Bob deed.pdf");

    const { error: linkError } = await alice.rpc("attach_document", {
      p_document_id: aliceDoc,
      p_resource_type: "PHYSICAL_ASSET",
      p_resource_id: assetId,
    });
    expect(linkError).toBeNull();
    const links = await documentRepository.attachmentsFor(alice, aliceId, [aliceDoc]);
    expect(links.get(aliceDoc)).toEqual([
      expect.objectContaining({ resourceType: "PHYSICAL_ASSET", resourceId: assetId }),
    ]);

    // Bob can neither see Alice's links nor attach across owners in either direction.
    expect((await documentRepository.attachmentsFor(bob, bobId, [aliceDoc])).size).toBe(0);
    const { data: peek } = await bob
      .from("document_attachments")
      .select("id")
      .eq("document_id", aliceDoc);
    expect(peek).toEqual([]);
    const { error: intoAlice } = await bob.rpc("attach_document", {
      p_document_id: bobDoc,
      p_resource_type: "PHYSICAL_ASSET",
      p_resource_id: assetId,
    });
    expect(intoAlice).not.toBeNull();
    const { data: bobAsset } = await bob.rpc("create_asset", {
      p_resource_type: "PHYSICAL_ASSET",
      p_plain: { name: "Bob house", category: "REAL_ESTATE", currency: "INR" } as never,
    });
    const { error: fromAlice } = await bob.rpc("attach_document", {
      p_document_id: aliceDoc,
      p_resource_type: "PHYSICAL_ASSET",
      p_resource_id: bobAsset as string,
    });
    expect(fromAlice).not.toBeNull();
  });

  it("filters activity by record without crossing owners", async () => {
    const assetId = await propertyWithProfile(alice);
    const { data: own } = await alice
      .from("audit_log")
      .select("action")
      .eq("actor_id", aliceId)
      .eq("resource_id", assetId);
    expect((own ?? []).map((row) => row.action)).toContain("asset.created");
    const { data: foreign } = await bob.from("audit_log").select("id").eq("resource_id", assetId);
    expect(foreign).toEqual([]);
  });

  it("never shows a beneficiary the owner's nominee, instructions or status", async () => {
    const assetId = await propertyWithProfile(alice);
    const { data: beneficiary, error: beneficiaryError } = await alice
      .from("beneficiaries")
      .insert({
        user_id: aliceId,
        name: "Trusted Intel",
        relationship: "Sibling",
        email: `intel-${crypto.randomUUID()}@example.com`,
      })
      .select("id")
      .single();
    if (beneficiaryError) throw beneficiaryError;
    await alice.rpc("assign_beneficiary", {
      p_beneficiary_id: beneficiary.id,
      p_resource_type: "PHYSICAL_ASSET",
      p_resource_id: assetId,
    });
    const minted = mintAccessToken();
    const { data: tokenId, error } = await alice.rpc("issue_access_token", {
      p_beneficiary_id: beneficiary.id,
      p_scope: {
        documents: [],
        assets: [{ type: "PHYSICAL_ASSET", id: assetId }],
        videos: [],
        planSections: [],
      } as never,
      p_token_hash: minted.hash,
      p_expires_at: new Date(Date.now() + 86_400_000).toISOString(),
    });
    if (error) throw error;

    await portal.exchange(minted.plaintext, "test");
    const grant = await portal.requireGrant(tokenId as string);
    const resources = JSON.stringify(await portal.listResources(grant, "test"));
    const view = await portal.assetView(grant, "PHYSICAL_ASSET", assetId, "test");
    for (const payload of [resources, JSON.stringify(view)]) {
      expect(payload).not.toContain(NOMINEE);
      expect(payload).not.toContain(INSTRUCTIONS);
      expect(payload).not.toContain("profile");
      expect(payload).not.toContain("metadata");
    }
    expect(Object.keys(view).sort()).toEqual(
      ["category", "currency", "estimatedValue", "id", "name", "notes", "type"].sort(),
    );
  });
});
