import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { ClerkAPIResponseError } from "@clerk/nextjs/errors";
import { Webhook } from "svix";

import { POST as clerkWebhook } from "@/app/api/webhooks/clerk/route";

import type { AppUser } from "@/lib/auth/ensure-app-user";
import { getOptionalUser, requireUser } from "@/lib/auth/require-user";
import { resetEnvGroupCache } from "@/lib/config/env";
import type { TypedSupabaseClient } from "@/lib/db/server";
import { accessDeliverHandler } from "@/lib/jobs/handlers/access-deliver";
import { notificationDeliverHandler } from "@/lib/jobs/handlers/notification-deliver";
import { runHousekeeping } from "@/lib/jobs/handlers/housekeeping";
import { securityNewDeviceHandler } from "@/lib/jobs/handlers/security-new-device";
import { userHardDeleteHandler } from "@/lib/jobs/handlers/user-hard-delete";
import type { JobRow } from "@/lib/repositories/job.repository";
import * as userRepository from "@/lib/repositories/user.repository";
import * as accountService from "@/lib/services/account.service";

import {
  createServiceScopedClient,
  createUserScopedClient,
  isLocalStackAvailable,
} from "../helpers/db";

/**
 * Account deletion against the real local stack: migration 0012, the hard
 * delete and both entry points (delete now / scheduled + housekeeping).
 *
 * Every account here is synthetic and created by this file. Clerk is the only
 * fake — its Backend API is not reachable from tests — so each test can also
 * make it fail. Asserted: access closes at once (RLS, guarded functions and the
 * session lookup), storage, Clerk identity and every domain row are removed,
 * the audit trail is kept, a bystander's rows and objects are untouched, and
 * repeated, concurrent and failed-then-retried runs all end in the same place.
 */
const clerk = vi.hoisted(() => ({
  deleted: [] as string[],
  failNext: null as Error | null,
  sessionUser: null as string | null,
}));

vi.mock("@clerk/nextjs/server", () => ({
  auth: async () => ({ userId: clerk.sessionUser }),
  currentUser: async () => null,
  clerkClient: async () => ({
    users: {
      deleteUser: async (id: string) => {
        if (clerk.failNext) {
          const failure = clerk.failNext;
          clerk.failNext = null;
          throw failure;
        }
        clerk.deleted.push(id);
        return {};
      },
    },
    sessions: {
      getSessionList: async () => ({ data: [] }),
      revokeSession: async () => ({}),
      getSession: async () => ({
        latestActivity: { browserName: "Firefox", deviceType: "Laptop", country: "IN" },
      }),
    },
  }),
}));

const outbox = vi.hoisted(() => ({ links: [] as string[], notifications: [] as string[] }));
vi.mock("@/lib/email/send", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/email/send")>();
  return {
    ...actual,
    sendAccessLinkEmail: async ({ link }: { link: string }) => {
      outbox.links.push(link);
      return { providerMessageId: `msg_${outbox.links.length}` };
    },
    sendNotificationEmail: async ({ to }: { to: string }) => {
      outbox.notifications.push(to);
      return { providerMessageId: `msg_n${outbox.notifications.length}` };
    },
  };
});

const available = await isLocalStackAvailable();
if (!available) {
  console.warn(
    "[account-deletion] local Supabase stack unreachable — start it with `pnpm db:start`. Assertions are SKIPPED, not passed.",
  );
}

const RUN = crypto.randomUUID().slice(0, 8);
const PDF = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37]);
let service: TypedSupabaseClient;
const seeded: Seeded[] = [];

interface Seeded {
  id: string;
  clerkUserId: string;
  documentKey: string;
  versionKey: string;
  videoKey: string;
  beneficiaryId: string;
}

