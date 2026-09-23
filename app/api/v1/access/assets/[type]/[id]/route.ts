import { withApi } from "@/lib/api/with-api";
import * as portal from "@/lib/services/access-portal.service";
import { accessAssetParamSchema } from "@/lib/validators/access-portal.validators";

type AssetParams = { type: string; id: string };

/** A read-only asset view. Encrypted fields are not selected, let alone returned. */
export const GET = withApi<undefined, undefined, AssetParams>(
  {
    auth: "access-cookie",
    rateLimit: "tokenAccess",
    schema: { params: accessAssetParamSchema },
  },
  async ({ grant, params, correlationId }) =>
    portal.assetView(grant, params.type, params.id, correlationId),
);
