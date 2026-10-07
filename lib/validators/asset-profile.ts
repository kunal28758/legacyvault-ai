import { z } from "zod";

import { ASSET_STATUSES, type AssetProfile } from "@/lib/types/asset-profile";
import { isoDate } from "@/lib/validators/document-profile";

export {
  ASSET_STATUSES,
  ASSET_STATUS_LABELS,
  isHeld,
  type AssetNominee,
  type AssetProfile,
  type AssetStatus,
} from "@/lib/types/asset-profile";

/**
 * Validation for the owner's asset profile (model: lib/types/asset-profile).
 * Used by the asset create/update bodies and when reading stored metadata back.
 */

/**
 * Shapes of secrets that must never be stored as instructions. Kept narrow so
 * ordinary prose ("ask the bank manager about the joint account…") passes.
 */
const SECRET_PATTERNS = [
  // PEM private key
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  // Wallet recovery phrase: 12–24 lowercase words, alone or after a label
  /^\s*(?:[a-z]{3,8}\s+){11,23}[a-z]{3,8}\s*$/,
  /\b(?:seed|recovery|mnemonic|backup|secret)(?:\s+(?:phrase|words?))?(?:\s+(?:is|are))?\s*[:=-]?\s*(?:[a-z]{3,8}[\s,]+){11,23}[a-z]{3,8}\b/i,
  // Raw key material: 64-hex private key, Bitcoin WIF key, BIP32 extended private key
  /\b(?:0x)?[0-9a-f]{64}\b/i,
  /\b[5KL][1-9A-HJ-NP-Za-km-z]{50,51}\b/,
  /\b[xyzt]prv[1-9A-HJ-NP-Za-km-z]{100,}/,
];

export function looksLikeSecret(value: string): boolean {
  return SECRET_PATTERNS.some((pattern) => pattern.test(value));
}

const text = (max: number) => z.string().trim().max(max);

export const assetProfileSchema = z
  .object({
    status: z.enum(ASSET_STATUSES).nullable().optional(),
    acquiredOn: isoDate.nullable().optional(),
    reviewOn: isoDate.nullable().optional(),
    expiresOn: isoDate.nullable().optional(),
    lastReviewedOn: isoDate.nullable().optional(),
    nominee: z
      .object({
        name: text(120).min(1, "Enter the nominee's name"),
        relationship: text(60).nullable().optional(),
        beneficiaryId: z.uuid().nullable().optional(),
      })
      .strict()
      .nullable()
      .optional(),
    instructions: text(2000)
      .refine(
        (value) => !looksLikeSecret(value),
        "This looks like a secret. Describe where it is kept instead — never the secret itself.",
      )
      .nullable()
      .optional(),
  })
  .strict() satisfies z.ZodType<AssetProfile>;

/** Reads the profile from stored metadata; anything malformed reads as "no profile". */
export function readAssetProfile(metadata: unknown): AssetProfile | null {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return null;
  const parsed = assetProfileSchema.safeParse((metadata as Record<string, unknown>).profile);
  return parsed.success ? parsed.data : null;
}

/** The profile with empty values dropped, or null when nothing is left. */
export function cleanAssetProfile(profile: AssetProfile): AssetProfile | null {
  const clean: AssetProfile = {};
  if (profile.status && profile.status !== "ACTIVE") clean.status = profile.status;
  for (const key of ["acquiredOn", "reviewOn", "expiresOn", "lastReviewedOn"] as const) {
    if (profile[key]) clean[key] = profile[key];
  }
  if (profile.nominee?.name) {
    clean.nominee = { name: profile.nominee.name };
    if (profile.nominee.relationship) clean.nominee.relationship = profile.nominee.relationship;
    if (profile.nominee.beneficiaryId) clean.nominee.beneficiaryId = profile.nominee.beneficiaryId;
  }
  if (profile.instructions) clean.instructions = profile.instructions;
  return Object.keys(clean).length ? clean : null;
}

/**
 * Returns the metadata to store: every other key is kept (system or AI keys),
 * only `profile` is replaced, and an empty profile is removed rather than stored.
 */
export function mergeAssetProfile(
  metadata: unknown,
  profile: AssetProfile,
): Record<string, unknown> {
  const base =
    metadata && typeof metadata === "object" && !Array.isArray(metadata)
      ? { ...(metadata as Record<string, unknown>) }
      : {};
  const clean = cleanAssetProfile(profile);
  if (clean) base.profile = clean;
  else delete base.profile;
  return base;
}

/** Profile fields whose value differs — names only, for the audit row. */
export function changedProfileFields(
  before: AssetProfile | null,
  after: AssetProfile | null,
): string[] {
  const keys = new Set([...Object.keys(before ?? {}), ...Object.keys(after ?? {})]);
  return [...keys].filter(
    (key) =>
      JSON.stringify((before as Record<string, unknown> | null)?.[key] ?? null) !==
      JSON.stringify((after as Record<string, unknown> | null)?.[key] ?? null),
  );
}
