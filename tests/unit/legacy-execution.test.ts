import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { deriveActions, openActions } from "@/lib/client/action-centre";
import {
  CHECK_IN_STATES,
  DMS_STAGES,
  dmsExplanation,
  escalationStepCount,
  projectSchedule,
  type ScheduleInput,
} from "@/lib/client/dms-presentation";
import { analyzeLegacy } from "@/lib/client/intelligence";
import { buildLegacySnapshot, type LegacySnapshotInput } from "@/lib/client/legacy-snapshot";
import { shouldEmailNotification } from "@/lib/notifications/preferences";
import type { DeadManSwitch, DmsStatus } from "@/lib/types/dms";
import { dmsConfigureBodySchema } from "@/lib/validators/dms.validators";

/**
 * The Legacy Execution Engine, without a database: what the owner is told
 * will happen and when, which warnings can never be switched off, what the
 * Action Centre and Legacy Intelligence raise, and what configuration is
 * refused before it reaches `dms_configure()`.
 */
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const NOW = Date.parse("2026-10-07T12:00:00.000Z");

function schedule(overrides: Partial<ScheduleInput> = {}): ScheduleInput {
  return {
    status: "ACTIVE",
    lastCheckInAt: new Date(NOW - 10 * DAY).toISOString(),
    nextCheckInAt: new Date(NOW + 20 * DAY).toISOString(),
    checkInFrequencyDays: 30,
    inactivityPeriodDays: 90,
    escalationDelayHours: 24,
    escalationSteps: 2,
    currentEscalationStep: 0,
    ...overrides,
  };
}

describe("projected schedule", () => {
  it("projects every stage from the last check-in, as the scan applies them", () => {
    const steps = projectSchedule(schedule(), NOW);
    const last = NOW - 10 * DAY;
    expect(steps.map((step) => step.id)).toEqual(["due", "grace", "notify", "release"]);
    expect(steps[0].at).toBe(new Date(NOW + 20 * DAY).toISOString());
    expect(steps[1].at).toBe(new Date(last + 90 * DAY).toISOString());
    // Contacts are told one delay after the grace period starts…
    expect(steps[2].at).toBe(new Date(last + 90 * DAY + 24 * HOUR).toISOString());
    // …and release is at the earliest two further delays later.
    expect(steps[3].at).toBe(new Date(last + 90 * DAY + 3 * 24 * HOUR).toISOString());
    expect(steps.every((step) => !step.reached)).toBe(true);
  });

  it("anchors on the scan's own deadline once escalating", () => {
    const next = NOW + 5 * HOUR;
    const steps = projectSchedule(
      schedule({
        status: "ESCALATING",
        nextCheckInAt: new Date(next).toISOString(),
        currentEscalationStep: 1,
      }),
      NOW,
    );
    expect(steps.slice(0, 3).every((step) => step.reached && step.at === null)).toBe(true);
    expect(steps[3].at).toBe(new Date(next + 24 * HOUR).toISOString());
  });

  it("has no schedule while disabled or paused, and no future release once released", () => {
    expect(projectSchedule(schedule({ status: "INACTIVE" }), NOW)).toEqual([]);
    expect(projectSchedule(schedule({ status: "PAUSED" }), NOW)).toEqual([]);
    const released = projectSchedule(schedule({ status: "RELEASED" }), NOW);
    expect(released.at(-1)).toMatchObject({ reached: true, at: null });
  });

  it("reads the step count the way the scan does", () => {
    expect(escalationStepCount({})).toBe(2);
    expect(escalationStepCount({ steps: 3 })).toBe(3);
    expect(escalationStepCount({ steps: 9999 })).toBe(2);
    expect(escalationStepCount(null)).toBe(2);
  });

  it("accepts a check-in at every stage before release, and none after", () => {
    expect(CHECK_IN_STATES).toEqual([
      "ACTIVE",
      "REMINDER_SENT",
      "GRACE_PERIOD",
      "ESCALATING",
      "RELEASING",
    ]);
  });
});

