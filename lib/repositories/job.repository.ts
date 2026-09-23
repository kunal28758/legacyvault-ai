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
