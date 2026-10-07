import "server-only";

import { redactAdminMetadata } from "@/lib/admin/audit-redaction";
import type { TypedSupabaseClient } from "@/lib/db/server";
import type { ActivityEntry } from "@/lib/types/activity";
import type {
  AdminAnalytics,
  AdminDeadJob,
  AdminOperations,
  AdminUserSummary,
} from "@/lib/types/admin";

/**
 * Operator data access (FR-P002, FR-P005, FR-P006).
 *
 * Every query here runs on the service client, because a Super Admin's reach is
 * deliberately not expressible in RLS: the policies are written for owners, and
 * widening them would weaken the barrier for everyone. The authorization is
 * therefore the route's `auth: "admin"` plus the service layer, and the price
 * of that is this file selecting columns explicitly — never `*` — so no vault
 * content can leak into an operator screen by accident.
 */
const USER_COLUMNS =
  "id, email, name, role, email_verified, mfa_enabled, onboarding_completed_at, last_login_at, deletion_requested_at, deleted_at, created_at";

interface UserRow {
  id: string;
  email: string;
  name: string;
  role: AdminUserSummary["role"];
  email_verified: boolean;
  mfa_enabled: boolean;
  onboarding_completed_at: string | null;
  last_login_at: string | null;
  deletion_requested_at: string | null;
  deleted_at: string | null;
  created_at: string;
}

function toSummary(row: UserRow): AdminUserSummary {
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    role: row.role,
    emailVerified: row.email_verified,
    mfaEnabled: row.mfa_enabled,
    onboardingCompletedAt: row.onboarding_completed_at,
    lastLoginAt: row.last_login_at,
    deletionRequestedAt: row.deletion_requested_at,
    deletedAt: row.deleted_at,
    createdAt: row.created_at,
  };
}

export async function listUsers(
  serviceDb: TypedSupabaseClient,
  query: { search?: string; page: number; limit: number },
): Promise<{ rows: AdminUserSummary[]; total: number }> {
  let builder = serviceDb.from("users").select(USER_COLUMNS, { count: "exact" });

  if (query.search) {
    const term = `%${query.search.replace(/[%_]/g, (match) => `\\${match}`)}%`;
    builder = builder.or(`email.ilike.${term},name.ilike.${term}`);
  }

  const from = (query.page - 1) * query.limit;
  const { data, error, count } = await builder
    .order("created_at", { ascending: false })
    .range(from, from + query.limit - 1);
  if (error) throw error;

  return { rows: (data ?? []).map((row) => toSummary(row as UserRow)), total: count ?? 0 };
}

export async function findUser(
  serviceDb: TypedSupabaseClient,
  id: string,
): Promise<(AdminUserSummary & { clerkUserId: string }) | null> {
  const { data, error } = await serviceDb
    .from("users")
    .select(`${USER_COLUMNS}, clerk_user_id`)
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  return {
    ...toSummary(data as UserRow),
    clerkUserId: (data as { clerk_user_id: string }).clerk_user_id,
  };
}

/** How much a user holds, as counts. Never what they hold. */
export async function countsFor(
  serviceDb: TypedSupabaseClient,
  userId: string,
): Promise<Record<string, number>> {
  async function count(table: string, live = true): Promise<number> {
    let builder = serviceDb
      .from(table as never)
      .select("id", { head: true, count: "exact" })
      .eq("user_id", userId);
    if (live) builder = builder.is("deleted_at", null);
    const { count: total, error } = await builder;
    if (error) throw error;
    return total ?? 0;
  }

  const [beneficiaries, financial, physical, digital, documents, videos, plans] = await Promise.all(
    [
      count("beneficiaries"),
      count("financial_assets"),
      count("physical_assets"),
      count("digital_assets"),
      count("documents"),
      count("video_messages"),
      count("legacy_plans"),
    ],
  );

  const { count: tokens, error } = await serviceDb
    .from("access_tokens")
    .select("id", { head: true, count: "exact" })
    .eq("owner_user_id", userId)
    .is("revoked_at", null);
  if (error) throw error;

  return {
    beneficiaries,
    assets: financial + physical + digital,
    documents,
    videos,
    legacyPlans: plans,
    accessTokensLive: tokens ?? 0,
  };
}

