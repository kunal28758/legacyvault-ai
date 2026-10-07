import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { analyzeLegacy } from "@/lib/client/intelligence";
import { buildLegacySnapshot, type LegacySnapshotInput } from "@/lib/client/legacy-snapshot";
import { describeForAssistant } from "@/lib/services/intelligence.service";

/**
 * Legacy Intelligence security boundaries:
 *  • the engine is pure — it cannot fetch, so it can only see what the owner's
 *    own authorized reads returned;
 *  • the server copy only reads (no insert/update/delete/rpc, only get/list
 *    service calls), so the Copilot path cannot mutate anything;
 *  • what reaches the AI provider has no record or people names.
 */
const ROOT = path.resolve(__dirname, "../..");
const source = (file: string) => readFileSync(path.join(ROOT, file), "utf8");

describe("legacy intelligence boundaries", () => {
  it("keeps the engine and graph pure: no network, storage or API client", () => {
    for (const file of ["lib/client/intelligence.ts", "lib/client/legacy-graph.ts"]) {
      const text = source(file);
      expect(text).not.toMatch(/\bfetch\(|apiClient|localStorage|sessionStorage|XMLHttpRequest/);
      expect(text).not.toMatch(/from "@\/lib\/(services|repositories|db)\//);
    }
  });

  it("only reads on the server path that grounds the Copilot", () => {
    const text = source("lib/services/intelligence.service.ts");
    expect(text).not.toMatch(/\.(insert|update|upsert|delete|rpc)\(/);
    const calls = [...text.matchAll(/(\w+Service)\.(\w+)\(/g)].map((match) => match[2]);
    expect(calls.length).toBeGreaterThan(0);
    for (const name of calls) expect(name).toMatch(/^(get|list)/);
  });

  it("sends the Copilot counts and rule ids — never asset, document or people names", () => {
    const input: LegacySnapshotInput = {
      now: Date.parse("2026-10-06T12:00:00Z"),
      profile: { mfaEnabled: true, emailVerified: true, alternateEmail: null, preferences: {} },
      planOverview: {
        current: {
          id: "plan-1",
          status: "DRAFT",
          version: 1,
          currentStep: 1,
          stepsData: {
            beneficiaries: { beneficiaryIds: ["b1"] },
            "physical-assets": { none: true },
          },
          completionStatus: {},
          lockVersion: 1,
          finalizedAt: null,
          createdAt: "2026-09-01T00:00:00Z",
          updatedAt: "2026-09-01T00:00:00Z",
        },
        plans: [],
        versions: [],
      },
      beneficiaries: [
        {
          id: "b1",
          name: "Meera Secretname",
          relationship: "Daughter",
          email: "meera@example.com",
          phone: null,
          status: "ACTIVE",
          invitedAt: null,
          activatedAt: null,
          notes: null,
          createdAt: "2026-09-01T00:00:00Z",
          updatedAt: "2026-09-01T00:00:00Z",
          roles: {
            assignmentCount: 0,
            isTrustedContact: false,
            isEmergencyContact: false,
            averageAllocation: 0,
          },
        },
      ],
      assets: [
        {
          asset: {
            id: "a1",
            kind: "PHYSICAL_ASSET",
            name: "Lakeview Villa Secret",
            category: "REAL_ESTATE",
            estimatedValue: 9_900_000,
            currency: "INR",
            notes: "Under the floorboard",
            profile: { instructions: "Key with Uncle Ravi", nominee: { name: "Ravi Nominee" } },
            createdAt: "2026-09-01T00:00:00Z",
            updatedAt: "2026-09-01T00:00:00Z",
            description: null,
            location: "Pune",
            ownershipDetails: null,
          },
          assignments: [],
          allocatedPercentage: 0,
          remainingPercentage: 100,
        },
      ],
      documents: [
        {
          id: "d1",
          name: "Villa deed confidential.pdf",
          mimeType: "application/pdf",
          sizeBytes: 10,
          folderId: null,
          versionCount: 1,
          shareCount: 0,
          attachments: [],
          currentVersionId: null,
          profile: { category: "PROPERTY", expiresOn: "2026-10-20" },
          createdAt: "2026-09-01T00:00:00Z",
          updatedAt: "2026-09-01T00:00:00Z",
        },
      ],
      documentTotal: 1,
      dms: null,
      emergency: { contacts: [], requests: [] },
    };
    const intelligence = analyzeLegacy(input, buildLegacySnapshot(input));
    expect(intelligence.open.length).toBeGreaterThan(3);

    const context = describeForAssistant(intelligence);
    expect(context).toContain("RULE-002");
    expect(context).toContain("ASSET-BEN-001");
    for (const secret of [
      "Meera",
      "Secretname",
      "meera@example.com",
      "Lakeview",
      "Villa",
      "floorboard",
      "Ravi",
      "Pune",
      "9900000",
      "9,900,000",
      "a1",
      "d1",
    ]) {
      expect(context).not.toContain(secret);
    }
  });
});
