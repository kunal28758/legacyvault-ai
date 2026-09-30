import { describe, expect, it } from "vitest";

import { SKIPPED_SUMMARY, computeCompleteness } from "@/lib/legacy-plan/completeness";
import { SKIPPABLE_SECTIONS, sectionDraftSchemas } from "@/lib/validators/legacy-plan.validators";

/**
 * Auto-save validation and "Skip for now" (FR-C002). A draft must save while
 * half-typed, but only in the wizard's own shape; a skipped section keeps what
 * was typed and still counts as incomplete.
 */
const UUID = "11111111-1111-4111-8111-111111111111";

describe("draft shapes", () => {
  it("accepts a half-typed section", () => {
    expect(sectionDraftSchemas["personal-details"].safeParse({ legalName: "Pri" }).success).toBe(
      true,
    );
    expect(
      sectionDraftSchemas["family-information"].safeParse({ children: [{ name: "" }] }).success,
    ).toBe(true);
  });

  it("drops keys the wizard never writes", () => {
    const parsed = sectionDraftSchemas["special-wishes"].parse({
      instructions: "Keep the house",
      isComplete: true,
      __proto__injection: "x",
    });
    expect(parsed).toEqual({ instructions: "Keep the house" });
  });

  it("refuses wrong types, oversize text and non-UUID references", () => {
    expect(sectionDraftSchemas["personal-details"].safeParse({ legalName: 42 }).success).toBe(
      false,
    );
    expect(
      sectionDraftSchemas["special-wishes"].safeParse({ instructions: "x".repeat(4_001) }).success,
    ).toBe(false);
    expect(
      sectionDraftSchemas.beneficiaries.safeParse({ beneficiaryIds: ["not-a-uuid"] }).success,
    ).toBe(false);
    expect(
      sectionDraftSchemas["financial-assets"].safeParse({ assetIds: [UUID], none: false }).success,
    ).toBe(true);
  });

  it("never lets personal details be skipped", () => {
    expect(SKIPPABLE_SECTIONS).not.toContain("personal-details");
    expect(SKIPPABLE_SECTIONS).toHaveLength(8);
    expect(sectionDraftSchemas["personal-details"].parse({ skipped: true })).toEqual({});
    expect(sectionDraftSchemas["witness-details"].parse({ skipped: true })).toEqual({
      skipped: true,
    });
  });
});

describe("skipped sections", () => {
  const context = {
    beneficiaries: [],
    assets: [],
    documents: [],
  };

  it("are labelled skipped and remain incomplete", () => {
    const result = computeCompleteness({
      ...context,
      stepsData: { "witness-details": { witnesses: [], skipped: true } },
    });
    expect(result.sections["witness-details"]).toMatchObject({
      complete: false,
      skipped: true,
      summary: SKIPPED_SUMMARY,
    });
    expect(result.incompleteSections).toContain("witness-details");
  });

  it("stop being skipped once the section is complete", () => {
    const result = computeCompleteness({
      ...context,
      stepsData: { "special-wishes": { instructions: "Donate my books", skipped: true } },
    });
    expect(result.sections["special-wishes"]).toMatchObject({ complete: true, skipped: false });
  });
});