export async function switchFor(
  serviceDb: TypedSupabaseClient,
  userId: string,
): Promise<{ status: string; nextCheckInAt: string | null } | null> {
  const { data, error } = await serviceDb
    .from("dead_man_switches")
    .select("status, next_check_in_at")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw error;
  return data ? { status: data.status, nextCheckInAt: data.next_check_in_at } : null;
}

/**
 * Platform-wide audit (FR-P005), optionally narrowed to one actor or action.
 *
 * Metadata is filtered to its structural keys before it leaves this function:
 * the Class A triggers record changed *values* so an owner can read their own
 * history, and those values are vault content that an operator must not see.
 */
export async function listAudit(
  serviceDb: TypedSupabaseClient,
  query: { actorId?: string; action?: string; outcome?: string; page: number; limit: number },
): Promise<{ rows: ActivityEntry[]; total: number }> {
  let builder = serviceDb
    .from("audit_log")
    .select("id, action, resource_type, resource_id, outcome, ip_address, created_at, metadata", {
      count: "exact",
    });

  if (query.actorId) builder = builder.eq("actor_id", query.actorId);
  if (query.action) builder = builder.ilike("action", `${query.action}%`);
  if (query.outcome) builder = builder.eq("outcome", query.outcome as never);

  const from = (query.page - 1) * query.limit;
  const { data, error, count } = await builder
    .order("created_at", { ascending: false })
    .range(from, from + query.limit - 1);
  if (error) throw error;

  return {
    rows: (data ?? []).map((row) => ({
      id: row.id,
      action: row.action,
      resourceType: row.resource_type,
      resourceId: row.resource_id,
      outcome: row.outcome,
      ipAddress: row.ip_address,
      createdAt: row.created_at,
      metadata: redactAdminMetadata(row.metadata),
    })),
    total: count ?? 0,
  };
}

const DAY_MS = 86_400_000;

export async function analytics(
  serviceDb: TypedSupabaseClient,
  now: Date,
  days: number,
): Promise<AdminAnalytics> {
  const since = new Date(now.getTime() - days * DAY_MS).toISOString();

  const [total, pendingDeletion, superAdmins, active] = await Promise.all([
    countWhere(serviceDb, "users", [["is", "deleted_at", null]]),
    countWhere(serviceDb, "users", [
      ["not_is", "deletion_requested_at", null],
      ["is", "deleted_at", null],
    ]),
    countWhere(serviceDb, "users", [
      ["eq", "role", "SUPER_ADMIN"],
      ["is", "deleted_at", null],
    ]),
    countWhere(serviceDb, "users", [
      ["gte", "last_login_at", new Date(now.getTime() - 30 * DAY_MS).toISOString()],
    ]),
  ]);

  const { data: recent, error: recentError } = await serviceDb
    .from("users")
    .select("created_at")
    .gte("created_at", since)
    .order("created_at", { ascending: true })
    .limit(5000);
  if (recentError) throw recentError;

  const byDay = new Map<string, number>();
  for (let offset = days - 1; offset >= 0; offset -= 1) {
    byDay.set(new Date(now.getTime() - offset * DAY_MS).toISOString().slice(0, 10), 0);
  }
  for (const row of recent ?? []) {
    const day = row.created_at.slice(0, 10);
    if (byDay.has(day)) byDay.set(day, (byDay.get(day) ?? 0) + 1);
  }

  const [documents, videos] = await Promise.all([
    sizeOf(serviceDb, "documents"),
    sizeOf(serviceDb, "video_messages"),
  ]);

  const [switchesActive, switchesReleased, switchesHeld, emergencyPending] = await Promise.all([
    countWhere(serviceDb, "dead_man_switches", [["eq", "status", "ACTIVE"]]),
    countWhere(serviceDb, "dead_man_switches", [["eq", "status", "RELEASED"]]),
    // At the release point, but no owner warning confirmed delivered (0009).
    countWhere(serviceDb, "dead_man_switches", [
      ["eq", "status", "ESCALATING"],
      ["not_is", "release_held_at", null],
    ]),
    countWhere(serviceDb, "emergency_access_requests", [["eq", "status", "VERIFIED"]]),
  ]);

  const [queued, running, dead, succeededLastDay] = await Promise.all([
    countWhere(serviceDb, "jobs", [["eq", "status", "QUEUED"]]),
    countWhere(serviceDb, "jobs", [["eq", "status", "RUNNING"]]),
    countWhere(serviceDb, "jobs", [["eq", "status", "DEAD"]]),
    countWhere(serviceDb, "jobs", [
      ["eq", "status", "SUCCEEDED"],
      ["gte", "finished_at", new Date(now.getTime() - DAY_MS).toISOString()],
    ]),
  ]);

  return {
    users: { total, active, pendingDeletion, superAdmins },
    registrations: [...byDay.entries()].map(([day, count]) => ({ day, count })),
    storage: { documents, videos },
    protection: { switchesActive, switchesReleased, switchesHeld, emergencyPending },
    jobs: { queued, running, dead, succeededLastDay },
  };
}

