import { withApi } from "@/lib/api/with-api";
import * as planService from "@/lib/services/legacy-plan.service";
import { planIdParamSchema } from "@/lib/validators/legacy-plan.validators";

type IdParams = { id: string };

export const GET = withApi<undefined, undefined, IdParams>(
  {
    auth: "user",
    rateLimit: "default",
    schema: { params: planIdParamSchema },
    auditAction: "plan.read",
    auditResourceType: "legacy_plan",
  },
  async ({ user, params }) => planService.getPlan(user, params.id),
);
