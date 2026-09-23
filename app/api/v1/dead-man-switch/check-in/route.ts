import { withApi } from "@/lib/api/with-api";
import * as dmsService from "@/lib/services/dms.service";
import { dmsActionBodySchema } from "@/lib/validators/dms.validators";

type Body = { confirmed: true };

/** Owner check-in (FR-I003). Step-up verification is required: a check-in is the
 * single action that holds the whole release mechanism back. */
export const POST = withApi<Body>(
  {
    auth: "user",
    rateLimit: "sensitive",
    reverification: "multi_factor",
    schema: { body: dmsActionBodySchema },
    auditAction: "dms.checked_in",
    auditResourceType: "dead_man_switch",
  },
  async ({ user, correlationId }) => dmsService.checkIn(user, correlationId),
);
