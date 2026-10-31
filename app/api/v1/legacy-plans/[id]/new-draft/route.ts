import { withApi } from "@/lib/api/with-api";
import * as planService from "@/lib/services/legacy-plan.service";
import {
  newDraftBodySchema,
  planIdParamSchema,
  type NewDraftBody,
} from "@/lib/validators/legacy-plan.validators";

type IdParams = { id: string };

/**
 * Open the next draft from a finalized plan (`create_plan_draft()`).
 *
 * The function refuses unless the source plan is FINALIZED and no draft is
 * already open, and it copies the steps forward at `version + 1`.
 */
export const POST = withApi<NewDraftBody, undefined, IdParams>(
  {
    auth: "user",
    maintenanceGate: "legacy-plan",
    rateLimit: "default",
    schema: { params: planIdParamSchema, body: newDraftBodySchema },
    auditAction: "plan.draft_created",
    auditResourceType: "legacy_plan",
  },
  async ({ user, params, correlationId }) =>
    planService.createNewDraft(user, params.id, correlationId),
);
