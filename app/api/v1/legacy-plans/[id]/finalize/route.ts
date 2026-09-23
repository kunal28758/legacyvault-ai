import { withApi } from "@/lib/api/with-api";
import * as planService from "@/lib/services/legacy-plan.service";
import {
  finalizeSchema,
  planIdParamSchema,
  type FinalizePlanBody,
} from "@/lib/validators/legacy-plan.validators";

type IdParams = { id: string };

/**
 * DRAFT → FINALIZED (FR-C008).
 *
 * `finalize_legacy_plan()` writes the immutable snapshot and flips the status in
 * one transaction. It refuses without complete Personal Details
 * (422 `PERSONAL_DETAILS_REQUIRED`) and refuses any other incomplete section
 * unless the caller acknowledges it (422 `PLAN_INCOMPLETE`, with the list).
 */
export const POST = withApi<FinalizePlanBody, undefined, IdParams>(
  {
    auth: "user",
    rateLimit: "sensitive",
    schema: { params: planIdParamSchema, body: finalizeSchema },
    auditAction: "plan.finalized",
    auditResourceType: "legacy_plan",
  },
  async ({ user, params, body, correlationId }) =>
    planService.finalizePlan(user, params.id, body, correlationId),
);
