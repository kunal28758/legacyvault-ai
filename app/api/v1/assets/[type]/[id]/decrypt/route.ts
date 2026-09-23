import { withApi } from "@/lib/api/with-api";
import * as assetService from "@/lib/services/asset.service";
import { ASSET_KIND_BY_SLUG, type AssetTypeSlug } from "@/lib/types/asset";
import { assetIdParamSchema } from "@/lib/validators/asset.validators";

type AssetParams = { type: AssetTypeSlug; id: string };

/**
 * Decrypted sensitive fields (FR-G004/G005).
 *
 * The only endpoint that returns asset plaintext. It requires Clerk step-up
 * verification, is rate-limited with the `sensitive` policy, and the service
 * writes an `asset.sensitive_revealed` audit row naming the fields — never the
 * values. The response carries `Cache-Control: private, no-store` like every
 * other API response, so it never reaches a shared cache.
 */
export const GET = withApi<undefined, undefined, AssetParams>(
  {
    auth: "user",
    reverification: "strict",
    rateLimit: "sensitive",
    schema: { params: assetIdParamSchema },
    auditAction: "asset.sensitive_revealed",
    auditResourceType: "asset",
  },
  async ({ user, params, correlationId }) =>
    assetService.revealSensitiveFields(
      user,
      ASSET_KIND_BY_SLUG[params.type],
      params.id,
      correlationId,
    ),
);
