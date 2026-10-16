// @vitest-environment node
import { describe, expect, it } from "vitest";

import { assessHealth, type HealthReadings } from "@/lib/observability/health";

/**
 * Every health transition, from readings alone. The production case on
 * 2026-10-15 is the important one: the database scheduler had no Vault
 * secret, but the GitHub Actions fallback kept the scan fresh — health must
 * not call that `ok`.
 */
const HEALTHY: HealthReadings = {
  database: "ok",
  storage: "ok",
  jobsAge: 60,
  dmsAge: 600,
  housekeepingAge: 3_600,
  failed: { deadJobs24h: 0, webhookFailures24h: 0, overduePurges: 0 },
  scheduler: { configured: true, lastSuccessAgeSeconds: 120, failedResponses: 0 },
};

const assess = (change: Partial<HealthReadings>) => assessHealth({ ...HEALTHY, ...change });

describe("assessHealth", () => {
  it("is ok only when every component has positive evidence", () => {
    expect(assessHealth(HEALTHY).status).toBe("ok");
  });

  it("does not let a fresh fallback scan hide an unconfigured database scheduler", () => {
    const health = assess({
      scheduler: { configured: false, lastSuccessAgeSeconds: null, failedResponses: 0 },
    });
    expect(health.scheduler.status).toBe("degraded");
    expect(health.dmsScan.status).toBe("ok");
    expect(health.status).toBe("degraded");
  });

  it.each([
    [
      "scheduler status unknown (0014 not applied)",
      { configured: null, lastSuccessAgeSeconds: null, failedResponses: null },
    ],
    [
      "no successful scheduler call for over 30 minutes",
      { configured: true, lastSuccessAgeSeconds: 1_801, failedResponses: 0 },
    ],
    [
      "a failed scheduler call still on record (e.g. a wrong secret → 401)",
      { configured: true, lastSuccessAgeSeconds: 60, failedResponses: 1 },
    ],
  ])("degrades on %s", (_label, scheduler) => {
    const health = assess({ scheduler: scheduler as HealthReadings["scheduler"] });
    expect(health.scheduler.status).toBe("degraded");
    expect(health.status).toBe("degraded");
  });

  it("goes down when the scan is older than twice its interval or the database is down", () => {
    expect(assess({ dmsAge: 7_201 }).status).toBe("down");
    expect(assess({ dmsAge: 7_200 }).status).toBe("ok");
    expect(assess({ database: "down" }).status).toBe("down");
  });

  it("degrades, never downs, on stale housekeeping, recent failures or unknown readings", () => {
    expect(assess({ housekeepingAge: 36 * 3_600 + 1 }).status).toBe("degraded");
    expect(assess({ housekeepingAge: null }).status).toBe("degraded");
    expect(
      assess({ failed: { deadJobs24h: 1, webhookFailures24h: 0, overduePurges: 0 } }).status,
    ).toBe("degraded");
    expect(
      assess({ failed: { deadJobs24h: 0, webhookFailures24h: 0, overduePurges: 1 } }).status,
    ).toBe("degraded");
    expect(
      assess({ failed: { deadJobs24h: null, webhookFailures24h: 0, overduePurges: 0 } }).status,
    ).toBe("degraded");
    expect(assess({ dmsAge: null }).status).toBe("degraded");
    expect(assess({ jobsAge: null }).status).toBe("degraded");
    expect(assess({ storage: "degraded" }).status).toBe("degraded");
  });
});
