import { withApi } from "@/lib/api/with-api";
import * as beneficiaryService from "@/lib/services/beneficiary.service";
import { beneficiaryIdParamSchema } from "@/lib/validators/beneficiary.validators";

type IdParams = { id: string };

/**
 * Send or re-send the invitation (api-contracts.md § Beneficiaries).
 *
 * This records the invitation, stamps `invitedAt` and emails the beneficiary a
 * notification — never access. `emailSent` is true only when the provider
 * accepted the message; an unconfigured or failed send leaves the invitation
 * recorded and reports `emailSent: false`.
 *
 * Rate-limited with the `sensitive` policy because it is the endpoint that
 * causes mail to be sent to a third party.
 */
export const POST = withApi<undefined, undefined, IdParams>(
  {
    auth: "user",
    rateLimit: "sensitive",
    schema: { params: beneficiaryIdParamSchema },
    auditAction: "beneficiary.invited",
    auditResourceType: "beneficiary",
  },
  async ({ user, params, correlationId }) =>
    beneficiaryService.inviteBeneficiary(user, params.id, correlationId),
);
