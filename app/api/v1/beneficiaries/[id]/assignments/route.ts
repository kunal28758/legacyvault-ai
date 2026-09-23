import { withApi } from "@/lib/api/with-api";
import * as beneficiaryService from "@/lib/services/beneficiary.service";
import { beneficiaryIdParamSchema } from "@/lib/validators/beneficiary.validators";

type IdParams = { id: string };

/**
 * What this beneficiary is assigned to.
 *
 * Assignments are *created* from the resource side (`POST /assets/:type/:id/assign`,
 * `/documents/:id/share`, `/videos/:id/assign`) because `assign_beneficiary()`
 * locks the resource row to serialize the allocation sum. This endpoint and the
 * delete beneath it are the beneficiary-centric read and undo.
 */
export const GET = withApi<undefined, undefined, IdParams>(
  {
    auth: "user",
    rateLimit: "default",
    schema: { params: beneficiaryIdParamSchema },
    auditAction: "assignment.listed",
    auditResourceType: "beneficiary",
  },
  async ({ user, params }) => {
    const detail = await beneficiaryService.getBeneficiary(user, params.id);
    return { items: detail.assignments };
  },
);
