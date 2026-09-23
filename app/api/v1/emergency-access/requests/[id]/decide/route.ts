import { withApi } from "@/lib/api/with-api";
import * as emergencyService from "@/lib/services/emergency-access.service";
import {
  eaDecisionBodySchema,
  eaRequestIdParamSchema,
  type EaDecisionBody,
} from "@/lib/validators/emergency-access.validators";

type IdParams = { id: string };

/**
 * The owner approves or denies a verified request (FR-J005).
 *
 * Approval queues the delivery job; the access link is minted inside that job,
 * so no plaintext token passes through this request or its response.
 */
export const POST = withApi<EaDecisionBody, undefined, IdParams>(
  {
    auth: "user",
    rateLimit: "sensitive",
    reverification: "strict",
    schema: { params: eaRequestIdParamSchema, body: eaDecisionBodySchema },
    auditAction: "ea.request_decided",
    auditResourceType: "emergency_access_request",
  },
  async ({ user, params, body, correlationId }) =>
    emergencyService.decideRequest(user, params.id, body.decision, correlationId),
);
