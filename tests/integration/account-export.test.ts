import { strFromU8, unzipSync } from "fflate";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import type { AppUser } from "@/lib/auth/ensure-app-user";
import type { TypedSupabaseClient } from "@/lib/db/server";
import { accountSheets } from "@/lib/export/account-sheets";
import { buildCsvZip, buildXlsx } from "@/lib/export/spreadsheet";
import { encrypt } from "@/lib/security/encryption";
import * as accountService from "@/lib/services/account.service";

import {
  createServiceScopedClient,
  createUserScopedClient,
  ensureTestUser,
  isLocalStackAvailable,
} from "../helpers/db";

/**
 * The spreadsheet export against the real local stack: the caller's own client
 * (RLS) reads the rows, the encrypted fields are decrypted, and the files are
 * built from what came back. Asserted: each account's files hold its own
 * records — including a decrypted account number and a nested folder path —
 * and nothing of the other account's; storage locations never appear; the
 * audit row names the format and counts, never values. Synthetic accounts only.
 */
const OWNER = "user_export_owner";
const OTHER = "user_export_other";

const clients = vi.hoisted(() => ({ current: null as unknown }));
vi.mock("@/lib/db/server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/db/server")>();
  return { ...actual, createUserClient: async () => clients.current };
});

const available = await isLocalStackAvailable();
if (!available) {
  console.warn(
    "[account-export] local Supabase stack unreachable — assertions are SKIPPED, not passed.",
  );
}

const RUN = crypto.randomUUID().slice(0, 8);
const service = available ? (createServiceScopedClient() as unknown as TypedSupabaseClient) : null;
const ids: Record<string, string> = {};

function appUser(id: string, clerkUserId: string): AppUser {
  return {
    id,
    clerkUserId,
    email: `${clerkUserId}@example.com`,
    emailVerified: true,
    name: clerkUserId,
    mfaEnabled: true,
    role: "USER",
    onboardingCompletedAt: null,
    deletionRequestedAt: null,
  };
}

async function seed(clerkUserId: string, tag: string) {
  const db = service!;
  const userId = await ensureTestUser(db as never, clerkUserId);
  const client = (await createUserScopedClient(clerkUserId)) as unknown as TypedSupabaseClient;
  const { data: ben, error: benError } = await db
    .from("beneficiaries")
    .insert({
      user_id: userId,
      name: `Beneficiary ${tag} ${RUN}`,
      relationship: "Sibling",
      email: `ben-${tag.toLowerCase()}-${RUN}@example.com`,
    })
    .select("id")
    .single();
  if (benError) throw benError;
  await db.from("beneficiaries").insert({
    user_id: userId,
    name: `Former ${tag} ${RUN}`,
    relationship: "Friend",
    email: `former-${tag.toLowerCase()}-${RUN}@example.com`,
    deleted_at: new Date().toISOString(),
  });
  const { error: assetError } = await client.rpc("create_asset", {
    p_resource_type: "FINANCIAL_ASSET",
    p_plain: { name: `Savings ${tag} ${RUN}`, category: "BANK_ACCOUNT", currency: "INR" } as never,
    p_encrypted: { accountNumber: encrypt(`ACCT-${tag}-${RUN}`) } as never,
  });
  if (assetError) throw assetError;
  const { data: parent } = await db
    .from("folders")
    .insert({ user_id: userId, name: `Legal ${tag}` })
    .select("id")
    .single();
  const { data: child } = await db
    .from("folders")
    .insert({ user_id: userId, name: "Property", parent_id: parent!.id })
    .select("id")
    .single();
  const { data: doc, error: docError } = await db
    .from("documents")
    .insert({
      user_id: userId,
      folder_id: child!.id,
      name: `Deed ${tag} ${RUN}.pdf`,
      mime_type: "application/pdf",
      size_bytes: 2048,
      storage_key: `export-test/${RUN}/${tag}/object-key`,
    })
    .select("id")
    .single();
  if (docError) throw docError;

  // History tables, written as the system would. The secret columns hold
  // markers that must never reach a file.
  const day = new Date(Date.now() + 86_400_000).toISOString();
  const check = (result: { error: unknown }) => {
    if (result.error) throw result.error;
  };
  check(
    await db.from("access_tokens").insert({
      owner_user_id: userId,
      beneficiary_id: ben.id,
      grant_type: "DIRECT_SHARE",
      token_hash: `token-hash-${tag}-${RUN}`,
      scope: { documents: [doc.id] },
      expires_at: day,
    }),
  );
  const { data: config, error: configError } = await db
    .from("emergency_access_configs")
    .insert({ user_id: userId, beneficiary_id: ben.id, access_scope: {} })
    .select("id")
    .single();
  if (configError) throw configError;
  check(
    await db.from("emergency_access_requests").insert({
      config_id: config.id,
      requester_email: `requester-${tag.toLowerCase()}-${RUN}@example.com`,
      status: "DENIED",
      request_expires_at: day,
      otp_hash: `otp-hash-${tag}-${RUN}`,
    }),
  );
  const { data: dms, error: dmsError } = await db
    .from("dead_man_switches")
    .insert({ user_id: userId, check_in_frequency_days: 30, inactivity_period_days: 60 })
    .select("id")
    .single();
  if (dmsError) throw dmsError;
  check(
    await db
      .from("dead_man_switch_contacts")
      .insert({ dead_man_switch_id: dms.id, beneficiary_id: ben.id, notify_order: 1 }),
  );
  check(
    await db.from("dead_man_switch_events").insert({
      dead_man_switch_id: dms.id,
      event_type: "CHECK_IN",
      previous_state: "ACTIVE",
      new_state: "ACTIVE",
    }),
  );
  const { data: draft, error: draftError } = await db
    .from("ai_drafts")
    .insert({ user_id: userId, kind: "DOCUMENT_ANALYSIS", source_document_id: doc.id })
    .select("id")
    .single();
  if (draftError) throw draftError;
  const stored = {
    payload: { action: "summary", data: { summary: `Analysis ${tag} ${RUN}` } },
    language: "en",
  };
  check(
    await db.from("ai_draft_versions").insert({
      draft_id: draft.id,
      version_number: 1,
      created_by: "AI",
      content: encrypt(JSON.stringify(stored)) as never,
    }),
  );
  return { userId, client };
}

