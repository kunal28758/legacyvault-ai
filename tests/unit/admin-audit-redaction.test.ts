import { describe, expect, it } from "vitest";

import { redactAdminMetadata } from "@/lib/admin/audit-redaction";

/**
 * An operator reads the shape of an event, never its contents (FR-P012).
 *
 * The Class A audit triggers store the changed values so an owner can read
 * their own history in full. These assertions are the line between that and
 * what a support screen may show.
 */
describe("admin audit redaction", () => {
  it("drops the values a trigger recorded and keeps the shape", () => {
    const safe = redactAdminMetadata({
      source: "db_trigger",
      db_role: "authenticated",
      changed: ["name", "email"],
      owner_user_id: "11111111-1111-4111-8111-111111111111",
      previous: { name: "Old Name" },
      new: { name: "Priya Sharma", email: "priya@example.com", notes: "spare key under the mat" },
    });

    expect(safe).toMatchObject({ source: "db_trigger", changed: ["name", "email"] });
    expect(safe.new).toBeUndefined();
    expect(safe.previous).toBeUndefined();
    expect(JSON.stringify(safe)).not.toContain("Priya");
    expect(JSON.stringify(safe)).not.toContain("spare key");
    expect(safe.redactedKeys).toBe(3);
  });

  it("keeps identifiers, counts and outcomes", () => {
    const safe = redactAdminMetadata({
      grantType: "DMS_RELEASE",
      beneficiaryId: "22222222-2222-4222-8222-222222222222",
      scopeCounts: { documents: 2, assets: 1, videos: 0 },
      releaseTokensRevoked: 3,
      reason: "timeout",
    });

    expect(safe).toEqual({
      grantType: "DMS_RELEASE",
      beneficiaryId: "22222222-2222-4222-8222-222222222222",
      scopeCounts: { documents: 2, assets: 1, videos: 0 },
      releaseTokensRevoked: 3,
      reason: "timeout",
    });
  });

  it("refuses an unexpected nested object even under an allowed key", () => {
    // A new domain could start writing an object where a scalar used to be.
    const safe = redactAdminMetadata({ reason: { note: "a sentence about the person" } });
    expect(safe.reason).toBeUndefined();
    expect(safe.redactedKeys).toBe(1);
  });

  it("handles anything that is not an object", () => {
    expect(redactAdminMetadata(null)).toEqual({});
    expect(redactAdminMetadata("a string")).toEqual({});
    expect(redactAdminMetadata([1, 2, 3])).toEqual({});
  });
});
