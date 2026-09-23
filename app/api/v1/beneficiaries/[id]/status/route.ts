import { withApi } from "@/lib/api/with-api";
import * as beneficiaryService from "@/lib/services/beneficiary.service";
import {
  beneficiaryIdParamSchema,
  beneficiaryStatusBodySchema,
  type BeneficiaryStatusBody,
} from "@/lib/validators/beneficiary.validators";

type IdParams = { id: string };

/**
 * Lifecycle transition (Clarifications 2026-09-18). Going INACTIVE revokes every
 * live access token for this beneficiary and blocks new assignments; both happen
 * inside `set_beneficiary_status()` so the revocation cannot be skipped.
 */
export const POST = withApi<BeneficiaryStatusBody, undefined, IdParams>(
  {
    auth: "user",
    rateLimit: "default",
    schema: { params: beneficiaryIdParamSchema, body: beneficiaryStatusBodySchema },
    auditAction: "beneficiary.status_changed",
    auditResourceType: "beneficiary",
  },
  async ({ user, params, body, correlationId }) =>
    beneficiaryService.setBeneficiaryStatus(user, params.id, body.status, correlationId),
);
