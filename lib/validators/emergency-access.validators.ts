import { z } from "zod";

import { accessScopeSchema } from "@/lib/validators/dms.validators";

/** Emergency access request shapes (FR-J001–J010). */
export const eaConfigIdParamSchema = z.object({ id: z.uuid("Unknown contact.") });
export const eaRequestIdParamSchema = z.object({ id: z.uuid("Unknown request.") });

const timeoutRules = {
  onTimeout: z.enum(["WAIT", "AUTO_GRANT", "DENY"]).default("WAIT"),
  timeoutHours: z.number().int().min(1).max(168).nullable().optional(),
  requestExpiryHours: z.number().int().min(1).max(720).default(72),
  accessDurationHours: z.number().int().min(1).max(720).default(72),
};

export const eaContactCreateBodySchema = z
  .object({
    beneficiaryId: z.uuid("Choose a beneficiary"),
    accessScope: accessScopeSchema,
    ...timeoutRules,
  })
  .superRefine((value, ctx) => {
    // `ea_configure_contact()` enforces this too; failing here names the field.
    if (value.onTimeout !== "WAIT" && !value.timeoutHours) {
      ctx.addIssue({
        code: "custom",
        path: ["timeoutHours"],
        message: "Set how long to wait before the automatic decision.",
      });
    }
  });

export const eaContactUpdateBodySchema = z.object({
  accessScope: accessScopeSchema.optional(),
  onTimeout: z.enum(["WAIT", "AUTO_GRANT", "DENY"]).optional(),
  timeoutHours: z.number().int().min(1).max(168).nullable().optional(),
  requestExpiryHours: z.number().int().min(1).max(720).optional(),
  accessDurationHours: z.number().int().min(1).max(720).optional(),
});

export const eaDecisionBodySchema = z.object({
  decision: z.enum(["APPROVE", "DENY"]),
  confirmed: z.literal(true, { error: "Confirm this decision to continue." }),
});

export const eaRevokeBodySchema = z.object({
  confirmed: z.literal(true, { error: "Confirm this revocation to continue." }),
});

/**
 * The public request flow (FR-J002–J003).
 *
 * The email is compared with the designated beneficiary inside the database;
 * these schemas only make sure the shape is sane before it gets there.
 */
export const eaRequestBodySchema = z.object({
  configId: z.uuid("This link is not valid."),
  email: z.email("Enter the email address this link was sent to."),
});

export const eaVerifyBodySchema = z.object({
  requestId: z.uuid("This link is not valid."),
  code: z.string().regex(/^[0-9]{6}$/, "Enter the six-digit code."),
});

export type EaRequestBody = z.infer<typeof eaRequestBodySchema>;
export type EaVerifyBody = z.infer<typeof eaVerifyBodySchema>;
export type EaContactCreateBody = z.infer<typeof eaContactCreateBodySchema>;
export type EaContactUpdateBody = z.infer<typeof eaContactUpdateBodySchema>;
export type EaDecisionBody = z.infer<typeof eaDecisionBodySchema>;
