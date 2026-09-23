import { withApi } from "@/lib/api/with-api";
import * as assetService from "@/lib/services/asset.service";
import { ASSET_KIND_BY_SLUG, type AssetTypeSlug } from "@/lib/types/asset";
import { assetAssignmentParamSchema } from "@/lib/validators/asset.validators";

type AssignmentParams = { type: AssetTypeSlug; id: string; assignmentId: string };

/** `unassign_beneficiary()` — the assignment must belong to this caller and this asset. */
export const DELETE = withApi<undefined, undefined, AssignmentParams>(
  {
    auth: "user",
    rateLimit: "default",
    schema: { params: assetAssignmentParamSchema },
    auditAction: "assignment.removed",
    auditResourceType: "asset",
  },
  async ({ user, params, correlationId }) =>
    assetService.unassignBeneficiary(
      user,
      ASSET_KIND_BY_SLUG[params.type],
      params.id,
      params.assignmentId,
      correlationId,
    ),
);
