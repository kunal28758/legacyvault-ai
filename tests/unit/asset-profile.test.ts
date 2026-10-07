import { describe, expect, it } from "vitest";

import {
  assetProfileSchema,
  changedProfileFields,
  cleanAssetProfile,
  mergeAssetProfile,
  readAssetProfile,
} from "@/lib/validators/asset-profile";
import { physicalAssetUpdateSchema } from "@/lib/validators/asset.validators";
import { preferencesSchema } from "@/lib/validators/user.validators";

describe("asset profile validation", () => {
  it("accepts a complete profile and rejects unknown keys, bad dates and bad statuses", () => {
    expect(
      assetProfileSchema.safeParse({
        status: "SOLD",
        acquiredOn: "2020-02-29",
        reviewOn: "2027-01-01",
        expiresOn: null,
        nominee: { name: "Meera", relationship: "Daughter", beneficiaryId: null },
        instructions: "Transfer to my daughter.",
      }).success,
    ).toBe(true);
    expect(assetProfileSchema.safeParse({ owner: "someone" }).success).toBe(false);
    expect(assetProfileSchema.safeParse({ reviewOn: "2026-02-30" }).success).toBe(false);
    expect(assetProfileSchema.safeParse({ status: "STOLEN" }).success).toBe(false);
    expect(assetProfileSchema.safeParse({ nominee: { name: "" } }).success).toBe(false);
    expect(
      assetProfileSchema.safeParse({ nominee: { name: "x", beneficiaryId: "1" } }).success,
    ).toBe(false);
  });

  it("refuses secrets in instructions: private keys and recovery phrases", () => {
    const phrase =
      "abandon ability able about above absent absorb abstract absurd abuse access accident";
    expect(assetProfileSchema.safeParse({ instructions: phrase }).success).toBe(false);
    expect(
      assetProfileSchema.safeParse({
        instructions: "-----BEGIN OPENSSH PRIVATE KEY-----\nb3BlbnNzaC1rZXk=\n-----END",
      }).success,
    ).toBe(false);
    expect(
      assetProfileSchema.safeParse({
        instructions: "The recovery phrase is in the fireproof safe; the PIN is with my lawyer.",
      }).success,
    ).toBe(true);
  });

  it("refuses labelled phrases and raw key material, but not ordinary instructions", () => {
    const words =
      "abandon ability able about above absent absorb abstract absurd abuse access accident";
    const refused = [
      `Seed phrase: ${words}`,
      `Keep this safe. My recovery words are ${words.replaceAll(" ", ", ")}`,
      "Wallet key 0x4c0883a69102937d6231471b5dbb6204fe512961708279f0b2bfb2f0f0c4e1b2",
      "WIF 5HueCGU8rMjxEXxiPuD5BDku4MkFqeZyd4dZ1jvhTVqvbTLvyTJ",
      "xprv9s21ZrQH143K3QTDL4LXw2F7HEK3wJUD2nW2nRk4stbPy6cq3jPPqjiChkVvvNKmPGJxWUtg6LnF5kejMRNNU3TGtRBeJgk33yuGBxrMPHi",
    ];
    for (const instructions of refused) {
      expect(assetProfileSchema.safeParse({ instructions }).success, instructions).toBe(false);
    }
    const allowed = [
      "Please ask the bank manager about the joint account details before selling the house.",
      "The seed phrase is in the safe deposit box at the bank; the key is with my sister.",
      "Transfer the domain to Priya. Registrar login details are in the password manager.",
    ];
    for (const instructions of allowed) {
      expect(assetProfileSchema.safeParse({ instructions }).success, instructions).toBe(true);
    }
  });

  it("is accepted by the asset update body and nothing outside the allow-list is", () => {
    expect(
      physicalAssetUpdateSchema.safeParse({ profile: { lastReviewedOn: "2026-10-06" } }).success,
    ).toBe(true);
    // `metadata` is not a field of the body: alone it is refused, and next to a real
    // field zod strips it, so raw metadata can never reach the column patch.
    expect(physicalAssetUpdateSchema.safeParse({ metadata: { profile: {} } }).success).toBe(false);
    expect(physicalAssetUpdateSchema.parse({ name: "x", metadata: { a: 1 } } as never)).toEqual({
      name: "x",
    });
  });

  it("merges into metadata without touching other keys, and drops empty values", () => {
    const stored = { source: "ai_analysis", profile: { instructions: "old" } };
    expect(
      mergeAssetProfile(stored, { status: "ACTIVE", instructions: "", reviewOn: null }),
    ).toEqual({ source: "ai_analysis" });
    expect(mergeAssetProfile(stored, { status: "CLOSED" })).toEqual({
      source: "ai_analysis",
      profile: { status: "CLOSED" },
    });
    expect(
      cleanAssetProfile({ nominee: { name: "A", relationship: "", beneficiaryId: null } }),
    ).toEqual({ nominee: { name: "A" } });
  });

  it("reads malformed stored metadata as no profile", () => {
    expect(readAssetProfile(null)).toBeNull();
    expect(readAssetProfile([])).toBeNull();
    expect(readAssetProfile({ profile: { status: "WHATEVER" } })).toBeNull();
    expect(readAssetProfile({ profile: { reviewOn: "2026-10-06" } })).toEqual({
      reviewOn: "2026-10-06",
    });
  });

  it("names changed profile fields (never values) for the audit row", () => {
    expect(
      changedProfileFields(
        { instructions: "a", reviewOn: "2026-01-01" },
        { instructions: "b", reviewOn: "2026-01-01", status: "SOLD" },
      ).sort(),
    ).toEqual(["instructions", "status"]);
    expect(changedProfileFields(null, null)).toEqual([]);
  });
});

describe("dismissed findings preference", () => {
  it("accepts finding ids and refuses anything else", () => {
    expect(
      preferencesSchema.safeParse({
        dismissedFindings: [
          "RULE-004:0b6f4b1e-1c2d-4e5f-8a9b-0c1d2e3f4a5b,1b6f4b1e-1c2d-4e5f-8a9b-0c1d2e3f4a5b",
          "ASSET-DOC-001:0b6f4b1e-1c2d-4e5f-8a9b-0c1d2e3f4a5b",
        ],
      }).success,
    ).toBe(true);
    for (const bad of ["<script>", "rule-004:x", "RULE-004:", "RULE-004:x y", "X:abc"]) {
      expect(preferencesSchema.safeParse({ dismissedFindings: [bad] }).success).toBe(false);
    }
    expect(
      preferencesSchema.safeParse({ dismissedFindings: Array(201).fill("RULE-004:a") }).success,
    ).toBe(false);
  });
});
