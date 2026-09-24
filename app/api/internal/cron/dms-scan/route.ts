import { withApi } from "@/lib/api/with-api";
import { enqueueDmsScan } from "@/lib/jobs/processor";

/**
 * Queues the hourly Dead Man's Switch scan (FR-I004).
 *
 * The scan itself runs in the job queue rather than in this request: the
 * idempotency key is the hour, so however often the cron fires — or however
 * many instances fire at once — exactly one scan is queued per hour, and the
 * runner applies it with retries and a lock.
 */
/**
 * Only enqueues, but the queue insert waits on the database.
 *
 * The platform default is far shorter than this work can take, and a
 * truncated run is worse than a slow one.
 */
export const maxDuration = 60;

export const POST = withApi(
  { auth: "cron", auditAction: "dms.scan_queued", auditResourceType: "dead_man_switch" },
  async () => {
    const jobId = await enqueueDmsScan();
    return { queued: jobId !== null, jobId };
  },
);

export const GET = POST;
