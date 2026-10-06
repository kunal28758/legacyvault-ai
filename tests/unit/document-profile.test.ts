import { describe, expect, it } from "vitest";

import {
  daysUntil,
  documentProfileSchema,
  mergeDocumentProfile,
  readDocumentProfile,
  suggestCategory,
} from "@/lib/validators/document-profile";
import { documentUpdateBodySchema } from "@/lib/validators/document.validators";

describe("document profile", () => {
  it("accepts a category and real ISO dates, and rejects anything else", () => {
    expect(
      documentProfileSchema.safeParse({ category: "INSURANCE", expiresOn: "2030-03-12" }).success,
    ).toBe(true);
    expect(documentProfileSchema.safeParse({ category: "SECRET" }).success).toBe(false);
    expect(documentProfileSchema.safeParse({ expiresOn: "12/03/2030" }).success).toBe(false);
    expect(documentProfileSchema.safeParse({ expiresOn: "2030-02-31" }).success).toBe(false);
    expect(documentProfileSchema.safeParse({ owner: "someone-else" }).success).toBe(false);
  });

  it("is accepted by the existing PATCH body, alone or with a rename", () => {
    expect(documentUpdateBodySchema.safeParse({ profile: { category: "TAX" } }).success).toBe(true);
    expect(
      documentUpdateBodySchema.safeParse({ name: "Deed.pdf", profile: { reviewOn: "2027-01-01" } })
        .success,
    ).toBe(true);
  });

  it("keeps system metadata (scan) when the profile is written", () => {
    const merged = mergeDocumentProfile(
      { scan: { status: "skipped" } },
      { category: "PROPERTY", expiresOn: "2031-01-01" },
    );
    expect(merged).toEqual({
      scan: { status: "skipped" },
      profile: { category: "PROPERTY", expiresOn: "2031-01-01" },
    });
  });

  it("removes the profile when every value is cleared, and drops AI flags for cleared fields", () => {
    expect(
      mergeDocumentProfile({ scan: 1, profile: { category: "TAX" } }, { category: null }),
    ).toEqual({ scan: 1 });
    expect(
      mergeDocumentProfile(null, { category: "TAX", aiSuggested: ["category", "expiresOn"] }),
    ).toEqual({ profile: { category: "TAX", aiSuggested: ["category"] } });
  });

  it("reads malformed stored metadata as no profile", () => {
    expect(readDocumentProfile(null)).toBeNull();
    expect(readDocumentProfile({ profile: { category: "NOPE" } })).toBeNull();
    expect(readDocumentProfile({ profile: { category: "MEDICAL" } })).toEqual({
      category: "MEDICAL",
    });
  });

  it("maps AI document types conservatively and counts days to a date", () => {
    expect(suggestCategory("Life insurance policy")).toBe("INSURANCE");
    expect(suggestCategory("Last Will and Testament")).toBe("WILL_ESTATE");
    expect(suggestCategory("Property sale deed")).toBe("PROPERTY");
    expect(suggestCategory("Unknown")).toBeNull();
    const now = new Date(2026, 9, 6, 15, 0).getTime();
    expect(daysUntil("2026-10-06", now)).toBe(0);
    expect(daysUntil("2026-10-16", now)).toBe(10);
    expect(daysUntil("2026-10-01", now)).toBe(-5);
  });
});
