// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

import { resetEnvGroupCache } from "@/lib/config/env";

/**
 * The three internal scheduler routes (called by pg_cron through pg_net, and
 * by the GitHub Actions backup) run work only with `Authorization: Bearer
 * $CRON_SECRET`, compared in constant time. Anything else — no header, a wrong
 * or truncated secret, another scheme, the secret without the scheme — is 401
 * and does no work. The secret never appears in a response.
 */
const work = vi.hoisted(() => ({ runs: 0, scans: 0, sweeps: 0 }));

vi.mock("@/lib/jobs/processor", () => ({
  runDueJobs: async () => {
    work.runs += 1;
    return { claimed: 0, succeeded: 0, failed: 0, skipped: 0 };
  },
  enqueueDmsScan: async () => {
    work.scans += 1;
    return "job-scan";
  },
  enqueueHousekeeping: async () => {
    work.sweeps += 1;
    return "job-sweep";
  },
}));
// A refused call is audited; here only that it was, not where it was written.
const audited = vi.hoisted(() => ({ actions: [] as string[] }));
vi.mock("@/lib/audit/audit.service", () => ({
  audit: { log: async (entry: { action: string }) => void audited.actions.push(entry.action) },
}));

import { POST as runJobs, GET as runJobsGet } from "@/app/api/internal/cron/run-jobs/route";
import { POST as dmsScan } from "@/app/api/internal/cron/dms-scan/route";
import { POST as housekeeping } from "@/app/api/internal/cron/housekeeping/route";

const SECRET = "test-cron-secret-0123456789abcdefghijklmnop";

beforeEach(() => {
  vi.stubEnv("CRON_SECRET", SECRET);
  resetEnvGroupCache();
  work.runs = 0;
  work.scans = 0;
  work.sweeps = 0;
  audited.actions.length = 0;
});

function call(
  route: (request: Request) => Promise<Response>,
  authorization?: string,
  method = "POST",
) {
  return route(
    new Request("https://app.test/api/internal/cron/x", {
      method,
      headers: authorization ? { authorization } : {},
    }),
  );
}

describe("internal cron routes", () => {
  const routes = [
    ["run-jobs", runJobs],
    ["dms-scan", dmsScan],
    ["housekeeping", housekeeping],
  ] as const;

  it.each(routes)("%s refuses every request without the exact bearer", async (_name, route) => {
    for (const authorization of [
      undefined,
      "Bearer wrong-secret",
      `Bearer ${SECRET.slice(0, -1)}`,
      `Bearer ${SECRET}x`,
      SECRET,
      `Basic ${SECRET}`,
      `bearer${SECRET}`,
    ]) {
      const response = await call(route, authorization);
      expect(response.status, String(authorization)).toBe(401);
      expect(await response.text()).not.toContain(SECRET);
    }
    expect(work).toEqual({ runs: 0, scans: 0, sweeps: 0 });
    expect(audited.actions.length).toBeGreaterThan(0);
  });

  it("refuses the GET form the same way (Vercel Cron's method)", async () => {
    expect((await call(runJobsGet, undefined, "GET")).status).toBe(401);
    expect(work.runs).toBe(0);
  });

  it.each(routes)("%s does its work with the exact bearer", async (_name, route) => {
    const response = await call(route, `Bearer ${SECRET}`);
    expect(response.status).toBe(200);
    expect(await response.text()).not.toContain(SECRET);
    expect(work.runs + work.scans + work.sweeps).toBe(1);
  });
});
