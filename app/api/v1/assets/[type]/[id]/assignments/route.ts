import { withApi } from "@/lib/api/with-api";
import * as assetService from "@/lib/services/asset.service";
import { ASSET_KIND_BY_SLUG, type AssetTypeSlug } from "@/lib/types/asset";
import { assetIdParamSchema } from "@/lib/validators/asset.validators";

type AssetParams = { type: AssetTypeSlug; id: string };

/** Assignments on this asset plus the remaining percentage (FR-D005). */
export const GET = withApi<undefined, undefined, AssetParams>(
  {
    auth: "user",
    rateLimit: "default",
    schema: { params: assetIdParamSchema },
    auditAction: "assignment.listed",
    auditResourceType: "asset",
  },
  async ({ user, params }) =>
    assetService.listAssignments(user, ASSET_KIND_BY_SLUG[params.type], params.id),
);
