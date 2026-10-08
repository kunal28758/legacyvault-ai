import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import type { AppUser } from "@/lib/auth/ensure-app-user";
import { resetEnvGroupCache } from "@/lib/config/env";
import type { TypedSupabaseClient } from "@/lib/db/server";
import { accessDeliverHandler } from "@/lib/jobs/handlers/access-deliver";
import { dmsContactNoticeHandler } from "@/lib/jobs/handlers/dms-contact-notice";
import { runDmsScan } from "@/lib/jobs/handlers/dms-scan";
import { runHousekeeping } from "@/lib/jobs/handlers/housekeeping";
import { notificationConfirmHandler } from "@/lib/jobs/handlers/notification-confirm";
import { notificationDeliverHandler } from "@/lib/jobs/handlers/notification-deliver";
import type { JobHandler } from "@/lib/jobs/types";
import type { JobRow } from "@/lib/repositories/job.repository";
import * as jobRepository from "@/lib/repositories/job.repository";
import { hashAccessToken, mintAccessToken } from "@/lib/security/access-token";
import * as accessService from "@/lib/services/access.service";
import * as portal from "@/lib/services/access-portal.service";
import * as dmsService from "@/lib/services/dms.service";
import * as emergencyPublic from "@/lib/services/emergency-public.service";
import * as uploadService from "@/lib/services/upload.service";
import { BUCKETS, removeObject, uploadObjectKey } from "@/lib/storage/storage";

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

// The upload service reads the caller's client from the Clerk session; here it
// is Alice's Clerk-shaped token, so RLS applies exactly as in the app.
const userClient = vi.hoisted(() => ({ current: null as unknown }));
vi.mock("@/lib/db/server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/db/server")>();
  return { ...actual, createUserClient: async () => userClient.current };
});
// Delivery mints its token for real; only the outbound email is replaced, and
// what it would have carried is kept so a test can act as the recipient.
const mail = vi.hoisted(() => ({
  links: [] as string[],
  codes: [] as string[],
  notices: [] as { to: string; ownerName: string }[],
  notificationsFail: false,
  /** What the provider reports when asked about a sent message (notification.confirm). */
  outcome: "delivered" as "delivered" | "bounced" | "failed" | "pending",
  lookupFails: false,
}));
vi.mock("@/lib/email/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/email/client")>();
  return {
    ...actual,
    lookupDelivery: async () => {
      if (mail.lookupFails) throw new Error("email send failed: timeout");
      return mail.outcome;
    },
  };
});
vi.mock("@/lib/email/send", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/email/send")>();
  return {
    ...actual,
    sendAccessLinkEmail: async ({ link }: { link: string }) => {
      mail.links.push(link);
      return { providerMessageId: "msg_test" };
    },
    sendNotificationEmail: async ({ idempotencyKey }: { idempotencyKey: string }) => {
      if (mail.notificationsFail) throw new Error("provider unavailable");
      return { providerMessageId: `msg_${idempotencyKey}`, provider: "brevo" };
    },
    sendDmsContactNoticeEmail: async (input: { to: string; ownerName: string }) => {
      mail.notices.push({ to: input.to, ownerName: input.ownerName });
      return { providerMessageId: "msg_contact" };
    },
    sendReleaseCodeEmail: async ({ code }: { code: string }) => {
      mail.codes.push(code);
      return { providerMessageId: "msg_code" };
    },
  };
});

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
  process.env.ACCESS_COOKIE_KEY ??= Buffer.from(new Uint8Array(32).fill(7)).toString("base64");

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
  await service.from("documents").delete().in("user_id", [aliceId, bobId]);
  // This file is the only integration suite that uses the queue.
  await service.from("jobs").delete().not("id", "is", null);
  mail.links = [];
  mail.codes = [];
  mail.notices = [];
  mail.notificationsFail = false;
  mail.outcome = "delivered";
  mail.lookupFails = false;
});

/**
 * Runs the queued jobs of one type with their real handler, as the runner
 * would: success marks the job done; a failure leaves it queued for a retry.
 */
const HANDLERS: Record<string, JobHandler> = {
  "notification.deliver": notificationDeliverHandler,
  "notification.confirm": notificationConfirmHandler,
  "dms.contact-notice": dmsContactNoticeHandler,
  "access.deliver": accessDeliverHandler,
};
async function runQueued(type: string): Promise<number> {
  const { data } = await service.from("jobs").select("*").eq("type", type).eq("status", "QUEUED");
  let ran = 0;
  for (const job of data ?? []) {
    try {
      await HANDLERS[type](job as unknown as JobRow, service);
      await jobRepository.markSucceeded(service, job.id);
      ran += 1;
    } catch {
      // Left QUEUED: the next run retries it, exactly like a back-off retry.
    }
  }
  return ran;
}

/** An emailed link's secret: it travels in the fragment, never in the request line. */
function secretIn(link: string): string {
  const secret = new URLSearchParams(new URL(link).hash.slice(1)).get("t");
  if (!secret) throw new Error("no secret in the link's fragment");
  return secret;
}

function appUser(id: string, subject: string, name: string): AppUser {
  return {
    id,
    clerkUserId: subject,
    email: `${name.toLowerCase()}.protection@example.com`,
    emailVerified: true,
    name,
    mfaEnabled: false,
    role: "USER",
    onboardingCompletedAt: new Date().toISOString(),
    deletionRequestedAt: null,
  };
}

