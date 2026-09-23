import { z } from "zod";

/**
 * Beneficiary schemas (tasks T071–T076, api-contracts.md § Beneficiaries).
 *
 * One module for both sides on purpose: the browser form and the Route Handler
 * parse the same shapes, so a client that drifts cannot widen what the server
 * accepts. Client-side validation remains a UX affordance only — the server
 * re-parses every request (constitution X).
 */
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

export const BENEFICIARY_STATUSES = ["PENDING", "ACTIVE", "INACTIVE"] as const;

/* ── Field primitives ─────────────────────────────────────────────────────── */

const nameField = z
  .string()
  .trim()
  .min(1, "Name is required")
  .max(100, "Keep the name under 100 characters");

const relationshipField = z
  .string()
  .trim()
  .min(1, "Choose a relationship")
  .max(60, "Keep the relationship under 60 characters");

const emailField = z
  .email("Enter a valid email address")
  .max(254, "That email address is too long")
  .transform((value) => value.toLowerCase());

const phoneField = z
  .string()
  .trim()
  .max(30, "Keep the phone number under 30 characters")
  .nullable();

const notesField = z.string().trim().max(500, "Keep notes under 500 characters").nullable();

/* ── Browser form ─────────────────────────────────────────────────────────── */

export const createBeneficiarySchema = z.object({
  name: nameField,
  relationship: relationshipField,
  email: emailField,
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

/* ── API request shapes ───────────────────────────────────────────────────── */

export const beneficiaryIdParamSchema = z.object({
  id: z.uuid("Unknown beneficiary."),
});

export const assignmentParamSchema = z.object({
  id: z.uuid("Unknown beneficiary."),
  assignmentId: z.uuid("Unknown assignment."),
});

export const beneficiaryListQuerySchema = z.object({
  status: z.enum(BENEFICIARY_STATUSES).optional(),
  q: z.string().trim().max(100).optional(),
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

export const beneficiaryCreateBodySchema = z.object({
  name: nameField,
  relationship: relationshipField,
  email: emailField,
  phone: phoneField.optional(),
  notes: notesField.optional(),
});

/**
 * Partial update. Name and email are authoritative identity fields on a legal
 * record, so changing either requires an explicit confirmation (FR-D008) —
 * the same rule the destructive endpoints use.
 */
export const beneficiaryUpdateBodySchema = z
  .object({
    name: nameField.optional(),
    relationship: relationshipField.optional(),
    email: emailField.optional(),
    phone: phoneField.optional(),
    notes: notesField.optional(),
    confirmed: z.boolean().optional(),
  })
  .superRefine((value, ctx) => {
    const fields = Object.keys(value).filter((key) => key !== "confirmed");
    if (fields.length === 0) {
      ctx.addIssue({
        code: "custom",
        path: ["_"],
        message: "Provide at least one field to update.",
      });
    }
    if ((value.name !== undefined || value.email !== undefined) && value.confirmed !== true) {
      ctx.addIssue({
        code: "custom",
        path: ["confirmed"],
        message: "Confirm the change before a name or email is updated.",
      });
    }
  });

export const beneficiaryStatusBodySchema = z.object({
  status: z.enum(["ACTIVE", "INACTIVE"], { error: "Choose ACTIVE or INACTIVE." }),
  confirmed: z.literal(true, { error: "Confirm this change to continue." }),
});

export const beneficiaryDeleteBodySchema = z.object({
  confirmed: z.literal(true, { error: "Confirm this removal to continue." }),
});

export type BeneficiaryListQuery = z.infer<typeof beneficiaryListQuerySchema>;
export type BeneficiaryCreateBody = z.infer<typeof beneficiaryCreateBodySchema>;
export type BeneficiaryUpdateBody = z.infer<typeof beneficiaryUpdateBodySchema>;
export type BeneficiaryStatusBody = z.infer<typeof beneficiaryStatusBodySchema>;
export type BeneficiaryDeleteBody = z.infer<typeof beneficiaryDeleteBodySchema>;
