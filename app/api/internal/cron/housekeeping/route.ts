import { withApi } from "@/lib/api/with-api";
import { enqueueHousekeeping } from "@/lib/jobs/processor";

/**
 * Queues the daily sweep (api-contracts.md § Internal).
 *
 * As with the DMS scan, the cron only queues: the idempotency key is the day,
 * so a retried or duplicated trigger is a no-op, and the work itself runs in
 * the job queue with retries and a lock.
 */
export const POST = withApi(
  { auth: "cron", auditAction: "housekeeping.queued", auditResourceType: "job" },
  async () => {
    const jobId = await enqueueHousekeeping();
    return { queued: jobId !== null, jobId };
  },
);

export const GET = POST;
