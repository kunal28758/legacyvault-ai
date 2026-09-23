import { describe, expect, it } from "vitest";

import {
  beneficiaryCreateBodySchema,
  beneficiaryDeleteBodySchema,
  beneficiaryIdParamSchema,
  beneficiaryListQuerySchema,
  beneficiaryStatusBodySchema,
  beneficiaryUpdateBodySchema,
} from "@/lib/validators/beneficiary.validators";

/**
 * Beneficiary request validation (tasks T071–T076).
 *
 * These are the rules the Route Handlers rely on, so they are asserted
 * independently of any running server: identity changes need an explicit
 * confirmation (FR-D008), destructive endpoints need one too, pagination
 * cannot be used to pull an unbounded page, and a path id must be a UUID
 * before it ever reaches a query.
 */
describe("create", () => {
  it("normalizes the email and trims text", () => {
    const parsed = beneficiaryCreateBodySchema.parse({
      name: "  Priya Sharma ",
      relationship: " Spouse ",
      email: "Priya@Example.COM",
      phone: "  ",
      notes: null,
    });
    expect(parsed.email).toBe("priya@example.com");
    expect(parsed.name).toBe("Priya Sharma");
    expect(parsed.relationship).toBe("Spouse");
  });

  it("rejects a missing name, a bad email and oversized notes", () => {
    const result = beneficiaryCreateBodySchema.safeParse({
      name: "",
      relationship: "Spouse",
      email: "not-an-email",
      notes: "x".repeat(501),
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const paths = result.error.issues.map((issue) => issue.path.join("."));
      expect(paths).toEqual(expect.arrayContaining(["name", "email", "notes"]));
    }
  });
});

describe("update", () => {
  it("requires confirmation before a name or email change (FR-D008)", () => {
    expect(beneficiaryUpdateBodySchema.safeParse({ name: "New name" }).success).toBe(false);
    expect(beneficiaryUpdateBodySchema.safeParse({ email: "new@example.com" }).success).toBe(false);
    expect(
      beneficiaryUpdateBodySchema.safeParse({ name: "New name", confirmed: true }).success,
    ).toBe(true);
  });

  it("allows contact-only edits without confirmation", () => {
    const parsed = beneficiaryUpdateBodySchema.parse({ phone: "+91 90000 00000", notes: null });
    expect(parsed.phone).toBe("+91 90000 00000");
    expect(parsed.notes).toBeNull();
    expect("name" in parsed).toBe(false);
  });

  it("rejects an empty patch", () => {
    expect(beneficiaryUpdateBodySchema.safeParse({}).success).toBe(false);
    expect(beneficiaryUpdateBodySchema.safeParse({ confirmed: true }).success).toBe(false);
  });

  it("does not let an unknown field through to the repository", () => {
    const parsed = beneficiaryUpdateBodySchema.parse({ phone: "1", status: "ACTIVE" } as never);
    expect(parsed).not.toHaveProperty("status");
  });
});

describe("status and deletion", () => {
  it("accepts only ACTIVE or INACTIVE, and only when confirmed", () => {
    expect(
      beneficiaryStatusBodySchema.safeParse({ status: "ACTIVE", confirmed: true }).success,
    ).toBe(true);
    expect(beneficiaryStatusBodySchema.safeParse({ status: "ACTIVE" }).success).toBe(false);
    expect(
      beneficiaryStatusBodySchema.safeParse({ status: "PENDING", confirmed: true }).success,
    ).toBe(false);
  });

  it("refuses an unconfirmed removal", () => {
    expect(beneficiaryDeleteBodySchema.safeParse({}).success).toBe(false);
    expect(beneficiaryDeleteBodySchema.safeParse({ confirmed: false }).success).toBe(false);
    expect(beneficiaryDeleteBodySchema.safeParse({ confirmed: true }).success).toBe(true);
  });
});

describe("list query and path params", () => {
  it("defaults the page window and caps the page size", () => {
    expect(beneficiaryListQuerySchema.parse({})).toEqual({ page: 1, limit: 50 });
    expect(beneficiaryListQuerySchema.parse({ page: "2", limit: "10" })).toMatchObject({
      page: 2,
      limit: 10,
    });
    expect(beneficiaryListQuerySchema.safeParse({ limit: "5000" }).success).toBe(false);
    expect(beneficiaryListQuerySchema.safeParse({ page: "0" }).success).toBe(false);
  });

  it("rejects an unknown status filter", () => {
    expect(beneficiaryListQuerySchema.safeParse({ status: "DELETED" }).success).toBe(false);
  });

  it("requires a UUID path parameter, so a crafted id never reaches SQL", () => {
    expect(
      beneficiaryIdParamSchema.safeParse({ id: "11111111-1111-4111-8111-111111111111" }).success,
    ).toBe(true);
    expect(beneficiaryIdParamSchema.safeParse({ id: "1 OR 1=1" }).success).toBe(false);
    expect(beneficiaryIdParamSchema.safeParse({ id: "" }).success).toBe(false);
  });
});
