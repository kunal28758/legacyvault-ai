import "server-only";

import type { TypedSupabaseClient } from "@/lib/db/server";
import type { JobHandler } from "@/lib/jobs/types";
import { logger } from "@/lib/observability/logger";
import { BUCKETS, removeObject } from "@/lib/storage/storage";

/**
 * The daily sweep (api-contracts.md § Internal, ADR-006).
 *
 * Everything here is a deadline the product has already promised and that no
 * request will arrive to enforce: an emergency request whose owner never
 * answered, an upload that was started and abandoned, an account whose 30-day
 * grace period has run out. Each pass is idempotent and scoped, so running the
 * sweep twice in a day changes nothing the first run did not already do.
 */
const UPLOAD_GRACE_MS = 6 * 60 * 60 * 1000;
const DELETION_GRACE_DAYS = 30;

export interface HousekeepingSummary {
  emergencyTimeouts: number;
  emergencyExpiries: number;
  uploadsExpired: number;
  accountsDeleted: number;
}

export async function runHousekeeping(
  db: TypedSupabaseClient,
  now = new Date(),
): Promise<HousekeepingSummary> {
  return {
    emergencyTimeouts: await applyEmergencyTimeoutRules(db, now),
    emergencyExpiries: await expireEmergencyRequests(db, now),
    uploadsExpired: await expireAbandonedUploads(db, now),
    accountsDeleted: await applyDeletionGrace(db, now),
  };
}

/**
 * The owner's "if I do not respond" rule (FR-J005).
 *
 * It runs from the moment the contact verified their code — `decided_at` is
 * still null then, and the row's `updated_at` is the verification — so a
 * request only auto-resolves after the owner has had the full window.
 */
async function applyEmergencyTimeoutRules(db: TypedSupabaseClient, now: Date): Promise<number> {
  const { data, error } = await db
    .from("emergency_access_requests")
    .select("id, updated_at, config_id, emergency_access_configs!inner(on_timeout, timeout_hours)")
    .eq("status", "VERIFIED")
    .is("decided_at", null)
    .limit(200);
  if (error) throw error;

  let applied = 0;
  for (const row of data ?? []) {
    const config = row.emergency_access_configs as unknown as {
      on_timeout: "WAIT" | "AUTO_GRANT" | "DENY";
      timeout_hours: number | null;
    };
    if (config.on_timeout === "WAIT" || !config.timeout_hours) continue;

    const dueAt = Date.parse(row.updated_at) + config.timeout_hours * 3_600_000;
    if (dueAt > now.getTime()) continue;

    const { error: transitionError } = await db.rpc("ea_transition", {
      p_request_id: row.id,
      p_to: config.on_timeout === "AUTO_GRANT" ? "AUTO_GRANTED" : "DENIED",
      p_metadata: { reason: "timeout", timeoutHours: config.timeout_hours } as never,
    });
    if (transitionError) {
      // The owner decided in the same minute; their decision wins.
      if (transitionError.code !== "LV409") throw transitionError;
      continue;
    }
    applied += 1;
  }
  return applied;
}

/** Requests whose window has passed, and grants whose access duration is spent. */
async function expireEmergencyRequests(db: TypedSupabaseClient, now: Date): Promise<number> {
  const { data, error } = await db
    .from("emergency_access_requests")
    .select("id, status, request_expires_at, expires_at")
    .in("status", ["PENDING", "VERIFYING", "VERIFIED", "ACTIVE"])
    .limit(200);
  if (error) throw error;

  let applied = 0;
  for (const row of data ?? []) {
    const undecided = row.status !== "ACTIVE";
    const deadline = undecided ? row.request_expires_at : row.expires_at;
    if (!deadline || Date.parse(deadline) > now.getTime()) continue;

    const { error: transitionError } = await db.rpc("ea_transition", {
      p_request_id: row.id,
      p_to: "EXPIRED",
      p_metadata: { reason: "housekeeping" } as never,
    });
    if (transitionError) {
      if (transitionError.code !== "LV409") throw transitionError;
      continue;
    }
    applied += 1;
  }
  return applied;
}

/**
 * Uploads that were started and never completed.
 *
 * The bytes go first and the row second: an object left in quarantine with no
 * session to explain it is the one outcome worth avoiding.
 */
async function expireAbandonedUploads(db: TypedSupabaseClient, now: Date): Promise<number> {
  const cutoff = new Date(now.getTime() - UPLOAD_GRACE_MS).toISOString();
  const { data, error } = await db
    .from("upload_sessions")
    .select("id, user_id, status")
    .in("status", ["PENDING", "UPLOADED", "VALIDATING", "SCANNING", "SCANNED_CLEAN", "REJECTED"])
    .lt("created_at", cutoff)
    .limit(200);
  if (error) throw error;

  let applied = 0;
  for (const session of data ?? []) {
    try {
      await removeObject(BUCKETS.quarantine, `${session.user_id}/${session.id}`);
    } catch (cause) {
      // Nothing was ever uploaded, or it is already gone — either way the
      // session can still be closed.
      logger.warn({ err: cause, uploadId: session.id }, "quarantine cleanup skipped");
    }
    const { error: updateError } = await db
      .from("upload_sessions")
      .update({ status: "EXPIRED" })
      .eq("id", session.id);
    if (updateError) throw updateError;
    applied += 1;
  }
  return applied;
}

/**
 * Accounts past their grace period.
 *
 * This marks the account deleted and stops everything that could still act for
 * it. The rows themselves are kept until an operator purges them, because a
 * cascade started by a scheduled job is not a thing to do unattended — and the
 * audit trail must survive the account either way.
 */
async function applyDeletionGrace(db: TypedSupabaseClient, now: Date): Promise<number> {
  const cutoff = new Date(now.getTime() - DELETION_GRACE_DAYS * 86_400_000).toISOString();
  const { data, error } = await db
    .from("users")
    .select("id")
    .lt("deletion_requested_at", cutoff)
    .is("deleted_at", null)
    .limit(50);
  if (error) throw error;

  let applied = 0;
  for (const user of data ?? []) {
    const { error: tokensError } = await db
      .from("access_tokens")
      .update({ revoked_at: now.toISOString(), revoked_reason: "OWNER" })
      .eq("owner_user_id", user.id)
      .is("revoked_at", null);
    if (tokensError) throw tokensError;

    const { error: switchError } = await db
      .from("dead_man_switches")
      .update({ status: "INACTIVE", next_check_in_at: null })
      .eq("user_id", user.id);
    if (switchError) throw switchError;

    const { error: userError } = await db
      .from("users")
      .update({ deleted_at: now.toISOString() })
      .eq("id", user.id);
    if (userError) throw userError;

    const { error: auditError } = await db.from("audit_log").insert({
      actor_id: user.id,
      action: "user.deleted",
      resource_type: "users",
      resource_id: user.id,
      outcome: "SUCCESS",
      metadata: { gracePeriodDays: DELETION_GRACE_DAYS, appliedBy: "housekeeping" } as never,
    });
    if (auditError) throw auditError;
    applied += 1;
  }
  return applied;
}

export const housekeepingHandler: JobHandler = async (_job, db) => {
  const summary = await runHousekeeping(db);
  logger.info({ ...summary }, "housekeeping complete");
};
