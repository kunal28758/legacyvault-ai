import "server-only";

import { payloadOf, requireString, type JobHandler } from "@/lib/jobs/types";
import { logger } from "@/lib/observability/logger";
import { purgeAccount } from "@/lib/services/account.service";

/**
 * The hard delete of an account marked deleted by begin_account_deletion()
 * (0012): storage, Clerk identity, then the row and everything it cascades to.
 * Idempotent, so the queue's retries finish whatever an earlier attempt — or
 * the inline attempt of an immediate deletion — left undone.
 */
export const userHardDeleteHandler: JobHandler = async (job, db) => {
  const payload = payloadOf(job);
  const result = await purgeAccount(
    db,
    requireString(payload, "userId"),
    requireString(payload, "clerkUserId"),
  );
  logger.info({ jobId: job.id, ...result }, "account purge complete");
};
