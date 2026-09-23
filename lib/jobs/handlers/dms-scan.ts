import "server-only";

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
 * partially apply a state change.
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

function escalationSteps(rules: unknown): number {
  const record =
    rules && typeof rules === "object" && !Array.isArray(rules)
      ? (rules as Record<string, unknown>)
      : {};
  const steps = Number(record.steps);
  return Number.isFinite(steps) && steps >= 1 && steps <= 10 ? Math.floor(steps) : 2;
}

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
            "Your Dead Man's Switch is waiting for a check-in. One click keeps everything as it is.",
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
            "You are inside the grace period. Check in now, or LegacyVault will start contacting the people you nominated.",
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
          title: "LegacyVault has started escalating",
          content:
            "Your trusted contacts are being notified. You can still stop this by checking in.",
        },
      };
    case "ESCALATING": {
      const total = escalationSteps(row.escalation_rules);
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
          title: "LegacyVault has released access to your trusted contacts",
          content:
            "Your Dead Man's Switch reached its release point. You can revoke this from the Dead Man's Switch page.",
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

    const { error } = await db.rpc("dms_transition", {
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
    applied += 1;

    if (step.notify) {
      const notificationId = await notificationRepository.insertSystem(db, {
        userId: row.user_id,
        type: step.notify.type,
        title: step.notify.title,
        content: step.notify.content,
        channel: "BOTH",
        metadata: { switchId: row.id, status: step.to },
      });
      // Delivery is a separate job: mail must never delay a state change.
      await jobRepository.enqueue(
        db,
        "notification.deliver",
        { notificationId },
        `notification.deliver:${notificationId}`,
      );
    }
  }

  await expireEmergencyRequests(db, now);
  return applied;
}

/** Times out emergency requests and lets expired grants lapse (FR-J006). */
async function expireEmergencyRequests(db: TypedSupabaseClient, now: Date): Promise<void> {
  const expirable = await emergencyRepository.listExpirable(db, now);
  for (const request of expirable) {
    const target = ["PENDING", "VERIFYING", "VERIFIED"].includes(request.status)
      ? "EXPIRED"
      : "REVOKED";
    const { error } = await db.rpc("ea_transition", {
      p_request_id: request.id,
      p_to: target,
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
