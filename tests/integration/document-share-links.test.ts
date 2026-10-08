import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import type { AppUser } from "@/lib/auth/ensure-app-user";
import type { TypedSupabaseClient } from "@/lib/db/server";
import { hashAccessToken, mintAccessToken } from "@/lib/security/access-token";
import * as accessService from "@/lib/services/access.service";
import * as portal from "@/lib/services/access-portal.service";
import * as documentService from "@/lib/services/document.service";

import {
  createServiceScopedClient,
  createUserScopedClient,
  isLocalStackAvailable,
} from "../helpers/db";

/**
 * Sharing a document emails a link that follows the beneficiary's shares
 * (migration 0007), against the real database.
 *
 * The share, the guarded mint, the token exchange and every portal read are
 * real; only the outbound email (to capture the link) and the third-party email
 * budget are replaced. Asserted: a second share needs no new link, an unshare
 * ends access at once, a fixed-scope link never gains a document, another
 * owner's document is unreachable, revoked and expired links stay refused, and
 * a failed email keeps the share.
 */
const SUBJECT_A = "user_share_links_alice";
const SUBJECT_B = "user_share_links_bob";

const clients = vi.hoisted(() => ({ current: null as unknown }));
const outbox = vi.hoisted(() => ({ links: [] as string[], notices: [] as string[], fail: false }));

vi.mock("@/lib/db/server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/db/server")>();
  return { ...actual, createUserClient: async () => clients.current };
});
vi.mock("@/lib/email/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/email/client")>();
  return { ...actual, emailConfigured: () => true };
});
vi.mock("@/lib/email/send", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/email/send")>();
  return {
    ...actual,
    sendAccessLinkEmail: async ({ link }: { link: string }) => {
      if (outbox.fail) throw new Error("email send failed: unauthorized");
      outbox.links.push(link);
      return { providerMessageId: `msg_${outbox.links.length}` };
    },
    sendDocumentSharedNoticeEmail: async (input: Record<string, string>) => {
      outbox.notices.push(JSON.stringify(input));
      return { providerMessageId: `notice_${outbox.notices.length}` };
    },
  };
});
vi.mock("@/lib/security/rate-limit", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/security/rate-limit")>();
  return {
    ...actual,
    checkRateLimit: async () => ({ allowed: true, limit: 5, remaining: 5, retryAfterSeconds: 1 }),
  };
});

const available = await isLocalStackAvailable();
let aliceId: string;
let bobId: string;
let alice: TypedSupabaseClient;
let service: TypedSupabaseClient;
let owner: AppUser;

if (!available) {
  console.warn(
    "[document-share-links] local Supabase stack unreachable — start it with `pnpm db:start`. Assertions are SKIPPED, not passed.",
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
      { clerk_user_id: SUBJECT_A, email: "alice.sharelinks@example.com", name: "Alice Owner" },
      { clerk_user_id: SUBJECT_B, email: "bob.sharelinks@example.com", name: "Bob" },
    ])
    .select("id, clerk_user_id");
  if (error) throw error;

  aliceId = data.find((row) => row.clerk_user_id === SUBJECT_A)!.id;
  bobId = data.find((row) => row.clerk_user_id === SUBJECT_B)!.id;
  alice = (await createUserScopedClient(SUBJECT_A)) as unknown as TypedSupabaseClient;
  clients.current = alice;
  owner = {
    id: aliceId,
    clerkUserId: SUBJECT_A,
    email: "alice.sharelinks@example.com",
    emailVerified: true,
    name: "Alice Owner",
    mfaEnabled: false,
    role: "USER",
    onboardingCompletedAt: new Date().toISOString(),
    deletionRequestedAt: null,
  };
}, 60_000);

beforeEach(async () => {
  if (!available) return;
  outbox.links.length = 0;
  outbox.notices.length = 0;
  outbox.fail = false;
  await service.from("access_tokens").delete().in("owner_user_id", [aliceId, bobId]);
  await service.from("beneficiaries").delete().in("user_id", [aliceId, bobId]);
  await service.from("documents").delete().in("user_id", [aliceId, bobId]);
  await service.from("financial_assets").delete().in("user_id", [aliceId, bobId]);
});

