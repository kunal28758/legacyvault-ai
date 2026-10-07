import { describe, expect, it } from "vitest";

import { deriveActions, openActions } from "@/lib/client/action-centre";
import {
  analyzeLegacy,
  assetRelations,
  findingsFor,
  mergeActions,
  RULES,
  type Finding,
} from "@/lib/client/intelligence";
import { assetKey, buildLegacyGraph, documentKey, WILL } from "@/lib/client/legacy-graph";
import { buildLegacySnapshot, type LegacySnapshotInput } from "@/lib/client/legacy-snapshot";
import { readiness } from "@/lib/client/readiness";
import type { AssetKind } from "@/lib/types/asset";

const NOW = new Date(2026, 9, 6, 12, 0).getTime();
const RECENT = "2026-09-01T00:00:00.000Z";

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

type AssetOptions = {
  kind?: AssetKind;
  name?: string;
  category?: string;
  profile?: object | null;
  assignments?: { beneficiaryId: string; allocationPercentage: number | null }[];
  createdAt?: string;
  updatedAt?: string;
  platform?: string | null;
  username?: string | null;
};

function asset(id: string, options: AssetOptions = {}) {
  const kind = options.kind ?? "PHYSICAL_ASSET";
  return {
    asset: {
      id,
      kind,
      name: options.name ?? `Asset ${id}`,
      category:
        options.category ??
        (kind === "DIGITAL_ASSET"
          ? "ONLINE_ACCOUNT"
          : kind === "FINANCIAL_ASSET"
            ? "BANK_ACCOUNT"
            : "REAL_ESTATE"),
      estimatedValue: null,
      currency: "INR",
      notes: null,
      profile: options.profile ?? null,
      createdAt: options.createdAt ?? RECENT,
      updatedAt: options.updatedAt ?? RECENT,
      institution: null,
      hasAccountNumber: false,
      hasPolicyNumber: false,
      description: null,
      location: null,
      ownershipDetails: null,
      platform: options.platform ?? null,
      username: options.username ?? null,
      hasCredentials: false,
      hasRecoveryInfo: false,
    },
    assignments: (options.assignments ?? []).map((a, index) => ({
      id: `${id}-as${index}`,
      beneficiaryName: a.beneficiaryId,
      createdAt: RECENT,
      ...a,
    })),
    allocatedPercentage: 0,
    remainingPercentage: 100,
  } as never;
}

function person(
  id: string,
  options: { status?: string; assignmentCount?: number; trusted?: boolean } = {},
) {
  return {
    id,
    name: `Person ${id}`,
    relationship: "Child",
    email: `${id}@example.com`,
    phone: null,
    status: options.status ?? "ACTIVE",
    invitedAt: null,
    activatedAt: null,
    notes: null,
    createdAt: RECENT,
    updatedAt: RECENT,
    roles: {
      assignmentCount: options.assignmentCount ?? 0,
      isTrustedContact: options.trusted ?? false,
      isEmergencyContact: false,
      averageAllocation: 0,
    },
  } as never;
}

function doc(
  id: string,
  options: {
    name?: string;
    profile?: object | null;
    attachments?: { resourceType: string; resourceId: string }[];
    sizeBytes?: number;
  } = {},
) {
  return {
    id,
    name: options.name ?? `${id}.pdf`,
    mimeType: "application/pdf",
    sizeBytes: options.sizeBytes ?? 10,
    folderId: null,
    versionCount: 1,
    shareCount: 0,
    attachments: (options.attachments ?? []).map((a, index) => ({
      id: `${id}-at${index}`,
      createdAt: RECENT,
      ...a,
    })),
    currentVersionId: null,
    profile: options.profile ?? null,
    createdAt: RECENT,
    updatedAt: RECENT,
  } as never;
}

function plan(stepsData: object, status: "DRAFT" | "FINALIZED" = "DRAFT", finalizedAt = RECENT) {
  return {
    current: {
      id: "plan-1",
      status,
      version: 1,
      currentStep: 1,
      stepsData,
      completionStatus: {},
      lockVersion: 1,
      finalizedAt: status === "FINALIZED" ? finalizedAt : null,
      createdAt: RECENT,
      updatedAt: RECENT,
    },
    plans: [],
    versions: [],
  } as never;
}

