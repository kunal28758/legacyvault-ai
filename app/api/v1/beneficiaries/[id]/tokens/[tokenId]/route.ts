import { withApi } from "@/lib/api/with-api";
import * as accessService from "@/lib/services/access.service";
import { tokenParamSchema } from "@/lib/validators/access.validators";

type TokenParams = { id: string; tokenId: string };

/** Revokes a link immediately (`revokedReason = OWNER`). */
export const DELETE = withApi<undefined, undefined, TokenParams>(
  {
    auth: "user",
    rateLimit: "default",
    schema: { params: tokenParamSchema },
    auditAction: "access.token_revoked",
    auditResourceType: "access_token",
  },
  async ({ user, params, correlationId }) =>
    accessService.revokeToken(user, params.id, params.tokenId, correlationId),
);
