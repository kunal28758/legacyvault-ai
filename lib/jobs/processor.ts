import "server-only";

import { createServiceClient } from "@/lib/db/server";
import { accessDeliverHandler } from "@/lib/jobs/handlers/access-deliver";
import { dmsScanHandler } from "@/lib/jobs/handlers/dms-scan";
import { housekeepingHandler } from "@/lib/jobs/handlers/housekeeping";
import { notificationDeliverHandler } from "@/lib/jobs/handlers/notification-deliver";
import { storageRemoveObjectHandler } from "@/lib/jobs/handlers/storage-remove-object";
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
 */
const HANDLERS: Record<string, JobHandler> = {
  "access.deliver": accessDeliverHandler,
  "notification.deliver": notificationDeliverHandler,
  "storage.remove-object": storageRemoveObjectHandler,
  "dms.scan": dmsScanHandler,
  housekeeping: housekeepingHandler,
};

export interface JobRunSummary {
  claimed: number;
  succeeded: number;
  failed: number;
  skipped: number;
}

export async function runDueJobs(runnerId: string, limit = 10): Promise<JobRunSummary> {
  const db = createServiceClient();
  const jobs = await jobRepository.claim(db, runnerId, limit);
  const summary: JobRunSummary = { claimed: jobs.length, succeeded: 0, failed: 0, skipped: 0 };

  for (const job of jobs) {
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
    } catch (cause) {
      summary.failed += 1;
      const message = cause instanceof Error ? cause.message : "job failed";
      logger.error({ err: cause, jobId: job.id, type: job.type }, "job failed");
      await jobRepository.markFailed(db, job, message);
    }
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
