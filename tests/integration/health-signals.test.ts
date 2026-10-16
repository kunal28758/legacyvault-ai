import { afterAll, describe, expect, it } from "vitest";

import { recentFailures, schedulerStatus } from "@/lib/observability/health";

import { createServiceScopedClient, isLocalStackAvailable } from "../helpers/db";

/**
 * The operator health breakdown counts recent failures: dead jobs, failed
 * webhook deliveries and purges that should have finished. Counted as deltas
 * against the shared local database; every fixture is synthetic, and jobs are
 * DEAD so no runner can claim them.
 */
const available = await isLocalStackAvailable();
const RUN = crypto.randomUUID().slice(0, 8);
const service = available ? createServiceScopedClient() : null;
const jobIds: string[] = [];
let userId: string | null = null;

afterAll(async () => {
  if (!service) return;
  if (jobIds.length) await service.from("jobs").delete().in("id", jobIds);
  if (userId) await service.from("users").delete().eq("id", userId);
});

describe.skipIf(!available)("operator health signals", () => {
  it("counts dead jobs, failed webhook deliveries and overdue purges", async () => {
    const db = service!;
    const before = await recentFailures();
    const twoDaysAgo = new Date(Date.now() - 2 * 86_400_000).toISOString();

    const { data: user, error: userError } = await db
      .from("users")
      .insert({
        clerk_user_id: `user_healthsig_${RUN}`,
        email: `healthsig-${RUN}@example.com`,
        name: "Health signal",
        deleted_at: twoDaysAgo,
      })
      .select("id")
      .single();
    if (userError) throw userError;
    userId = user.id;

    const { data: jobs, error: jobError } = await db
      .from("jobs")
      .insert([
        // Died just now: a recent failure.
        {
          type: "test.health-signal",
          status: "DEAD",
          payload: {},
          created_at: new Date().toISOString(),
          finished_at: new Date().toISOString(),
        },
        // Queued two days ago for an account that still exists: an overdue purge.
        {
          type: "user.hard-delete",
          status: "DEAD",
          payload: { userId: user.id, clerkUserId: `user_healthsig_${RUN}` },
          created_at: twoDaysAgo,
          finished_at: twoDaysAgo,
        },
      ])
      .select("id");
    if (jobError) throw jobError;
    jobIds.push(...(jobs ?? []).map((job) => job.id));

    // audit_log is append-only, so this row stays; dated 23 h ago it leaves the
    // one-day window within the hour.
    const { error: auditError } = await db.from("audit_log").insert({
      action: "webhook.clerk",
      resource_type: "processed_webhook_event",
      outcome: "FAILURE",
      metadata: { source: "health-signals.test" },
      created_at: new Date(Date.now() - 23 * 3_600_000).toISOString(),
    });
    if (auditError) throw auditError;

    const after = await recentFailures();
    expect(after.deadJobs24h).toBe((before.deadJobs24h ?? 0) + 1);
    expect(after.webhookFailures24h).toBe((before.webhookFailures24h ?? 0) + 1);
    expect(after.overduePurges).toBe((before.overduePurges ?? 0) + 1);
  });

  it("reads the database scheduler's status: a flag, an age and a count, no values", async () => {
    const status = await schedulerStatus();
    expect(Object.keys(status).sort()).toEqual([
      "configured",
      "failedResponses",
      "lastSuccessAgeSeconds",
    ]);
    expect(typeof status.configured).toBe("boolean");
    expect(status.failedResponses).toEqual(expect.any(Number));
  });
});
