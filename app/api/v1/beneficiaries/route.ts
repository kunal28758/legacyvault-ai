import { withApi } from "@/lib/api/with-api";
import * as beneficiaryService from "@/lib/services/beneficiary.service";
import {
  beneficiaryCreateBodySchema,
  beneficiaryListQuerySchema,
  type BeneficiaryCreateBody,
  type BeneficiaryListQuery,
} from "@/lib/validators/beneficiary.validators";

/**
 * Beneficiary collection (api-contracts.md § Beneficiaries).
 *
 * Handlers stay thin on purpose: authenticate, validate, delegate. Ownership,
 * duplicate handling and auditing belong to the service (constitution VIII).
 */
export const GET = withApi<undefined, BeneficiaryListQuery>(
  {
    auth: "user",
    rateLimit: "default",
    schema: { query: beneficiaryListQuerySchema },
    auditAction: "beneficiary.listed",
    auditResourceType: "beneficiary",
  },
  async ({ user, query }) => beneficiaryService.listBeneficiaries(user, query),
);

export const POST = withApi<BeneficiaryCreateBody>(
  {
    auth: "user",
    rateLimit: "default",
    schema: { body: beneficiaryCreateBodySchema },
    auditAction: "beneficiary.created",
    auditResourceType: "beneficiary",
  },
  async ({ user, body, correlationId }) =>
    beneficiaryService.createBeneficiary(user, body, correlationId),
);
