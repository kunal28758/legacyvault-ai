import { withApi } from "@/lib/api/with-api";
import * as dmsService from "@/lib/services/dms.service";
import { dmsActionBodySchema } from "@/lib/validators/dms.validators";

type Body = { confirmed: true };

/** Pauses the countdown; no deadline runs while paused. */
export const POST = withApi<Body>(
  {
    auth: "user",
    rateLimit: "default",
    schema: { body: dmsActionBodySchema },
    auditAction: "dms.paused",
    auditResourceType: "dead_man_switch",
  },
  async ({ user, correlationId }) => dmsService.pause(user, correlationId),
);
