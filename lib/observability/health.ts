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
  housekeeping: { lastSuccessAgeSeconds: number | null; status: ComponentStatus };
  /**
   * The database scheduler itself (pg_cron → pg_net, 0010/0014). Kept apart
   * from the job heartbeats above, which the GitHub Actions caller can keep
   * fresh on its own. `null` fields: unknown (e.g. 0014 not applied).
   */
  scheduler: {
    configured: boolean | null;
    lastSuccessAgeSeconds: number | null;
    failedResponses: number | null;
    status: ComponentStatus;
  };
  /** Work that failed in the last day; `null` when it could not be counted. */
  failures: {
    deadJobs24h: number | null;
    webhookFailures24h: number | null;
    overduePurges: number | null;
    status: ComponentStatus;
  };
}

const DMS_SCAN_INTERVAL_SECONDS = 3600;
/** Daily, but the GitHub Actions caller has run up to ~10 h late. */
const HOUSEKEEPING_STALE_SECONDS = 36 * 3600;
const DAY_MS = 24 * 3600 * 1000;
/** run-jobs is called every 10 minutes; two missed calls is a failure. */
const SCHEDULER_STALE_SECONDS = 30 * 60;

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
 * What failed recently, as operator signals (counts only — no payload, no
 * personal value):
 *  - jobs that exhausted their retries in the last day (a purge, an access
 *    delivery, a notification);
 *  - webhook deliveries that failed on our side in the last day (Svix retries
 *    them, but a run of them means a broken secret or handler);
 *  - accounts marked deleted more than a day ago whose hard delete was queued
 *    but has not finished (the purge normally completes within minutes).
 */
export async function recentFailures(): Promise<Omit<HealthDetail["failures"], "status">> {
  const db = createServiceClient();
  const since = new Date(Date.now() - DAY_MS).toISOString();

  const deadJobs = db
    .from("jobs")
    .select("id", { count: "exact", head: true })
    .eq("status", "DEAD")
    .gte("finished_at", since)
    .then(({ count, error }) => (error ? null : (count ?? 0)));

  const webhookFailures = db
    .from("audit_log")
    .select("id", { count: "exact", head: true })
    .in("action", ["webhook.clerk", "webhook.email"])
    .eq("outcome", "FAILURE")
    .gte("created_at", since)
    .then(({ count, error }) => (error ? null : (count ?? 0)));

  const overduePurges = (async () => {
    const { data: queued, error } = await db
      .from("jobs")
      .select("payload")
      .eq("type", "user.hard-delete")
      .lt("created_at", since)
      .order("created_at", { ascending: false })
      .limit(500);
    if (error) return null;
    const ids = [
      ...new Set(
        (queued ?? [])
          .map((job) => (job.payload as { userId?: unknown } | null)?.userId)
          .filter((id): id is string => typeof id === "string"),
      ),
    ];
    if (ids.length === 0) return 0;
    const { count, error: countError } = await db
      .from("users")
      .select("id", { count: "exact", head: true })
      .in("id", ids)
      .not("deleted_at", "is", null);
    return countError ? null : (count ?? 0);
  })();

  const [deadJobs24h, webhookFailures24h, overdue] = await Promise.all([
    deadJobs,
    webhookFailures,
    overduePurges,
  ]);
  return { deadJobs24h, webhookFailures24h, overduePurges: overdue };
}

