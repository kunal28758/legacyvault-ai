import { withApi } from "@/lib/api/with-api";
import * as emergencyService from "@/lib/services/emergency-access.service";
import {
  eaRequestIdParamSchema,
  eaRevokeBodySchema,
} from "@/lib/validators/emergency-access.validators";

type IdParams = { id: string };
type Body = { confirmed: true };

/** Revokes an active emergency grant and its access token (FR-J008). */
export const POST = withApi<Body, undefined, IdParams>(
  {
    auth: "user",
    rateLimit: "sensitive",
    schema: { params: eaRequestIdParamSchema, body: eaRevokeBodySchema },
    auditAction: "ea.access_revoked",
    auditResourceType: "emergency_access_request",
  },
  async ({ user, params, correlationId }) =>
    emergencyService.revokeRequest(user, params.id, correlationId),
);
