import { z } from "zod";

/** Beneficiary form schemas (task T071 shape; client validation is UX only — constitution X). */
export const RELATIONSHIPS = [
  "Spouse",
  "Partner",
  "Son",
  "Daughter",
  "Parent",
  "Sibling",
  "Grandchild",
  "Friend",
  "Family advisor",
  "Legal representative",
  "Other",
] as const;

export const createBeneficiarySchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(100, "Keep the name under 100 characters"),
  relationship: z.string().trim().min(1, "Choose a relationship"),
  email: z.email("Enter a valid email address").transform((v) => v.toLowerCase()),
  phone: z.string().trim().max(30).optional().or(z.literal("")),
  notes: z.string().trim().max(500, "Keep notes under 500 characters").optional().or(z.literal("")),
});

export type CreateBeneficiaryInput = z.infer<typeof createBeneficiarySchema>;

export const assignSchema = z.object({
  beneficiaryId: z.string().min(1, "Choose a beneficiary"),
  allocationPercentage: z
    .number({ error: "Enter a percentage" })
    .min(0, "Cannot be negative")
    .max(100, "Cannot exceed 100%")
    .nullable(),
});
