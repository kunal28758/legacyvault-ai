import "server-only";

import { createServiceClient } from "@/lib/db/server";
import { accessDeliverHandler } from "@/lib/jobs/handlers/access-deliver";
import { dmsContactNoticeHandler } from "@/lib/jobs/handlers/dms-contact-notice";
import { dmsScanHandler } from "@/lib/jobs/handlers/dms-scan";
import { housekeepingHandler } from "@/lib/jobs/handlers/housekeeping";
import { notificationConfirmHandler } from "@/lib/jobs/handlers/notification-confirm";
import { notificationDeliverHandler } from "@/lib/jobs/handlers/notification-deliver";
import { securityNewDeviceHandler } from "@/lib/jobs/handlers/security-new-device";
import { storageRemoveObjectHandler } from "@/lib/jobs/handlers/storage-remove-object";
import { userHardDeleteHandler } from "@/lib/jobs/handlers/user-hard-delete";
import type { JobHandler } from "@/lib/jobs/types";
import { logger } from "@/lib/observability/logger";
import * as jobRepository from "@/lib/repositories/job.repository";

/**
 * The job runner (ADR-006).
 *
 * `claim_jobs()` locks and marks a batch RUNNING in one statement, so two cron
 * invocations overlapping cannot take the same work. A handler that throws puts
 * its job back with an exponential back-off until `max_attempts` is spent, at
 * which point the row becomes DEAD and stays visible rather than disappearing.
 * A job left RUNNING by an invocation that died is taken back at the start of
 * the next run (`recoverAbandoned`).
 */
const HANDLERS: Record<string, JobHandler> = {
  "access.deliver": accessDeliverHandler,
  "notification.deliver": notificationDeliverHandler,
  "notification.confirm": notificationConfirmHandler,
  "storage.remove-object": storageRemoveObjectHandler,
  "dms.scan": dmsScanHandler,
  "dms.contact-notice": dmsContactNoticeHandler,
  housekeeping: housekeepingHandler,
  "security.new-device": securityNewDeviceHandler,
  "user.hard-delete": userHardDeleteHandler,
};

export interface JobRunSummary {
  claimed: number;
  succeeded: number;
  failed: number;
  skipped: number;
}

export async function runDueJobs(runnerId: string, limit = 10): Promise<JobRunSummary> {
  const runStarted = Date.now();
  const db = createServiceClient();
  // Jobs a killed or crashed invocation left RUNNING go back to the queue first.
  const recovered = await jobRepository.recoverAbandoned(db).catch((cause: unknown) => {
    logger.error({ err: cause, runnerId }, "abandoned-job recovery failed");
    return 0;
  });
  if (recovered > 0) logger.warn({ runnerId, recovered }, "abandoned jobs recovered");
  const jobs = await jobRepository.claim(db, runnerId, limit);
  const summary: JobRunSummary = { claimed: jobs.length, succeeded: 0, failed: 0, skipped: 0 };

  for (const job of jobs) {
    const started = Date.now();
    // Ids, types and timings only: payloads can name people.
    const fields = { jobId: job.id, type: job.type, attempt: job.attempts };
    const handler = HANDLERS[job.type];
    if (!handler) {
      summary.skipped += 1;
      await jobRepository.markFailed(db, job, `no handler for job type ${job.type}`);
      continue;
    }

    try {
      await handler(job, db);
      await jobRepository.markSucceeded(db, job.id);
      summary.succeeded += 1;
      logger.info({ ...fields, durationMs: Date.now() - started }, "job succeeded");
    } catch (cause) {
      summary.failed += 1;
      const message = cause instanceof Error ? cause.message : "job failed";
      logger.error(
        {
          err: cause,
          ...fields,
          final: job.attempts >= job.max_attempts,
          durationMs: Date.now() - started,
        },
        "job failed",
      );
      await jobRepository.markFailed(db, job, message);
    }
  }

  if (jobs.length > 0) {
    logger.info({ runnerId, ...summary, durationMs: Date.now() - runStarted }, "job run complete");
  }
  return summary;
}

/**
 * Queues the hourly scan.
 *
 * The idempotency key is the hour itself, so however often the cron fires, one
 * scan runs per hour and a duplicate insert is silently the same work.
 */
export async function enqueueDmsScan(now = new Date()): Promise<string | null> {
  const db = createServiceClient();
  const hour = now.toISOString().slice(0, 13); // YYYY-MM-DDTHH
  return jobRepository.enqueue(db, "dms.scan", { hour }, `dms.scan:${hour}`);
}

/** One idempotent housekeeping sweep per day, whatever fires the cron. */
export async function enqueueHousekeeping(now = new Date()): Promise<string | null> {
  const db = createServiceClient();
  const day = now.toISOString().slice(0, 10); // YYYY-MM-DD
  return jobRepository.enqueue(db, "housekeeping", { day }, `housekeeping:${day}`);
}
