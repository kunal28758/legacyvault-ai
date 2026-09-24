import { randomUUID } from "node:crypto";

import { withApi } from "@/lib/api/with-api";
import { runDueJobs } from "@/lib/jobs/processor";

/**
 * The job runner tick (ADR-006).
 *
 * Authenticated by `Authorization: Bearer $CRON_SECRET` in `withApi`'s `cron`
 * mode — no cookie is involved, which is why it is exempt from the browser CSRF
 * check. `claim_jobs()` locks the batch it takes, so overlapping invocations
 * never process the same job twice.
 */
/**
 * A drain of 25 jobs can include several email sends and storage calls.
 *
 * The platform default is far shorter than this work can take, and a
 * truncated run is worse than a slow one.
 */
export const maxDuration = 300;

export const POST = withApi(
  { auth: "cron", auditAction: "jobs.run", auditResourceType: "job" },
  async () => runDueJobs(`cron-${randomUUID().slice(0, 8)}`, 25),
);

/** Vercel Cron issues GET; same handler, same bearer check. */
export const GET = POST;