/** A synthetic account with rows in most domain tables and three stored objects. */
async function seedAccount(label: string): Promise<Seeded> {
  const clerkUserId = `user_acctdel_${label}_${RUN}`;
  const { data: user, error } = await service
    .from("users")
    .insert({
      clerk_user_id: clerkUserId,
      email: `${clerkUserId}@example.com`,
      name: `Deletion ${label}`,
    })
    .select("id")
    .single();
  if (error) throw error;
  const id = user.id;

  const documentKey = `${id}/${crypto.randomUUID()}`;
  const versionKey = `${id}/${crypto.randomUUID()}`;
  const videoKey = `${id}/${crypto.randomUUID()}`;
  for (const [bucket, key, type] of [
    ["documents", documentKey, "application/pdf"],
    ["documents", versionKey, "application/pdf"],
    ["videos", videoKey, "video/mp4"],
  ] as const) {
    const { error: uploadError } = await service.storage
      .from(bucket)
      .upload(key, PDF, { contentType: type });
    if (uploadError) throw uploadError;
  }

  const { data: beneficiary, error: beneficiaryError } = await service
    .from("beneficiaries")
    .insert({
      user_id: id,
      name: "Asha Rao",
      relationship: "Friend",
      email: `${label}@example.com`,
    })
    .select("id")
    .single();
  if (beneficiaryError) throw beneficiaryError;

  const { data: document, error: documentError } = await service
    .from("documents")
    .insert({
      user_id: id,
      name: "will.pdf",
      mime_type: "application/pdf",
      size_bytes: PDF.byteLength,
      storage_key: documentKey,
    })
    .select("id")
    .single();
  if (documentError) throw documentError;
  const versions = await service.from("document_versions").insert([
    {
      document_id: document.id,
      version_number: 1,
      storage_key: documentKey,
      size_bytes: 8,
      uploaded_by: id,
    },
    {
      document_id: document.id,
      version_number: 2,
      storage_key: versionKey,
      size_bytes: 8,
      uploaded_by: id,
    },
  ]);
  if (versions.error) throw versions.error;

  const inserts = await Promise.all([
    service.from("video_messages").insert({
      user_id: id,
      title: "For my family",
      storage_key: videoKey,
      mime_type: "video/mp4",
      size_bytes: 8,
      delivery_condition: "IMMEDIATE",
    }),
    service.from("dead_man_switches").insert({
      user_id: id,
      status: "ACTIVE",
      inactivity_period_days: 30,
      check_in_frequency_days: 7,
      next_check_in_at: new Date(Date.now() + 86_400_000).toISOString(),
    }),
    service.from("access_tokens").insert({
      owner_user_id: id,
      beneficiary_id: beneficiary.id,
      grant_type: "DIRECT_SHARE",
      token_hash: crypto.randomUUID(),
      scope: {},
      expires_at: new Date(Date.now() + 86_400_000).toISOString(),
    }),
    service.from("notifications").insert({
      user_id: id,
      type: "test",
      title: "Hello",
      content: "Synthetic",
      channel: "IN_APP",
    }),
  ]);
  for (const result of inserts) if (result.error) throw result.error;

  const account = {
    id,
    clerkUserId,
    documentKey,
    versionKey,
    videoKey,
    beneficiaryId: beneficiary.id,
  };
  seeded.push(account);
  return account;
}

function appUser(account: Seeded, deletionRequestedAt: string | null = null): AppUser {
  return {
    id: account.id,
    clerkUserId: account.clerkUserId,
    email: `${account.clerkUserId}@example.com`,
    emailVerified: true,
    name: "Deletion",
    mfaEnabled: false,
    role: "USER",
    onboardingCompletedAt: new Date().toISOString(),
    deletionRequestedAt,
  };
}

async function objectExists(bucket: string, key: string): Promise<boolean> {
  const [prefix, name] = key.split("/");
  const { data, error } = await service.storage.from(bucket).list(prefix, { search: name });
  if (error) throw error;
  return (data ?? []).some((entry) => entry.name === name);
}

async function userRow(id: string) {
  const { data } = await service
    .from("users")
    .select("deleted_at, deletion_requested_at")
    .eq("id", id)
    .maybeSingle();
  return data;
}

async function count(table: string, column: string, id: string): Promise<number> {
  const { count: total, error } = await service
    .from(table as never)
    .select("*", { count: "exact", head: true })
    .eq(column, id);
  if (error) throw error;
  return total ?? 0;
}

async function expectPurged(account: Seeded): Promise<void> {
  expect(await userRow(account.id)).toBeNull();
  for (const table of [
    "beneficiaries",
    "documents",
    "video_messages",
    "dead_man_switches",
    "notifications",
  ]) {
    expect(await count(table, "user_id", account.id)).toBe(0);
  }
  expect(await count("access_tokens", "owner_user_id", account.id)).toBe(0);
  expect(await objectExists("documents", account.documentKey)).toBe(false);
  expect(await objectExists("documents", account.versionKey)).toBe(false);
  expect(await objectExists("videos", account.videoKey)).toBe(false);
  expect(clerk.deleted).toContain(account.clerkUserId);
}

