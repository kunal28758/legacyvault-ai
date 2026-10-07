import { withApi } from "@/lib/api/with-api";
import * as dmsService from "@/lib/services/dms.service";
import { dmsActionBodySchema } from "@/lib/validators/dms.validators";

type Body = { confirmed: true };

/** Disables the switch entirely and revokes any release link (step-up verified). */
export const POST = withApi<Body>(
  {
    auth: "user",
    rateLimit: "sensitive",
    reverification: "strict",
    schema: { body: dmsActionBodySchema },
    auditAction: "dms.disabled",
    auditResourceType: "dead_man_switch",
  },
  async ({ user, correlationId }) => dmsService.disable(user, correlationId),
);
