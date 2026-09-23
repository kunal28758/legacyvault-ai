import { withApi } from "@/lib/api/with-api";
import * as emergencyService from "@/lib/services/emergency-access.service";
import {
  eaConfigIdParamSchema,
  eaContactUpdateBodySchema,
  eaRevokeBodySchema,
  type EaContactUpdateBody,
} from "@/lib/validators/emergency-access.validators";

type IdParams = { id: string };
type DeleteBody = { confirmed: true };

export const PATCH = withApi<EaContactUpdateBody, undefined, IdParams>(
  {
    auth: "user",
    rateLimit: "default",
    schema: { params: eaConfigIdParamSchema, body: eaContactUpdateBodySchema },
    auditAction: "ea.contact_updated",
    auditResourceType: "emergency_access_config",
  },
  async ({ user, params, body, correlationId }) =>
    emergencyService.updateContact(user, params.id, body, correlationId),
);

export const DELETE = withApi<DeleteBody, undefined, IdParams>(
  {
    auth: "user",
    rateLimit: "default",
    schema: { params: eaConfigIdParamSchema, body: eaRevokeBodySchema },
    auditAction: "ea.contact_removed",
    auditResourceType: "emergency_access_config",
  },
  async ({ user, params, correlationId }) =>
    emergencyService.removeContact(user, params.id, correlationId),
);
