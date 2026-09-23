import { parseJsonBody } from "@/lib/api/validate";
import { withApi } from "@/lib/api/with-api";
import * as assetService from "@/lib/services/asset.service";
import { ASSET_KIND_BY_SLUG, type AssetTypeSlug } from "@/lib/types/asset";
import {
  assetCreateSchemaFor,
  assetListQuerySchema,
  assetTypeParamSchema,
  type AssetListQuery,
} from "@/lib/validators/asset.validators";

type TypeParams = { type: AssetTypeSlug };

/**
 * Asset collection for one class (api-contracts.md § Assets).
 *
 * `:type` is validated against the slug enum before it reaches a query, and the
 * body schema is chosen from it — each class has its own allow-list, which
 * `create_asset()` then enforces a second time inside the transaction.
 */
export const GET = withApi<undefined, AssetListQuery, TypeParams>(
  {
    auth: "user",
    rateLimit: "default",
    schema: { params: assetTypeParamSchema, query: assetListQuerySchema },
    auditAction: "asset.listed",
    auditResourceType: "asset",
  },
  async ({ user, params, query }) =>
    assetService.listAssets(user, ASSET_KIND_BY_SLUG[params.type], query),
);

export const POST = withApi<undefined, undefined, TypeParams>(
  {
    auth: "user",
    rateLimit: "default",
    schema: { params: assetTypeParamSchema },
    auditAction: "asset.created",
    auditResourceType: "asset",
  },
  async ({ user, params, request, correlationId }) => {
    const body = await parseJsonBody(request, assetCreateSchemaFor(params.type));
    return assetService.createAsset(user, ASSET_KIND_BY_SLUG[params.type], body, correlationId);
  },
);
