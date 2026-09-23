import { withApi } from "@/lib/api/with-api";
import * as emergencyPublic from "@/lib/services/emergency-public.service";
import { eaConfigIdParamSchema } from "@/lib/validators/emergency-access.validators";

type IdParams = { id: string };

/** Re-sends the designation email. It carries no secret — only where to ask. */
export const POST = withApi<undefined, undefined, IdParams>(
  {
    auth: "user",
    rateLimit: "sensitive",
    schema: { params: eaConfigIdParamSchema },
    auditAction: "ea.designation_sent",
    auditResourceType: "emergency_access_config",
  },
  async ({ user, params, correlationId }) =>
    emergencyPublic.resendDesignation(user.id, params.id, correlationId),
);