/** One filtered `count(*)`, spelled out so the builder stays typed. */
type CountFilter = ["eq" | "gte" | "is" | "not_is", string, string | null];

async function countWhere(
  serviceDb: TypedSupabaseClient,
  table: string,
  filters: CountFilter[],
): Promise<number> {
  let builder = serviceDb.from(table as never).select("id", { head: true, count: "exact" });
  for (const [operator, column, value] of filters) {
    if (operator === "eq") builder = builder.eq(column, value as never);
    else if (operator === "gte") builder = builder.gte(column, value as never);
    else if (operator === "is") builder = builder.is(column, value as never);
    else builder = builder.not(column, "is", value as never);
  }
  const { count, error } = await builder;
  if (error) throw error;
  return count ?? 0;
}

/** Storage usage from the rows that own the objects, not from the bucket API. */
async function sizeOf(
  serviceDb: TypedSupabaseClient,
  table: "documents" | "video_messages",
): Promise<{ count: number; bytes: number }> {
  const { data, error } = await serviceDb
    .from(table)
    .select("size_bytes")
    .is("deleted_at", null)
    .limit(20_000);
  if (error) throw error;
  const rows = data ?? [];
  return {
    count: rows.length,
    bytes: rows.reduce((sum, row) => sum + (row.size_bytes ?? 0), 0),
  };
}

/** What an operator may need to act on (ADR-014 § 6, ADR-006). */
export async function operations(serviceDb: TypedSupabaseClient): Promise<AdminOperations> {
  const { data: jobs, error: jobsError } = await serviceDb
    .from("jobs")
    .select("id, type, payload, attempts, last_error, run_at, finished_at")
    .eq("status", "DEAD")
    .order("finished_at", { ascending: false })
    .limit(50);
  if (jobsError) throw jobsError;

  const deadJobs: AdminDeadJob[] = (jobs ?? []).map((job) => {
    const payload =
      job.payload && typeof job.payload === "object" && !Array.isArray(job.payload)
        ? (job.payload as Record<string, unknown>)
        : {};
    return {
      id: job.id,
      type: job.type,
      attempts: job.attempts,
      lastError: job.last_error,
      runAt: job.run_at,
      finishedAt: job.finished_at,
      accessTokenId: null,
      beneficiaryId: typeof payload.beneficiaryId === "string" ? payload.beneficiaryId : null,
    };
  });

  // A system grant whose link was minted but never delivered is the case the
  // resend path exists for.
  const { data: tokens, error: tokensError } = await serviceDb
    .from("access_tokens")
    .select("id, grant_type, beneficiary_id, owner_user_id, created_at, expires_at")
    .is("delivered_at", null)
    .is("revoked_at", null)
    .neq("grant_type", "DIRECT_SHARE")
    .order("created_at", { ascending: false })
    .limit(50);
  if (tokensError) throw tokensError;

  return {
    deadJobs,
    undeliveredTokens: (tokens ?? []).map((token) => ({
      id: token.id,
      grantType: token.grant_type,
      beneficiaryId: token.beneficiary_id,
      ownerUserId: token.owner_user_id,
      createdAt: token.created_at,
      expiresAt: token.expires_at,
    })),
  };
}