function analyze(overrides: Partial<LegacySnapshotInput> = {}) {
  const data = input(overrides);
  const snapshot = buildLegacySnapshot(data);
  return { snapshot, intel: analyzeLegacy(data, snapshot) };
}

const ids = (findings: Finding[], ruleId: string) =>
  findings.filter((finding) => finding.ruleId === ruleId);

describe("legacy relationship graph", () => {
  it("links documents, beneficiaries, nominees, the Will and release scopes with typed edges", () => {
    const graph = buildLegacyGraph(
      input({
        beneficiaries: [person("b1"), person("b2")],
        assets: [
          asset("a1", {
            assignments: [{ beneficiaryId: "b1", allocationPercentage: 100 }],
            profile: {
              nominee: { name: "Person b2", beneficiaryId: "b2" },
              expiresOn: "2027-01-01",
            },
          }),
        ],
        assetTotal: 1,
        beneficiaryTotal: 2,
        documents: [
          doc("d1", { attachments: [{ resourceType: "PHYSICAL_ASSET", resourceId: "a1" }] }),
        ],
        documentTotal: 1,
        planOverview: plan({
          beneficiaries: { beneficiaryIds: ["b1"] },
          "physical-assets": { assetIds: ["a1"] },
        }),
        dms: {
          id: "dms-1",
          releaseScope: { documents: ["d1"], assets: [], videos: [], planSections: [] },
          contacts: [{ beneficiaryId: "b2", beneficiaryName: "Person b2", notifyOrder: 1 }],
        } as never,
      }),
    );
    const types = (from: string) =>
      graph
        .out(from)
        .map((edge) => edge.type)
        .sort();
    expect(types(assetKey("a1"))).toEqual(["assigned_to", "expires_on", "referenced_by"]);
    expect(graph.in(assetKey("a1"), "documents")[0]).toMatchObject({ attachmentId: "d1-at0" });
    expect(graph.in(assetKey("a1"), "nominee_of")[0].from).toBe("beneficiary:b2");
    expect(graph.out(documentKey("d1"), "protected_by")[0].to).toBe("switch");
    expect(graph.out("switch", "released_to")[0].to).toBe("beneficiary:b2");
    expect(
      graph
        .in(WILL, "referenced_by")
        .map((edge) => edge.from)
        .sort(),
    ).toEqual(["asset:a1", "beneficiary:b1"]);
    expect(graph.dangling).toEqual([]);
  });

  it("reports a missing record only when the list it would be in is complete", () => {
    const references = {
      planOverview: plan({ "physical-assets": { assetIds: ["gone"] } }),
      assets: [asset("a1")],
    };
    const complete = buildLegacyGraph(input({ ...references, assetTotal: 1 }));
    expect(complete.dangling).toEqual([{ type: "referenced_by", from: "asset:gone", to: WILL }]);
    // 150 assets exist but only one was loaded: "gone" may simply be on page 2.
    const partial = buildLegacyGraph(input({ ...references, assetTotal: 150 }));
    expect(partial.dangling).toEqual([]);
  });

  it("never reports a record as missing because what it points at is on a later page", () => {
    // Beneficiary "b-page2" and asset "a-page2" exist but were not loaded.
    const { intel } = analyze({
      beneficiaries: [person("b1", { assignmentCount: 1 })],
      beneficiaryTotal: 80,
      assets: [
        asset("a1", {
          assignments: [{ beneficiaryId: "b-page2", allocationPercentage: 100 }],
          profile: {
            instructions: "See the folder.",
            nominee: { name: "X", beneficiaryId: "b-page2" },
          },
        }),
      ],
      assetTotal: 150,
      documents: [
        doc("d1", {
          profile: { category: "PROPERTY" },
          attachments: [{ resourceType: "PHYSICAL_ASSET", resourceId: "a-page2" }],
        }),
      ],
      documentTotal: 1,
      planOverview: plan({ beneficiaries: { beneficiaryIds: ["b-page2"] } }),
    });
    for (const ruleId of ["ASSET-BEN-001", "DOC-ASSET-001", "RULE-003", "RULE-006"]) {
      expect(ids(intel.findings, ruleId)).toEqual([]);
    }
    expect(intel.coverage.assignedAssets).toBe(1);
  });
});