async function newBeneficiary(): Promise<string> {
  const { data, error } = await alice
    .from("beneficiaries")
    .insert({
      user_id: aliceId,
      name: "Asha Rao",
      relationship: "Friend",
      email: `share-${crypto.randomUUID()}@example.com`,
    })
    .select("id")
    .single();
  if (error) throw error;
  return data.id;
}

/** A document row. The portal reads rows, not objects, so no upload is needed. */
async function newDocument(userId = aliceId, name = "Will.pdf"): Promise<string> {
  const { data, error } = await service
    .from("documents")
    .insert({
      user_id: userId,
      name,
      mime_type: "application/pdf",
      size_bytes: 1024,
      storage_key: `${userId}/${crypto.randomUUID()}.pdf`,
    })
    .select("id")
    .single();
  if (error) throw error;
  return data.id;
}

/** Links carry the secret in the fragment (never sent to a server). */
function secretOf(link: string): string {
  return new URLSearchParams(new URL(link).hash.slice(1)).get("t") ?? "";
}

/** Unrevoked share-following links of a beneficiary (migration 0011 allows one). */
async function unrevokedShareLinks(beneficiaryId: string) {
  const { data, error } = await service
    .from("access_tokens")
    .select("id, expires_at, revoked_reason")
    .eq("beneficiary_id", beneficiaryId)
    .eq("grant_type", "DIRECT_SHARE")
    .eq("follows_document_shares", true)
    .is("revoked_at", null);
  if (error) throw error;
  return data;
}

async function tokenIdOf(plaintext: string): Promise<string> {
  const { data } = await service
    .from("access_tokens")
    .select("id")
    .eq("token_hash", hashAccessToken(plaintext))
    .single();
  return data!.id;
}

async function documentIds(tokenId: string): Promise<string[]> {
  const grant = await portal.requireGrant(tokenId);
  const resources = await portal.listResources(grant, "test");
  return resources.documents.map((document) => document.id).sort();
}

async function shareFollowingLink(beneficiaryId: string, days = 7) {
  const minted = mintAccessToken();
  const result = await alice.rpc("issue_document_share_token", {
    p_beneficiary_id: beneficiaryId,
    p_token_hash: minted.hash,
    p_expires_at: new Date(Date.now() + days * 86_400_000).toISOString(),
  });
  return { ...result, plaintext: minted.plaintext };
}

