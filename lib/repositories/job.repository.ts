import "server-only";

import type { TypedSupabaseClient } from "@/lib/db/server";
import type { Database } from "@/lib/types/database";

/**
 * Background job queue (ADR-006).
 *
 * `jobs` is Class C: only the service role touches it, and `claim_jobs()` is
 * the only way to take work — it locks and marks rows RUNNING in one statement,
 * so two cron invocations cannot pick up the same job.
 */
export type JobRow = Database["public"]["Tables"]["jobs"]["Row"];

export async function claim(
  serviceDb: TypedSupabaseClient,
  runnerId: string,
  limit: number,
): Promise<JobRow[]> {
  const { data, error } = await serviceDb.rpc("claim_jobs", {
    p_limit: limit,
    p_runner_id: runnerId,
  });
  if (error) throw error;
  return (data ?? []) as JobRow[];
}

export async function markSucceeded(serviceDb: TypedSupabaseClient, id: string): Promise<void> {
  const { error } = await serviceDb
    .from("jobs")
    .update({ status: "SUCCEEDED", finished_at: new Date().toISOString(), last_error: null })
    .eq("id", id);
  if (error) throw error;
}

/**
 * A RUNNING job older than this belongs to a runner that died: the run-jobs
 * route is stopped at 300 s, so no live invocation holds a job this long.
 */
const ABANDONED_AFTER_MS = 15 * 60 * 1000;

/**
 * Takes back jobs a dead runner left RUNNING (a killed or crashed invocation):
 * to the queue, or to DEAD once their attempts are spent. Without this they
 * would stay RUNNING for ever — a purge never retried, a delivery lost. Every
 * handler is idempotent (deliveries carry provider idempotency keys).
 */
export async function recoverAbandoned(
  serviceDb: TypedSupabaseClient,
  now = new Date(),
): Promise<number> {
  const cutoff = new Date(now.getTime() - ABANDONED_AFTER_MS).toISOString();
  const { data, error } = await serviceDb
    .from("jobs")
    .select("id, attempts, max_attempts")
    .eq("status", "RUNNING")
    .lt("locked_at", cutoff)
    .limit(100);
  if (error) throw error;
  const abandoned = data ?? [];
  const lastError = "abandoned: the runner stopped while this job was running";
  const groups = [
    {
      ids: abandoned.filter((job) => job.attempts < job.max_attempts).map((job) => job.id),
      update: { status: "QUEUED" as const },
    },
    {
      ids: abandoned.filter((job) => job.attempts >= job.max_attempts).map((job) => job.id),
      update: { status: "DEAD" as const, finished_at: now.toISOString() },
    },
  ];
  for (const { ids, update } of groups) {
    if (ids.length === 0) continue;
    const { error: updateError } = await serviceDb
      .from("jobs")
      .update({ ...update, locked_at: null, locked_by: null, last_error: lastError })
      .in("id", ids)
      .eq("status", "RUNNING");
    if (updateError) throw updateError;
  }
  return abandoned.length;
}

/**
 * Returns a job to the queue, or gives up once it has used its attempts.
 *
 * The retry is delayed by an exponential back-off so a failing dependency is
 * not hammered once a minute by the cron tick.
 */
export async function markFailed(
  serviceDb: TypedSupabaseClient,
  job: JobRow,
  message: string,
): Promise<void> {
  const exhausted = job.attempts >= job.max_attempts;
  const backoffMinutes = Math.min(60, 2 ** Math.max(0, job.attempts - 1));

  const { error } = await serviceDb
    .from("jobs")
    .update({
      status: exhausted ? "DEAD" : "QUEUED",
      // Never the raw exception: a job payload error can quote user data.
      last_error: message.slice(0, 500),
      locked_at: null,
      locked_by: null,
      run_at: exhausted ? job.run_at : new Date(Date.now() + backoffMinutes * 60_000).toISOString(),
      finished_at: exhausted ? new Date().toISOString() : null,
    })
    .eq("id", job.id);
  if (error) throw error;
}

/** Enqueues work from the application side (the guarded functions do their own). */
export async function enqueue(
  serviceDb: TypedSupabaseClient,
  type: string,
  payload: Record<string, unknown>,
  idempotencyKey: string,
  runAt?: string,
): Promise<string | null> {
  const { data, error } = await serviceDb
    .from("jobs")
    .insert({
      type,
      payload: payload as never,
      idempotency_key: idempotencyKey,
      ...(runAt ? { run_at: runAt } : {}),
    })
    .select("id")
    .maybeSingle();

  // A duplicate key means the work is already queued — that is the point of it.
  if (error) {
    if (error.code === "23505") return null;
    throw error;
  }
  return data?.id ?? null;
}
