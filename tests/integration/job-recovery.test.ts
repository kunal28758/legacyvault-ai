import { afterAll, describe, expect, it } from "vitest";

import type { TypedSupabaseClient } from "@/lib/db/server";
import { recoverAbandoned } from "@/lib/repositories/job.repository";

import { createServiceScopedClient, isLocalStackAvailable } from "../helpers/db";

/**
 * A run-jobs invocation that dies (the 300 s limit, a crash) leaves its claimed
 * jobs RUNNING. The next run must take them back. Fixtures are scheduled a day
 * ahead, so no other suite's runner can claim them while this runs.
 */
const available = await isLocalStackAvailable();
const service = available ? (createServiceScopedClient() as unknown as TypedSupabaseClient) : null;
const ids: string[] = [];

afterAll(async () => {
  if (service && ids.length) await service.from("jobs").delete().in("id", ids);
});

describe.skipIf(!available)("abandoned job recovery", () => {
  it("requeues jobs a dead runner left RUNNING, retires spent ones, leaves live ones", async () => {
    const db = service!;
    const ago = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString();
    const tomorrow = new Date(Date.now() + 86_400_000).toISOString();
    const base = {
      type: "test.abandoned",
      payload: {},
      run_at: tomorrow,
      locked_by: "dead-runner",
    };
    const { data, error } = await db
      .from("jobs")
      .insert([
        { ...base, status: "RUNNING", locked_at: ago(20), attempts: 1, max_attempts: 5 },
        { ...base, status: "RUNNING", locked_at: ago(20), attempts: 5, max_attempts: 5 },
        { ...base, status: "RUNNING", locked_at: ago(1), attempts: 1, max_attempts: 5 },
      ])
      .select("id");
    if (error) throw error;
    ids.push(...(data ?? []).map((row) => row.id));
    const [stale, spent, live] = ids;

    expect(await recoverAbandoned(db)).toBeGreaterThanOrEqual(2);

    const { data: rows } = await db
      .from("jobs")
      .select("id, status, locked_at, last_error, finished_at")
      .in("id", ids);
    const byId = new Map((rows ?? []).map((row) => [row.id, row]));
    expect(byId.get(stale)).toMatchObject({ status: "QUEUED", locked_at: null });
    expect(byId.get(stale)?.last_error).toMatch(/abandoned/);
    expect(byId.get(spent)).toMatchObject({ status: "DEAD", locked_at: null });
    expect(byId.get(spent)?.finished_at).not.toBeNull();
    // Still within its lease: a live runner may be working on it.
    expect(byId.get(live)?.status).toBe("RUNNING");

    // Idempotent: nothing of ours is left to recover.
    await recoverAbandoned(db);
    const { data: again } = await db.from("jobs").select("id, status").in("id", [stale, spent]);
    expect(new Set((again ?? []).map((row) => row.status))).toEqual(new Set(["QUEUED", "DEAD"]));
  });
});
