import { withApi } from "@/lib/api/with-api";
import * as dmsService from "@/lib/services/dms.service";
import { dmsActionBodySchema } from "@/lib/validators/dms.validators";

type Body = { confirmed: true };

/** Recovery at any escalation stage, including after release: every DMS_RELEASE
 * token is revoked and the switch returns to ACTIVE (FR-I007). */
export const POST = withApi<Body>(
  {
    auth: "user",
    rateLimit: "sensitive",
    reverification: "multi_factor",
    schema: { body: dmsActionBodySchema },
    auditAction: "dms.escalation_cancelled",
    auditResourceType: "dead_man_switch",
  },
  async ({ user, correlationId }) => dmsService.cancelEscalation(user, correlationId),
);
