import { withApi } from "@/lib/api/with-api";
import * as portal from "@/lib/services/access-portal.service";
import { accessIdParamSchema } from "@/lib/validators/access-portal.validators";

type IdParams = { id: string };

/**
 * A signed playback URL.
 *
 * The delivery condition is re-checked against the grant type here, not only
 * when the link was minted.
 */
export const GET = withApi<undefined, undefined, IdParams>(
  {
    auth: "access-cookie",
    rateLimit: "tokenAccess",
    schema: { params: accessIdParamSchema },
    auditAction: "access.video_played",
    auditResourceType: "video_message",
  },
  async ({ grant, params, correlationId }) => portal.videoAccess(grant, params.id, correlationId),
);
