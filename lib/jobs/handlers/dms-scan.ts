import "server-only";

import { escalationStepCount } from "@/lib/client/dms-presentation";
import { logger } from "@/lib/observability/logger";
import * as dmsRepository from "@/lib/repositories/dms.repository";
import * as emergencyRepository from "@/lib/repositories/emergency-access.repository";
import * as jobRepository from "@/lib/repositories/job.repository";
import * as notificationRepository from "@/lib/repositories/notification.repository";
import type { TypedSupabaseClient } from "@/lib/db/server";
import type { JobHandler } from "@/lib/jobs/types";
import type { Database } from "@/lib/types/database";

/**
 * The scheduled Dead Man's Switch scan (FR-I004–I007, ADR-006).
 *
 * The timeline, expressed with the columns the schema already has:
 *
 *   ACTIVE          → REMINDER_SENT  when the check-in deadline passes
 *   REMINDER_SENT   → GRACE_PERIOD   when the full inactivity period has elapsed
 *   GRACE_PERIOD    → ESCALATING     after one escalation delay
 *   ESCALATING      → ESCALATING     once per escalation delay, up to the
 *                                    configured number of steps
 *   ESCALATING      → RELEASING      after the last step
 *   RELEASING       → RELEASED       on the next tick, which is what enqueues
 *                                    the per-contact `access.deliver` jobs
 *
 * `next_check_in_at` carries the next scheduled action once the switch has left
 * ACTIVE, which is what `dms_transition()`'s `nextCheckInAt` metadata is for.
 *
 * No email is sent from here. Each transition writes a notification row and
 * queues `notification.deliver`, so a slow mail provider can never hold up or
 * partially apply a state change. Trusted contacts are told by jobs that
 * `dms_transition()` itself queues: `dms.contact-notice` when escalation
 * starts, `access.deliver` on release.
 */
type DmsStatus = Database["public"]["Enums"]["dms_status"];
type DmsEventType = Database["public"]["Enums"]["dms_event_type"];

/** Only the columns the timeline depends on. */
export type DmsScanRow = Pick<
  dmsRepository.DmsRow,
  | "id"
  | "status"
  | "escalation_delay_hours"
  | "inactivity_period_days"
  | "last_check_in_at"
  | "current_escalation_step"
  | "escalation_rules"
>;

export interface DmsStep {
  to: DmsStatus;
  eventType: DmsEventType;
  nextAt: Date | null;
  escalationStep?: number;
  notify?: { title: string; content: string; type: string };
}

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

/**
 * The next scheduled action for a switch, as a pure function of its row and
 * the clock. Exported so the timeline can be asserted without a database.
 */
export function nextDmsStep(row: DmsScanRow, now: Date): DmsStep | null {
  const delay = row.escalation_delay_hours * HOUR_MS;
  const lastCheckIn = row.last_check_in_at
    ? new Date(row.last_check_in_at).getTime()
    : now.getTime();

  switch (row.status) {
    case "ACTIVE":
      return {
        to: "REMINDER_SENT",
        eventType: "MISSED_CHECK_IN",
        nextAt: new Date(lastCheckIn + row.inactivity_period_days * DAY_MS),
        notify: {
          type: "dms.reminder",
          title: "Your LegacyVault check-in is due",
          content:
            "No recent check-in was recorded. Check in to keep your emergency release workflow on schedule — nothing is shared while it waits for you.",
        },
      };
    case "REMINDER_SENT":
      return {
        to: "GRACE_PERIOD",
        eventType: "MISSED_CHECK_IN",
        nextAt: new Date(now.getTime() + delay),
        notify: {
          type: "dms.grace_period",
          title: "Your LegacyVault check-in is overdue",
          content:
            "Your emergency release workflow is in its grace period because no recent activity was detected. Check in to stop it. If you do not, your trusted contacts will be told the workflow has started; nothing is released at that point.",
        },
      };
    case "GRACE_PERIOD":
      return {
        to: "ESCALATING",
        eventType: "ESCALATION_STEP",
        nextAt: new Date(now.getTime() + delay),
        escalationStep: 1,
        notify: {
          type: "dms.escalating",
          title: "Your emergency release workflow has started",
          content:
            "No check-in was recorded during the grace period, so your trusted contacts are being told the workflow has started. Nothing has been released. Check in now to cancel it.",
        },
      };
    case "ESCALATING": {
      const total = escalationStepCount(row.escalation_rules);
      if (row.current_escalation_step < total) {
        return {
          to: "ESCALATING",
          eventType: "ESCALATION_STEP",
          nextAt: new Date(now.getTime() + delay),
          escalationStep: row.current_escalation_step + 1,
        };
      }
      return { to: "RELEASING", eventType: "ESCALATION_STEP", nextAt: now };
    }
    case "RELEASING":
      return {
        to: "RELEASED",
        eventType: "RELEASE",
        nextAt: null,
        notify: {
          type: "dms.released",
          title: "Your emergency release workflow completed",
          content:
            "Your trusted contacts are being sent secure, expiring links to the resources you selected. Each must confirm a code sent to their own email before anything opens. If this was a mistake, recover from the Dead Man's Switch page — that revokes the links.",
        },
      };
    default:
      return null;
  }
}

