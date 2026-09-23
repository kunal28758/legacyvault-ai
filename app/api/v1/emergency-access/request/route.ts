import { withApi } from "@/lib/api/with-api";
import * as emergencyPublic from "@/lib/services/emergency-public.service";
import {
  eaRequestBodySchema,
  type EaRequestBody,
} from "@/lib/validators/emergency-access.validators";

/**
 * A designated contact asks for access (FR-J002).
 *
 * Public, and therefore rate-limited hard by IP. The response is identical
 * whether or not the configuration exists and whether or not the email
 * matches, so this cannot be used to find out who someone's contacts are.
 */
export const POST = withApi<EaRequestBody>(
  {
    auth: "public",
    rateLimit: "publicEmergency",
    schema: { body: eaRequestBodySchema },
    auditAction: "ea.request_created",
    auditResourceType: "emergency_access_request",
  },
  async ({ body, correlationId }) =>
    emergencyPublic.requestAccess(body.configId, body.email, correlationId),
);