/** What the database scheduler has done recently (`scheduler_status()`, 0014). */
export async function schedulerStatus(): Promise<Omit<HealthDetail["scheduler"], "status">> {
  const unknown = { configured: null, lastSuccessAgeSeconds: null, failedResponses: null };
  const db = createServiceClient();
  const { data, error } = await db.rpc("scheduler_status");
  if (error || !data || typeof data !== "object") return unknown;
  const status = data as {
    configured?: unknown;
    lastSuccessAt?: unknown;
    failedResponses?: unknown;
  };
  const lastSuccess =
    typeof status.lastSuccessAt === "string" ? Date.parse(status.lastSuccessAt) : NaN;
  return {
    configured: typeof status.configured === "boolean" ? status.configured : null,
    lastSuccessAgeSeconds: Number.isNaN(lastSuccess)
      ? null
      : Math.max(0, Math.round((Date.now() - lastSuccess) / 1000)),
    failedResponses: typeof status.failedResponses === "number" ? status.failedResponses : null,
  };
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
/** What the probe measured, before any judgement. */
export interface HealthReadings {
  database: ComponentStatus;
  storage: ComponentStatus;
  jobsAge: number | null;
  dmsAge: number | null;
  housekeepingAge: number | null;
  failed: Omit<HealthDetail["failures"], "status">;
  scheduler: Omit<HealthDetail["scheduler"], "status">;
}

async function probe(): Promise<HealthDetail> {
  const [database, storage, jobsAge, dmsAge, housekeepingAge, failed, scheduler] =
    await Promise.all([
      checkDatabase(),
      checkStorage(),
      lastFinishedJob().catch(() => null),
      lastFinishedJob("dms.scan").catch(() => null),
      lastFinishedJob("housekeeping").catch(() => null),
      recentFailures().catch(() => ({
        deadJobs24h: null,
        webhookFailures24h: null,
        overduePurges: null,
      })),
      schedulerStatus().catch(() => ({
        configured: null,
        lastSuccessAgeSeconds: null,
        failedResponses: null,
      })),
    ]);
  return assessHealth({ database, storage, jobsAge, dmsAge, housekeepingAge, failed, scheduler });
}

/**
 * Turns readings into statuses. Pure, so every transition is unit-tested.
 *
 *  - `down`: the database is unreachable, or the last Dead Man's Switch scan
 *    is older than twice its interval.
 *  - `ok`: every component is `ok`.
 *  - `degraded`: anything else, including any reading that is unknown.
 */
export function assessHealth(readings: HealthReadings): HealthDetail {
  const { database, storage, jobsAge, dmsAge, housekeepingAge, failed, scheduler } = readings;

  // Before the job runner exists there is no heartbeat to judge; that is not a
  // failure of the deployment, so it reports as degraded rather than down.
  const dmsStatus: ComponentStatus =
    dmsAge === null ? "degraded" : dmsAge <= DMS_SCAN_INTERVAL_SECONDS * 2 ? "ok" : "down";
  const jobsStatus: ComponentStatus = jobsAge === null ? "degraded" : "ok";
  // Missed housekeeping or recent failures need attention but take nothing
  // down, so they degrade the status rather than fail it.
  const housekeepingStatus: ComponentStatus =
    housekeepingAge !== null && housekeepingAge <= HOUSEKEEPING_STALE_SECONDS ? "ok" : "degraded";
  const failuresStatus: ComponentStatus = Object.values(failed).every((count) => count === 0)
    ? "ok"
    : "degraded";
  // The primary scheduler is healthy only on positive evidence: configured,
  // a recent 2xx from the app, and no failed call still on record.
  const schedulerStatusValue: ComponentStatus =
    scheduler.configured === true &&
    scheduler.lastSuccessAgeSeconds !== null &&
    scheduler.lastSuccessAgeSeconds <= SCHEDULER_STALE_SECONDS &&
    scheduler.failedResponses === 0
      ? "ok"
      : "degraded";

  const status: ComponentStatus =
    database === "down" || dmsStatus === "down"
      ? "down"
      : [
            database,
            storage,
            dmsStatus,
            jobsStatus,
            housekeepingStatus,
            failuresStatus,
            schedulerStatusValue,
          ].every((component) => component === "ok")
        ? "ok"
        : "degraded";

  return {
    status,
    database,
    storage,
    jobs: { lastRunAgeSeconds: jobsAge, status: jobsStatus },
    dmsScan: { lastSuccessAgeSeconds: dmsAge, status: dmsStatus },
    housekeeping: { lastSuccessAgeSeconds: housekeepingAge, status: housekeepingStatus },
    failures: { ...failed, status: failuresStatus },
    scheduler: { ...scheduler, status: schedulerStatusValue },
  };
}
