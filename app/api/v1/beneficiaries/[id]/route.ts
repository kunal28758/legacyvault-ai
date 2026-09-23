import { withApi } from "@/lib/api/with-api";
import * as beneficiaryService from "@/lib/services/beneficiary.service";
import {
  beneficiaryDeleteBodySchema,
  beneficiaryIdParamSchema,
  beneficiaryUpdateBodySchema,
  type BeneficiaryDeleteBody,
  type BeneficiaryUpdateBody,
} from "@/lib/validators/beneficiary.validators";

type IdParams = { id: string };

export const GET = withApi<undefined, undefined, IdParams>(
  {
    auth: "user",
    rateLimit: "default",
    schema: { params: beneficiaryIdParamSchema },
    auditAction: "beneficiary.read",
    auditResourceType: "beneficiary",
  },
  async ({ user, params }) => beneficiaryService.getBeneficiary(user, params.id),
);

/**
 * Contact-field update. Changing the name or email of a beneficiary changes an
 * authoritative record, so the body must carry `confirmed: true` — the schema
 * refuses it otherwise (FR-D008).
 */
export const PATCH = withApi<BeneficiaryUpdateBody, undefined, IdParams>(
  {
    auth: "user",
    rateLimit: "default",
    schema: { params: beneficiaryIdParamSchema, body: beneficiaryUpdateBodySchema },
    auditAction: "beneficiary.updated",
    auditResourceType: "beneficiary",
  },
  async ({ user, params, body, correlationId }) =>
    beneficiaryService.updateBeneficiary(user, params.id, body, correlationId),
);

/**
 * Removal cascades inside `remove_beneficiary()`: assignments deleted, access
 * tokens revoked, Dead Man’s Switch contact link removed, emergency-access
 * config deactivated, row soft deleted — one transaction, audited there.
 */
export const DELETE = withApi<BeneficiaryDeleteBody, undefined, IdParams>(
  {
    auth: "user",
    rateLimit: "default",
    schema: { params: beneficiaryIdParamSchema, body: beneficiaryDeleteBodySchema },
    auditAction: "beneficiary.removed",
    auditResourceType: "beneficiary",
  },
  async ({ user, params, correlationId }) =>
    beneficiaryService.removeBeneficiary(user, params.id, correlationId),
);
