import { withApi } from "@/lib/api/with-api";
import * as emergencyPublic from "@/lib/services/emergency-public.service";
import { eaRequestIdParamSchema } from "@/lib/validators/emergency-access.validators";

type IdParams = { id: string };

/**
 * Queues another delivery run for an approved request (ADR-014 § 6).
 *
 * The job revokes the undelivered link and mints exactly one replacement, so a
 * resend never leaves two live links to the same vault.
 */
export const POST = withApi<undefined, undefined, IdParams>(
  {
    auth: "user",
    rateLimit: "sensitive",
    reverification: "strict",
    schema: { params: eaRequestIdParamSchema },
    auditAction: "ea.access_resent",
    auditResourceType: "emergency_access_request",
  },
  async ({ user, params, correlationId }) =>
    emergencyPublic.resendAccess(user.id, params.id, correlationId),
);
