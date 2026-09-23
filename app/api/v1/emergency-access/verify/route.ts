import { withApi } from "@/lib/api/with-api";
import * as emergencyPublic from "@/lib/services/emergency-public.service";
import {
  eaVerifyBodySchema,
  type EaVerifyBody,
} from "@/lib/validators/emergency-access.validators";

/**
 * Verifies the one-time code (FR-J003).
 *
 * Three wrong codes end the request; that counter lives in the database, so it
 * cannot be reset by trying from somewhere else.
 */
export const POST = withApi<EaVerifyBody>(
  {
    auth: "public",
    rateLimit: "publicEmergency",
    schema: { body: eaVerifyBodySchema },
    auditAction: "ea.otp_rejected",
    auditResourceType: "emergency_access_request",
  },
  async ({ body, correlationId }) =>
    emergencyPublic.verify(body.requestId, body.code, correlationId),
);
