import "server-only";

import type { TypedSupabaseClient } from "@/lib/db/server";
import type { JobHandler } from "@/lib/jobs/types";
import { logger } from "@/lib/observability/logger";
import { enqueue } from "@/lib/repositories/job.repository";
import * as notificationRepository from "@/lib/repositories/notification.repository";
import type { UploadStatus } from "@/lib/repositories/upload.repository";
import { notifyOwnerOfRequest } from "@/lib/services/emergency-public.service";
import {
  BUCKETS,
  removeObject,
  uploadBucketFor,
  uploadObjectKey,
  type BucketName,
} from "@/lib/storage/storage";
import { ACCOUNT_DELETION_GRACE_DAYS } from "@/lib/validators/user.validators";

/**
 * The daily sweep (api-contracts.md § Internal, ADR-006).
 *
 * Everything here is a deadline the product has already promised and that no
 * request will arrive to enforce: an emergency request whose owner never
 * answered, an upload that was started and abandoned, an account whose 30-day
 * grace period has run out (whose hard delete it queues). Each pass is idempotent and scoped, so running the
 * sweep twice in a day changes nothing the first run did not already do.
 */
const UPLOAD_GRACE_MS = 6 * 60 * 60 * 1000;
const DAY_MS = 86_400_000;

export interface HousekeepingSummary {
  emergencyTimeouts: number;
  emergencyExpiries: number;
  uploadsExpired: number;
  accountsDeleted: number;
  purgesRequeued: number;
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
    purgesRequeued: await requeueStalledPurges(db, now),
  };
}

/**
 * The owner's "if I do not respond" rule (FR-J005).
 *
 * It runs from the moment the contact verified their code — `decided_at` is
 * still null then, and the row's `updated_at` is the verification — so a
 * request only auto-resolves after the owner has had the full window.
 *
 * An AUTO_GRANT also needs proof the owner was told: ea_transition() (0010)
 * holds the request at VERIFIED until the owner's alert is DELIVERED. A hold
 * restarts the window (it updates the row), and the owner can still decide.
 */
async function applyEmergencyTimeoutRules(db: TypedSupabaseClient, now: Date): Promise<number> {
  const { data, error } = await db
    .from("emergency_access_requests")
    .select(
      "id, updated_at, config_id, emergency_access_configs!inner(user_id, on_timeout, timeout_hours)",
    )
    .eq("status", "VERIFIED")
    .is("decided_at", null)
    .limit(200);
  if (error) throw error;

  let applied = 0;
  for (const row of data ?? []) {
    const config = row.emergency_access_configs as unknown as {
      user_id: string;
      on_timeout: "WAIT" | "AUTO_GRANT" | "DENY";
      timeout_hours: number | null;
    };
    if (config.on_timeout === "WAIT" || !config.timeout_hours) continue;

    const dueAt = Date.parse(row.updated_at) + config.timeout_hours * 3_600_000;
    if (dueAt > now.getTime()) continue;

    const target = config.on_timeout === "AUTO_GRANT" ? "AUTO_GRANTED" : "DENIED";
    const { data: outcome, error: transitionError } = await db.rpc("ea_transition", {
      p_request_id: row.id,
      p_to: target,
      p_metadata: { reason: "timeout", timeoutHours: config.timeout_hours } as never,
    });
    if (transitionError) {
      // The owner decided in the same minute; their decision wins.
      if (transitionError.code !== "LV409") throw transitionError;
      continue;
    }
    if (outcome !== target) {
      await keepTryingToAlert(db, config.user_id, row.id, now);
      continue;
    }
    applied += 1;
    if (config.on_timeout === "AUTO_GRANT") {
      // Access was granted without the owner's answer: they must be told.
      await notificationRepository.notifyOwner(db, {
        userId: config.user_id,
        type: "ea.access_granted",
        title: "Emergency access was granted automatically",
        content: `A verified emergency request was not answered within ${config.timeout_hours} hours, so your timeout rule granted time-limited access. You can revoke it on the Emergency Access page.`,
        metadata: { requestId: row.id },
      });
    }
  }
  return applied;
}

/**
 * While an automatic grant is held, keep establishing whether the owner was
 * told: ask the provider again about every alert still at SENT, and — when
 * none is on its way (each failed or bounced) — send a fresh one, at most once
 * a day. Nothing here grants anything; only a DELIVERED alert lets
 * ea_transition() do that.
 */