async function clean() {
  if (!service || !ids.owner) return;
  const users = [ids.owner, ids.other];
  await service.from("access_tokens").delete().in("owner_user_id", users);
  await service.from("dead_man_switches").delete().in("user_id", users);
  for (const table of [
    "ai_drafts",
    "emergency_access_configs",
    "documents",
    "folders",
    "financial_assets",
    "beneficiaries",
  ] as const) {
    const { error } = await service.from(table).delete().in("user_id", users);
    if (error) throw error;
  }
}

const seeded: Record<string, { userId: string; client: TypedSupabaseClient }> = {};

beforeAll(async () => {
  if (!available) return;
  ids.owner = await ensureTestUser(service as never, OWNER);
  ids.other = await ensureTestUser(service as never, OTHER);
  await clean();
  seeded.owner = await seed(OWNER, "A");
  seeded.other = await seed(OTHER, "B");
}, 60_000);

afterAll(clean);

function text(bytes: Uint8Array): string {
  return Object.values(unzipSync(bytes))
    .map((data) => strFromU8(data))
    .join("\n");
}

describe.skipIf(!available)("account export — spreadsheet formats", () => {
  it("holds the caller's own records, decrypted, and none of another account's", async () => {
    for (const [key, own, foreign, clerkUserId] of [
      ["owner", "A", "B", OWNER],
      ["other", "B", "A", OTHER],
    ] as const) {
      clients.current = seeded[key]!.client;
      const data = await accountService.exportData(
        appUser(seeded[key]!.userId, clerkUserId),
        `corr-${RUN}`,
        "xlsx",
      );
      const { sheets, readme } = accountSheets(data);
      for (const bytes of [buildXlsx(sheets), buildCsvZip(sheets, readme)]) {
        const files = text(bytes);
        expect(files).toContain(`Beneficiary ${own} ${RUN}`);
        expect(files).toContain(`ACCT-${own}-${RUN}`);
        expect(files).toContain(`Deed ${own} ${RUN}.pdf`);
        expect(files).toContain(`Legal ${own} / Property`);
        // History, decrypted analyses and retained deleted rows are covered.
        expect(files).toContain(`Analysis ${own} ${RUN}`);
        expect(files).toContain(`Former ${own} ${RUN}`);
        expect(files).toContain(`requester-${own.toLowerCase()}-${RUN}@example.com`);
        expect(files).toContain(`Documents: Deed ${own} ${RUN}.pdf`);
        expect(files).not.toContain(`${foreign} ${RUN}`);
        expect(files).not.toContain(`ACCT-${foreign}-${RUN}`);
        expect(files).not.toContain("export-test/");
        expect(files).not.toContain("token-hash-");
        expect(files).not.toContain("otp-hash-");
      }
    }
  });

  it("audits the format and counts, never the values", async () => {
    clients.current = seeded.owner!.client;
    await accountService.exportData(appUser(seeded.owner!.userId, OWNER), `corr-csv-${RUN}`, "csv");
    const { data: rows } = await service!
      .from("audit_log")
      .select("action, metadata")
      .eq("correlation_id", `corr-csv-${RUN}`);
    expect(rows).toHaveLength(1);
    expect(rows![0]).toMatchObject({
      action: "user.data_exported",
      // 2 beneficiaries (one deleted, retained); 1 account number + 1 analysis decrypted.
      metadata: { format: "csv", beneficiaries: 2, documents: 1, decryptedFields: 2 },
    });
    expect(JSON.stringify(rows)).not.toContain("ACCT-");
  });
});
