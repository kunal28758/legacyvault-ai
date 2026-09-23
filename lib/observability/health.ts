import "server-only";

import { createServiceClient } from "@/lib/db/server";
import { logger } from "@/lib/observability/logger";

/**
 * Health / readiness probes (task T030 health route, ADR-010).
 *
 * The public response is deliberately just `{ status }` — an unauthenticated
 * caller must not learn which dependency is down. Operators authenticate with
 * `CRON_SECRET` (or a Super Admin session) for the detailed breakdown.
 */
export type ComponentStatus = "ok" | "degraded" | "down";

export interface HealthDetail {
  status: ComponentStatus;
  database: ComponentStatus;
  storage: ComponentStatus;
  jobs: { lastRunAgeSeconds: number | null; status: ComponentStatus };
  dmsScan: { lastSuccessAgeSeconds: number | null; status: ComponentStatus };
}

const DMS_SCAN_INTERVAL_SECONDS = 3600;

async function checkDatabase(): Promise<ComponentStatus> {
  try {
    const db = createServiceClient();
    const { error } = await db.from("users").select("id", { head: true, count: "exact" }).limit(1);
    return error ? "down" : "ok";
  } catch (cause) {
    logger.error({ err: cause }, "health: database probe failed");
    return "down";
  }
}

async function checkStorage(): Promise<ComponentStatus> {
  try {
    const db = createServiceClient();
    const { error } = await db.storage.listBuckets();
    return error ? "degraded" : "ok";
  } catch (cause) {
    logger.error({ err: cause }, "health: storage probe failed");
    return "degraded";
  }
}

async function lastFinishedJob(type: string): Promise<number | null> {
  const db = createServiceClient();
  const { data, error } = await db
    .from("jobs")
    .select("finished_at")
    .eq("type", type)
    .eq("status", "SUCCEEDED")
    .order("finished_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error || !data?.finished_at) return null;
  return Math.max(0, Math.round((Date.now() - Date.parse(data.finished_at)) / 1000));
}

/**
 * Dead Man's Switch scheduler freshness (NFR-AVL-002): the `finished_at` of the
 * most recent SUCCEEDED `dms.scan` job is the only heartbeat, and it must be
 * within 2× its interval.
 */
export async function getHealth(): Promise<HealthDetail> {
  const [database, storage, jobsAge, dmsAge] = await Promise.all([
    checkDatabase(),
    checkStorage(),
    lastFinishedJob("run-jobs").catch(() => null),
    lastFinishedJob("dms.scan").catch(() => null),
  ]);

  // Before the job runner exists there is no heartbeat to judge; that is not a
  // failure of the deployment, so it reports as degraded rather than down.
  const dmsStatus: ComponentStatus =
    dmsAge === null ? "degraded" : dmsAge <= DMS_SCAN_INTERVAL_SECONDS * 2 ? "ok" : "down";
  const jobsStatus: ComponentStatus = jobsAge === null ? "degraded" : "ok";

  const status: ComponentStatus =
    database === "down" || dmsStatus === "down"
      ? "down"
      : database === "ok" && storage === "ok" && dmsStatus === "ok" && jobsStatus === "ok"
        ? "ok"
        : "degraded";

  return {
    status,
    database,
    storage,
    jobs: { lastRunAgeSeconds: jobsAge, status: jobsStatus },
    dmsScan: { lastSuccessAgeSeconds: dmsAge, status: dmsStatus },
  };
}
