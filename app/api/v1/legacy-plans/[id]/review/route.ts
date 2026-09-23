import { withApi } from "@/lib/api/with-api";
import * as planService from "@/lib/services/legacy-plan.service";
import { planIdParamSchema } from "@/lib/validators/legacy-plan.validators";

type IdParams = { id: string };

/**
 * Review summary: per-section completeness, the cross-entity checks and whether
 * finalization is possible at all. Computed from the records, so a section that
 * references a deleted asset reads as incomplete here.
 */
export const POST = withApi<undefined, undefined, IdParams>(
  {
    auth: "user",
    rateLimit: "default",
    schema: { params: planIdParamSchema },
    auditAction: "plan.reviewed",
    auditResourceType: "legacy_plan",
  },
  async ({ user, params }) => planService.reviewPlan(user, params.id),
);