async function expectUntouched(account: Seeded): Promise<void> {
  expect((await userRow(account.id))?.deleted_at).toBeNull();
  expect(await count("beneficiaries", "user_id", account.id)).toBe(1);
  expect(await count("documents", "user_id", account.id)).toBe(1);
  expect(await objectExists("documents", account.documentKey)).toBe(true);
  expect(await objectExists("videos", account.videoKey)).toBe(true);
  expect(clerk.deleted).not.toContain(account.clerkUserId);
}

let bystander: Seeded;

/** A signing secret invented for this run: no Clerk instance knows it. */
const randomSecret = () =>
  `whsec_${Buffer.from(crypto.getRandomValues(new Uint8Array(24))).toString("base64")}`;
const WEBHOOK_SECRET = randomSecret();
const deliveries: string[] = [];

/** A Clerk webhook delivery, signed the way Svix signs it. */
function clerkDelivery(
  id: string,
  type: string,
  data: Record<string, unknown>,
  secret = WEBHOOK_SECRET,
): Request {
  deliveries.push(id);
  const body = JSON.stringify({ type, data });
  const at = new Date();
  return new Request("http://localhost:3000/api/webhooks/clerk", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "svix-id": id,
      "svix-timestamp": String(Math.floor(at.getTime() / 1000)),
      "svix-signature": new Webhook(secret).sign(id, at, body),
    },
    body,
  });
}

async function deletionAudits(id: string) {
  const { data, error } = await service
    .from("audit_log")
    .select("metadata")
    .eq("resource_id", id)
    .eq("action", "user.deleted");
  if (error) throw error;
  return (data ?? []).map((row) => row.metadata);
}

async function hardDeleteJobs(id: string): Promise<number> {
  const { count: total, error } = await service
    .from("jobs")
    .select("id", { count: "exact", head: true })
    .eq("type", "user.hard-delete")
    .eq("payload->>userId", id);
  if (error) throw error;
  return total ?? 0;
}

beforeAll(async () => {
  if (!available) return;
  service = createServiceScopedClient() as unknown as TypedSupabaseClient;
  bystander = await seedAccount("bystander");
}, 60_000);

afterAll(async () => {
  if (!available) return;
  // Only this file's synthetic accounts, and only what the tests left behind.
  for (const account of seeded) {
    for (const bucket of ["documents", "videos"]) {
      const { data } = await service.storage.from(bucket).list(account.id);
      const keys = (data ?? []).map((entry) => `${account.id}/${entry.name}`);
      if (keys.length) await service.storage.from(bucket).remove(keys);
    }
  }
  // The hard-delete jobs these tests queued (a local job runner would run them).
  await service.from("jobs").delete().like("payload->>clerkUserId", "user_acctdel_%");
  await service.from("processed_webhook_events").delete().in("event_id", deliveries);
  // Same order as the purge: document_versions.uploaded_by has no ON DELETE
  // action, so the users delete fails while their documents remain.
  const ids = seeded.map((account) => account.id);
  const documents = await service.from("documents").delete().in("user_id", ids);
  if (documents.error) throw documents.error;
  const users = await service.from("users").delete().in("id", ids);
  if (users.error) throw users.error;
});

