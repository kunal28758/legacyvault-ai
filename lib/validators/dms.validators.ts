import { z } from "zod";

/**
 * Dead Man's Switch request shapes (FR-I001–I012).
 *
 * The ranges mirror the CHECK constraints on `dead_man_switches` and the
 * guards inside `dms_configure()`, so a bad value is refused before it reaches
 * either.
 */
export const accessScopeSchema = z.object({
  documents: z.array(z.uuid()).max(500).default([]),
  assets: z
    .array(
      z.object({
        type: z.enum(["FINANCIAL_ASSET", "PHYSICAL_ASSET", "DIGITAL_ASSET"]),
        id: z.uuid(),
      }),
    )
    .max(500)
    .default([]),
  videos: z.array(z.uuid()).max(200).default([]),
  planSections: z
    .array(
      z.enum([
        "personal-details",
        "family-information",
        "beneficiaries",
        "financial-assets",
        "physical-assets",
        "digital-assets",
        "witness-details",
        "special-wishes",
        "document-attachments",
      ]),
    )
    .max(9)
    .default([]),
});

export const dmsConfigureBodySchema = z
  .object({
    inactivityPeriodDays: z.number().int().min(7).max(365),
    checkInFrequencyDays: z.number().int().min(1).max(90),
    escalationDelayHours: z.number().int().min(1).max(168).default(24),
    contactBeneficiaryIds: z.array(z.uuid()).min(1, "Choose at least one trusted contact").max(10),
    releaseScope: accessScopeSchema,
    escalationRules: z.object({ steps: z.number().int().min(1).max(10).optional() }).default({}),
  })
  // The warning window — from the missed check-in to the grace period — must exist.
  .refine((body) => body.checkInFrequencyDays < body.inactivityPeriodDays, {
    path: ["checkInFrequencyDays"],
    message: "The check-in interval must be shorter than the inactivity threshold.",
  });

export const dmsActionBodySchema = z.object({
  confirmed: z.literal(true, { error: "Confirm this change to continue." }),
});

export type DmsConfigureBody = z.infer<typeof dmsConfigureBodySchema>;
export type AccessScopeInput = z.infer<typeof accessScopeSchema>;
