import { describe, expect, it } from "vitest";

import {
  assetAssignBodySchema,
  assetAssignmentParamSchema,
  assetCreateSchemaFor,
  assetDeleteBodySchema,
  assetIdParamSchema,
  assetListQuerySchema,
  assetTypeParamSchema,
  assetUpdateSchemaFor,
} from "@/lib/validators/asset.validators";

/**
 * Asset request validation (tasks T079–T090).
 *
 * The properties under test are the ones the guarded functions rely on being
 * true before they run: the class slug is one of three, each class accepts only
 * its own fields, allocations are bounded, and destructive calls carry an
 * explicit confirmation.
 */
const UUID = "11111111-1111-4111-8111-111111111111";

describe("asset type and id parameters", () => {
  it("accepts only the three published slugs", () => {
    for (const type of ["financial", "physical", "digital"]) {
      expect(assetTypeParamSchema.safeParse({ type }).success).toBe(true);
    }
    expect(assetTypeParamSchema.safeParse({ type: "documents" }).success).toBe(false);
    expect(assetTypeParamSchema.safeParse({ type: "FINANCIAL_ASSET" }).success).toBe(false);
  });

  it("requires a UUID so a crafted id never reaches SQL", () => {
    expect(assetIdParamSchema.safeParse({ type: "financial", id: UUID }).success).toBe(true);
    expect(assetIdParamSchema.safeParse({ type: "financial", id: "1; drop table" }).success).toBe(
      false,
    );
    expect(
      assetAssignmentParamSchema.safeParse({ type: "digital", id: UUID, assignmentId: UUID })
        .success,
    ).toBe(true);
    expect(
      assetAssignmentParamSchema.safeParse({ type: "digital", id: UUID, assignmentId: "x" })
        .success,
    ).toBe(false);
  });
});

describe("creation", () => {
  it("normalizes the currency and keeps the class allow-list", () => {
    const parsed = assetCreateSchemaFor("financial").parse({
      name: "  Savings  ",
      category: "BANK_ACCOUNT",
      currency: "inr",
      estimatedValue: 250000,
      accountNumber: "1234567890",
    });
    expect(parsed).toMatchObject({ name: "Savings", currency: "INR" });
  });

  it("refuses a category from another class", () => {
    expect(
      assetCreateSchemaFor("financial").safeParse({ name: "House", category: "REAL_ESTATE" })
        .success,
    ).toBe(false);
    expect(
      assetCreateSchemaFor("physical").safeParse({ name: "House", category: "REAL_ESTATE" })
        .success,
    ).toBe(true);
  });

  it("drops a sensitive field that belongs to a different class", () => {
    const parsed = assetCreateSchemaFor("physical").parse({
      name: "Flat",
      category: "REAL_ESTATE",
      credentials: "should-not-survive",
    } as never);
    expect(parsed).not.toHaveProperty("credentials");
  });

  it("requires a name and a category", () => {
    const result = assetCreateSchemaFor("digital").safeParse({ name: "", category: "DOMAIN" });
    expect(result.success).toBe(false);
    expect(assetCreateSchemaFor("digital").safeParse({ name: "Wallet" }).success).toBe(false);
  });

  it("rejects a negative value and a malformed currency", () => {
    expect(
      assetCreateSchemaFor("financial").safeParse({
        name: "A",
        category: "STOCK",
        estimatedValue: -1,
      }).success,
    ).toBe(false);
    expect(
      assetCreateSchemaFor("financial").safeParse({
        name: "A",
        category: "STOCK",
        currency: "RUPEES",
      }).success,
    ).toBe(false);
  });

  it("never echoes a secret back in a validation error", () => {
    const secret = "hunter2-super-secret";
    const result = assetCreateSchemaFor("digital").safeParse({
      name: "",
      category: "ONLINE_ACCOUNT",
      credentials: secret,
    });
    expect(result.success).toBe(false);
    if (!result.success) expect(JSON.stringify(result.error.issues)).not.toContain(secret);
  });
});

describe("update", () => {
  it("accepts a single field", () => {
    expect(assetUpdateSchemaFor("physical").parse({ location: "Pune" })).toEqual({
      location: "Pune",
    });
  });

  it("rejects an empty patch", () => {
    expect(assetUpdateSchemaFor("physical").safeParse({}).success).toBe(false);
  });

  it("allows an explicit null so a stored secret can be cleared", () => {
    // An absent key keeps the stored value; an explicit null clears it.
    expect(assetUpdateSchemaFor("digital").parse({ credentials: null })).toEqual({
      credentials: null,
    });
  });
});

describe("assignment and deletion", () => {
  it("bounds the allocation to 0–100 and requires confirmation", () => {
    expect(
      assetAssignBodySchema.safeParse({
        beneficiaryId: UUID,
        allocationPercentage: 60,
        confirmed: true,
      }).success,
    ).toBe(true);
    expect(
      assetAssignBodySchema.safeParse({
        beneficiaryId: UUID,
        allocationPercentage: 101,
        confirmed: true,
      }).success,
    ).toBe(false);
    expect(
      assetAssignBodySchema.safeParse({
        beneficiaryId: UUID,
        allocationPercentage: -1,
        confirmed: true,
      }).success,
    ).toBe(false);
    expect(assetAssignBodySchema.safeParse({ beneficiaryId: UUID }).success).toBe(false);
  });

  it("allows a share with no percentage at all", () => {
    expect(
      assetAssignBodySchema.safeParse({
        beneficiaryId: UUID,
        allocationPercentage: null,
        confirmed: true,
      }).success,
    ).toBe(true);
    expect(assetAssignBodySchema.safeParse({ beneficiaryId: UUID, confirmed: true }).success).toBe(
      true,
    );
  });

  it("refuses an unconfirmed deletion", () => {
    expect(assetDeleteBodySchema.safeParse({}).success).toBe(false);
    expect(assetDeleteBodySchema.safeParse({ confirmed: true }).success).toBe(true);
  });
});

describe("list query", () => {
  it("defaults the window and caps the page size", () => {
    expect(assetListQuerySchema.parse({})).toEqual({ page: 1, limit: 100 });
    expect(assetListQuerySchema.safeParse({ limit: "5000" }).success).toBe(false);
    expect(assetListQuerySchema.parse({ page: "2", limit: "10" })).toMatchObject({
      page: 2,
      limit: 10,
    });
  });
});