describe("wording", () => {
  // Inactivity is never evidence of anything; LegacyVault is not a legal authority.
  const FORBIDDEN =
    /\b(died|deceased|death|passed away|legally|proves?|transfers? ownership|unreachable)\b/i;
  const STATUSES: DmsStatus[] = [
    "INACTIVE",
    "ACTIVE",
    "REMINDER_SENT",
    "GRACE_PERIOD",
    "ESCALATING",
    "RELEASING",
    "RELEASED",
    "PAUSED",
  ];

  it("never claims death, legal effect or certainty in what the owner reads", () => {
    for (const status of STATUSES) expect(dmsExplanation(status)).not.toMatch(FORBIDDEN);
    for (const stage of DMS_STAGES) {
      expect(`${stage.label} ${stage.description}`).not.toMatch(FORBIDDEN);
    }
  });

  it("keeps every release email and notification free of those claims", () => {
    const root = path.resolve(__dirname, "../..");
    for (const file of [
      "lib/jobs/handlers/dms-scan.ts",
      "lib/email/templates/access-link-email.tsx",
      "lib/email/templates/dms-contact-notice-email.tsx",
      "lib/email/templates/emergency-code-email.tsx",
    ]) {
      const text = readFileSync(path.join(root, file), "utf8")
        // Code comments explain the rule; only shipped strings matter.
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/\/\/.*$/gm, "");
      expect(text, file).not.toMatch(FORBIDDEN);
    }
  });
});

describe("release warnings cannot be switched off", () => {
  it.each(["dms.grace_period", "dms.escalating", "dms.released"])(
    "always emails %s, whatever the preferences",
    (type) => {
      expect(shouldEmailNotification(type, { email: false, checkInReminders: false })).toEqual({
        send: true,
      });
    },
  );

  it("always emails an emergency request that waits for the owner, or was auto-granted", () => {
    for (const type of ["ea.request_pending", "ea.access_granted"]) {
      expect(shouldEmailNotification(type, { email: false })).toEqual({ send: true });
    }
  });

  it("still lets the owner silence the routine reminder", () => {
    expect(shouldEmailNotification("dms.reminder", { checkInReminders: false })).toMatchObject({
      send: false,
    });
  });
});

function dms(overrides: Partial<DeadManSwitch> = {}): DeadManSwitch {
  return {
    id: "s1",
    status: "ACTIVE",
    inactivityPeriodDays: 90,
    checkInFrequencyDays: 30,
    escalationDelayHours: 24,
    escalationSteps: 2,
    lastCheckInAt: new Date(NOW - DAY).toISOString(),
    nextCheckInAt: new Date(NOW + 29 * DAY).toISOString(),
    currentEscalationStep: 0,
    pausedAt: null,
    releaseScope: { documents: ["d1"], assets: [], videos: [], planSections: [] },
    unavailableScopeItems: 0,
    contacts: [{ beneficiaryId: "b1", beneficiaryName: "Asha", notifyOrder: 1, status: "ACTIVE" }],
    releaseAccess: [],
    releaseHold: null,
    latestWarning: null,
    events: [],
    createdAt: new Date(NOW - 30 * DAY).toISOString(),
    updatedAt: new Date(NOW - DAY).toISOString(),
    ...overrides,
  };
}

function input(overrides: Partial<LegacySnapshotInput> = {}): LegacySnapshotInput {
  return {
    now: NOW,
    profile: { mfaEnabled: true, emailVerified: true, alternateEmail: null, preferences: {} },
    planOverview: { current: null, plans: [], versions: [] },
    beneficiaries: [],
    assets: [],
    documents: [],
    documentTotal: 0,
    dms: null,
    emergency: { contacts: [], requests: [] },
    ...overrides,
  };
}

const openIds = (overrides: Partial<LegacySnapshotInput>) =>
  openActions(deriveActions(buildLegacySnapshot(input(overrides)))).map((action) => action.id);

describe("action centre: execution", () => {
  it("raises a critical review once a release completed, counting only open links", () => {
    const released = dms({
      status: "RELEASED",
      releaseAccess: [
        {
          tokenId: "t1",
          beneficiaryId: "b1",
          beneficiaryName: "Asha",
          issuedAt: new Date(NOW - HOUR).toISOString(),
          deliveredAt: new Date(NOW - HOUR).toISOString(),
          verifiedAt: null,
          lastUsedAt: null,
          expiresAt: new Date(NOW + 30 * DAY).toISOString(),
          revokedAt: null,
        },
        {
          tokenId: "t0",
          beneficiaryId: "b1",
          beneficiaryName: "Asha",
          issuedAt: new Date(NOW - 40 * DAY).toISOString(),
          deliveredAt: null,
          verifiedAt: null,
          lastUsedAt: null,
          expiresAt: new Date(NOW + DAY).toISOString(),
          revokedAt: new Date(NOW - 39 * DAY).toISOString(),
        },
      ],
    });
    const snapshot = buildLegacySnapshot(input({ dms: released }));
    expect(snapshot.dms.liveReleaseLinks).toBe(1);
    const action = deriveActions(snapshot).find((a) => a.id === "dms-released");
    expect(action).toMatchObject({ priority: "CRITICAL", completed: false });
    expect(action?.explanation).toMatch(/1 release link still open/);
  });

  it("asks for a check-in, not a recovery, while a release is only pending", () => {
    const ids = openIds({ dms: dms({ status: "ESCALATING" }) });
    expect(ids[0]).toBe("dms-escalating");
    expect(ids).not.toContain("dms-released");
  });

  it("flags a schedule with no warning window, and nothing for a healthy one", () => {
    expect(openIds({ dms: dms({ checkInFrequencyDays: 30, inactivityPeriodDays: 30 }) })).toContain(
      "dms-schedule",
    );
    expect(openIds({ dms: dms() })).not.toContain("dms-schedule");
  });

  it("counts only release-scope items that still exist", () => {
    const snapshot = buildLegacySnapshot(
      input({
        dms: dms({
          releaseScope: { documents: ["d1", "d2"], assets: [], videos: [], planSections: [] },
          unavailableScopeItems: 2,
        }),
      }),
    );
    expect(snapshot.dms.releaseScopeSize).toBe(0);
    expect(deriveActions(snapshot).map((a) => a.id)).toContain("dms-scope");
  });
});

