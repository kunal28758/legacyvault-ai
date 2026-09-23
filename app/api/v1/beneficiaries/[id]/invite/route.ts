import { withApi } from "@/lib/api/with-api";
import * as beneficiaryService from "@/lib/services/beneficiary.service";
import { beneficiaryIdParamSchema } from "@/lib/validators/beneficiary.validators";

type IdParams = { id: string };

/**
 * Send or re-send the invitation (api-contracts.md § Beneficiaries).
 *
 * This records the invitation and stamps `invitedAt`. Delivery itself belongs to
 * the email service, which is not wired yet, so the response reports
 * `emailSent: false` rather than letting the UI imply a message went out.
 *
 * Rate-limited with the `sensitive` policy because it is the endpoint that will
 * cause mail to be sent to a third party.
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