describe.skipIf(!available)("delete account permanently now", () => {
  it("closes access at once, removes everything and keeps the audit trail", async () => {
    const account = await seedAccount("now");
    const owner = await createUserScopedClient(account.clerkUserId);
    expect((await owner.from("beneficiaries").select("id")).data).toHaveLength(1);

    const result = await accountService.deleteAccountNow(appUser(account), `corr-${RUN}`);
    expect(result.status).toBe("DELETED");

    await expectPurged(account);
    // The owner's still-valid session token reaches nothing.
    expect((await owner.from("beneficiaries").select("id")).data).toEqual([]);
    expect((await owner.from("users").select("id")).data).toEqual([]);
    expect((await owner.rpc("dms_pause", { p_corr: "x" })).error?.code).toBe("42501");

    const { data: trail } = await service
      .from("audit_log")
      .select("action, metadata")
      .eq("resource_id", account.id)
      .in("action", ["user.deleted", "user.purged"]);
    const actions = (trail ?? []).map((row) => row.action).sort();
    expect(actions).toEqual(["user.deleted", "user.purged"]);
    const started = trail?.find((row) => row.action === "user.deleted");
    expect(started?.metadata).toMatchObject({ mode: "immediate", accessTokensRevoked: 1 });

    await expectUntouched(bystander);
  });

  it("refuses a session issued before the deletion, while the hard delete is pending", async () => {
    const account = await seedAccount("stale");
    clerk.sessionUser = account.clerkUserId;
    try {
      expect((await requireUser()).id).toBe(account.id);
      await service.rpc("begin_account_deletion", { p_user_id: account.id });
      await expect(requireUser()).rejects.toMatchObject({ status: 401 });
      expect(await getOptionalUser()).toBeNull();
    } finally {
      clerk.sessionUser = null;
    }
    await accountService.purgeAccount(service, account.id, account.clerkUserId);
    await expectPurged(account);
  });

  it("introduces no grace period, and a second start changes nothing", async () => {
    const account = await seedAccount("nograce");
    const before = Date.now();
    const { data: first } = await service.rpc("begin_account_deletion", { p_user_id: account.id });
    const { data: second } = await service.rpc("begin_account_deletion", { p_user_id: account.id });
    expect([first, second]).toEqual([true, false]);

    const row = await userRow(account.id);
    expect(Date.parse(row!.deleted_at!)).toBeGreaterThanOrEqual(before - 5_000);
    expect(Date.parse(row!.deleted_at!)).toBeLessThan(Date.now() + 5_000);

    // Everything that could act for the account stopped in the same transaction.
    const { data: tokens } = await service
      .from("access_tokens")
      .select("revoked_at")
      .eq("owner_user_id", account.id);
    expect(tokens?.every((token) => token.revoked_at)).toBe(true);
    const { data: dms } = await service
      .from("dead_man_switches")
      .select("status, next_check_in_at")
      .eq("user_id", account.id)
      .single();
    expect(dms).toEqual({ status: "INACTIVE", next_check_in_at: null });

    // The hard delete and the late-upload sweep are queued, once each.
    const { data: jobs } = await service
      .from("jobs")
      .select("idempotency_key, run_at")
      .eq("type", "user.hard-delete")
      .like("idempotency_key", `user.hard-delete:${account.id}%`);
    expect(jobs?.map((job) => job.idempotency_key).sort()).toEqual([
      `user.hard-delete:${account.id}`,
      `user.hard-delete:${account.id}:late-uploads`,
    ]);
    // Minutes, never the 30-day grace period.
    for (const job of jobs ?? []) {
      expect(Date.parse(job.run_at) - Date.now()).toBeLessThan(66 * 60_000);
    }

    await accountService.purgeAccount(service, account.id, account.clerkUserId);
    await expectPurged(account);
  });

  it("reports pending, keeps access closed, and a retry finishes a failed purge", async () => {
    const account = await seedAccount("retry");
    clerk.failNext = new Error("clerk unavailable");

    const result = await accountService.deleteAccountNow(appUser(account), `corr-${RUN}`);
    expect(result.status).toBe("CLEANUP_PENDING");
    // Storage went first; the row — and with it the block — is still there.
    expect(await objectExists("documents", account.documentKey)).toBe(false);
    expect((await userRow(account.id))?.deleted_at).not.toBeNull();
    const owner = await createUserScopedClient(account.clerkUserId);
    expect((await owner.from("beneficiaries").select("id")).data).toEqual([]);

    // The queued job is the retry.
    await userHardDeleteHandler(
      {
        id: crypto.randomUUID(),
        payload: { userId: account.id, clerkUserId: account.clerkUserId },
      } as unknown as JobRow,
      service,
    );
    await expectPurged(account);
  });

  it("treats an already-deleted Clerk identity as done", async () => {
    const account = await seedAccount("clerk404");
    await service.rpc("begin_account_deletion", { p_user_id: account.id });
    clerk.failNext = new ClerkAPIResponseError("Not Found", { data: [], status: 404 });

    const result = await accountService.purgeAccount(service, account.id, account.clerkUserId);
    expect(result.rowDeleted).toBe(true);
    expect(await userRow(account.id)).toBeNull();
  });

  it("is safe under concurrent requests and repeated runs", async () => {
    const account = await seedAccount("concurrent");
    const results = await Promise.all([
      accountService.deleteAccountNow(appUser(account), `corr-a-${RUN}`),
      accountService.deleteAccountNow(appUser(account), `corr-b-${RUN}`),
    ]);
    // Each answer is truthful: done, or (if the other run held the row) pending.
    for (const result of results) expect(["DELETED", "CLEANUP_PENDING"]).toContain(result.status);
    await accountService.purgeAccount(service, account.id, account.clerkUserId);
    await expectPurged(account);

    const { count: starts } = await service
      .from("audit_log")
      .select("*", { count: "exact", head: true })
      .eq("resource_id", account.id)
      .eq("action", "user.deleted");
    expect(starts).toBe(1);
  });

  it("sweeps an object written after the purge through an old signed upload URL", async () => {
    const account = await seedAccount("late");
    await accountService.deleteAccountNow(appUser(account), `corr-${RUN}`);
    const lateKey = `${account.id}/${crypto.randomUUID()}`;
    await service.storage
      .from("documents")
      .upload(lateKey, PDF, { contentType: "application/pdf" });

    const result = await accountService.purgeAccount(service, account.id, account.clerkUserId);
    expect(result).toEqual({ objectsRemoved: 1, rowDeleted: false });
    expect(await objectExists("documents", lateKey)).toBe(false);
  });

  it("delivers no new access link for an emergency grant once deletion has begun", async () => {
    const account = await seedAccount("eagrant");
    const { data: document } = await service
      .from("documents")
      .select("id")
      .eq("user_id", account.id)
      .single();
    const { data: config, error: configError } = await service
      .from("emergency_access_configs")
      .insert({
        user_id: account.id,
        beneficiary_id: account.beneficiaryId,
        access_scope: { documents: [document!.id], assets: [], videos: [], planSections: [] },
      })
      .select("id")
      .single();
    if (configError) throw configError;
    // Approved just before the deletion; its delivery job runs after it began.
    const { data: request, error: requestError } = await service
      .from("emergency_access_requests")
      .insert({
        config_id: config.id,
        requester_email: "eagrant@example.com",
        status: "APPROVED",
        decided_by: "OWNER",
        decided_at: new Date().toISOString(),
        request_expires_at: new Date(Date.now() + 86_400_000).toISOString(),
      })
      .select("id")
      .single();
    if (requestError) throw requestError;
    const { data: pending, error: pendingError } = await service
      .from("emergency_access_requests")
      .insert({
        config_id: config.id,
        requester_email: "eagrant@example.com",
        status: "VERIFIED",
        request_expires_at: new Date(Date.now() + 86_400_000).toISOString(),
      })
      .select("id")
      .single();
    if (pendingError) throw pendingError;
    await service.rpc("begin_account_deletion", { p_user_id: account.id });
    outbox.links.length = 0;

    const { data: closed } = await service
      .from("emergency_access_requests")
      .select("status, decided_by")
      .eq("id", pending.id)
      .single();
    expect(closed).toEqual({ status: "DENIED", decided_by: "SYSTEM" });
    const { data: inactive } = await service
      .from("emergency_access_configs")
      .select("status")
      .eq("id", config.id)
      .single();
    expect(inactive?.status).toBe("INACTIVE");

    await accessDeliverHandler(
      {
        id: crypto.randomUUID(),
        payload: {
          grantType: "EMERGENCY_ACCESS",
          beneficiaryId: account.beneficiaryId,
          requestId: request.id,
        },
      } as unknown as JobRow,
      service,
    );

    expect(outbox.links).toEqual([]);
    const { count: live } = await service
      .from("access_tokens")
      .select("*", { count: "exact", head: true })
      .eq("owner_user_id", account.id)
      .is("revoked_at", null);
    expect(live).toBe(0);
    await accountService.purgeAccount(service, account.id, account.clerkUserId);
  });

  it("purges an account with hundreds of documents", async () => {
    const account = await seedAccount("large");
    const rows = Array.from({ length: 400 }, (_, index) => ({
      user_id: account.id,
      name: `doc-${index}.pdf`,
      mime_type: "application/pdf",
      size_bytes: 8,
      storage_key: `${account.id}/${crypto.randomUUID()}`,
    }));
    const { error } = await service.from("documents").insert(rows);
    if (error) throw error;
    await service.rpc("begin_account_deletion", { p_user_id: account.id });

    const result = await accountService.purgeAccount(service, account.id, account.clerkUserId);
    expect(result.rowDeleted).toBe(true);
    await expectPurged(account);
  });

  it("refuses an empty or path-like identifier before touching storage", async () => {
    for (const clerkUserId of ["", "/", "../user_x", "a/b"]) {
      await expect(
        accountService.purgeAccount(service, crypto.randomUUID(), clerkUserId),
      ).rejects.toThrow(/unsafe account identifier/);
    }
    await expectUntouched(bystander);
  });

  it("records no device and sends no alert for a deleted account", async () => {
    const account = await seedAccount("device");
    await service.rpc("begin_account_deletion", { p_user_id: account.id });
    const job = (userId: string) =>
      ({ id: crypto.randomUUID(), payload: { userId, sessionId: "sess_x" } }) as unknown as JobRow;

    await securityNewDeviceHandler(job(account.id), service);
    await accountService.purgeAccount(service, account.id, account.clerkUserId);
    // The job queued by a sign-in just before the deletion runs after the purge.
    await securityNewDeviceHandler(job(account.id), service);

    const { count } = await service
      .from("audit_log")
      .select("*", { count: "exact", head: true })
      .eq("actor_id", account.id)
      .eq("action", "auth.device_seen");
    expect(count).toBe(0);
  });

  it("emails nothing more to the owner once deletion has begun", async () => {
    const account = await seedAccount("mail");
    const { data: queued, error } = await service
      .from("notifications")
      .insert({
        user_id: account.id,
        type: "dms.reminder",
        title: "Check in",
        content: "Synthetic",
        channel: "EMAIL",
      })
      .select("id")
      .single();
    if (error) throw error;
    await service.rpc("begin_account_deletion", { p_user_id: account.id });

    const sentBefore = outbox.notifications.length;
    await notificationDeliverHandler(
      { id: crypto.randomUUID(), payload: { notificationId: queued.id } } as unknown as JobRow,
      service,
    );
    expect(outbox.notifications.length).toBe(sentBefore);
  });

  it("requeues a hard delete that ran out of attempts, once a day", async () => {
    const account = await seedAccount("stalled");
    await service.rpc("begin_account_deletion", { p_user_id: account.id });
    await service
      .from("jobs")
      .update({ status: "DEAD" })
      .eq("idempotency_key", `user.hard-delete:${account.id}`);

    await runHousekeeping(service);
    await runHousekeeping(service);

    const day = new Date().toISOString().slice(0, 10);
    const { data: retries } = await service
      .from("jobs")
      .select("status, payload")
      .eq("idempotency_key", `user.hard-delete:${account.id}:retry:${day}`);
    expect(retries).toHaveLength(1);
    expect(retries?.[0]).toMatchObject({
      status: "QUEUED",
      payload: { userId: account.id, clerkUserId: account.clerkUserId },
    });

    // Once the account is gone, its old DEAD job no longer produces retries.
    await accountService.purgeAccount(service, account.id, account.clerkUserId);
    await service
      .from("jobs")
      .delete()
      .like("idempotency_key", `user.hard-delete:${account.id}:retry:%`);
    await runHousekeeping(service);
    const { count } = await service
      .from("jobs")
      .select("*", { count: "exact", head: true })
      .like("idempotency_key", `user.hard-delete:${account.id}:retry:%`);
    expect(count).toBe(0);
  });

  it("refuses to purge an account that was never marked deleted", async () => {
    const account = await seedAccount("active");
    await expect(
      accountService.purgeAccount(service, account.id, account.clerkUserId),
    ).rejects.toThrow(/not marked deleted/);
    await expectUntouched(account);
  });

  it("is not callable by the account itself", async () => {
    const account = await seedAccount("selfcall");
    const owner = await createUserScopedClient(account.clerkUserId);
    const { error } = await owner.rpc("begin_account_deletion", { p_user_id: account.id });
    expect(error).not.toBeNull();
    expect((await userRow(account.id))?.deleted_at).toBeNull();
  });
});

