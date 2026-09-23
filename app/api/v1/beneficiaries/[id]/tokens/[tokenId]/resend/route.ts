import { withApi } from "@/lib/api/with-api";
import * as accessService from "@/lib/services/access.service";
import {
  resendTokenBodySchema,
  tokenParamSchema,
  type ResendTokenBody,
} from "@/lib/validators/access.validators";

type TokenParams = { id: string; tokenId: string };

/**
 * Resends a link (ADR-014 § 6).
 *
 * The original secret is unrecoverable by design, so a resend revokes the
 * current link as RESENT and mints exactly one replacement. Step-up
 * verification is required because it hands out fresh access.
 */
export const POST = withApi<ResendTokenBody, undefined, TokenParams>(
  {
    auth: "user",
    rateLimit: "sensitive",
    reverification: "strict",
    schema: { params: tokenParamSchema, body: resendTokenBodySchema },
    auditAction: "access.token_resent",
    auditResourceType: "access_token",
  },
  async ({ user, params, body, correlationId }) =>
    accessService.resendToken(user, params.id, params.tokenId, body, correlationId),
);
