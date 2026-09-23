import { describe, expect, it } from "vitest";

import { nextDmsStep, type DmsScanRow } from "@/lib/jobs/handlers/dms-scan";

/**
 * The Dead Man's Switch timeline (FR-I004–I007).
 *
 * The scheduled scan is the only thing that advances a switch through its
 * states, so the order and the timing are asserted here without a database:
 * ACTIVE → REMINDER_SENT → GRACE_PERIOD → ESCALATING (n times) → RELEASING →
 * RELEASED.
 */
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const NOW = new Date("2026-09-24T12:00:00.000Z");

function row(overrides: Partial<DmsScanRow> = {}): DmsScanRow {
  return {
    id: "switch-1",
    status: "ACTIVE",
    escalation_delay_hours: 24,
    inactivity_period_days: 90,
    last_check_in_at: new Date(NOW.getTime() - 40 * DAY).toISOString(),
    current_escalation_step: 0,
    escalation_rules: {},
    ...overrides,
  } as DmsScanRow;
}

describe("dms timeline", () => {
  it("moves an overdue ACTIVE switch to REMINDER_SENT and schedules the full window", () => {
    const step = nextDmsStep(row(), NOW);
    expect(step).toMatchObject({ to: "REMINDER_SENT", eventType: "MISSED_CHECK_IN" });
    // The next action is the end of the inactivity period, measured from the
    // last check-in rather than from now.
    expect(step?.nextAt?.toISOString()).toBe(
      new Date(NOW.getTime() - 40 * DAY + 90 * DAY).toISOString(),
    );
    expect(step?.notify?.type).toBe("dms.reminder");
  });

  it("moves REMINDER_SENT to the grace period one escalation delay ahead", () => {
    const step = nextDmsStep(row({ status: "REMINDER_SENT" }), NOW);
    expect(step?.to).toBe("GRACE_PERIOD");
    expect(step?.nextAt?.getTime()).toBe(NOW.getTime() + 24 * HOUR);
  });

  it("starts escalation at step 1 after the grace period", () => {
    const step = nextDmsStep(row({ status: "GRACE_PERIOD" }), NOW);
    expect(step).toMatchObject({ to: "ESCALATING", escalationStep: 1 });
    expect(step?.notify?.type).toBe("dms.escalating");
  });

  it("escalates once per delay up to the configured number of steps", () => {
    const second = nextDmsStep(
      row({ status: "ESCALATING", current_escalation_step: 1, escalation_rules: { steps: 3 } }),
      NOW,
    );
    expect(second).toMatchObject({ to: "ESCALATING", escalationStep: 2 });

    const last = nextDmsStep(
      row({ status: "ESCALATING", current_escalation_step: 3, escalation_rules: { steps: 3 } }),
      NOW,
    );
    expect(last?.to).toBe("RELEASING");
  });

  it("defaults to two escalation steps when no rule is configured", () => {
    expect(nextDmsStep(row({ status: "ESCALATING", current_escalation_step: 1 }), NOW)?.to).toBe(
      "ESCALATING",
    );
    expect(nextDmsStep(row({ status: "ESCALATING", current_escalation_step: 2 }), NOW)?.to).toBe(
      "RELEASING",
    );
  });

  it("ignores a nonsensical step count rather than escalating forever", () => {
    const step = nextDmsStep(
      row({ status: "ESCALATING", current_escalation_step: 2, escalation_rules: { steps: 9999 } }),
      NOW,
    );
    expect(step?.to).toBe("RELEASING");
  });

  it("releases from RELEASING and stops scheduling", () => {
    const step = nextDmsStep(row({ status: "RELEASING" }), NOW);
    expect(step).toMatchObject({ to: "RELEASED", eventType: "RELEASE" });
    expect(step?.nextAt).toBeNull();
    expect(step?.notify?.type).toBe("dms.released");
  });

  it("does nothing for states the scan must not touch", () => {
    expect(nextDmsStep(row({ status: "PAUSED" }), NOW)).toBeNull();
    expect(nextDmsStep(row({ status: "INACTIVE" }), NOW)).toBeNull();
    expect(nextDmsStep(row({ status: "RELEASED" }), NOW)).toBeNull();
  });
});