async function keepTryingToAlert(
  db: TypedSupabaseClient,
  userId: string,
  requestId: string,
  now: Date,
): Promise<void> {
  const alerts = await notificationRepository.listRequestAlerts(db, userId, requestId);
  const hour = now.toISOString().slice(0, 13);
  for (const alert of alerts.filter((item) => item.delivery_status === "SENT")) {
    await enqueue(
      db,
      "notification.confirm",
      { notificationId: alert.id },
      `notification.confirm:${alert.id}:${hour}`,
    );
  }
  const inFlight = alerts.some((item) => ["PENDING", "SENT"].includes(item.delivery_status));
  const sentToday = alerts.some((item) => now.getTime() - Date.parse(item.created_at) < DAY_MS);
  if (!inFlight && !sentToday) await notifyOwnerOfRequest(db, requestId);
  logger.warn({ requestId, alerts: alerts.length, inFlight }, "emergency auto-grant held");
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

/** Sessions that never reached PROMOTED and never will. */
const ABANDONED: readonly UploadStatus[] = [
  "PENDING",
  "UPLOADED",
  "VALIDATING",
  "VALIDATED",
  "REJECTED",
];

/**
 * Uploads that were started and never completed.
 *
 * An unfinished upload's bytes sit at their final key in the private bucket,
 * with no row pointing at them. The session is closed first, with a
 * compare-and-set, and the object is removed only if that succeeded — an
 * upload promoted in the meantime keeps its bytes. As a second guard, an
 * object any vault row still points at is never removed.
 */
async function expireAbandonedUploads(db: TypedSupabaseClient, now: Date): Promise<number> {
  const cutoff = new Date(now.getTime() - UPLOAD_GRACE_MS).toISOString();
  const { data, error } = await db
    .from("upload_sessions")
    .select("id, user_id, kind")
    .in("status", [...ABANDONED])
    .lt("created_at", cutoff)
    .limit(200);
  if (error) throw error;

  let applied = 0;
  for (const session of data ?? []) {
    const { data: closed, error: updateError } = await db
      .from("upload_sessions")
      .update({ status: "EXPIRED" })
      .eq("id", session.id)
      .in("status", [...ABANDONED])
      .select("id");
    if (updateError) throw updateError;
    if (!closed?.length) continue;
    applied += 1;

    const bucket = uploadBucketFor(session.kind);
    const key = uploadObjectKey(session.user_id, session.id);
    try {
      if (await isReferenced(db, bucket, key)) {
        logger.warn({ uploadId: session.id }, "abandoned upload object is referenced; kept");
        continue;
      }
      await removeObject(bucket, key);
    } catch (cause) {
      // Nothing was ever uploaded, or it is already gone. Anything left is
      // private and unreachable without a row.
      logger.warn({ err: cause, uploadId: session.id }, "abandoned upload cleanup skipped");
    }
  }
  return applied;
}

/** True when a document, version or video row points at this object. */
async function isReferenced(
  db: TypedSupabaseClient,
  bucket: BucketName,
  key: string,
): Promise<boolean> {
  const tables =
    bucket === BUCKETS.videos
      ? (["video_messages"] as const)
      : (["documents", "document_versions"] as const);
  for (const table of tables) {
    const { count, error } = await db
      .from(table)
      .select("id", { count: "exact", head: true })
      .eq("storage_key", key);
    if (error) throw error;
    if ((count ?? 0) > 0) return true;
  }
  return false;
}

/**
 * Accounts past their grace period.
 *
 * begin_account_deletion() (0012) marks each one deleted, stops everything
 * that could still act for it and queues its hard delete, in one transaction.
 * It re-checks the deadline under the row lock, so an account whose owner
 * cancelled after the select above is left alone.
 */
async function applyDeletionGrace(db: TypedSupabaseClient, now: Date): Promise<number> {
  const cutoff = new Date(now.getTime() - ACCOUNT_DELETION_GRACE_DAYS * DAY_MS).toISOString();
  const { data, error } = await db
    .from("users")
    .select("id")
    .lt("deletion_requested_at", cutoff)
    .is("deleted_at", null)
    .limit(50);
  if (error) throw error;

  let applied = 0;
  for (const user of data ?? []) {
    const { data: started, error: startError } = await db.rpc("begin_account_deletion", {
      p_user_id: user.id,
      p_requested_before: cutoff,
    });
    if (startError) throw startError;
    if (started) applied += 1;
  }
  return applied;
}

/**
 * Hard deletes that ran out of attempts (DEAD) while the account row — and so
 * its data — is still there get one fresh job a day, so a long provider outage
 * delays a deletion instead of abandoning it. Only accounts begun by
 * begin_account_deletion() have such a job; accounts soft-deleted any other way
 * are not touched here.
 */
async function requeueStalledPurges(db: TypedSupabaseClient, now: Date): Promise<number> {
  const { data: dead, error } = await db
    .from("jobs")
    .select("payload")
    .eq("type", "user.hard-delete")
    .eq("status", "DEAD")
    .limit(200);
  if (error) throw error;

  const payloads = new Map<string, Record<string, unknown>>();
  for (const job of dead ?? []) {
    const payload = job.payload as Record<string, unknown> | null;
    if (typeof payload?.userId === "string") payloads.set(payload.userId, payload);
  }
  if (payloads.size === 0) return 0;

  const { data: pending, error: pendingError } = await db
    .from("users")
    .select("id")
    .in("id", [...payloads.keys()].slice(0, 100))
    .not("deleted_at", "is", null);
  if (pendingError) throw pendingError;

  const day = now.toISOString().slice(0, 10);
  let queued = 0;
  for (const { id } of pending ?? []) {
    const jobId = await enqueue(
      db,
      "user.hard-delete",
      payloads.get(id) ?? {},
      `user.hard-delete:${id}:retry:${day}`,
    );
    if (jobId) queued += 1;
  }
  if (queued > 0) logger.warn({ queued }, "stalled account purges requeued");
  return queued;
}

export const housekeepingHandler: JobHandler = async (_job, db) => {
  const summary = await runHousekeeping(db);
  logger.info({ ...summary }, "housekeeping complete");
};
