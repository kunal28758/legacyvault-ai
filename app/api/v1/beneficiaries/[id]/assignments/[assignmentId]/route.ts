import { withApi } from "@/lib/api/with-api";
import * as beneficiaryService from "@/lib/services/beneficiary.service";
import { assignmentParamSchema } from "@/lib/validators/beneficiary.validators";

type AssignmentParams = { id: string; assignmentId: string };

/**
 * Remove one assignment through `unassign_beneficiary()`.
 *
 * The service re-checks that the assignment belongs both to the caller and to
 * the beneficiary named in the path, so a leaked assignment id cannot be spent
 * against a different beneficiary; the guarded function then re-checks
 * ownership a second time inside the transaction.
 */
export const DELETE = withApi<undefined, undefined, AssignmentParams>(
  {
    auth: "user",
    rateLimit: "default",
    schema: { params: assignmentParamSchema },
    auditAction: "assignment.removed",
    auditResourceType: "beneficiary",
  },
  async ({ user, params, correlationId }) =>
    beneficiaryService.unassignBeneficiary(user, params.id, params.assignmentId, correlationId),
);