function heldAsset(id: string, assignedTo: string[]) {
  return {
    asset: {
      id,
      kind: "PHYSICAL_ASSET",
      name: `Asset ${id}`,
      category: "REAL_ESTATE",
      profile: null,
      createdAt: "2026-09-01T00:00:00.000Z",
      updatedAt: "2026-09-01T00:00:00.000Z",
    },
    assignments: assignedTo.map((beneficiaryId, index) => ({
      id: `${id}-as${index}`,
      beneficiaryId,
      beneficiaryName: beneficiaryId,
      allocationPercentage: null,
    })),
  } as never;
}

describe("legacy intelligence: ASSET-REL-001", () => {
  const people = [
    {
      id: "b1",
      name: "Asha",
      status: "ACTIVE",
      createdAt: "2026-09-01",
      roles: { assignmentCount: 1 },
    },
  ] as never;
  const findings = (overrides: Partial<LegacySnapshotInput>) => {
    const value = input({ beneficiaries: people, ...overrides });
    return analyzeLegacy(value, buildLegacySnapshot(value)).findings.filter(
      (finding) => finding.ruleId === "ASSET-REL-001",
    );
  };

  it("suggests reviewing an assigned asset no emergency release covers", () => {
    const found = findings({ assets: [heldAsset("a1", ["b1"])], dms: dms() });
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ severity: "RECOMMENDED", dismissible: true });
    expect(found[0].sourceRecords[0]).toMatchObject({ kind: "asset", id: "a1" });
  });

  it("stays silent without any release plan, for unassigned assets, and once covered", () => {
    expect(findings({ assets: [heldAsset("a1", ["b1"])], dms: null })).toEqual([]);
    expect(findings({ assets: [heldAsset("a1", [])], dms: dms() })).toEqual([]);
    expect(
      findings({
        assets: [heldAsset("a1", ["b1"])],
        dms: dms({
          releaseScope: {
            documents: [],
            assets: [{ type: "PHYSICAL_ASSET", id: "a1" }],
            videos: [],
            planSections: [],
          },
        }),
      }),
    ).toEqual([]);
  });
});

describe("configuration is validated before the database sees it", () => {
  const valid = {
    inactivityPeriodDays: 90,
    checkInFrequencyDays: 30,
    escalationDelayHours: 24,
    contactBeneficiaryIds: ["5b6f0c64-0f5b-4f0e-9f4e-8f3b8f0c1a11"],
    releaseScope: { documents: ["5b6f0c64-0f5b-4f0e-9f4e-8f3b8f0c1a12"] },
  };

  it("accepts a schedule with a warning window", () => {
    expect(dmsConfigureBodySchema.safeParse(valid).success).toBe(true);
  });

  it.each([
    ["a check-in interval as long as the threshold", { checkInFrequencyDays: 90 }],
    [
      "a check-in interval longer than the threshold",
      { checkInFrequencyDays: 60, inactivityPeriodDays: 30 },
    ],
    ["a negative grace period", { escalationDelayHours: -1 }],
    ["no trusted contact", { contactBeneficiaryIds: [] }],
    ["a contact that is not an id", { contactBeneficiaryIds: ["someone@example.com"] }],
  ])("refuses %s", (_, change) => {
    expect(dmsConfigureBodySchema.safeParse({ ...valid, ...change }).success).toBe(false);
  });
});
