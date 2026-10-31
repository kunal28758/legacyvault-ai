import { parseJsonBody } from "@/lib/api/validate";
import { withApi } from "@/lib/api/with-api";
import * as planService from "@/lib/services/legacy-plan.service";
import type { PlanSectionKey } from "@/lib/types/legacy-plan";
import {
  planStepParamSchema,
  savePlanStepBodySchema,
} from "@/lib/validators/legacy-plan.validators";

type StepParams = { id: string; step: PlanSectionKey };

/**
 * Auto-save one section (FR-C002).
 *
 * `save_plan_step()` compares `lockVersion` while holding the plan row, so two
 * tabs editing the same draft produce a 409 `LOCK_CONFLICT` instead of one
 * silently overwriting the other. Completeness is decided by the service
 * against the real records, never by the caller.
 */
export const PATCH = withApi<undefined, undefined, StepParams>(
  {
    auth: "user",
    maintenanceGate: "legacy-plan",
    // Debounced section saves: their own budget, so typing never starves
    // other writes (and vice versa).
    rateLimit: "autosave",
    schema: { params: planStepParamSchema },
    auditAction: "plan.step_saved",
    auditResourceType: "legacy_plan",
  },
  async ({ user, params, request, correlationId }) => {
    const body = await parseJsonBody(request, savePlanStepBodySchema);
    return planService.savePlanStep(user, params.id, params.step, body, correlationId);
  },
);