describe.skipIf(!available)("document share links", () => {
  it("emails a link on share; the beneficiary sees later shares and loses unshared ones at once", async () => {
    const beneficiaryId = await newBeneficiary();
    const will = await newDocument(aliceId, "Will.pdf");
    const deed = await newDocument(aliceId, "Deed.pdf");

    const first = await documentService.shareDocument(owner, will, beneficiaryId, "corr-1");
    expect(first.accessEmailSent).toBe(true);
    expect(outbox.links).toHaveLength(1);

    // The beneficiary opens the emailed link: activated, one document.
    const plaintext = secretOf(outbox.links[0]);
    const exchanged = await portal.exchange(plaintext, "test");
    if (!("grant" in exchanged)) throw new Error("a direct share must open without a code");
    expect(exchanged.grant.counts.documents).toBe(1);
    const tokenId = await tokenIdOf(plaintext);
    const { data: token } = await service
      .from("access_tokens")
      .select("grant_type, follows_document_shares, token_hash")
      .eq("id", tokenId)
      .single();
    expect(token).toMatchObject({ grant_type: "DIRECT_SHARE", follows_document_shares: true });
    expect(token?.token_hash).toBe(hashAccessToken(plaintext));
    const { data: beneficiary } = await service
      .from("beneficiaries")
      .select("status")
      .eq("id", beneficiaryId)
      .single();
    expect(beneficiary?.status).toBe("ACTIVE");

    // A second share: no new link — the one live link (and the open session)
    // already shows it; the beneficiary gets a link-free notice instead.
    const second = await documentService.shareDocument(owner, deed, beneficiaryId, "corr-2");
    expect(second).toMatchObject({ accessLink: "existing", accessEmailSent: true });
    expect(outbox.links).toHaveLength(1);
    expect(outbox.notices).toHaveLength(1);
    expect(await unrevokedShareLinks(beneficiaryId)).toHaveLength(1);
    expect(await documentIds(tokenId)).toEqual([will, deed].sort());
    const grant = await portal.requireGrant(tokenId);
    await expect(portal.documentDetail(grant, deed, "test")).resolves.toMatchObject({ id: deed });

    // Unshared: refused on the very next request, through every link.
    await documentService.unshareDocument(owner, will, beneficiaryId, "corr-3");
    const after = await portal.requireGrant(tokenId);
    await expect(portal.documentDetail(after, will, "test")).rejects.toMatchObject({
      status: 404,
    });
    expect(await documentIds(tokenId)).toEqual([deed]);
  });

  it("keeps the share when the email cannot be sent", async () => {
    const beneficiaryId = await newBeneficiary();
    const will = await newDocument();
    outbox.fail = true;

    const result = await documentService.shareDocument(owner, will, beneficiaryId, "corr");

    expect(result.accessEmailSent).toBe(false);
    expect(result.shares.map((share) => share.beneficiaryId)).toEqual([beneficiaryId]);
  });

  it("never lets a fixed-scope link gain a newly shared document", async () => {
    const beneficiaryId = await newBeneficiary();
    const will = await newDocument(aliceId, "Will.pdf");
    const deed = await newDocument(aliceId, "Deed.pdf");
    await alice.rpc("assign_beneficiary", {
      p_beneficiary_id: beneficiaryId,
      p_resource_type: "DOCUMENT",
      p_resource_id: will,
    });

    const minted = mintAccessToken();
    const { data: tokenId, error } = await alice.rpc("issue_access_token", {
      p_beneficiary_id: beneficiaryId,
      p_scope: { documents: [will], assets: [], videos: [], planSections: [] } as never,
      p_token_hash: minted.hash,
      p_expires_at: new Date(Date.now() + 7 * 86_400_000).toISOString(),
    });
    expect(error).toBeNull();
    await portal.exchange(minted.plaintext, "test");

    await alice.rpc("assign_beneficiary", {
      p_beneficiary_id: beneficiaryId,
      p_resource_type: "DOCUMENT",
      p_resource_id: deed,
    });
    expect(await documentIds(tokenId as string)).toEqual([will]);
    const grant = await portal.requireGrant(tokenId as string);
    await expect(portal.documentDetail(grant, deed, "test")).rejects.toMatchObject({
      status: 404,
    });

    // It can still lose one: unsharing ends access through the fixed link too.
    const { data: assignment } = await service
      .from("beneficiary_assignments")
      .select("id")
      .eq("beneficiary_id", beneficiaryId)
      .eq("resource_id", will)
      .single();
    await alice.rpc("unassign_beneficiary", { p_assignment_id: assignment!.id });
    expect(await documentIds(tokenId as string)).toEqual([]);
  });

  it("gives an asset-only link no documents when one is shared later", async () => {
    const beneficiaryId = await newBeneficiary();
    const { data: assetId } = await alice.rpc("create_asset", {
      p_resource_type: "FINANCIAL_ASSET",
      p_plain: { name: "Joint savings", category: "BANK_ACCOUNT", currency: "INR" } as never,
    });
    await alice.rpc("assign_beneficiary", {
      p_beneficiary_id: beneficiaryId,
      p_resource_type: "FINANCIAL_ASSET",
      p_resource_id: assetId as string,
    });
    const minted = mintAccessToken();
    const { data: tokenId } = await alice.rpc("issue_access_token", {
      p_beneficiary_id: beneficiaryId,
      p_scope: {
        documents: [],
        assets: [{ type: "FINANCIAL_ASSET", id: assetId as string }],
        videos: [],
        planSections: [],
      } as never,
      p_token_hash: minted.hash,
      p_expires_at: new Date(Date.now() + 7 * 86_400_000).toISOString(),
    });

    const will = await newDocument();
    await documentService.shareDocument(owner, will, beneficiaryId, "corr");

    const grant = await portal.requireGrant(tokenId as string);
    const resources = await portal.listResources(grant, "test");
    expect(resources.documents).toEqual([]);
    expect(resources.assets.map((asset) => asset.id)).toEqual([assetId]);
    await expect(portal.documentDetail(grant, will, "test")).rejects.toMatchObject({
      status: 404,
    });
  });

  it("never reaches another owner's document, even through a forged share row", async () => {
    const beneficiaryId = await newBeneficiary();
    const will = await newDocument(aliceId);
    const bobsDocument = await newDocument(bobId, "Bob private.pdf");

    // Alice cannot share Bob's document through the guarded function...
    const { error: refused } = await alice.rpc("assign_beneficiary", {
      p_beneficiary_id: beneficiaryId,
      p_resource_type: "DOCUMENT",
      p_resource_id: bobsDocument,
    });
    expect(refused).not.toBeNull();

    // ...and even a row written around it is not enough: every read is pinned to
    // the link's owner.
    await documentService.shareDocument(owner, will, beneficiaryId, "corr");
    await service.from("beneficiary_assignments").insert({
      user_id: aliceId,
      beneficiary_id: beneficiaryId,
      resource_type: "DOCUMENT",
      resource_id: bobsDocument,
    });
    const tokenId = await tokenIdOf(secretOf(outbox.links[0]));
    expect(await documentIds(tokenId)).toEqual([will]);
    const grant = await portal.requireGrant(tokenId);
    await expect(portal.documentDetail(grant, bobsDocument, "test")).rejects.toMatchObject({
      status: 404,
    });
  });

  it("keeps a resent share link following shares, even after an unshare", async () => {
    const beneficiaryId = await newBeneficiary();
    const will = await newDocument(aliceId, "Will.pdf");
    const deed = await newDocument(aliceId, "Deed.pdf");
    await documentService.shareDocument(owner, will, beneficiaryId, "corr-1");
    await documentService.shareDocument(owner, deed, beneficiaryId, "corr-2");
    const originalId = await tokenIdOf(secretOf(outbox.links[0]));

    // The original link named the will; unsharing it must not make a resend fail.
    await documentService.unshareDocument(owner, will, beneficiaryId, "corr-3");
    const resent = await accessService.resendToken(
      owner,
      beneficiaryId,
      originalId,
      { ttlDays: 7, confirmed: true },
      "corr-4",
    );

    await expect(portal.requireGrant(originalId)).rejects.toMatchObject({ status: 401 });
    const resentId = await tokenIdOf(secretOf(resent.link));
    const { data: row } = await service
      .from("access_tokens")
      .select("follows_document_shares, replaces_token_id")
      .eq("id", resentId)
      .single();
    expect(row).toEqual({ follows_document_shares: true, replaces_token_id: originalId });
    expect(await documentIds(resentId)).toEqual([deed]);

    const later = await newDocument(aliceId, "Later.pdf");
    await documentService.shareDocument(owner, later, beneficiaryId, "corr-5");
    expect(await documentIds(resentId)).toEqual([deed, later].sort());
  });

  it("refuses a share link once its beneficiary is deactivated or removed", async () => {
    const deactivated = await newBeneficiary();
    await documentService.shareDocument(owner, await newDocument(), deactivated, "corr-1");
    const deactivatedId = await tokenIdOf(secretOf(outbox.links[0]));
    await portal.exchange(secretOf(outbox.links[0]), "test");
    await alice.rpc("set_beneficiary_status", {
      p_beneficiary_id: deactivated,
      p_status: "INACTIVE",
    });
    await expect(portal.requireGrant(deactivatedId)).rejects.toMatchObject({ status: 401 });

    const removed = await newBeneficiary();
    await documentService.shareDocument(owner, await newDocument(), removed, "corr-2");
    const removedId = await tokenIdOf(secretOf(outbox.links[1]));
    await alice.rpc("remove_beneficiary", { p_beneficiary_id: removed });
    await expect(portal.requireGrant(removedId)).rejects.toMatchObject({ status: 401 });
    await expect(portal.exchange(secretOf(outbox.links[1]), "test")).rejects.toMatchObject({
      status: 401,
    });
  });

  it("keeps a revoked or expired share link refused", async () => {
    const beneficiaryId = await newBeneficiary();
    const will = await newDocument();
    await documentService.shareDocument(owner, will, beneficiaryId, "corr-1");
    const revokedSecret = secretOf(outbox.links[0]);
    const revokedId = await tokenIdOf(revokedSecret);
    await portal.exchange(revokedSecret, "test");

    await alice.rpc("revoke_access_token", { p_token_id: revokedId });
    await expect(portal.requireGrant(revokedId)).rejects.toMatchObject({ status: 401 });
    await expect(portal.exchange(revokedSecret, "test")).rejects.toMatchObject({ status: 401 });

    const expired = await shareFollowingLink(beneficiaryId);
    await service
      .from("access_tokens")
      .update({ expires_at: new Date(Date.now() - 1000).toISOString() })
      .eq("id", expired.data as string);
    await expect(portal.exchange(expired.plaintext, "test")).rejects.toMatchObject({
      status: 401,
    });
  });

  it("applies every issue-time check to a share-following link", async () => {
    const beneficiaryId = await newBeneficiary();

    // Nothing shared yet: nothing to link to.
    expect((await shareFollowingLink(beneficiaryId)).error?.message).toContain("SCOPE_EMPTY");

    await documentService.shareDocument(owner, await newDocument(), beneficiaryId, "corr");
    expect((await shareFollowingLink(beneficiaryId, 31)).error?.message).toContain(
      "INVALID_EXPIRY",
    );
    const badHash = await alice.rpc("issue_document_share_token", {
      p_beneficiary_id: beneficiaryId,
      p_token_hash: "not-a-hash",
      p_expires_at: new Date(Date.now() + 86_400_000).toISOString(),
    });
    expect(badHash.error?.message).toContain("INVALID_TOKEN_HASH");

    // Someone else's beneficiary.
    const { data: bobsBeneficiary } = await service
      .from("beneficiaries")
      .insert({
        user_id: bobId,
        name: "Bob's heir",
        relationship: "Son",
        email: "heir@example.com",
      })
      .select("id")
      .single();
    expect((await shareFollowingLink(bobsBeneficiary!.id)).error?.message).toContain("FORBIDDEN");

    await alice.rpc("set_beneficiary_status", {
      p_beneficiary_id: beneficiaryId,
      p_status: "INACTIVE",
    });
    expect((await shareFollowingLink(beneficiaryId)).error?.message).toContain(
      "BENEFICIARY_INACTIVE",
    );
  });
});