/** A document row as promote_upload() would leave it (no file is needed here). */
async function document(userId: string, name: string): Promise<string> {
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

function scopeOf(assetId: string | null, documentIds: string[] = []) {
  return {
    documents: documentIds,
    assets: assetId ? [{ type: "FINANCIAL_ASSET", id: assetId }] : [],
    videos: [],
    planSections: [],
  };
}

async function configureSwitch(
  contactIds: string[],
  assetId: string | null,
  documentIds: string[] = [],
): Promise<string> {
  const { data, error } = await alice.rpc("dms_configure", {
    p_config: {
      inactivityPeriodDays: 30,
      checkInFrequencyDays: 7,
      escalationDelayHours: 24,
      escalationRules: { steps: 1 },
    } as never,
    p_contact_beneficiary_ids: contactIds,
    p_release_scope: scopeOf(assetId, documentIds) as never,
  });
  if (error) throw error;
  return data as string;
}

/**
 * Makes a switch overdue and runs the hourly scan until it releases. Between
 * ticks the owner's warning emails are delivered, as the job runner would —
 * release is refused until one of them reached the provider.
 */
async function driveToRelease(
  switchId: string,
  { overdue = true, ticks = 8 } = {},
): Promise<string[]> {
  if (overdue) {
    const past = new Date(Date.now() - 400 * 24 * 3_600_000).toISOString();
    await service
      .from("dead_man_switches")
      .update({ last_check_in_at: past, next_check_in_at: past })
      .eq("id", switchId);
  }

  const statuses: string[] = [];
  for (let tick = 0; tick < ticks; tick += 1) {
    await runDmsScan(service, new Date());
    await runQueued("notification.deliver");
    // The provider is asked what became of each warning (run_at is ignored here).
    await runQueued("notification.confirm");
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
  return statuses;
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

    const statuses = await driveToRelease(switchId);

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

  it("releases a freshly uploaded document and delivers it, with no scanner involved", async () => {
    vi.stubEnv("APP_URL", "http://localhost:3000");
    resetEnvGroupCache();
    userClient.current = alice;
    const owner: AppUser = {
      id: aliceId,
      clerkUserId: SUBJECT_A,
      email: "alice.protection@example.com",
      emailVerified: true,
      name: "Alice",
      mfaEnabled: false,
      role: "USER",
      onboardingCompletedAt: new Date().toISOString(),
      deletionRequestedAt: null,
    };

    // A real upload: private bucket, size and type checks, promotion. No scan.
    const bytes = new TextEncoder().encode("%PDF-1.7\nLetter to my family\n%%EOF\n");
    const ticket = await uploadService.createUploadSession(
      owner,
      {
        kind: "DOCUMENT",
        name: "letter.pdf",
        mimeType: "application/pdf",
        sizeBytes: bytes.byteLength,
      },
      "test",
    );
    const put = await fetch(ticket.uploadUrl, {
      method: "PUT",
      headers: { "content-type": "application/pdf" },
      body: bytes,
    });
    expect(put.ok).toBe(true);
    const uploaded = await uploadService.completeUpload(owner, ticket.uploadId, {}, "test");
    expect(uploaded.status).toBe("PROMOTED");
    const documentId = uploaded.documentId!;

    try {
      const contact = await beneficiary("dms-document@example.com");
      const switchId = await configureSwitch([contact], null, [documentId]);

      // Release completes without waiting on anything about the file.
      expect((await driveToRelease(switchId)).at(-1)).toBe("RELEASED");

      // The queued delivery mints a token scoped to the release, document included.
      const { data: job } = await service
        .from("jobs")
        .select("*")
        .eq("type", "access.deliver")
        .single();
      await accessDeliverHandler(job as unknown as JobRow, service);
      const { data: token } = await service
        .from("access_tokens")
        .select("id, scope, delivered_at")
        .eq("owner_user_id", aliceId)
        .single();
      expect((token!.scope as { documents: string[] }).documents).toEqual([documentId]);
      expect(token!.delivered_at).not.toBeNull();

      // The contact confirms a code sent to their own address, then receives
      // exactly the uploaded bytes, through a signed link.
      const plaintext = secretIn(mail.links[0]);
      const challenge = await portal.exchange(plaintext, "test");
      expect(challenge).toMatchObject({ verificationRequired: true });
      await portal.exchange(plaintext, "test", mail.codes[0]);
      const grant = await portal.requireGrant(token!.id);
      const access = await portal.documentDownload(grant, documentId, "test");
      const fetched = await fetch(access.url);
      expect(fetched.ok).toBe(true);
      expect(new Uint8Array(await fetched.arrayBuffer())).toEqual(bytes);
    } finally {
      vi.unstubAllEnvs();
      resetEnvGroupCache();
      // Its version row references Alice, which would stop the next run from
      // re-creating her in `beforeAll`.
      await service.from("documents").delete().eq("id", documentId);
      await removeObject(BUCKETS.documents, uploadObjectKey(aliceId, ticket.uploadId));
    }
  }, 60_000);
});

describe.skipIf(!available)("legacy execution engine", () => {
  const HOUR = 3_600_000;

  async function statusOf(switchId: string): Promise<string> {
    const { data } = await service
      .from("dead_man_switches")
      .select("status")
      .eq("id", switchId)
      .single();
    return data!.status;
  }

  /** Walks a switch forward through dms_transition, the system path the scan uses. */
  async function advance(switchId: string, to: string): Promise<void> {
    const path: [string, string, string][] = [
      ["ACTIVE", "REMINDER_SENT", "MISSED_CHECK_IN"],
      ["REMINDER_SENT", "GRACE_PERIOD", "MISSED_CHECK_IN"],
      ["GRACE_PERIOD", "ESCALATING", "ESCALATION_STEP"],
      ["ESCALATING", "RELEASING", "ESCALATION_STEP"],
      ["RELEASING", "RELEASED", "RELEASE"],
    ];
    for (const [from, next, event] of path) {
      const current = await statusOf(switchId);
      if (current === to) return;
      if (current !== from) continue;
      if (next === "RELEASING") await ownerWarned(switchId);
      const { error } = await service.rpc("dms_transition", {
        p_switch_id: switchId,
        p_from: from as never,
        p_to: next as never,
        p_event_type: event as never,
        p_metadata: { nextCheckInAt: new Date(Date.now() + HOUR).toISOString() } as never,
      });
      if (error) throw error;
    }
  }

  /** A release warning in the state given (DELIVERED = the provider confirmed it). */
  async function warning(
    switchId: string,
    fields: { status?: string; providerMessageId?: string | null; createdAt?: string } = {},
  ): Promise<string> {
    const { data, error } = await service
      .from("notifications")
      .insert({
        user_id: aliceId,
        type: "dms.grace_period",
        title: "Your LegacyVault check-in is overdue",
        content: "test",
        channel: "BOTH",
        delivery_status: (fields.status ?? "DELIVERED") as never,
        provider_message_id:
          fields.providerMessageId === undefined
            ? `<${crypto.randomUUID()}@smtp-relay>`
            : fields.providerMessageId,
        delivery_provider: "brevo",
        metadata: { switchId } as never,
        ...(fields.createdAt ? { created_at: fields.createdAt } : {}),
      })
      .select("id")
      .single();
    if (error) throw error;
    return data.id;
  }
  const ownerWarned = (switchId: string) => warning(switchId);

  /** Makes the next scan find the switch due again. */
  async function due(switchId: string): Promise<void> {
    await service
      .from("dead_man_switches")
      .update({ next_check_in_at: new Date(Date.now() - 1000).toISOString() })
      .eq("id", switchId);
  }

  async function auditCount(switchId: string, action: string): Promise<number> {
    const { data } = await service
      .from("audit_log")
      .select("id")
      .eq("resource_id", switchId)
      .eq("action", action);
    return (data ?? []).length;
  }

  /** Configured, released and delivered: returns the switch, the link and its token. */
  async function released(
    contactEmail: string,
    scope: { assetId?: string | null; documentIds?: string[] } = {},
  ): Promise<{ switchId: string; contact: string; plaintext: string; tokenId: string }> {
    const contact = await beneficiary(contactEmail);
    const assetId =
      scope.assetId === undefined ? await asset(alice, "Released savings") : scope.assetId;
    const switchId = await configureSwitch([contact], assetId, scope.documentIds ?? []);
    await advance(switchId, "RELEASED");
    await runQueued("access.deliver");
    const plaintext = secretIn(mail.links.at(-1)!);
    const { data: token } = await service
      .from("access_tokens")
      .select("id")
      .eq("token_hash", hashAccessToken(plaintext))
      .single();
    return { switchId, contact, plaintext, tokenId: token!.id };
  }

  /** Opens a release link the way the portal does: code requested, code entered. */
  async function verified(plaintext: string): Promise<void> {
    const challenge = await portal.exchange(plaintext, "test");
    expect(challenge).toMatchObject({ verificationRequired: true });
    const session = await portal.exchange(plaintext, "test", mail.codes.at(-1));
    expect(session).toHaveProperty("cookie");
  }

  it("refuses a schedule with no warning window before the grace period", async () => {
    const contact = await beneficiary("exec-window@example.com");
    const { error } = await alice.rpc("dms_configure", {
      p_config: { inactivityPeriodDays: 30, checkInFrequencyDays: 30 } as never,
      p_contact_beneficiary_ids: [contact],
      p_release_scope: scopeOf(await asset(alice, "Savings")) as never,
    });
    expect(error?.code).toBe("LV422");
    expect(error?.message).toContain("WARNING_WINDOW_INVALID");
  });

  it("pauses only a switch on schedule, so pausing can never end a warning or hide a release", async () => {
    const contact = await beneficiary("exec-pause@example.com");
    const switchId = await configureSwitch([contact], await asset(alice, "Savings"));
    await advance(switchId, "REMINDER_SENT");

    expect((await alice.rpc("dms_pause", {})).error?.code).toBe("LV409");
    expect(await statusOf(switchId)).toBe("REMINDER_SENT");

    await advance(switchId, "RELEASED");
    expect((await alice.rpc("dms_pause", {})).error?.code).toBe("LV409");
    expect(await statusOf(switchId)).toBe("RELEASED");
  });

  it.each(["REMINDER_SENT", "GRACE_PERIOD"])(
    "accepts a check-in during %s as an ordinary check-in",
    async (stage) => {
      const contact = await beneficiary(`exec-checkin-${stage.toLowerCase()}@example.com`);
      const switchId = await configureSwitch([contact], await asset(alice, "Savings"));
      await advance(switchId, stage);

      expect((await alice.rpc("dms_check_in", {})).error).toBeNull();
      expect(await statusOf(switchId)).toBe("ACTIVE");
      const { data: events } = await alice
        .from("dead_man_switch_events")
        .select("event_type, previous_state")
        .eq("dead_man_switch_id", switchId)
        .order("created_at", { ascending: false })
        .limit(1);
      expect(events?.[0]).toEqual({ event_type: "CHECK_IN", previous_state: stage });
      expect(await auditCount(switchId, "dms.release_cancelled")).toBe(0);
    },
  );

  it.each(["ESCALATING", "RELEASING"])(
    "treats a check-in during %s as authoritative and records the cancelled release",
    async (stage) => {
      const contact = await beneficiary(`exec-checkin-${stage.toLowerCase()}@example.com`);
      const switchId = await configureSwitch([contact], await asset(alice, "Savings"));
      await advance(switchId, stage);

      expect((await alice.rpc("dms_check_in", {})).error).toBeNull();
      expect(await statusOf(switchId)).toBe("ACTIVE");

      const { data: events } = await alice
        .from("dead_man_switch_events")
        .select("event_type, previous_state, metadata")
        .eq("dead_man_switch_id", switchId)
        .order("created_at", { ascending: false })
        .limit(1);
      expect(events?.[0]).toMatchObject({
        event_type: "RECOVERY",
        previous_state: stage,
        metadata: { releaseCancelled: true },
      });
      const { data: audits } = await service
        .from("audit_log")
        .select("action")
        .eq("resource_id", switchId)
        .in("action", ["dms.checked_in", "dms.release_cancelled"]);
      expect(audits?.map((row) => row.action).sort()).toEqual([
        "dms.checked_in",
        "dms.release_cancelled",
      ]);
    },
  );

  it("refuses a plain check-in after release (that is a recovery) and recovers from the grace period", async () => {
    const contact = await beneficiary("exec-recover@example.com");
    const switchId = await configureSwitch([contact], await asset(alice, "Savings"));
    await advance(switchId, "GRACE_PERIOD");
    expect((await alice.rpc("dms_cancel_escalation", {})).error).toBeNull();
    expect(await statusOf(switchId)).toBe("ACTIVE");

    await advance(switchId, "RELEASED");
    expect((await alice.rpc("dms_check_in", {})).error?.code).toBe("LV409");
    expect(await statusOf(switchId)).toBe("RELEASED");
  });

  it("tells each eligible trusted contact once when escalation starts — no link, nothing released", async () => {
    const told = await beneficiary("exec-notice@example.com");
    const skipped = await beneficiary("exec-notice-inactive@example.com");
    const switchId = await configureSwitch([told, skipped], await asset(alice, "Savings"));
    await alice.rpc("set_beneficiary_status", { p_beneficiary_id: skipped, p_status: "INACTIVE" });
    await advance(switchId, "ESCALATING");

    const { data: jobs } = await service
      .from("jobs")
      .select("payload")
      .eq("type", "dms.contact-notice");
    expect(jobs).toHaveLength(1);
    // Only who and which event — never a link, a scope or a secret.
    expect(Object.keys(jobs![0].payload as object).sort()).toEqual([
      "beneficiaryId",
      "eventId",
      "switchId",
    ]);
    expect((jobs![0].payload as { beneficiaryId: string }).beneficiaryId).toBe(told);

    expect(await runQueued("dms.contact-notice")).toBe(1);
    expect(mail.notices).toEqual([{ to: "exec-notice@example.com", ownerName: "Alice" }]);
    expect(mail.links).toHaveLength(0);
    const { data: tokens } = await service
      .from("access_tokens")
      .select("id")
      .eq("owner_user_id", aliceId);
    expect(tokens ?? []).toHaveLength(0);
  });

  it("sends no contact notice once the owner checked in", async () => {
    const contact = await beneficiary("exec-notice-late@example.com");
    const switchId = await configureSwitch([contact], await asset(alice, "Savings"));
    await advance(switchId, "ESCALATING");
    expect((await alice.rpc("dms_check_in", {})).error).toBeNull();

    expect(await runQueued("dms.contact-notice")).toBe(1);
    expect(mail.notices).toHaveLength(0);
  });

  it("holds the release while the provider is down, audits the hold once, then proceeds", async () => {
    userClient.current = alice;
    const owner = appUser(aliceId, SUBJECT_A, "Alice");
    const contact = await beneficiary("exec-held@example.com");
    const switchId = await configureSwitch([contact], await asset(alice, "Savings"));

    mail.notificationsFail = true;
    const held = await driveToRelease(switchId, { ticks: 6 });
    expect(held.at(-1)).toBe("ESCALATING");
    expect(held).not.toContain("RELEASING");
    // Several refused scans, one audit row: the start of the hold.
    expect(await auditCount(switchId, "dms.release_held")).toBe(1);
    const { data: hold } = await service
      .from("audit_log")
      .select("outcome, metadata")
      .eq("resource_id", switchId)
      .eq("action", "dms.release_held")
      .single();
    expect(hold).toMatchObject({
      outcome: "DENIED",
      metadata: { reason: "OWNER_WARNING_NOT_DELIVERED" },
    });

    // The owner sees it, with what is wrong and when it was last checked.
    const view = await dmsService.getSwitch(owner);
    expect(view?.releaseHold).toEqual({
      since: expect.any(String),
      lastCheckedAt: expect.any(String),
    });
    expect(view?.latestWarning?.status).toBe("FAILED");

    // The provider recovers; the queued warnings are retried, confirmed, released.
    mail.notificationsFail = false;
    const resumed = await driveToRelease(switchId, { overdue: false, ticks: 4 });
    expect(resumed.at(-1)).toBe("RELEASED");
    expect(await auditCount(switchId, "dms.release_hold_cleared")).toBe(1);
    const { data: row } = await service
      .from("dead_man_switches")
      .select("release_held_at, release_hold_checked_at")
      .eq("id", switchId)
      .single();
    expect(row).toEqual({ release_held_at: null, release_hold_checked_at: null });
  }, 90_000);

  it("authorizes release only on a warning the provider confirmed delivered", async () => {
    const contact = await beneficiary("exec-gate@example.com");
    const switchId = await configureSwitch([contact], await asset(alice, "Savings"));
    await advance(switchId, "ESCALATING");
    const toReleasing = () =>
      service.rpc("dms_transition", {
        p_switch_id: switchId,
        p_from: "ESCALATING",
        p_to: "RELEASING",
        p_event_type: "ESCALATION_STEP",
      });
    const { data: dms } = await service
      .from("dead_man_switches")
      .select("last_check_in_at")
      .eq("id", switchId)
      .single();
    const beforeCycle = new Date(Date.parse(dms!.last_check_in_at!) - 60_000).toISOString();

    const refused: [string, () => Promise<string>][] = [
      ["no warning at all", async () => ""],
      ["accepted but unconfirmed (SENT)", () => warning(switchId, { status: "SENT" })],
      ["bounced", () => warning(switchId, { status: "BOUNCED" })],
      ["failed", () => warning(switchId, { status: "FAILED" })],
      ["still pending", () => warning(switchId, { status: "PENDING", providerMessageId: null })],
      [
        "delivered in the app only (no email)",
        () => warning(switchId, { providerMessageId: null }),
      ],
      ["delivered in an earlier cycle", () => warning(switchId, { createdAt: beforeCycle })],
      ["delivered for another switch", () => warning(crypto.randomUUID())],
    ];
    for (const [name, arrange] of refused) {
      const id = await arrange();
      const { data, error } = await toReleasing();
      expect(error, name).toBeNull();
      expect(data, name).toBeNull();
      expect(await statusOf(switchId), name).toBe("ESCALATING");
      if (id) await service.from("notifications").delete().eq("id", id);
    }
    expect(await auditCount(switchId, "dms.release_held")).toBe(1);

    await warning(switchId);
    const { data: eventId, error } = await toReleasing();
    expect(error).toBeNull();
    expect(eventId).toEqual(expect.any(String));
    expect(await statusOf(switchId)).toBe("RELEASING");
    expect(await auditCount(switchId, "dms.release_hold_cleared")).toBe(1);
  });

  it("re-asks the provider about unconfirmed warnings, and re-warns at most once a day", async () => {
    const contact = await beneficiary("exec-rewarn@example.com");
    const switchId = await configureSwitch([contact], await asset(alice, "Savings"));
    await service
      .from("dead_man_switches")
      .update({ escalation_rules: { steps: 1 } as never })
      .eq("id", switchId);
    await advance(switchId, "ESCALATING");
    await service
      .from("dead_man_switches")
      .update({ current_escalation_step: 1 })
      .eq("id", switchId);

    // An accepted warning still unconfirmed: the scan asks the provider again.
    const unconfirmed = await warning(switchId, { status: "SENT" });
    await due(switchId);
    await runDmsScan(service, new Date());
    const { data: confirms } = await service
      .from("jobs")
      .select("payload")
      .eq("type", "notification.confirm");
    expect(
      confirms?.map((job) => (job.payload as { notificationId: string }).notificationId),
    ).toContain(unconfirmed);
    // While one is on its way, no extra warning is sent.
    expect(
      (await service.from("notifications").select("id").eq("type", "dms.release_held")).data,
    ).toHaveLength(0);

    // It bounced: nothing is in flight any more, so a fresh warning goes out — once.
    await service
      .from("notifications")
      .update({ delivery_status: "BOUNCED" })
      .eq("id", unconfirmed);
    for (let scan = 0; scan < 2; scan += 1) {
      await due(switchId);
      await runDmsScan(service, new Date());
    }
    const { data: notices } = await service
      .from("notifications")
      .select("id, channel, metadata")
      .eq("type", "dms.release_held");
    expect(notices).toHaveLength(1);
    expect(notices![0]).toMatchObject({ channel: "BOTH", metadata: { switchId } });
    expect(await statusOf(switchId)).toBe("ESCALATING");

    // Once that warning is confirmed delivered, the release proceeds.
    expect(await runQueued("notification.deliver")).toBe(1);
    expect(await runQueued("notification.confirm")).toBeGreaterThanOrEqual(1);
    await due(switchId);
    await runDmsScan(service, new Date());
    expect(await statusOf(switchId)).toBe("RELEASING");
  });

  it("keeps a release held when the provider cannot be asked, or reports a bounce", async () => {
    const contact = await beneficiary("exec-unknown@example.com");
    const switchId = await configureSwitch([contact], await asset(alice, "Savings"));
    await advance(switchId, "ESCALATING");
    const id = await warning(switchId, { status: "SENT" });
    await jobRepository.enqueue(service, "notification.confirm", { notificationId: id }, `t:${id}`);

    mail.lookupFails = true;
    expect(await runQueued("notification.confirm")).toBe(0);
    mail.lookupFails = false;
    mail.outcome = "pending";
    expect(await runQueued("notification.confirm")).toBe(0);
    mail.outcome = "bounced";
    expect(await runQueued("notification.confirm")).toBe(1);

    const { data: row } = await service
      .from("notifications")
      .select("delivery_status")
      .eq("id", id)
      .single();
    expect(row?.delivery_status).toBe("BOUNCED");
    const { data } = await service.rpc("dms_transition", {
      p_switch_id: switchId,
      p_from: "ESCALATING",
      p_to: "RELEASING",
      p_event_type: "ESCALATION_STEP",
    });
    expect(data).toBeNull();
  });

  it("ends a hold on check-in and records how long it lasted", async () => {
    const contact = await beneficiary("exec-hold-checkin@example.com");
    const switchId = await configureSwitch([contact], await asset(alice, "Savings"));
    await advance(switchId, "ESCALATING");
    await service.rpc("dms_transition", {
      p_switch_id: switchId,
      p_from: "ESCALATING",
      p_to: "RELEASING",
      p_event_type: "ESCALATION_STEP",
    });
    expect((await alice.rpc("dms_check_in", {})).error).toBeNull();

    const { data: row } = await service
      .from("dead_man_switches")
      .select("status, release_held_at")
      .eq("id", switchId)
      .single();
    expect(row).toEqual({ status: "ACTIVE", release_held_at: null });
    const { data: cancelled } = await service
      .from("audit_log")
      .select("metadata")
      .eq("resource_id", switchId)
      .eq("action", "dms.release_cancelled")
      .single();
    expect(
      (cancelled!.metadata as { releaseHeldSince: string | null }).releaseHeldSince,
    ).not.toBeNull();
  });

  it("asks a contact for a code before a release link opens anything", async () => {
    const { plaintext, tokenId } = await released("exec-code@example.com");

    // A link alone is not a session.
    await expect(portal.requireGrant(tokenId)).rejects.toMatchObject({ status: 401 });
    const challenge = await portal.exchange(plaintext, "test");
    expect(challenge).toEqual({
      verificationRequired: true,
      sentTo: "e•••@example.com",
      codeExpiresAt: expect.any(String),
    });
    expect(mail.codes).toHaveLength(1);
    const code = mail.codes[0];
    const wrong = code === "000000" ? "111111" : "000000";

    await expect(portal.exchange(plaintext, "test", wrong)).rejects.toMatchObject({
      status: 422,
      details: { restart: false },
    });
    await expect(portal.exchange(plaintext, "test", wrong)).rejects.toMatchObject({ status: 422 });
    // The third wrong code ends the challenge; the right one no longer works.
    await expect(portal.exchange(plaintext, "test", wrong)).rejects.toMatchObject({
      details: { restart: true },
    });
    await expect(portal.exchange(plaintext, "test", code)).rejects.toMatchObject({ status: 422 });

    // A fresh code opens a session scoped to exactly the release.
    await verified(plaintext);
    const grant = await portal.requireGrant(tokenId);
    expect(grant.verifiedAt).not.toBeNull();
    const resources = await portal.listResources(grant, "test");
    expect(resources.assets).toHaveLength(1);
    expect(resources.documents).toHaveLength(0);

    // Re-using the link elsewhere needs a new code again.
    expect(await portal.exchange(plaintext, "test")).toMatchObject({ verificationRequired: true });

    // The owner sees that it was verified; nobody can read the code hash.
    const { data: own } = await alice
      .from("access_tokens")
      .select("verified_at")
      .eq("id", tokenId)
      .single();
    expect(own?.verified_at).not.toBeNull();
    expect(
      (await alice.from("access_tokens").select("verification_code_hash")).error,
    ).not.toBeNull();
    // The challenge functions belong to the service role alone.
    expect(
      (
        await alice.rpc("system_check_release_verification", {
          p_token_id: tokenId,
          p_code_hash: hashAccessToken(code),
        })
      ).error,
    ).not.toBeNull();
  });

  it("does not let a release link from before migration 0009 bypass verification", async () => {
    // A link as an earlier release would have left it: live, delivered, and
    // with no verification state at all — plus a session cookie already issued.
    const contact = await beneficiary("exec-legacy@example.com");
    const switchId = await configureSwitch([contact], await asset(alice, "Savings"));
    await advance(switchId, "RELEASED");
    const minted = mintAccessToken();
    const { data: token, error } = await service
      .from("access_tokens")
      .insert({
        owner_user_id: aliceId,
        beneficiary_id: contact,
        grant_type: "DMS_RELEASE",
        dead_man_switch_id: switchId,
        token_hash: minted.hash,
        scope: scopeOf(null) as never,
        expires_at: new Date(Date.now() + 86_400_000).toISOString(),
        delivered_at: new Date().toISOString(),
        used_at: new Date().toISOString(),
      })
      .select("id, verified_at")
      .single();
    if (error) throw error;
    expect(token.verified_at).toBeNull();

    // A session cookie for it resolves through requireGrant: refused on its next request…
    await expect(portal.requireGrant(token.id)).rejects.toMatchObject({ status: 401 });
    // …and the link itself now asks for a code before anything opens.
    expect(await portal.exchange(minted.plaintext, "test")).toMatchObject({
      verificationRequired: true,
    });
  });

  it("answers an unknown, a revoked and an expired link identically", async () => {
    const { plaintext, tokenId } = await released("exec-enumerate@example.com");
    const refusal = {
      status: 401,
      code: "UNAUTHENTICATED",
      message: "This link is no longer valid.",
    };

    await expect(portal.exchange(mintAccessToken().plaintext, "test")).rejects.toMatchObject(
      refusal,
    );
    await service
      .from("access_tokens")
      .update({ expires_at: new Date(Date.now() - 1000).toISOString() })
      .eq("id", tokenId);
    await expect(portal.exchange(plaintext, "test")).rejects.toMatchObject(refusal);
    await service
      .from("access_tokens")
      .update({ expires_at: new Date(Date.now() + 86_400_000).toISOString() })
      .eq("id", tokenId);
    await alice.rpc("revoke_access_token", { p_token_id: tokenId });
    await expect(portal.exchange(plaintext, "test")).rejects.toMatchObject(refusal);
    // No code was ever sent for a refused link.
    expect(mail.codes).toHaveLength(0);
  });

  it("verifies a code once: a duplicate or an expired code opens nothing", async () => {
    const { plaintext, tokenId } = await released("exec-dup-code@example.com");
    await portal.exchange(plaintext, "test");
    const code = mail.codes.at(-1)!;

    // The same right code twice at once: one session, one refusal.
    const results = await Promise.allSettled([
      portal.exchange(plaintext, "test", code),
      portal.exchange(plaintext, "test", code),
    ]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);

    // A new code that has expired is refused, and must be requested again.
    await portal.exchange(plaintext, "test");
    await service
      .from("access_tokens")
      .update({ verification_expires_at: new Date(Date.now() - 1000).toISOString() })
      .eq("id", tokenId);
    await expect(portal.exchange(plaintext, "test", mail.codes.at(-1))).rejects.toMatchObject({
      status: 422,
      details: { restart: true },
    });
  });

  it("applies each transition once when scans, transitions or deliveries race", async () => {
    const contact = await beneficiary("exec-race@example.com");
    const switchId = await configureSwitch([contact], await asset(alice, "Savings"));
    const past = new Date(Date.now() - 400 * 24 * 3_600_000).toISOString();
    await service
      .from("dead_man_switches")
      .update({ last_check_in_at: past, next_check_in_at: past })
      .eq("id", switchId);

    // Two scans at once: one ACTIVE → REMINDER_SENT, not two.
    await Promise.all([runDmsScan(service, new Date()), runDmsScan(service, new Date())]);
    const { data: missed } = await service
      .from("dead_man_switch_events")
      .select("id")
      .eq("dead_man_switch_id", switchId)
      .eq("event_type", "MISSED_CHECK_IN");
    expect(missed).toHaveLength(1);

    // The same transition twice at once: exactly one succeeds.
    const both = await Promise.all([
      service.rpc("dms_transition", {
        p_switch_id: switchId,
        p_from: "REMINDER_SENT",
        p_to: "GRACE_PERIOD",
        p_event_type: "MISSED_CHECK_IN",
      }),
      service.rpc("dms_transition", {
        p_switch_id: switchId,
        p_from: "REMINDER_SENT",
        p_to: "GRACE_PERIOD",
        p_event_type: "MISSED_CHECK_IN",
      }),
    ]);
    expect(both.filter((result) => result.error === null)).toHaveLength(1);
    expect(both.find((result) => result.error)?.error?.code).toBe("LV409");

    // Two deliveries of one release at once: one live link, one email.
    await advance(switchId, "RELEASED");
    const { data: job } = await service
      .from("jobs")
      .select("*")
      .eq("type", "access.deliver")
      .single();
    await Promise.allSettled([
      accessDeliverHandler(job as unknown as JobRow, service),
      accessDeliverHandler(job as unknown as JobRow, service),
    ]);
    const { data: live } = await service
      .from("access_tokens")
      .select("id")
      .eq("dead_man_switch_id", switchId)
      .is("revoked_at", null);
    expect(live).toHaveLength(1);
    expect(mail.links).toHaveLength(1);
  });

  it("ends release access on recovery, even for a link that escaped revocation", async () => {
    const { switchId, plaintext, tokenId } = await released("exec-recovered@example.com");
    await verified(plaintext);
    await portal.requireGrant(tokenId);

    expect((await alice.rpc("dms_cancel_escalation", {})).error).toBeNull();
    const { data: token } = await service
      .from("access_tokens")
      .select("revoked_reason")
      .eq("id", tokenId)
      .single();
    expect(token?.revoked_reason).toBe("RECOVERY");
    await expect(portal.requireGrant(tokenId)).rejects.toMatchObject({ status: 401 });

    // Defence in depth: were revocation ever missed, a recovered switch still refuses.
    await service
      .from("access_tokens")
      .update({ revoked_at: null, revoked_reason: null })
      .eq("id", tokenId);
    expect(await statusOf(switchId)).toBe("ACTIVE");
    await expect(portal.requireGrant(tokenId)).rejects.toMatchObject({ status: 401 });
    await expect(portal.exchange(plaintext, "test")).rejects.toMatchObject({ status: 401 });
  });

  it("ends release access when the switch is disabled", async () => {
    const { plaintext, tokenId } = await released("exec-disabled@example.com");
    await verified(plaintext);

    expect((await alice.rpc("dms_disable", {})).error).toBeNull();
    await expect(portal.requireGrant(tokenId)).rejects.toMatchObject({ status: 401 });
  });

  it("releases what still exists, and issues nothing when nothing does", async () => {
    userClient.current = alice;
    const owner = appUser(aliceId, SUBJECT_A, "Alice");
    const kept = await document(aliceId, "Letter.pdf");
    const deleted = await document(aliceId, "Old deed.pdf");
    const contact = await beneficiary("exec-live@example.com");
    const switchId = await configureSwitch([contact], null, [kept, deleted]);
    expect((await alice.rpc("delete_document", { p_document_id: deleted })).error).toBeNull();

    // The owner is shown the gap before anything happens.
    expect((await dmsService.getSwitch(owner))?.unavailableScopeItems).toBe(1);

    await advance(switchId, "RELEASED");
    await runQueued("access.deliver");
    const { data: token } = await service
      .from("access_tokens")
      .select("scope")
      .eq("dead_man_switch_id", switchId)
      .single();
    expect((token!.scope as { documents: string[] }).documents).toEqual([kept]);

    // A second owner whose whole scope is gone: delivery records it and stops.
    await service.from("access_tokens").delete().eq("owner_user_id", aliceId);
    await service.from("dead_man_switches").delete().eq("id", switchId);
    await service.from("jobs").delete().not("id", "is", null);
    const only = await document(aliceId, "Only.pdf");
    const nextSwitch = await configureSwitch([contact], null, [only]);
    await alice.rpc("delete_document", { p_document_id: only });
    await advance(nextSwitch, "RELEASED");
    expect(await runQueued("access.deliver")).toBe(1);
    const { data: none } = await service
      .from("access_tokens")
      .select("id")
      .eq("dead_man_switch_id", nextSwitch);
    expect(none ?? []).toHaveLength(0);
    const { data: skipped } = await service
      .from("audit_log")
      .select("metadata")
      .eq("action", "access.delivery_skipped")
      .eq("resource_id", nextSwitch);
    expect(skipped?.[0]?.metadata).toMatchObject({ reason: "SCOPE_EMPTY" });
  });

  it("delivers each release once, and a delivery left over after recovery issues nothing", async () => {
    const { switchId } = await released("exec-once@example.com");
    // The handler running again (a retry, a second runner) is the same delivery.
    const { data: job } = await service
      .from("jobs")
      .select("*")
      .eq("type", "access.deliver")
      .single();
    await accessDeliverHandler(job as unknown as JobRow, service);
    const { data: tokens } = await service
      .from("access_tokens")
      .select("id")
      .eq("dead_man_switch_id", switchId);
    expect(tokens).toHaveLength(1);
    expect(mail.links).toHaveLength(1);

    // Recovered before its delivery ran: the queued job finds no release.
    await service.from("access_tokens").delete().eq("owner_user_id", aliceId);
    await service.from("dead_man_switches").delete().eq("id", switchId);
    await service.from("jobs").delete().not("id", "is", null);
    const contact = await beneficiary("exec-leftover@example.com");
    const nextSwitch = await configureSwitch([contact], await asset(alice, "Savings"));
    await advance(nextSwitch, "RELEASED");
    expect((await alice.rpc("dms_cancel_escalation", {})).error).toBeNull();
    expect(await runQueued("access.deliver")).toBe(1);
    const { data: none } = await service
      .from("access_tokens")
      .select("id")
      .eq("dead_man_switch_id", nextSwitch);
    expect(none ?? []).toHaveLength(0);
  });

  it("refuses an expired release link and a contact who was deactivated or removed", async () => {
    const { contact, plaintext, tokenId } = await released("exec-expired@example.com");
    await verified(plaintext);

    const { data: live } = await service
      .from("access_tokens")
      .select("expires_at")
      .eq("id", tokenId)
      .single();
    await service
      .from("access_tokens")
      .update({ expires_at: new Date(Date.now() - 1000).toISOString() })
      .eq("id", tokenId);
    await expect(portal.requireGrant(tokenId)).rejects.toMatchObject({ status: 401 });
    await service.from("access_tokens").update({ expires_at: live!.expires_at }).eq("id", tokenId);
    await portal.requireGrant(tokenId);

    await alice.rpc("set_beneficiary_status", { p_beneficiary_id: contact, p_status: "INACTIVE" });
    await expect(portal.requireGrant(tokenId)).rejects.toMatchObject({ status: 401 });
    // Even un-revoked, an inactive contact is refused…
    await service
      .from("access_tokens")
      .update({ revoked_at: null, revoked_reason: null })
      .eq("id", tokenId);
    await expect(portal.requireGrant(tokenId)).rejects.toMatchObject({ status: 401 });
    // …and so is a removed one.
    await alice.rpc("set_beneficiary_status", { p_beneficiary_id: contact, p_status: "ACTIVE" });
    expect((await alice.rpc("remove_beneficiary", { p_beneficiary_id: contact })).error).toBeNull();
    await service
      .from("access_tokens")
      .update({ revoked_at: null, revoked_reason: null })
      .eq("id", tokenId);
    await expect(portal.requireGrant(tokenId)).rejects.toMatchObject({ status: 401 });
  });

  it("keeps a release to what it named: other contacts' shares and other owners' records stay out", async () => {
    const other = await beneficiary("exec-other@example.com");
    const sharedWithOther = await document(aliceId, "For the other contact.pdf");
    expect(
      (
        await alice.rpc("assign_beneficiary", {
          p_beneficiary_id: other,
          p_resource_type: "DOCUMENT",
          p_resource_id: sharedWithOther,
        })
      ).error,
    ).toBeNull();
    const bobsDocument = await document(bobId, "Bob's will.pdf");
    const outsideAsset = await asset(alice, "Not released");

    const { plaintext, tokenId } = await released("exec-scope@example.com");
    await verified(plaintext);
    const grant = await portal.requireGrant(tokenId);

    for (const id of [sharedWithOther, bobsDocument]) {
      await expect(portal.documentDetail(grant, id, "test")).rejects.toMatchObject({
        status: 404,
      });
      await expect(portal.documentDownload(grant, id, "test")).rejects.toMatchObject({
        status: 404,
      });
    }
    await expect(
      portal.assetView(grant, "FINANCIAL_ASSET", outsideAsset, "test"),
    ).rejects.toMatchObject({ status: 404 });
  });

  it("isolates owners: switches, contacts, events, links and the release functions", async () => {
    const { switchId, tokenId } = await released("exec-isolation@example.com");

    expect((await bob.from("dead_man_switches").select("id").eq("id", switchId)).data).toEqual([]);
    expect(
      (await bob.from("dead_man_switches").select("release_scope").eq("user_id", aliceId)).data,
    ).toEqual([]);
    expect(
      (
        await bob
          .from("dead_man_switch_contacts")
          .select("beneficiary_id")
          .eq("dead_man_switch_id", switchId)
      ).data,
    ).toEqual([]);
    expect(
      (await bob.from("dead_man_switch_events").select("id").eq("dead_man_switch_id", switchId))
        .data,
    ).toEqual([]);
    expect((await bob.from("access_tokens").select("id").eq("id", tokenId)).data).toEqual([]);
    expect((await bob.rpc("revoke_access_token", { p_token_id: tokenId })).error?.code).toBe(
      "42501",
    );
    // Bob has no switch, so his owner actions reach nothing of Alice's.
    expect((await bob.rpc("dms_cancel_escalation", {})).error?.code).toBe("42501");
    expect(await statusOf(switchId)).toBe("RELEASED");
    for (const fn of ["system_start_release_verification", "system_check_release_verification"]) {
      expect(
        (await bob.rpc(fn as never, { p_token_id: tokenId, p_code_hash: "0".repeat(64) } as never))
          .error,
      ).not.toBeNull();
    }
    expect(
      (
        await bob.rpc("dms_transition", {
          p_switch_id: switchId,
          p_from: "RELEASED",
          p_to: "RELEASED",
          p_event_type: "RELEASE",
        })
      ).error,
    ).not.toBeNull();
  });

  it("shows each owner every live link of theirs, and only theirs", async () => {
    const { tokenId, plaintext } = await released("exec-links@example.com");
    await verified(plaintext);

    userClient.current = alice;
    const mine = await accessService.listLiveLinks(appUser(aliceId, SUBJECT_A, "Alice"));
    expect(mine.items.map((item) => item.id)).toContain(tokenId);
    expect(mine.items.find((item) => item.id === tokenId)).toMatchObject({
      grantType: "DMS_RELEASE",
      beneficiaryName: "Trusted Person",
      verifiedAt: expect.any(String),
    });
    expect(JSON.stringify(mine)).not.toMatch(/hash/i);

    userClient.current = bob;
    const theirs = await accessService.listLiveLinks(appUser(bobId, SUBJECT_B, "Bob"));
    expect(theirs.items.map((item) => item.id)).not.toContain(tokenId);
  });
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

  it("tells the owner when a verified request waits for their decision", async () => {
    const { configId } = await configure("ea-notify@example.com");
    const { data: requestId } = await service.rpc("ea_request_access", {
      p_config_id: configId,
      p_requester_email: "ea-notify@example.com",
      p_otp_hash: hashAccessToken("123456"),
    });

    expect(await emergencyPublic.verify(requestId as string, "123456", "test")).toEqual({
      status: "VERIFIED",
    });
    const { data: notifications } = await service
      .from("notifications")
      .select("id, type, channel, content")
      .eq("user_id", aliceId);
    expect(notifications).toHaveLength(1);
    expect(notifications![0]).toMatchObject({ type: "ea.request_pending", channel: "BOTH" });
    expect(notifications![0].content).not.toContain("ea-notify@example.com");
    const { data: jobs } = await service
      .from("jobs")
      .select("payload")
      .eq("type", "notification.deliver");
    expect(jobs?.map((job) => (job.payload as { notificationId: string }).notificationId)).toEqual([
      notifications![0].id,
    ]);
  });

  describe("timeout auto-grant", () => {
    const HOUR = 3_600_000;
    /** The daily sweep, run once the owner's 24-hour window has passed (or later). */
    const sweep = (hours = 25) => runHousekeeping(service, new Date(Date.now() + hours * HOUR));

    /** A verified request under an AUTO_GRANT rule; its owner alert is queued. */
    async function verifiedRequest(email: string): Promise<{ requestId: string; contact: string }> {
      const contact = await beneficiary(email);
      const { data: configId, error } = await alice.rpc("ea_configure_contact", {
        p_beneficiary_id: contact,
        p_access_scope: scopeOf(await asset(alice, "Emergency savings")) as never,
        p_on_timeout: "AUTO_GRANT",
        p_timeout_hours: 24,
      });
      if (error) throw error;
      const { data: requestId } = await service.rpc("ea_request_access", {
        p_config_id: configId as string,
        p_requester_email: email,
        p_otp_hash: hashAccessToken("123456"),
      });
      expect(await emergencyPublic.verify(requestId as string, "123456", "test")).toEqual({
        status: "VERIFIED",
      });
      return { requestId: requestId as string, contact };
    }

    /** Sends the owner alert and asks the provider about it, as the runner would. */
    async function deliverAlert(): Promise<void> {
      await runQueued("notification.deliver");
      await runQueued("notification.confirm");
    }

    async function state(requestId: string) {
      const { data: request } = await service
        .from("emergency_access_requests")
        .select("status, auto_grant_held_at")
        .eq("id", requestId)
        .single();
      const { data: deliveries } = await service
        .from("jobs")
        .select("id")
        .eq("type", "access.deliver")
        .eq("payload->>requestId", requestId);
      const { data: told } = await service
        .from("notifications")
        .select("id")
        .eq("type", "ea.access_granted")
        .eq("metadata->>requestId", requestId);
      const { data: alerts } = await service
        .from("notifications")
        .select("delivery_status")
        .eq("type", "ea.request_pending")
        .eq("metadata->>requestId", requestId)
        .order("created_at");
      const { count: holds } = await service
        .from("audit_log")
        .select("id", { count: "exact", head: true })
        .eq("action", "ea.auto_grant_held")
        .eq("resource_id", requestId);
      return {
        status: request!.status,
        heldAt: request!.auto_grant_held_at,
        deliveries: deliveries!.length,
        ownerToldOfGrant: told!.length,
        alerts: alerts!.map((alert) => alert.delivery_status),
        holds: holds ?? 0,
      };
    }

    it("grants on timeout once the owner's alert is confirmed delivered", async () => {
      const { requestId } = await verifiedRequest("ea-auto-delivered@example.com");
      await deliverAlert();

      expect((await sweep()).emergencyTimeouts).toBe(1);
      expect(await state(requestId)).toMatchObject({
        status: "AUTO_GRANTED",
        heldAt: null,
        deliveries: 1,
        ownerToldOfGrant: 1,
        alerts: ["DELIVERED"],
        holds: 0,
      });
    });

    it.each([
      ["sent but unconfirmed", "pending", "SENT"],
      ["bounced", "bounced", "BOUNCED"],
      ["failed", "failed", "FAILED"],
    ] as const)("holds the grant when the alert was %s", async (_label, outcome, status) => {
      const { requestId } = await verifiedRequest(`ea-auto-${outcome}@example.com`);
      mail.outcome = outcome;
      await deliverAlert();

      expect((await sweep()).emergencyTimeouts).toBe(0);
      const held = await state(requestId);
      expect(held).toMatchObject({
        status: "VERIFIED",
        deliveries: 0,
        ownerToldOfGrant: 0,
        holds: 1,
      });
      expect(held.heldAt).not.toBeNull();
      expect(held.alerts[0]).toBe(status);

      // The owner can still decide a held request themselves.
      expect(
        (await alice.rpc("ea_decide_request", { p_request_id: requestId, p_decision: "DENY" }))
          .error,
      ).toBeNull();
    });

    it("holds the grant when the email provider is unavailable", async () => {
      const { requestId } = await verifiedRequest("ea-auto-down@example.com");
      mail.notificationsFail = true;
      await deliverAlert();

      expect((await sweep()).emergencyTimeouts).toBe(0);
      expect(await state(requestId)).toMatchObject({
        status: "VERIFIED",
        deliveries: 0,
        ownerToldOfGrant: 0,
        // The failed send is followed by a fresh alert (sent by its own job).
        alerts: ["FAILED", "PENDING"],
        holds: 1,
      });
    });

    it("keeps re-checking and re-alerting while held, then grants on a delivered alert", async () => {
      const { requestId } = await verifiedRequest("ea-auto-retry@example.com");
      mail.outcome = "bounced";
      await deliverAlert();

      // Held, and nothing is on its way: a fresh alert is sent.
      await sweep();
      expect((await state(requestId)).alerts).toEqual(["BOUNCED", "PENDING"]);

      // The hold restarted the owner's window. Once it has passed with the new
      // alert still unconfirmed, the provider is asked again — nothing re-sent.
      mail.outcome = "pending";
      await deliverAlert();
      await sweep(50);
      expect(await state(requestId)).toMatchObject({
        status: "VERIFIED",
        alerts: ["BOUNCED", "SENT"],
        holds: 1,
      });
      const { data: confirms } = await service
        .from("jobs")
        .select("idempotency_key")
        .eq("type", "notification.confirm")
        .eq("status", "QUEUED");
      expect(
        confirms!.some((job) => /:\d{4}-\d{2}-\d{2}T\d{2}$/.test(job.idempotency_key ?? "")),
      ).toBe(true);

      // Confirmed delivered: the rule applies — exactly once.
      mail.outcome = "delivered";
      await runQueued("notification.confirm");
      expect((await sweep(50)).emergencyTimeouts).toBe(1);
      expect(await state(requestId)).toMatchObject({
        status: "AUTO_GRANTED",
        alerts: ["BOUNCED", "DELIVERED"],
        deliveries: 1,
        ownerToldOfGrant: 1,
        holds: 1,
      });
    });

    it("grants exactly once when sweeps overlap", async () => {
      const { requestId } = await verifiedRequest("ea-auto-race@example.com");
      await deliverAlert();

      const runs = await Promise.all([sweep(), sweep(), sweep()]);
      expect(runs.reduce((sum, run) => sum + run.emergencyTimeouts, 0)).toBe(1);
      expect((await sweep(26)).emergencyTimeouts).toBe(0);
      expect(await state(requestId)).toMatchObject({
        status: "AUTO_GRANTED",
        deliveries: 1,
        ownerToldOfGrant: 1,
      });
      const { count } = await service
        .from("audit_log")
        .select("id", { count: "exact", head: true })
        .eq("action", "ea.transition")
        .eq("resource_id", requestId)
        .eq("metadata->>to", "AUTO_GRANTED");
      expect(count).toBe(1);
    });

    it("never grants an expired request, even when the timeout is checked first", async () => {
      const { requestId } = await verifiedRequest("ea-auto-expired@example.com");
      await deliverAlert();
      // The request window closed while no sweep ran (a scheduler outage).
      await service
        .from("emergency_access_requests")
        .update({ request_expires_at: new Date(Date.now() - HOUR).toISOString() })
        .eq("id", requestId);

      expect((await sweep()).emergencyTimeouts).toBe(0);
      expect(await state(requestId)).toMatchObject({ status: "EXPIRED", deliveries: 0 });
    });

    it("never grants to a contact who is no longer active", async () => {
      const deactivated = await verifiedRequest("ea-auto-inactive@example.com");
      const removed = await verifiedRequest("ea-auto-removed@example.com");
      await deliverAlert();

      expect(
        (
          await alice.rpc("set_beneficiary_status", {
            p_beneficiary_id: deactivated.contact,
            p_status: "INACTIVE",
          })
        ).error,
      ).toBeNull();
      const { data: config } = await service
        .from("emergency_access_configs")
        .select("id")
        .eq("beneficiary_id", removed.contact)
        .single();
      expect((await alice.rpc("ea_remove_contact", { p_config_id: config!.id })).error).toBeNull();

      expect((await sweep()).emergencyTimeouts).toBe(0);
      expect(await state(deactivated.requestId)).toMatchObject({
        status: "VERIFIED",
        deliveries: 0,
      });
      expect(await state(removed.requestId)).toMatchObject({ status: "EXPIRED", deliveries: 0 });
    });

    it("shows the owner, and only the owner, that a grant is held", async () => {
      const { requestId } = await verifiedRequest("ea-auto-visible@example.com");
      mail.outcome = "bounced";
      await deliverAlert();
      await sweep();

      const { data: mine } = await alice
        .from("emergency_access_requests")
        .select("auto_grant_held_at")
        .eq("id", requestId);
      expect(mine?.[0]?.auto_grant_held_at).toBeTruthy();
      const { data: theirs } = await bob
        .from("emergency_access_requests")
        .select("auto_grant_held_at")
        .eq("id", requestId);
      expect(theirs).toEqual([]);
    });
  });

  it("never exposes the OTP hash to the owner", async () => {
    const { error } = await alice.from("emergency_access_requests").select("otp_hash");
    expect(error).not.toBeNull();
  });
});

describe.skipIf(!available)("job queue", () => {
  it("cannot trigger the production scheduler from any API role", async () => {
    for (const client of [alice, service]) {
      const { error } = await client.rpc("lv_trigger_scheduler", {
        p_path: "/api/internal/cron/run-jobs",
      });
      expect(error?.code).toBe("42501");
    }
  });

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
