import { z } from "zod";

import { ACTIVE_PLAN_SECTION_KEYS, PLAN_SECTION_KEYS } from "@/lib/types/legacy-plan";

/**
 * Zod schemas for the legacy-plan sections (task T057 — shared by the wizard
 * forms now and by `PATCH /legacy-plans/:id/steps/:step` later). Section keys
 * follow data-model.md § 9; constraints are UX-level validation only (the
 * guarded functions enforce the invariants of record).
 */
const trimmed = (max: number) => z.string().trim().max(max);
/**
 * A required text field whose message is the same whether the value is empty,
 * too short or missing altogether — an untouched step must say "Enter a city",
 * not Zod's generic "expected string, received undefined".
 */
const requiredText = (max: number, min: number, message: string) =>
  z.string({ error: message }).trim().max(max).min(min, message);
const optionalText = (max: number) => trimmed(max).optional().or(z.literal(""));
const isoDate = z
  .string({ error: "Enter a date" })
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Use the date picker (YYYY-MM-DD)")
  .refine((value) => !Number.isNaN(Date.parse(value)), "Enter a valid date");

export const personalDetailsSchema = z.object({
  legalName: requiredText(120, 2, "Enter the full legal name used in the plan"),
  dateOfBirth: isoDate.refine(
    (value) => Date.parse(value) < Date.now(),
    "Date of birth must be in the past",
  ),
  nationality: optionalText(60),
  addressLine: requiredText(200, 3, "Enter a street address"),
  city: requiredText(80, 2, "Enter a city"),
  country: requiredText(80, 2, "Enter a country"),
  // Optional: the form's "nothing chosen" value is "", which must pass exactly
  // like an absent value (the draft schema below accepts it too).
  idType: z
    .union([z.enum(["PAN", "AADHAAR", "PASSPORT", "NATIONAL_ID", "OTHER"]), z.literal("")])
    .optional(),
});

export const familyInformationSchema = z.object({
  maritalStatus: z.enum(["single", "married", "widowed", "divorced", "partnered"], {
    error: "Choose a marital status",
  }),
  spouseName: optionalText(120),
  children: z
    .array(
      z.object({
        name: trimmed(120).min(1, "Name is required"),
        dateOfBirth: isoDate.optional().or(z.literal("")),
      }),
    )
    .max(20)
    .default([]),
  dependents: optionalText(600),
});

export const beneficiariesStepSchema = z.object({
  beneficiaryIds: z
    .array(z.string().min(1))
    .default([])
    .pipe(z.array(z.string()).min(1, "Select at least one beneficiary or add one first")),
});

export const assetsStepSchema = z
  .object({
    assetIds: z.array(z.string().min(1)).default([]),
    none: z.boolean().optional(),
  })
  .refine((value) => value.none || value.assetIds.length > 0, {
    message: "Include at least one asset, or mark this class as “none”",
    path: ["assetIds"],
  });

export const witnessDetailsSchema = z
  .object({
    witnesses: z
      .array(
        z.object({
          name: trimmed(120).min(1, "Name is required"),
          relationship: optionalText(80),
          email: z.email("Enter a valid email").optional().or(z.literal("")),
        }),
      )
      .max(6)
      .default([]),
    none: z.boolean().optional(),
  })
  .refine((value) => value.none || value.witnesses.length > 0, {
    message: "Add a witness, or confirm you will record witnesses later",
    path: ["witnesses"],
  });

export const specialWishesSchema = z
  .object({
    instructions: optionalText(4000),
    funeralWishes: optionalText(2000),
    messages: optionalText(4000),
  })
  .refine(
    (value) => [value.instructions, value.funeralWishes, value.messages].some((v) => v && v.trim()),
    {
      message: "Write something in at least one area — even a sentence helps your family",
      path: ["instructions"],
    },
  );

export const documentAttachmentsStepSchema = z
  .object({
    documentIds: z.array(z.string().min(1)).default([]),
    none: z.boolean().optional(),
  })
  .refine((value) => value.none || value.documentIds.length > 0, {
    message: "Attach at least one document, or mark this step as “none for now”",
    path: ["documentIds"],
  });

export const finalizeSchema = z.object({
  confirmed: z.literal(true),
  lockVersion: z.number().int().nonnegative(),
  acknowledgeIncomplete: z.boolean().optional(),
});

export const planSectionKeySchema = z.enum(PLAN_SECTION_KEYS);

/* ── Draft shapes (server-side auto-save validation) ─────────────────────── */

/**
 * What an auto-save may contain, per section.
 *
 * Deliberately lenient about *completeness* — a half-typed draft must save —
 * but strict about *shape*: every field has its type and length bound, ids
 * must be UUIDs, lists are capped, and unknown keys are dropped, so nothing
 * but the wizard's own fields can ever be written into a plan. `skipped`
 * records "Skip for now" and is cleared by the next real edit.
 */
