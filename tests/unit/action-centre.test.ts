import { describe, expect, it } from "vitest";

import { deriveActions, openActions } from "@/lib/client/action-centre";
import { buildLegacySnapshot, type LegacySnapshotInput } from "@/lib/client/legacy-snapshot";
import { readiness } from "@/lib/client/readiness";

const NOW = new Date(2026, 9, 6, 12, 0).getTime();
const DAY = 86_400_000;

function input(overrides: Partial<LegacySnapshotInput> = {}): LegacySnapshotInput {
  return {
    now: NOW,
    profile: { mfaEnabled: false, emailVerified: true, alternateEmail: null, preferences: {} },
    planOverview: { current: null, versions: [] } as never,
    beneficiaries: [],
    assets: [],
    documents: [],
    documentTotal: 0,
    dms: null,
    emergency: { contacts: [], requests: [] } as never,
    ...overrides,
  };
}

const doc = (id: string, profile: object | null = null) =>
  ({
    id,
    name: `${id}.pdf`,
    mimeType: "application/pdf",
    sizeBytes: 10,
    folderId: null,
    versionCount: 1,
    shareCount: 0,
    currentVersionId: null,
    profile,
    createdAt: "2026-09-01T00:00:00.000Z",
    updatedAt: "2026-09-01T00:00:00.000Z",
  }) as never;

describe("action centre", () => {
  it("raises only real gaps for an empty account and invents nothing", () => {
    const actions = deriveActions(buildLegacySnapshot(input()));
    const open = openActions(actions).map((a) => a.id);
    expect(open).toEqual(
      expect.arrayContaining(["will", "beneficiary-first", "security-mfa", "documents-first"]),
    );
    // No beneficiaries / documents / assets → no rules about them that need data.
    expect(open).not.toContain("beneficiary-pending");
    expect(open).not.toContain("documents-expired");
    expect(open).not.toContain("assets-unassigned");
    expect(open.some((id) => id.startsWith("ea-request"))).toBe(false);
    // Verified email is reported as completed, not as an action.
    expect(actions.find((a) => a.id === "security-email")?.completed).toBe(true);
  });

  it("orders critical first and carries the deadline of a waiting emergency request", () => {
    const actions = deriveActions(
      buildLegacySnapshot(
        input({
          emergency: {
            contacts: [{}],
            requests: [
              { id: "r1", status: "VERIFIED", requestExpiresAt: "2026-10-07T12:00:00.000Z" },
            ],
          } as never,
        }),
      ),
    );
    expect(actions[0]).toMatchObject({
      id: "ea-request-r1",
      priority: "CRITICAL",
      deadline: "2026-10-07T12:00:00.000Z",
      href: "/emergency-access",
    });
  });

  it("escalates an overdue switch and flags a switch that would release to nobody", () => {
    const actions = deriveActions(
      buildLegacySnapshot(
        input({
          dms: {
            status: "GRACE_PERIOD",
            nextCheckInAt: new Date(NOW - DAY).toISOString(),
            contacts: [],
            releaseScope: { documents: [], assets: [], videos: [], planSections: [] },
          } as never,
        }),
      ),
    );
    const ids = openActions(actions).map((a) => a.id);
    expect(ids[0]).toBe("dms-overdue");
    expect(ids).toEqual(expect.arrayContaining(["dms-contacts", "dms-scope"]));
  });

  it("tracks owner-set expiry dates: expired, expiring soon, and nothing for distant dates", () => {
    const snapshot = buildLegacySnapshot(
      input({
        documents: [
          doc("passport", { category: "IDENTITY", expiresOn: "2026-09-30" }),
          doc("policy", { category: "INSURANCE", expiresOn: "2026-10-20" }),
          doc("deed", { category: "PROPERTY", expiresOn: "2040-01-01" }),
        ],
        documentTotal: 3,
      }),
    );
    expect(snapshot.documents.expired.map((d) => d.id)).toEqual(["passport"]);
    expect(snapshot.documents.expiringSoon.map((d) => d.id)).toEqual(["policy"]);
    const open = openActions(deriveActions(snapshot)).map((a) => a.id);
    expect(open).toContain("documents-expired");
    expect(open).toContain("document-expiring-policy");
    expect(open).not.toContain("document-expiring-deed");
  });

  it("turns a recorded life event into steps, completing those the state proves", () => {
    const actions = deriveActions(
      buildLegacySnapshot(
        input({
          profile: {
            mfaEnabled: true,
            emailVerified: true,
            alternateEmail: "a@b.c",
            preferences: {
              lifeEvents: [
                {
                  id: "evt-123456",
                  type: "PROPERTY",
                  occurredOn: null,
                  recordedAt: "2026-10-01T00:00:00.000Z",
                  done: ["insurance"],
                },
              ],
            },
          },
          documents: [doc("deed", { category: "PROPERTY" })],
          documentTotal: 1,
        }),
      ),
    );
    const life = actions.filter((a) => a.source === "Life events");
    expect(life.find((a) => a.id.endsWith("upload-deed"))?.completed).toBe(true); // proven by state
    expect(life.find((a) => a.id.endsWith("insurance"))?.completed).toBe(true); // marked by owner
    expect(life.find((a) => a.id.endsWith("record-asset"))?.completed).toBe(false);
  });
});

describe("legacy readiness", () => {
  it("scores an empty account low and explains every missing point", () => {
    const result = readiness(buildLegacySnapshot(input()));
    expect(result.categories.map((c) => c.id)).toEqual([
      "documents",
      "will",
      "beneficiaries",
      "emergency",
      "digital",
      "security",
    ]);
    expect(result.score).toBeLessThan(15);
    expect(result.missing.length).toBeGreaterThan(5);
    expect(result.missing[0].impact).toBeGreaterThanOrEqual(result.missing.at(-1)!.impact);
  });

  it("is deterministic and reaches 100 only when every criterion is met", () => {
    const full = input({
      profile: { mfaEnabled: true, emailVerified: true, alternateEmail: "r@x.y", preferences: {} },
      planOverview: {
        current: { status: "FINALIZED", stepsData: {}, updatedAt: "2026-09-01" },
        versions: [{}],
      } as never,
      beneficiaries: [
        { id: "b", status: "ACTIVE", createdAt: "2026-09-01", roles: { assignmentCount: 1 } },
      ] as never,
      assets: [
        { asset: { id: "a", kind: "DIGITAL_ASSET", createdAt: "2026-09-01" }, assignments: [{}] },
      ] as never,
      documents: [doc("will", { category: "WILL_ESTATE" })],
      documentTotal: 1,
      dms: {
        status: "ACTIVE",
        nextCheckInAt: new Date(NOW + 20 * DAY).toISOString(),
        contacts: [{}],
        releaseScope: { documents: ["will"], assets: [], videos: [], planSections: [] },
      } as never,
      emergency: { contacts: [{}], requests: [] } as never,
    });
    const first = readiness(buildLegacySnapshot(full));
    expect(first).toEqual(readiness(buildLegacySnapshot(full)));
    expect(first.score).toBe(100);
    expect(first.missing).toEqual([]);
  });
});
