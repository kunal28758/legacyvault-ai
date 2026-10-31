import { describe, expect, it } from "vitest";

import { computeCompleteness } from "@/lib/legacy-plan/completeness";
import {
  finalizeSchema,
  planStepParamSchema,
  planVersionParamSchema,
  savePlanStepBodySchema,
} from "@/lib/validators/legacy-plan.validators";

/**
 * Plan completeness and plan request validation (tasks T057–T070).
 *
 * The rule that matters for correctness is that a section referencing records
 * is complete only while those records exist and are eligible — the server
 * decides `isComplete` from this module, so a client cannot claim a section is
 * done by pointing at a deleted asset or an inactive beneficiary.
 */
const emptyContext = {
  stepsData: {},
  beneficiaries: [] as { id: string; status: string }[],
  assets: [] as { id: string; kind: "FINANCIAL_ASSET" | "PHYSICAL_ASSET" | "DIGITAL_ASSET" }[],
  documents: [] as { id: string }[],
};

const completePersonal = {
  legalName: "Priya Sharma",
  dateOfBirth: "1980-04-02",
  addressLine: "12 Marine Drive",
  city: "Mumbai",
  country: "India",
};

describe("section completeness", () => {
  it("treats an empty plan as 0% with every section incomplete", () => {
    const result = computeCompleteness(emptyContext);
    expect(result.percent).toBe(0);
    expect(result.incompleteSections).toHaveLength(5);
    expect(result.sections["personal-details"].required).toBe(true);
  });

  it("requires every personal-details field, not just a name", () => {
    const partial = computeCompleteness({
      ...emptyContext,
      stepsData: { "personal-details": { legalName: "Priya Sharma" } },
    });
    expect(partial.sections["personal-details"].complete).toBe(false);

    const full = computeCompleteness({
      ...emptyContext,
      stepsData: { "personal-details": completePersonal },
    });
    expect(full.sections["personal-details"].complete).toBe(true);
    expect(full.sections["personal-details"].summary).toBe("Priya Sharma");
  });

  it("ignores a selected beneficiary that no longer exists", () => {
    const stepsData = { beneficiaries: { beneficiaryIds: ["b1"] } };

    expect(
      computeCompleteness({ ...emptyContext, stepsData }).sections.beneficiaries.complete,
    ).toBe(false);

    expect(
      computeCompleteness({
        ...emptyContext,
        stepsData,
        beneficiaries: [{ id: "b1", status: "PENDING" }],
      }).sections.beneficiaries.complete,
    ).toBe(true);
  });

  it("ignores an INACTIVE beneficiary", () => {
    const result = computeCompleteness({
      ...emptyContext,
      stepsData: { beneficiaries: { beneficiaryIds: ["b1"] } },
      beneficiaries: [{ id: "b1", status: "INACTIVE" }],
    });
    expect(result.sections.beneficiaries.complete).toBe(false);
  });

  it("retains historical asset data without making it an active wizard requirement", () => {
    const stepsData = { "financial-assets": { assetIds: ["a1"] } };

    expect(computeCompleteness({ ...emptyContext, stepsData }).sections["financial-assets"].complete).toBe(true);
    expect(computeCompleteness({ ...emptyContext, stepsData }).incompleteSections).not.toContain("financial-assets");
  });

  it("accepts an explicit 'none' for the optional collection sections", () => {
    const result = computeCompleteness({
      ...emptyContext,
      stepsData: {
        "financial-assets": { assetIds: [], none: true },
        "physical-assets": { assetIds: [], none: true },
        "digital-assets": { assetIds: [], none: true },
        "document-attachments": { documentIds: [], none: true },
        "witness-details": { witnesses: [], none: true },
      },
    });
    expect(result.sections["financial-assets"].complete).toBe(true);
    expect(result.sections["financial-assets"].summary).toBe("Archived data retained");
    expect(result.sections["document-attachments"].complete).toBe(true);
    expect(result.sections["witness-details"].complete).toBe(true);
  });

  it("needs at least one written area for special wishes", () => {
    expect(
      computeCompleteness({
        ...emptyContext,
        stepsData: { "special-wishes": { instructions: "", funeralWishes: "", messages: "" } },
      }).sections["special-wishes"].complete,
    ).toBe(false);

    expect(
      computeCompleteness({
        ...emptyContext,
        stepsData: { "special-wishes": { messages: "A letter for my children." } },
      }).sections["special-wishes"].complete,
    ).toBe(true);
  });

  it("reports a percentage over the five active sections", () => {
    const result = computeCompleteness({
      ...emptyContext,
      stepsData: { "personal-details": completePersonal },
    });
    expect(result.percent).toBe(20);
    expect(result.incompleteSections).not.toContain("personal-details");
  });

  it("is robust against malformed step data", () => {
    const result = computeCompleteness({
      ...emptyContext,
      stepsData: {
        "personal-details": "not an object" as never,
        beneficiaries: { beneficiaryIds: "b1" } as never,
      },
    });
    expect(result.sections["personal-details"].complete).toBe(false);
    expect(result.sections.beneficiaries.complete).toBe(false);
  });
});

describe("plan request validation", () => {
  it("accepts a partial section payload so auto-save is never blocked", () => {
    const parsed = savePlanStepBodySchema.parse({
      data: { legalName: "Half typed" },
      lockVersion: 3,
    });
    expect(parsed.lockVersion).toBe(3);
  });

  it("requires a lock version, so a save can never skip the conflict check", () => {
    expect(savePlanStepBodySchema.safeParse({ data: {} }).success).toBe(false);
    expect(savePlanStepBodySchema.safeParse({ data: {}, lockVersion: -1 }).success).toBe(false);
    expect(savePlanStepBodySchema.safeParse({ data: {}, lockVersion: 1.5 }).success).toBe(false);
  });

  it("rejects an unknown section key before it reaches the guarded function", () => {
    const id = "11111111-1111-4111-8111-111111111111";
    expect(planStepParamSchema.safeParse({ id, step: "personal-details" }).success).toBe(true);
    expect(planStepParamSchema.safeParse({ id, step: "executor-details" }).success).toBe(false);
    expect(planStepParamSchema.safeParse({ id: "not-a-uuid", step: "beneficiaries" }).success).toBe(
      false,
    );
  });

  it("requires explicit confirmation and a lock version to finalize", () => {
    expect(finalizeSchema.safeParse({ confirmed: true, lockVersion: 0 }).success).toBe(true);
    expect(finalizeSchema.safeParse({ lockVersion: 0 }).success).toBe(false);
    expect(finalizeSchema.safeParse({ confirmed: false, lockVersion: 0 }).success).toBe(false);
    expect(
      finalizeSchema.safeParse({ confirmed: true, lockVersion: 2, acknowledgeIncomplete: true })
        .success,
    ).toBe(true);
  });

  it("requires both ids to be UUIDs when reading a version", () => {
    const id = "11111111-1111-4111-8111-111111111111";
    expect(planVersionParamSchema.safeParse({ id, versionId: id }).success).toBe(true);
    expect(planVersionParamSchema.safeParse({ id, versionId: "1 OR 1=1" }).success).toBe(false);
  });
});
