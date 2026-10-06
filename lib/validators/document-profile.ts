import { z } from "zod";

import { DOCUMENT_CATEGORIES, type DocumentProfile } from "@/lib/types/document-profile";

export {
  DOCUMENT_CATEGORIES,
  DOCUMENT_CATEGORY_LABELS,
  EXPIRY_WINDOW_DAYS,
  daysUntil,
  suggestCategory,
  type DocumentCategory,
  type DocumentProfile,
} from "@/lib/types/document-profile";

/**
 * Validation for the owner's document profile (see lib/types/document-profile
 * for the model). Used by the PATCH /documents/:id body and when reading
 * stored metadata back.
 */
const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Use a date in YYYY-MM-DD form.")
  .refine((value) => {
    const parsed = new Date(`${value}T00:00:00Z`);
    return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
  }, "Enter a real date.");

export const documentProfileSchema = z
  .object({
    category: z.enum(DOCUMENT_CATEGORIES).nullable().optional(),
    expiresOn: isoDate.nullable().optional(),
    reviewOn: isoDate.nullable().optional(),
    aiSuggested: z
      .array(z.enum(["category", "expiresOn", "reviewOn"]))
      .max(3)
      .optional(),
  })
  .strict() satisfies z.ZodType<DocumentProfile>;

/** Reads the profile from stored metadata; anything malformed reads as "no profile". */
export function readDocumentProfile(metadata: unknown): DocumentProfile | null {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return null;
  const parsed = documentProfileSchema.safeParse((metadata as Record<string, unknown>).profile);
  return parsed.success ? parsed.data : null;
}

/**
 * Returns the metadata to store: every existing key is kept (e.g. `scan`), only
 * `profile` is replaced, and empty values are dropped rather than stored.
 */
export function mergeDocumentProfile(
  metadata: unknown,
  profile: DocumentProfile,
): Record<string, unknown> {
  const base =
    metadata && typeof metadata === "object" && !Array.isArray(metadata)
      ? { ...(metadata as Record<string, unknown>) }
      : {};
  const clean: DocumentProfile = {};
  if (profile.category) clean.category = profile.category;
  if (profile.expiresOn) clean.expiresOn = profile.expiresOn;
  if (profile.reviewOn) clean.reviewOn = profile.reviewOn;
  const ai = (profile.aiSuggested ?? []).filter((field) => clean[field]);
  if (ai.length) clean.aiSuggested = [...new Set(ai)];
  if (Object.keys(clean).length) base.profile = clean;
  else delete base.profile;
  return base;
}
