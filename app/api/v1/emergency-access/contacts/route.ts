import { withApi } from "@/lib/api/with-api";
import * as emergencyService from "@/lib/services/emergency-access.service";
import {
  eaContactCreateBodySchema,
  type EaContactCreateBody,
} from "@/lib/validators/emergency-access.validators";

/** Emergency contacts (api-contracts.md § Emergency Access). */
export const GET = withApi(
  {
    auth: "user",
    rateLimit: "default",
    auditAction: "ea.contacts_listed",
    auditResourceType: "emergency_access_config",
  },
  async ({ user }) => emergencyService.getOverview(user),
);

export const POST = withApi<EaContactCreateBody>(
  {
    auth: "user",
    rateLimit: "default",
    schema: { body: eaContactCreateBodySchema },
    auditAction: "ea.contact_configured",
    auditResourceType: "emergency_access_config",
  },
  async ({ user, body, correlationId }) =>
    emergencyService.configureContact(user, body, correlationId),
);
