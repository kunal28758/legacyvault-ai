import { z } from "zod";

import { PLAN_SECTION_KEYS } from "@/lib/demo/types";

/**
 * Zod schemas for the legacy-plan sections (task T057 — shared by the wizard
 * forms now and by `PATCH /legacy-plans/:id/steps/:step` later). Section keys
 * follow data-model.md § 9; constraints are UX-level validation only (the
 * guarded functions enforce the invariants of record).
 */
const trimmed = (max: number) => z.string().trim().max(max);
const optionalText = (max: number) => trimmed(max).optional().or(z.literal(""));
const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Use the date picker (YYYY-MM-DD)")
  .refine((value) => !Number.isNaN(Date.parse(value)), "Enter a valid date");

export const personalDetailsSchema = z.object({
  legalName: trimmed(120).min(2, "Enter the full legal name used in the plan"),
  dateOfBirth: isoDate.refine(
    (value) => Date.parse(value) < Date.now(),
    "Date of birth must be in the past",
  ),
  nationality: optionalText(60),
  addressLine: trimmed(200).min(3, "Enter a street address"),
  city: trimmed(80).min(2, "Enter a city"),
  country: trimmed(80).min(2, "Enter a country"),
  idType: z.enum(["PAN", "AADHAAR", "PASSPORT", "NATIONAL_ID", "OTHER"]).optional(),
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
    .max(20),
  dependents: optionalText(600),
});

export const beneficiariesStepSchema = z.object({
  beneficiaryIds: z
    .array(z.string().min(1))
    .min(1, "Select at least one beneficiary or add one first"),
});

export const assetsStepSchema = z
  .object({
    assetIds: z.array(z.string().min(1)),
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
      .max(6),
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
    documentIds: z.array(z.string().min(1)),
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
