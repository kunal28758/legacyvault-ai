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

export async function checkDatabase(): Promise<ComponentStatus> {
  try {
    const db = createServiceClient();
    const { error } = await db.from("users").select("id", { head: true, count: "exact" }).limit(1);
    return error ? "down" : "ok";
  } catch (cause) {
    logger.error({ err: cause }, "health: database probe failed");
    return "down";
  }
}

export async function checkStorage(): Promise<ComponentStatus> {
  try {
    const db = createServiceClient();
    const { error } = await db.storage.listBuckets();
    return error ? "degraded" : "ok";
  } catch (cause) {
    logger.error({ err: cause }, "health: storage probe failed");
    return "degraded";
  }
}

/**
 * How long ago the runner last finished something.
 *
 * `type` narrows it to one kind of work; omitted, it is any job at all — the
 * runner has no job of its own to look for, so the freshest completion is its
 * heartbeat.
 */
export async function lastFinishedJob(type?: string): Promise<number | null> {
  const db = createServiceClient();
  let query = db
    .from("jobs")
    .select("finished_at")
    .eq("status", "SUCCEEDED")
    .order("finished_at", { ascending: false })
    .limit(1);
  if (type) query = query.eq("type", type);

  const { data, error } = await query.maybeSingle();
  if (error || !data?.finished_at) return null;
  return Math.max(0, Math.round((Date.now() - Date.parse(data.finished_at)) / 1000));
}

/**
 * The probe is public, so the result is cached for a few seconds.
 *
 * Uptime monitors poll far more often than the answer can change, and each
 * uncached call costs four database round trips plus a storage listing — an
 * amplification an anonymous caller should not be able to buy.
 */
const CACHE_MS = 5_000;
let cached: { at: number; value: HealthDetail } | null = null;

export async function getHealth(): Promise<HealthDetail> {
  if (cached && Date.now() - cached.at < CACHE_MS) return cached.value;
  const value = await probe();
  cached = { at: Date.now(), value };
  return value;
}

/**
 * Dead Man's Switch scheduler freshness (NFR-AVL-002): the `finished_at` of the
 * most recent SUCCEEDED `dms.scan` job is the only heartbeat, and it must be
 * within 2× its interval.
 */
async function probe(): Promise<HealthDetail> {
  const [database, storage, jobsAge, dmsAge] = await Promise.all([
    checkDatabase(),
    checkStorage(),
    lastFinishedJob().catch(() => null),
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