describe.skipIf(!available)("scheduled deletion and cancellation", () => {
  it("never restarts the grace period, and cancels only while scheduled", async () => {
    const account = await seedAccount("cas");
    const first = new Date(Date.now() - 1_000).toISOString();
    expect(await userRepository.setDeletionRequested(service, account.id, first)).toBe(true);
    expect(
      await userRepository.setDeletionRequested(service, account.id, new Date().toISOString()),
    ).toBe(false);
    expect(Date.parse((await userRow(account.id))!.deletion_requested_at!)).toBe(Date.parse(first));

    expect(await userRepository.setDeletionRequested(service, account.id, null)).toBe(true);
    expect(await userRepository.setDeletionRequested(service, account.id, null)).toBe(false);
  });

  it("deletes only accounts past their 30 days, and the hard delete completes it", async () => {
    const due = await seedAccount("due");
    const early = await seedAccount("early");
    const cancelled = await seedAccount("cancelled");
    const days = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString();
    await userRepository.setDeletionRequested(service, due.id, days(31));
    // Far enough from the deadline that a concurrent suite's +25 h sweep cannot reach it.
    await userRepository.setDeletionRequested(service, early.id, days(20));

    await runHousekeeping(service);

    expect((await userRow(due.id))?.deleted_at).not.toBeNull();
    expect((await userRow(early.id))?.deleted_at).toBeNull();
    expect((await userRow(cancelled.id))?.deleted_at).toBeNull();
    const { data: started } = await service
      .from("audit_log")
      .select("metadata")
      .eq("resource_id", due.id)
      .eq("action", "user.deleted")
      .single();
    expect(started?.metadata).toMatchObject({ mode: "scheduled" });

    await accountService.purgeAccount(service, due.id, due.clerkUserId);
    await expectPurged(due);
    await expectUntouched(early);
  });

  it("lets a deletion that began first win over a late cancellation", async () => {
    const account = await seedAccount("race");
    const owner = appUser(account, new Date(Date.now() - 31 * 86_400_000).toISOString());
    await userRepository.setDeletionRequested(service, account.id, owner.deletionRequestedAt);
    const { data: started } = await service.rpc("begin_account_deletion", {
      p_user_id: account.id,
      p_requested_before: new Date(Date.now() - 30 * 86_400_000).toISOString(),
    });
    expect(started).toBe(true);

    await expect(accountService.cancelDeletion(owner, `corr-${RUN}`)).rejects.toMatchObject({
      status: 409,
    });
    expect((await userRow(account.id))?.deleted_at).not.toBeNull();
    await accountService.purgeAccount(service, account.id, account.clerkUserId);
  });

  it("lets a cancellation that came first stop the scheduled deletion", async () => {
    const account = await seedAccount("cancelfirst");
    await userRepository.setDeletionRequested(
      service,
      account.id,
      new Date(Date.now() - 31 * 86_400_000).toISOString(),
    );
    await userRepository.setDeletionRequested(service, account.id, null);
    const { data: started } = await service.rpc("begin_account_deletion", {
      p_user_id: account.id,
      p_requested_before: new Date(Date.now() - 30 * 86_400_000).toISOString(),
    });
    expect(started).toBe(false);
    await expectUntouched(account);
  });
});

