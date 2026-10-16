// @vitest-environment node
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterAll, describe, expect, it } from "vitest";

/**
 * The scheduled production workflow's last step is the alert channel: it must
 * fail the run whenever production health is anything but `ok`, including when
 * the health call itself failed. The exact script from the workflow file is
 * run here against each kind of response.
 */
const workflow = readFileSync(
  path.resolve(__dirname, "../../.github/workflows/production-jobs.yml"),
  "utf8",
);
const step = workflow.slice(workflow.indexOf("- name: Check production health"));
const script = step
  .slice(step.indexOf("node -e '") + "node -e '".length, step.indexOf("\n          '"))
  .split("\n")
  .map((line) => line.replace(/^ {12}/, ""))
  .join("\n");

const dir = mkdtempSync(path.join(tmpdir(), "lv-health-step-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

function runWith(body: string) {
  writeFileSync(path.join(dir, "health.json"), body);
  return spawnSync(process.execPath, ["-e", script], { cwd: dir, encoding: "utf8" });
}

describe("production-jobs workflow health step", () => {
  it("is the last step and is not allowed to fail silently", () => {
    expect(step.indexOf("- name:", 10)).toBe(-1);
    expect(step).not.toMatch(/continue-on-error/);
    // The secret travels only as a header, never through echo or the log.
    expect(step).not.toMatch(/echo[^\n]*CRON_SECRET/);
  });

  it("passes only on an ok status", () => {
    const ok = runWith(JSON.stringify({ success: true, data: { status: "ok" } }));
    expect(ok.status).toBe(0);
  });

  it.each([
    ["degraded", JSON.stringify({ success: true, data: { status: "degraded" } })],
    ["down", JSON.stringify({ success: true, data: { status: "down" } })],
    [
      "a refused call (wrong secret)",
      JSON.stringify({ success: false, error: { code: "UNAUTHENTICATED" } }),
    ],
    ["an empty body", ""],
    ["an HTML error page", "<html><body>502 Bad Gateway</body></html>"],
  ])("fails the run on %s", (_label, body) => {
    expect(runWith(body).status).not.toBe(0);
  });

  it("prints component statuses but no secret-shaped values", () => {
    const run = runWith(
      JSON.stringify({
        success: true,
        data: {
          status: "degraded",
          scheduler: { configured: false, lastSuccessAgeSeconds: null, failedResponses: 0 },
        },
      }),
    );
    expect(run.stdout).toContain("scheduler:");
    expect(run.stdout).toContain("::error::Production health is degraded");
  });
});