describe.skipIf(!available)("one live share link per beneficiary (0011)", () => {
  /** A share recorded directly, so a link can be minted (or refused) by hand. */
  async function shareRow(beneficiaryId: string, documentId: string) {
    const { error } = await alice.rpc("assign_beneficiary", {
      p_beneficiary_id: beneficiaryId,
      p_resource_type: "DOCUMENT",
      p_resource_id: documentId,
    });
    if (error) throw error;
  }

  it("mints one link on the first share and reuses it on every later one", async () => {
    const beneficiaryId = await newBeneficiary();
    const outcomes = [];
    for (const name of ["Will.pdf", "Deed.pdf", "Policy.pdf"]) {
      const result = await documentService.shareDocument(
        owner,
        await newDocument(aliceId, name),
        beneficiaryId,
        `corr-${name}`,
      );
      outcomes.push(result.accessLink);
    }

    expect(outcomes).toEqual(["new", "existing", "existing"]);
    expect(outbox.links).toHaveLength(1);
    // The later shares told the beneficiary without sending any secret.
    expect(outbox.notices).toHaveLength(2);
    expect(outbox.notices.join(" ")).not.toMatch(/access[#?]t=|[0-9a-f]{64}/);
    const live = await unrevokedShareLinks(beneficiaryId);
    expect(live).toHaveLength(1);
    expect(live[0].id).toBe(await tokenIdOf(secretOf(outbox.links[0])));
    expect(await documentIds(live[0].id)).toHaveLength(3);

    const { count: issued } = await service
      .from("audit_log")
      .select("id", { count: "exact", head: true })
      .eq("action", "access.token_issued")
      .eq("metadata->>beneficiaryId", beneficiaryId)
      .eq("metadata->>followsShares", "true");
    // One mint (the database's own record of it), however many shares.
    expect(issued).toBe(1);
    const { count: reused } = await service
      .from("audit_log")
      .select("id", { count: "exact", head: true })
      .eq("action", "access.share_link_reused")
      .eq("resource_id", beneficiaryId);
    expect(reused).toBe(2);
  });

  it("lets concurrent shares create exactly one live link", async () => {
    const beneficiaryId = await newBeneficiary();
    const documents = await Promise.all(
      ["A.pdf", "B.pdf", "C.pdf", "D.pdf", "E.pdf"].map((name) => newDocument(aliceId, name)),
    );

    const results = await Promise.all(
      documents.map((id, i) =>
        documentService.shareDocument(owner, id, beneficiaryId, `race-${i}`),
      ),
    );

    expect(results.filter((r) => r.accessLink === "new")).toHaveLength(1);
    expect(results.filter((r) => r.accessLink === "existing")).toHaveLength(4);
    expect(await unrevokedShareLinks(beneficiaryId)).toHaveLength(1);
    expect(outbox.links).toHaveLength(1);
  });

  it("refuses a second link from concurrent raw mints, and in the database itself", async () => {
    const beneficiaryId = await newBeneficiary();
    await shareRow(beneficiaryId, await newDocument());

    const mints = await Promise.all([1, 2, 3, 4, 5].map(() => shareFollowingLink(beneficiaryId)));
    expect(mints.filter((m) => !m.error)).toHaveLength(1);
    for (const refused of mints.filter((m) => m.error)) {
      expect(refused.error?.code).toBe("LV409");
      expect(refused.error?.message).toContain("SHARE_LINK_ALREADY_LIVE");
    }

    // Even a direct insert that skips the function cannot add a second one.
    const { error } = await service.from("access_tokens").insert({
      owner_user_id: aliceId,
      beneficiary_id: beneficiaryId,
      grant_type: "DIRECT_SHARE",
      token_hash: mintAccessToken().hash,
      scope: { documents: [], assets: [], videos: [] },
      expires_at: new Date(Date.now() + 86_400_000).toISOString(),
      follows_document_shares: true,
    });
    expect(error?.code).toBe("23505");
    expect(await unrevokedShareLinks(beneficiaryId)).toHaveLength(1);
  });

  it("mints a fresh link after the owner revokes it, and the revoked one stays refused", async () => {
    const beneficiaryId = await newBeneficiary();
    await documentService.shareDocument(owner, await newDocument(), beneficiaryId, "corr-1");
    const firstSecret = secretOf(outbox.links[0]);
    const firstId = await tokenIdOf(firstSecret);

    await alice.rpc("revoke_access_token", { p_token_id: firstId });
    const again = await documentService.shareDocument(
      owner,
      await newDocument(aliceId, "Second.pdf"),
      beneficiaryId,
      "corr-2",
    );

    expect(again.accessLink).toBe("new");
    expect(outbox.links).toHaveLength(2);
    await expect(portal.exchange(firstSecret, "test")).rejects.toMatchObject({ status: 401 });
    const live = await unrevokedShareLinks(beneficiaryId);
    expect(live.map((l) => l.id)).toEqual([await tokenIdOf(secretOf(outbox.links[1]))]);
  });

  it("retires an expired link (audited) before minting its replacement", async () => {
    const beneficiaryId = await newBeneficiary();
    await documentService.shareDocument(owner, await newDocument(), beneficiaryId, "corr-1");
    const expiredSecret = secretOf(outbox.links[0]);
    const expiredId = await tokenIdOf(expiredSecret);
    await service
      .from("access_tokens")
      .update({ expires_at: new Date(Date.now() - 1000).toISOString() })
      .eq("id", expiredId);

    const next = await documentService.shareDocument(
      owner,
      await newDocument(aliceId, "Next.pdf"),
      beneficiaryId,
      "corr-2",
    );

    expect(next.accessLink).toBe("new");
    const { data: old } = await service
      .from("access_tokens")
      .select("revoked_reason")
      .eq("id", expiredId)
      .single();
    expect(old?.revoked_reason).toBe("EXPIRED");
    await expect(portal.exchange(expiredSecret, "test")).rejects.toMatchObject({ status: 401 });
    expect(await unrevokedShareLinks(beneficiaryId)).toHaveLength(1);
    const { count } = await service
      .from("audit_log")
      .select("id", { count: "exact", head: true })
      .eq("action", "access.token_revoked")
      .eq("resource_id", expiredId)
      .eq("metadata->>reason", "EXPIRED");
    expect(count).toBe(1);
  });

  it("keeps each beneficiary's one link to that beneficiary's documents", async () => {
    const asha = await newBeneficiary();
    const ravi = await newBeneficiary();
    const ashaDoc = await newDocument(aliceId, "Asha.pdf");
    const raviDoc = await newDocument(aliceId, "Ravi.pdf");
    await documentService.shareDocument(owner, ashaDoc, asha, "corr-1");
    await documentService.shareDocument(owner, raviDoc, ravi, "corr-2");

    const ashaLink = await tokenIdOf(secretOf(outbox.links[0]));
    const raviLink = await tokenIdOf(secretOf(outbox.links[1]));
    expect(await documentIds(ashaLink)).toEqual([ashaDoc]);
    expect(await documentIds(raviLink)).toEqual([raviDoc]);

    // Revoking one beneficiary's link leaves the other's untouched.
    await alice.rpc("revoke_access_token", { p_token_id: ashaLink });
    await expect(portal.requireGrant(ashaLink)).rejects.toMatchObject({ status: 401 });
    expect(await documentIds(raviLink)).toEqual([raviDoc]);
  });

  it("never lets another owner mint, revoke or resend through someone else's link", async () => {
    const beneficiaryId = await newBeneficiary();
    await documentService.shareDocument(owner, await newDocument(), beneficiaryId, "corr-1");
    const linkId = await tokenIdOf(secretOf(outbox.links[0]));
    const bob = (await createUserScopedClient(SUBJECT_B)) as unknown as TypedSupabaseClient;

    expect((await bob.rpc("revoke_access_token", { p_token_id: linkId })).error?.code).toBe(
      "42501",
    );
    const minted = mintAccessToken();
    const resend = await bob.rpc("resend_access_token", {
      p_token_id: linkId,
      p_token_hash: minted.hash,
      p_expires_at: new Date(Date.now() + 86_400_000).toISOString(),
    });
    expect(resend.error?.code).toBe("42501");
    const mint = await bob.rpc("issue_document_share_token", {
      p_beneficiary_id: beneficiaryId,
      p_token_hash: mintAccessToken().hash,
      p_expires_at: new Date(Date.now() + 86_400_000).toISOString(),
    });
    expect(mint.error?.code).toBe("42501");
    // Bob cannot even see that the link exists.
    const { data: seen } = await bob.from("access_tokens").select("id").eq("id", linkId);
    expect(seen).toEqual([]);
    const live = await unrevokedShareLinks(beneficiaryId);
    expect(live.map((l) => l.id)).toEqual([linkId]);
  });

  it("makes a resend replace the live link, never add to it", async () => {
    const beneficiaryId = await newBeneficiary();
    await documentService.shareDocument(owner, await newDocument(), beneficiaryId, "corr-1");
    const firstId = await tokenIdOf(secretOf(outbox.links[0]));

    const resent = await accessService.resendToken(
      owner,
      beneficiaryId,
      firstId,
      { ttlDays: 7, confirmed: true },
      "corr-2",
    );
    const secondId = await tokenIdOf(secretOf(resent.link));
    expect((await unrevokedShareLinks(beneficiaryId)).map((l) => l.id)).toEqual([secondId]);

    // Resending the OLD (already revoked) link still leaves exactly one live link.
    const again = await accessService.resendToken(
      owner,
      beneficiaryId,
      firstId,
      { ttlDays: 7, confirmed: true },
      "corr-3",
    );
    const thirdId = await tokenIdOf(secretOf(again.link));
    expect((await unrevokedShareLinks(beneficiaryId)).map((l) => l.id)).toEqual([thirdId]);
    await expect(portal.requireGrant(secondId)).rejects.toMatchObject({ status: 401 });
  });
});
