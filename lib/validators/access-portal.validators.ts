import { z } from "zod";

import { PLAN_SECTION_KEYS } from "@/lib/types/legacy-plan";

/**
 * The beneficiary-facing surface (ADR-014 § 3).
 *
 * The token is accepted in a body and nowhere else: a secret in a path would
 * be written to platform logs and browser history.
 */
export const exchangeBodySchema = z.object({
  token: z.string().min(20).max(512),
});

export const accessIdParamSchema = z.object({ id: z.uuid("Unknown resource.") });

export const accessAssetParamSchema = z.object({
  type: z.enum(["FINANCIAL_ASSET", "PHYSICAL_ASSET", "DIGITAL_ASSET"]),
  id: z.uuid("Unknown resource."),
});

export const accessSectionParamSchema = z.object({
  section: z.enum(PLAN_SECTION_KEYS),
});

export type ExchangeBody = z.infer<typeof exchangeBodySchema>;