describe.skipIf(!available)("deletion made in Clerk (user.deleted webhook)", () => {
  beforeAll(() => {
    vi.stubEnv("CLERK_WEBHOOK_SIGNING_SECRET", WEBHOOK_SECRET);
    resetEnvGroupCache();
  });
  afterAll(() => {
    vi.unstubAllEnvs();
    resetEnvGroupCache();
  });

  it("closes access the way the app does, keeps the data, and ignores a replay", async () => {
    const account = await seedAccount("clerkside");
    const id = `msg_${crypto.randomUUID()}`;
    const deleted = { id: account.clerkUserId, deleted: true };
    expect((await clerkWebhook(clerkDelivery(id, "user.deleted", deleted))).status).toBe(200);

    expect((await userRow(account.id))?.deleted_at).not.toBeNull();
    clerk.sessionUser = account.clerkUserId;
    try {
      expect(await getOptionalUser()).toBeNull();
    } finally {
      clerk.sessionUser = null;
    }
    const { data: dms } = await service
      .from("dead_man_switches")
      .select("status")
      .eq("user_id", account.id)
      .single();
    expect(dms?.status).toBe("INACTIVE");
    const { data: tokens } = await service
      .from("access_tokens")
      .select("revoked_at")
      .eq("owner_user_id", account.id);
    expect(tokens?.length).toBe(1);
    expect(tokens?.every((token) => token.revoked_at)).toBe(true);
    // The data stays: nothing is queued to erase it, Clerk is not called.
    expect(await hardDeleteJobs(account.id)).toBe(0);
    expect(await count("documents", "user_id", account.id)).toBe(1);
    expect(await objectExists("documents", account.documentKey)).toBe(true);
    expect(clerk.deleted).not.toContain(account.clerkUserId);
    expect(await deletionAudits(account.id)).toEqual([
      expect.objectContaining({
        mode: "identity-deleted",
        purgeQueued: false,
        accessTokensRevoked: 1,
      }),
    ]);

    const replay = await clerkWebhook(clerkDelivery(id, "user.deleted", deleted));
    expect((await replay.json()).data).toEqual({ received: true, duplicate: true });
    expect(await deletionAudits(account.id)).toHaveLength(1);
    await expectUntouched(bystander);
  });

  it("fails closed when no signing secret is configured", async () => {
    const account = await seedAccount("nosecret");
    vi.stubEnv("CLERK_WEBHOOK_SIGNING_SECRET", "");
    resetEnvGroupCache();
    try {
      const response = await clerkWebhook(
        clerkDelivery(`msg_${crypto.randomUUID()}`, "user.deleted", { id: account.clerkUserId }),
      );
      // A server error, so Clerk retries — never an accepted, unverified delivery.
      expect(response.status).toBe(500);
      expect(await response.text()).not.toContain("CLERK_WEBHOOK_SIGNING_SECRET");
      await expectUntouched(account);
    } finally {
      vi.stubEnv("CLERK_WEBHOOK_SIGNING_SECRET", WEBHOOK_SECRET);
      resetEnvGroupCache();
    }
  });

  it("refuses a delivery not signed with this environment's secret", async () => {
    const account = await seedAccount("forged");
    const deleted = { id: account.clerkUserId, deleted: true };
    const forged = clerkDelivery(
      `msg_${crypto.randomUUID()}`,
      "user.deleted",
      deleted,
      randomSecret(),
    );
    expect((await clerkWebhook(forged)).status).toBe(401);
    const unsigned = new Request("http://localhost:3000/api/webhooks/clerk", {
      method: "POST",
      body: JSON.stringify({ type: "user.deleted", data: deleted }),
    });
    expect((await clerkWebhook(unsigned)).status).toBe(401);
    await expectUntouched(account);
  });

  it("changes nothing after the app's own deletion, pending or finished", async () => {
    const pending = await seedAccount("inapp-pending");
    await service.rpc("begin_account_deletion", { p_user_id: pending.id });
    const first = clerkDelivery(`msg_${crypto.randomUUID()}`, "user.deleted", {
      id: pending.clerkUserId,
    });
    expect((await clerkWebhook(first)).status).toBe(200);
    expect(await deletionAudits(pending.id)).toEqual([
      expect.objectContaining({ mode: "immediate", purgeQueued: true }),
    ]);
    expect(await hardDeleteJobs(pending.id)).toBe(2);

    const finished = await seedAccount("inapp-done");
    const result = await accountService.deleteAccountNow(appUser(finished), `corr-${RUN}`);
    expect(result.status).toBe("DELETED");
    const second = clerkDelivery(`msg_${crypto.randomUUID()}`, "user.deleted", {
      id: finished.clerkUserId,
    });
    expect((await clerkWebhook(second)).status).toBe(200);
    expect(await userRow(finished.id)).toBeNull();
  });
});

// Opt-in (LV_SCALE_TESTS=1): uploads 1,050 objects, past one storage list page.
describe.runIf(available && process.env.LV_SCALE_TESTS === "1")("scale", () => {
  it("purges more objects than one storage listing page holds", async () => {
    const account = await seedAccount("scale");
    const keys = Array.from({ length: 1_050 }, () => `${account.id}/${crypto.randomUUID()}`);
    for (let index = 0; index < keys.length; index += 50) {
      await Promise.all(
        keys.slice(index, index + 50).map(async (key) => {
          const { error } = await service.storage
            .from("documents")
            .upload(key, PDF, { contentType: "application/pdf" });
          if (error) throw error;
        }),
      );
    }
    await service.rpc("begin_account_deletion", { p_user_id: account.id });

    const result = await accountService.purgeAccount(service, account.id, account.clerkUserId);
    expect(result.objectsRemoved).toBe(keys.length + 3);
    await expectPurged(account);
    const { data: left } = await service.storage.from("documents").list(account.id, { limit: 10 });
    expect(left).toEqual([]);
  }, 300_000);
});