const draftText = (max: number) => z.string().max(max);
const draftDate = z.string().max(10);
const skipped = { skipped: z.boolean().optional() };
const idList = (max: number) => z.array(z.uuid()).max(max);

export const sectionDraftSchemas = {
  "personal-details": z
    .object({
      legalName: draftText(120),
      dateOfBirth: draftDate,
      nationality: draftText(60),
      addressLine: draftText(200),
      city: draftText(80),
      country: draftText(80),
      idType: z.union([
        z.enum(["PAN", "AADHAAR", "PASSPORT", "NATIONAL_ID", "OTHER"]),
        z.literal(""),
      ]),
    })
    .partial(),
  "family-information": z
    .object({
      maritalStatus: z.union([
        z.enum(["single", "married", "widowed", "divorced", "partnered"]),
        z.literal(""),
      ]),
      spouseName: draftText(120),
      children: z
        .array(z.object({ name: draftText(120), dateOfBirth: draftDate }).partial())
        .max(20),
      dependents: draftText(600),
      ...skipped,
    })
    .partial(),
  beneficiaries: z.object({ beneficiaryIds: idList(200), ...skipped }).partial(),
  "financial-assets": z.object({ assetIds: idList(500), none: z.boolean(), ...skipped }).partial(),
  "physical-assets": z.object({ assetIds: idList(500), none: z.boolean(), ...skipped }).partial(),
  "digital-assets": z.object({ assetIds: idList(500), none: z.boolean(), ...skipped }).partial(),
  "witness-details": z
    .object({
      witnesses: z
        .array(
          z
            .object({ name: draftText(120), relationship: draftText(80), email: draftText(254) })
            .partial(),
        )
        .max(6),
      none: z.boolean(),
      ...skipped,
    })
    .partial(),
  "special-wishes": z
    .object({
      instructions: draftText(4000),
      funeralWishes: draftText(2000),
      messages: draftText(4000),
      ...skipped,
    })
    .partial(),
  "document-attachments": z
    .object({ documentIds: idList(200), none: z.boolean(), ...skipped })
    .partial(),
} as const;

/** Personal details can never be skipped: finalization requires them. */
export const SKIPPABLE_SECTIONS: readonly (typeof PLAN_SECTION_KEYS)[number][] =
  ACTIVE_PLAN_SECTION_KEYS.filter((key) => key !== "personal-details");

export const sectionSchemas = {
  "personal-details": personalDetailsSchema,
  "family-information": familyInformationSchema,
  beneficiaries: beneficiariesStepSchema,
  "financial-assets": assetsStepSchema,
  "physical-assets": assetsStepSchema,
  "digital-assets": assetsStepSchema,
  "witness-details": witnessDetailsSchema,
  "special-wishes": specialWishesSchema,
  "document-attachments": documentAttachmentsStepSchema,
} as const;

export type PersonalDetails = z.infer<typeof personalDetailsSchema>;
export type FamilyInformation = z.infer<typeof familyInformationSchema>;
export type WitnessDetails = z.infer<typeof witnessDetailsSchema>;
export type SpecialWishes = z.infer<typeof specialWishesSchema>;

/** Flattens Zod issues into `{ "path.to.field": message }` for form display. */
export function fieldErrors(error: z.ZodError): Record<string, string> {
  const result: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path.map(String).join(".") || "_";
    if (!result[key]) result[key] = issue.message;
  }
  return result;
}

/* ── API request shapes ───────────────────────────────────────────────────── */

export const planIdParamSchema = z.object({ id: z.uuid("Unknown plan.") });

export const planStepParamSchema = z.object({
  id: z.uuid("Unknown plan."),
  step: planSectionKeySchema,
});

export const planVersionParamSchema = z.object({
  id: z.uuid("Unknown plan."),
  versionId: z.uuid("Unknown version."),
});

/**
 * Auto-save body. `data` is re-parsed against the section's own schema in the
 * service only when the section claims to be complete — a half-typed draft must
 * still save, which is the whole point of auto-save, so the section schema
 * decides completeness rather than acceptance.
 *
 * `lockVersion` is the optimistic token `save_plan_step()` compares under a row
 * lock; a stale one is a 409 rather than a silent overwrite.
 */
export const savePlanStepBodySchema = z.object({
  data: z.record(z.string(), z.unknown()),
  lockVersion: z.number().int().nonnegative(),
});

export const createPlanBodySchema = z.object({}).optional();

export const newDraftBodySchema = z.object({
  confirmed: z.literal(true, { error: "Confirm this to start a new draft." }),
});

export type SavePlanStepBody = z.infer<typeof savePlanStepBodySchema>;
export type FinalizePlanBody = z.infer<typeof finalizeSchema>;
export type NewDraftBody = z.infer<typeof newDraftBodySchema>;
