import { withApi } from "@/lib/api/with-api";
import * as assetService from "@/lib/services/asset.service";
import { ASSET_KIND_BY_SLUG, type AssetTypeSlug } from "@/lib/types/asset";
import {
  assetAssignBodySchema,
  assetIdParamSchema,
  type AssetAssignBody,
} from "@/lib/validators/asset.validators";

type AssetParams = { type: AssetTypeSlug; id: string };

/**
 * Create an assignment from the resource side (FR-D005).
 *
 * Three barriers, in order: the service proves the caller owns both the asset
 * and the beneficiary and that the beneficiary is not INACTIVE; RLS scopes
 * every statement to the caller; and `assign_beneficiary()` re-checks ownership
 * and the Σ allocation ≤ 100 invariant while holding a lock on the resource
 * row, so two concurrent assignments cannot both pass the sum check.
 */
export const POST = withApi<AssetAssignBody, undefined, AssetParams>(
  {
    auth: "user",
    rateLimit: "default",
    schema: { params: assetIdParamSchema, body: assetAssignBodySchema },
    auditAction: "assignment.created",
    auditResourceType: "asset",
  },
  async ({ user, params, body, correlationId }) =>
    assetService.assignBeneficiary(
      user,
      ASSET_KIND_BY_SLUG[params.type],
      params.id,
      body,
      correlationId,
    ),
);