describe("legacy intelligence findings", () => {
  it("produces nothing that needs data the account does not have", () => {
    const { intel } = analyze({
      beneficiaries: [person("b1", { trusted: true })],
      emergency: {
        contacts: [
          {
            id: "e1",
            beneficiaryId: "b1",
            beneficiaryName: "Person b1",
            accessScope: { documents: [], assets: [], videos: [], planSections: [] },
          },
        ],
        requests: [],
      } as never,
      planOverview: plan({}, "FINALIZED"),
    });
    expect(intel.findings).toEqual([]);
    expect(intel.recommendations).toEqual([]);
  });

  it("explains every finding with its rule, records, action and destination", () => {
    const { intel } = analyze({ assets: [asset("a1", { name: "Family house" })], assetTotal: 1 });
    for (const finding of intel.findings) {
      expect(RULES[finding.ruleId]).toBeDefined();
      expect(finding.type).toBe(RULES[finding.ruleId].type);
      expect(finding.title).toBeTruthy();
      expect(finding.explanation).toBeTruthy();
      expect(finding.recommendedAction).toBeTruthy();
      expect(finding.destination).toMatch(/^\//);
      expect(finding.sourceRecords.length).toBeGreaterThan(0);
      expect(finding.createdAt).toBe(new Date(NOW).toISOString());
    }
    const missing = ids(intel.findings, "ASSET-BEN-001")[0];
    expect(missing).toMatchObject({
      id: "ASSET-BEN-001:a1",
      type: "MISSING",
      severity: "IMPORTANT",
      title: "Family house has no beneficiary",
      destination: "/assets/physical/a1",
      sourceRecords: [{ kind: "asset", id: "a1", label: "Family house" }],
    });
  });

  it("flags missing beneficiary, document and instructions only for assets still held", () => {
    const { intel } = analyze({
      assets: [
        asset("held", { kind: "FINANCIAL_ASSET" }),
        asset("sold", { profile: { status: "SOLD" } }),
        asset("covered", {
          assignments: [{ beneficiaryId: "b1", allocationPercentage: 100 }],
          profile: { instructions: "Sell and split." },
        }),
      ],
      beneficiaries: [person("b1", { assignmentCount: 1 })],
      documents: [
        doc("deed", { attachments: [{ resourceType: "PHYSICAL_ASSET", resourceId: "covered" }] }),
      ],
      documentTotal: 1,
    });
    expect(ids(intel.findings, "ASSET-BEN-001").map((f) => f.id)).toEqual(["ASSET-BEN-001:held"]);
    expect(ids(intel.findings, "ASSET-DOC-001").map((f) => f.id)).toEqual(["ASSET-DOC-001:held"]);
    expect(ids(intel.findings, "ASSET-INSTR-001").map((f) => f.id)).toEqual([
      "ASSET-INSTR-001:held",
    ]);
  });

  it("does not judge supporting documents while documents are only partly loaded", () => {
    const { intel } = analyze({
      assets: [asset("a1")],
      documents: [doc("d1")],
      documentTotal: 250,
    });
    expect(ids(intel.findings, "ASSET-DOC-001")).toEqual([]);
  });

  it("raises expiry and review findings for asset dates, with deadlines", () => {
    const { intel } = analyze({
      assets: [
        asset("policy", { profile: { expiresOn: "2026-10-20" } }),
        asset("lapsed", { profile: { expiresOn: "2026-09-01" } }),
        asset("later", { profile: { expiresOn: "2030-01-01", reviewOn: "2026-10-10" } }),
      ],
    });
    const expiring = ids(intel.findings, "ASSET-EXP-001");
    expect(expiring.map((f) => [f.sourceRecords[0].id, f.severity, f.deadline])).toEqual([
      ["lapsed", "IMPORTANT", "2026-09-01"],
      ["policy", "UPCOMING", "2026-10-20"],
    ]);
    expect(ids(intel.findings, "ASSET-REVIEW-001")[0]).toMatchObject({ deadline: "2026-10-10" });
  });

  it("mentions the supported asset when a linked document is expiring", () => {
    const { intel } = analyze({
      assets: [asset("car", { name: "Car" })],
      documents: [
        doc("rc", {
          name: "Insurance.pdf",
          profile: { category: "INSURANCE", expiresOn: "2026-11-01" },
          attachments: [{ resourceType: "PHYSICAL_ASSET", resourceId: "car" }],
        }),
      ],
      documentTotal: 1,
    });
    const finding = ids(intel.findings, "DOC-EXP-001")[0];
    expect(finding.explanation).toContain("It supports Car.");
    expect(finding.coveredBy).toBe("document-expiring-rc");
    expect(findingsFor(intel.findings, "asset", "car").map((f) => f.ruleId)).toContain(
      "DOC-EXP-001",
    );
  });

  it("marks assets and a finalized Will stale after a year without review", () => {
    const old = "2025-06-01T00:00:00.000Z";
    const { intel } = analyze({
      assets: [
        asset("old", { updatedAt: old }),
        asset("confirmed", { updatedAt: old, profile: { lastReviewedOn: "2026-08-01" } }),
      ],
      planOverview: plan({}, "FINALIZED", "2025-01-01T00:00:00.000Z"),
    });
    expect(ids(intel.findings, "ASSET-STALE-001").map((f) => f.id)).toEqual([
      "ASSET-STALE-001:old",
    ]);
    expect(ids(intel.findings, "WILL-STALE-001")).toHaveLength(1);
  });

  it("finds asset-type documents with no linked asset (DOC-ASSET-001)", () => {
    const { intel } = analyze({
      documents: [
        doc("deed", { name: "Deed.pdf", profile: { category: "PROPERTY" } }),
        doc("passport", { profile: { category: "IDENTITY" } }),
      ],
      documentTotal: 2,
    });
    expect(ids(intel.findings, "DOC-ASSET-001")).toEqual([
      expect.objectContaining({
        title: "Property document has no linked asset",
        explanation:
          "“Deed.pdf” is categorized as a property document but is not linked to an asset.",
        recommendedAction: "Link this document to an existing property or create a property asset",
        type: "ORPHAN",
      }),
    ]);
  });

  it("finds beneficiaries with nothing assigned, but not contacts or people named in the Will", () => {
    const { intel } = analyze({
      beneficiaries: [
        person("idle"),
        person("contact", { trusted: true }),
        person("named"),
        person("busy", { assignmentCount: 2 }),
      ],
      planOverview: plan({ beneficiaries: { beneficiaryIds: ["named"] } }),
    });
    expect(ids(intel.findings, "BEN-RES-001").map((f) => f.id)).toEqual(["BEN-RES-001:idle"]);
    expect(ids(intel.findings, "RULE-010").map((f) => f.id)).toEqual(["RULE-010:named,plan-1"]);
  });
});

describe("conflict rules", () => {
  it("RULE-001: mixed or partial allocations on one asset", () => {
    const { intel } = analyze({
      beneficiaries: [person("b1"), person("b2")],
      assets: [
        asset("mixed", {
          assignments: [
            { beneficiaryId: "b1", allocationPercentage: 50 },
            { beneficiaryId: "b2", allocationPercentage: null },
          ],
        }),
        asset("partial", { assignments: [{ beneficiaryId: "b1", allocationPercentage: 60 }] }),
        asset("full", {
          assignments: [
            { beneficiaryId: "b1", allocationPercentage: 40 },
            { beneficiaryId: "b2", allocationPercentage: 60 },
          ],
        }),
      ],
    });
    const found = ids(intel.findings, "RULE-001");
    expect(found.map((f) => [f.sourceRecords[0].id, f.severity])).toEqual([
      ["mixed", "IMPORTANT"],
      ["partial", "RECOMMENDED"],
    ]);
    expect(found[1].title).toBe("Asset partial is only 60% allocated");
  });

  it("RULE-002: an asset missing from a started Will section, stronger when marked none", () => {
    const { intel } = analyze({
      assets: [
        asset("listed"),
        asset("left-out"),
        asset("bank", { kind: "FINANCIAL_ASSET" }),
        asset("site", { kind: "DIGITAL_ASSET" }),
      ],
      planOverview: plan({
        "physical-assets": { assetIds: ["listed"] },
        "financial-assets": { none: true },
      }),
    });
    const found = ids(intel.findings, "RULE-002");
    expect(found.map((f) => [f.sourceRecords[0].id, f.severity])).toEqual([
      ["bank", "IMPORTANT"],
      ["left-out", "RECOMMENDED"],
    ]);
    // The untouched digital section expects nothing yet — the incomplete Will covers it.
    expect(found.some((f) => f.sourceRecords[0].id === "site")).toBe(false);
    expect(found[1].explanation).toContain("review recommended");
    expect(found[1].explanation).not.toMatch(/invalid/i);
  });

  it("RULE-003: the Will and release scopes referencing deleted records", () => {
    const { intel } = analyze({
      assets: [asset("a1")],
      assetTotal: 1,
      documentTotal: 0,
      planOverview: plan({ "physical-assets": { assetIds: ["a1", "deleted-asset"] } }),
      dms: {
        id: "dms-1",
        releaseScope: { documents: ["deleted-doc"], assets: [], videos: [], planSections: [] },
        contacts: [],
      } as never,
    });
    expect(
      ids(intel.findings, "RULE-003")
        .map((f) => f.title)
        .sort(),
    ).toEqual([
      "Your Dead Man’s Switch release includes a document that no longer exists",
      "Your Will references an asset that no longer exists",
    ]);
  });

  it("RULE-004: likely duplicate assets by name and category, or by account", () => {
    const { intel } = analyze({
      assets: [
        asset("h1", { name: "Family House" }),
        asset("h2", { name: "family-house " }),
        asset("car", { name: "Family House", kind: "PHYSICAL_ASSET", category: "VEHICLE" }),
        asset("g1", {
          kind: "DIGITAL_ASSET",
          name: "Mail",
          platform: "Google",
          username: "me@x.com",
        }),
        asset("g2", {
          kind: "DIGITAL_ASSET",
          name: "Photos",
          platform: "google",
          username: "ME@x.com",
        }),
      ],
    });
    expect(
      ids(intel.findings, "RULE-004")
        .map((f) => f.id)
        .sort(),
    ).toEqual(["RULE-004:g1,g2", "RULE-004:h1,h2"]);
  });

  it("RULE-005: an expired document still supporting an asset", () => {
    const { intel } = analyze({
      assets: [asset("car")],
      documents: [
        doc("old-policy", {
          profile: { category: "INSURANCE", expiresOn: "2026-01-01" },
          attachments: [{ resourceType: "PHYSICAL_ASSET", resourceId: "car" }],
        }),
      ],
      documentTotal: 1,
    });
    expect(ids(intel.findings, "RULE-005").map((f) => f.id)).toEqual(["RULE-005:car,old-policy"]);
  });

  it("RULE-006: nominee, Will and assignments referencing inactive or removed beneficiaries", () => {
    const { intel } = analyze({
      beneficiaries: [person("gone-quiet", { status: "INACTIVE" })],
      beneficiaryTotal: 1,
      assets: [
        asset("a1", {
          profile: { nominee: { name: "Removed", beneficiaryId: "removed" } },
          assignments: [{ beneficiaryId: "gone-quiet", allocationPercentage: 100 }],
        }),
      ],
      planOverview: plan({ beneficiaries: { beneficiaryIds: ["gone-quiet"] } }),
    });
    const titles = ids(intel.findings, "RULE-006")
      .map((f) => f.title)
      .sort();
    expect(titles).toEqual([
      "Asset a1 is assigned to Person gone-quiet, who is no longer active",
      "Asset a1 names as nominee a beneficiary who has been removed",
      "Your Will names Person gone-quiet, who is no longer active",
    ]);
  });

  it("RULE-007: assets assigned to someone the Will's beneficiaries section leaves out", () => {
    const { intel } = analyze({
      beneficiaries: [
        person("named", { assignmentCount: 1 }),
        person("extra", { assignmentCount: 1 }),
      ],
      assets: [
        asset("a1", {
          assignments: [
            { beneficiaryId: "named", allocationPercentage: 50 },
            { beneficiaryId: "extra", allocationPercentage: 50 },
          ],
        }),
      ],
      planOverview: plan({ beneficiaries: { beneficiaryIds: ["named"] } }),
    });
    expect(ids(intel.findings, "RULE-007").map((f) => f.id)).toEqual(["RULE-007:extra,plan-1"]);
  });

  it("RULE-008: documents with the same name, type and size", () => {
    const { intel } = analyze({
      documents: [
        doc("d1", { name: "Deed.pdf", sizeBytes: 500 }),
        doc("d2", { name: "deed.PDF", sizeBytes: 500 }),
        doc("d3", { name: "Deed.pdf", sizeBytes: 999 }),
      ],
      documentTotal: 3,
    });
    expect(ids(intel.findings, "RULE-008").map((f) => f.id)).toEqual(["RULE-008:d1,d2"]);
  });

  it("RULE-009: a sold asset still assigned and in the Will", () => {
    const { intel } = analyze({
      beneficiaries: [person("b1")],
      assets: [
        asset("sold", {
          name: "Old car",
          profile: { status: "SOLD" },
          assignments: [{ beneficiaryId: "b1", allocationPercentage: 100 }],
        }),
      ],
      planOverview: plan({ "physical-assets": { assetIds: ["sold"] } }),
    });
    const [finding] = ids(intel.findings, "RULE-009");
    expect(finding.title).toBe("Old car is marked sold but is still assigned to 1 beneficiary");
    expect(finding.explanation).toContain("assigned to 1 beneficiary and referenced in your Will");
    // A sold asset is not "missing a beneficiary".
    expect(ids(intel.findings, "ASSET-BEN-001")).toEqual([]);
  });

  it("never uses legal-conclusion wording", () => {
    const { intel } = analyze({
      beneficiaries: [person("x", { status: "INACTIVE" })],
      assets: [asset("a"), asset("b", { name: "Asset a" })],
      planOverview: plan({
        beneficiaries: { beneficiaryIds: ["x"] },
        "physical-assets": { none: true },
      }),
    });
    expect(intel.findings.length).toBeGreaterThan(3);
    for (const finding of intel.findings) {
      expect(`${finding.title} ${finding.explanation}`).not.toMatch(
        /legally|invalid|illegal|void/i,
      );
    }
  });
});

describe("recommendations and the Action Centre", () => {
  it("dismissal only applies to heuristic rules and keeps the finding visible as dismissed", () => {
    const { intel } = analyze({
      profile: {
        mfaEnabled: true,
        emailVerified: true,
        alternateEmail: null,
        preferences: { dismissedFindings: ["RULE-004:h1,h2", "ASSET-BEN-001:h1"] },
      },
      assets: [asset("h1", { name: "House" }), asset("h2", { name: "House" })],
    });
    expect(intel.dismissed.map((f) => f.id)).toEqual(["RULE-004:h1,h2"]);
    expect(intel.open.some((f) => f.id === "ASSET-BEN-001:h1")).toBe(true);
    expect(intel.recommendations.some((a) => a.ruleId === "RULE-004")).toBe(false);
  });

  it("aggregates a rule into one action and never duplicates an existing action", () => {
    const data = input({
      assets: [asset("a1"), asset("a2"), asset("a3")],
      documents: [doc("u1"), doc("u2")],
      documentTotal: 2,
    });
    const snapshot = buildLegacySnapshot(data);
    const intel = analyzeLegacy(data, snapshot);
    const actions = mergeActions(deriveActions(snapshot), intel);

    const unassigned = actions.filter((a) => a.id === "assets-unassigned");
    expect(unassigned).toHaveLength(1);
    expect(unassigned[0]).toMatchObject({
      title: "3 assets have no beneficiary",
      priority: "IMPORTANT",
      href: "/assets?rule=ASSET-BEN-001",
      ruleId: "ASSET-BEN-001",
    });
    // Uncategorized documents are already the "documents-categorize" action.
    expect(actions.filter((a) => a.ruleId === "DOC-CAT-001")).toEqual([]);
    expect(actions.filter((a) => a.id === "documents-categorize")).toHaveLength(1);
    expect(new Set(actions.map((a) => a.id)).size).toBe(actions.length);
  });

  it("completes the replaced action when the only unassigned asset is no longer held", () => {
    const data = input({ assets: [asset("sold", { profile: { status: "SOLD" } })] });
    const snapshot = buildLegacySnapshot(data);
    const actions = mergeActions(deriveActions(snapshot), analyzeLegacy(data, snapshot));
    expect(actions.find((a) => a.id === "assets-unassigned")).toMatchObject({
      completed: true,
      title: "Every asset has a beneficiary",
    });
  });

  it("keeps dated findings as separate actions with their deadlines", () => {
    const { intel } = analyze({
      assets: [
        asset("p1", { profile: { expiresOn: "2026-10-20" } }),
        asset("p2", { profile: { expiresOn: "2026-11-01" } }),
      ],
    });
    const dated = intel.recommendations.filter((a) => a.ruleId === "ASSET-EXP-001");
    expect(dated.map((a) => a.deadline)).toEqual(["2026-10-20", "2026-11-01"]);
    expect(openActions(dated)).toHaveLength(2);
  });
});

describe("readiness with intelligence coverage", () => {
  it("adds criteria only where they apply and leaves category weights unchanged", () => {
    const empty = analyze();
    const base = readiness(empty.snapshot);
    const extended = readiness(empty.snapshot, empty.intel.coverage);
    expect(extended.score).toBe(base.score);
    expect(extended.categories.map((c) => [c.id, c.weight])).toEqual(
      base.categories.map((c) => [c.id, c.weight]),
    );
    const criteria = (r: typeof base) => r.categories.flatMap((c) => c.criteria.map((x) => x.id));
    expect(criteria(extended)).toEqual(criteria(base));
  });

  it("scores asset coverage, supporting documents and conflict-free state", () => {
    const { snapshot, intel } = analyze({
      beneficiaries: [person("b1", { assignmentCount: 1 })],
      assets: [
        asset("a1", { assignments: [{ beneficiaryId: "b1", allocationPercentage: 100 }] }),
        asset("a2"),
      ],
      documents: [
        doc("d1", { attachments: [{ resourceType: "PHYSICAL_ASSET", resourceId: "a1" }] }),
      ],
      documentTotal: 1,
      planOverview: plan({ "physical-assets": { assetIds: ["a1"] } }),
    });
    const result = readiness(snapshot, intel.coverage);
    const find = (id: string) =>
      result.categories.flatMap((c) => c.criteria).find((criterion) => criterion.id === id);
    expect(find("ben-asset-coverage")).toMatchObject({ points: 30, earned: 15, met: false });
    expect(find("docs-assets")).toMatchObject({ points: 20, earned: 10, met: false });
    // a2 is not in the Will's started physical section → RULE-002 is open.
    expect(find("will-consistent")).toMatchObject({ points: 20, earned: 0, met: false });
  });

  it("judges Will consistency only by conflicts that involve the Will", () => {
    // Two identical documents (RULE-008) are a conflict, but not with the Will.
    const { snapshot, intel } = analyze({
      documents: [doc("d1", { name: "deed.pdf" }), doc("d2", { name: "deed.pdf" })],
      documentTotal: 2,
      planOverview: plan({}),
    });
    expect(ids(intel.open, "RULE-008")).toHaveLength(1);
    const criterion = readiness(snapshot, intel.coverage)
      .categories.flatMap((c) => c.criteria)
      .find((c) => c.id === "will-consistent");
    expect(criterion).toMatchObject({ earned: 20, met: true });
  });
});

describe("asset relations", () => {
  it("summarizes one asset's documents, people, nominee, Will and release scope", () => {
    const data = input({
      beneficiaries: [person("b1"), person("b2")],
      assets: [
        asset("a1", {
          assignments: [{ beneficiaryId: "b1", allocationPercentage: 100 }],
          profile: { nominee: { name: "b2", beneficiaryId: "b2" } },
        }),
      ],
      documents: [
        doc("d1", { attachments: [{ resourceType: "PHYSICAL_ASSET", resourceId: "a1" }] }),
      ],
      documentTotal: 1,
      planOverview: plan({ "physical-assets": { assetIds: ["a1"] } }),
      emergency: {
        contacts: [
          {
            id: "e1",
            beneficiaryId: "b2",
            beneficiaryName: "Person b2",
            accessScope: {
              documents: [],
              assets: [{ type: "PHYSICAL_ASSET", id: "a1" }],
              videos: [],
              planSections: [],
            },
          },
        ],
        requests: [],
      } as never,
    });
    const relations = assetRelations(buildLegacyGraph(data), "a1");
    expect(relations.documents.map((d) => [d.node.id, d.attachmentId])).toEqual([["d1", "d1-at0"]]);
    expect(relations.beneficiaries.map((b) => b.id)).toEqual(["b1"]);
    expect(relations.nominee?.id).toBe("b2");
    expect(relations.inWill).toBe(true);
    expect(relations.protectedBy.map((p) => p.label)).toEqual(["Emergency access · Person b2"]);
  });
});
