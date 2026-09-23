import { parseJsonBody } from "@/lib/api/validate";
import { withApi } from "@/lib/api/with-api";
import * as assetService from "@/lib/services/asset.service";
import { ASSET_KIND_BY_SLUG, type AssetTypeSlug } from "@/lib/types/asset";
import {
  assetDeleteBodySchema,
  assetIdParamSchema,
  assetUpdateSchemaFor,
  type AssetDeleteBody,
} from "@/lib/validators/asset.validators";

type AssetParams = { type: AssetTypeSlug; id: string };

export const GET = withApi<undefined, undefined, AssetParams>(
  {
    auth: "user",
    rateLimit: "default",
    schema: { params: assetIdParamSchema },
    auditAction: "asset.read",
    auditResourceType: "asset",
  },
  async ({ user, params }) =>
    assetService.getAsset(user, ASSET_KIND_BY_SLUG[params.type], params.id),
);

/**
 * Plain columns are a Class A write; `accountNumber` / `policyNumber` /
 * `credentials` / `recoveryInfo` are encrypted in the service and written
 * through `set_encrypted_fields()`, the only path the column grants allow.
 */
export const PATCH = withApi<undefined, undefined, AssetParams>(
  {
    auth: "user",
    rateLimit: "default",
    schema: { params: assetIdParamSchema },
    auditAction: "asset.updated",
    auditResourceType: "asset",
  },
  async ({ user, params, request, correlationId }) => {
    const body = await parseJsonBody(request, assetUpdateSchemaFor(params.type));
    return assetService.updateAsset(
      user,
      ASSET_KIND_BY_SLUG[params.type],
      params.id,
      body,
      correlationId,
    );
  },
);

/** `delete_asset()` — assignments and attachments removed, row soft-deleted, audited. */
export const DELETE = withApi<AssetDeleteBody, undefined, AssetParams>(
  {
    auth: "user",
    rateLimit: "default",
    schema: { params: assetIdParamSchema, body: assetDeleteBodySchema },
    auditAction: "asset.deleted",
    auditResourceType: "asset",
  },
  async ({ user, params, correlationId }) =>
    assetService.deleteAsset(user, ASSET_KIND_BY_SLUG[params.type], params.id, correlationId),
);
