import { withApi } from "@/lib/api/with-api";
import * as dmsService from "@/lib/services/dms.service";
import { dmsActionBodySchema } from "@/lib/validators/dms.validators";

type Body = { confirmed: true };

/** Resumes a paused switch and restarts the check-in window. */
export const POST = withApi<Body>(
  {
    auth: "user",
    rateLimit: "default",
    schema: { body: dmsActionBodySchema },
    auditAction: "dms.resumed",
    auditResourceType: "dead_man_switch",
  },
  async ({ user, correlationId }) => dmsService.resume(user, correlationId),
);