export async function runDmsScan(db: TypedSupabaseClient, now = new Date()): Promise<number> {
  const due = await dmsRepository.listDue(db, now);
  let applied = 0;

  for (const row of due) {
    const step = nextDmsStep(row, now);
    if (!step) continue;

    const { data: eventId, error } = await db.rpc("dms_transition", {
      p_switch_id: row.id,
      p_from: row.status,
      p_to: step.to,
      p_event_type: step.eventType,
      p_metadata: {
        ...(step.nextAt ? { nextCheckInAt: step.nextAt.toISOString() } : {}),
        ...(step.escalationStep !== undefined
          ? { currentEscalationStep: step.escalationStep }
          : {}),
        scan: true,
      } as never,
    });
    if (error) {
      // Another tick won the race, or the owner checked in mid-scan.
      logger.warn({ switchId: row.id, code: error.code }, "dms transition skipped");
      continue;
    }
    if (step.to === "RELEASING" && eventId === null) {
      // Held: no warning has been confirmed delivered this cycle (0009).
      await keepTryingToWarn(db, row, now);
      continue;
    }
    applied += 1;

    if (step.notify) {
      // Delivery is a separate job: mail must never delay a state change. The
      // `switchId` is what dms_transition() checks before authorizing release.
      await notificationRepository.notifyOwner(db, {
        userId: row.user_id,
        type: step.notify.type,
        title: step.notify.title,
        content: step.notify.content,
        metadata: { switchId: row.id, status: step.to },
      });
    }
  }

  await expireEmergencyRequests(db, now);
  return applied;
}

const HELD_NOTICE = {
  type: "dms.release_held",
  title: "Your emergency release is waiting on a warning to you",
  content:
    "Your emergency release workflow reached its release point, but LegacyVault could not confirm that a warning email reached you, so nothing has been released. If you are reading this, check in to cancel it. Once a warning like this one is confirmed delivered, the release you configured can proceed.",
};

/**
 * While a release is held, keep establishing whether the owner was warned:
 * ask the provider again about every warning still at SENT, and — when none
 * is on its way at all (each failed, bounced or was never sent) — send a fresh
 * one, at most once a day. Nothing here can release anything; only a
 * DELIVERED warning lets dms_transition() authorize the release.
 */
async function keepTryingToWarn(
  db: TypedSupabaseClient,
  row: dmsRepository.DmsRow,
  now: Date,
): Promise<void> {
  const since = row.last_check_in_at ?? row.created_at;
  const warnings = await notificationRepository.listReleaseWarnings(db, row.user_id, row.id, since);
  const hour = now.toISOString().slice(0, 13);
  for (const warning of warnings.filter((item) => item.delivery_status === "SENT")) {
    await jobRepository.enqueue(
      db,
      "notification.confirm",
      { notificationId: warning.id },
      `notification.confirm:${warning.id}:${hour}`,
    );
  }
  const inFlight = warnings.some((item) => ["PENDING", "SENT"].includes(item.delivery_status));
  const noticedToday = warnings.some(
    (item) =>
      item.type === HELD_NOTICE.type && now.getTime() - Date.parse(item.created_at) < DAY_MS,
  );
  if (!inFlight && !noticedToday) {
    await notificationRepository.notifyOwner(db, {
      userId: row.user_id,
      ...HELD_NOTICE,
      metadata: { switchId: row.id, status: row.status },
    });
  }
}

/** Times out emergency requests and lets expired grants lapse (FR-J006). */
async function expireEmergencyRequests(db: TypedSupabaseClient, now: Date): Promise<void> {
  const expirable = await emergencyRepository.listExpirable(db, now);
  for (const request of expirable) {
    // ea_transition() expires both: an undecided request, and a grant whose
    // access time is spent (revoking its token).
    const { error } = await db.rpc("ea_transition", {
      p_request_id: request.id,
      p_to: "EXPIRED",
      p_metadata: { reason: "scan", scannedAt: now.toISOString() } as never,
    });
    if (error && error.code !== "LV409") {
      logger.warn({ requestId: request.id, code: error.code }, "emergency expiry skipped");
    }
  }
}

export const dmsScanHandler: JobHandler = async (_job, db) => {
  const applied = await runDmsScan(db);
  logger.info({ applied }, "dms scan complete");
};
