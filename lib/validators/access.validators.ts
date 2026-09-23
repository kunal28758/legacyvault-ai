import { z } from "zod";

import { accessScopeSchema } from "@/lib/validators/dms.validators";

/**
 * Access link request shapes (ADR-014, FR-D011).
 *
 * `planSections` must be empty for a DIRECT_SHARE: plan sections are released
 * by the switch, not shared ad hoc, and `lv_validate_scope()` refuses them.
 */
export const tokenParamSchema = z.object({
  id: z.uuid("Unknown beneficiary."),
  tokenId: z.uuid("Unknown link."),
});

export const issueTokenBodySchema = z.object({
  scope: accessScopeSchema.refine((scope) => scope.planSections.length === 0, {
    message: "Plan sections cannot be shared directly.",
    path: ["planSections"],
  }),
  ttlDays: z.number().int().min(1).max(30).default(30),
  confirmed: z.literal(true, { error: "Confirm this share to continue." }),
});

export const resendTokenBodySchema = z.object({
  ttlDays: z.number().int().min(1).max(30).default(30),
  confirmed: z.literal(true, { error: "Confirm this resend to continue." }),
});

export type IssueTokenBody = z.infer<typeof issueTokenBodySchema>;
export type ResendTokenBody = z.infer<typeof resendTokenBodySchema>;
