import { withApi } from "@/lib/api/with-api";
import * as accessService from "@/lib/services/access.service";
import { issueTokenBodySchema, type IssueTokenBody } from "@/lib/validators/access.validators";
import { beneficiaryIdParamSchema } from "@/lib/validators/beneficiary.validators";

type IdParams = { id: string };

/** Access links for one beneficiary. The hash is never part of the response. */
export const GET = withApi<undefined, undefined, IdParams>(
  {
    auth: "user",
    rateLimit: "default",
    schema: { params: beneficiaryIdParamSchema },
    auditAction: "access.tokens_listed",
    auditResourceType: "access_token",
  },
  async ({ user, params }) => accessService.listTokens(user, params.id),
);

/**
 * Issues a DIRECT_SHARE link (FR-D011).
 *
 * `issue_access_token()` requires every id in the scope to be owned by the
 * caller *and* currently assigned to this beneficiary, refuses plan sections,
 * and refuses videos whose delivery condition is not IMMEDIATE. The plaintext
 * link is returned exactly once and is not stored.
 */
export const POST = withApi<IssueTokenBody, undefined, IdParams>(
  {
    auth: "user",
    rateLimit: "sensitive",
    schema: { params: beneficiaryIdParamSchema, body: issueTokenBodySchema },
    auditAction: "access.token_issued",
    auditResourceType: "access_token",
  },
  async ({ user, params, body, correlationId }) =>
    accessService.issueToken(user, params.id, body, correlationId),
);
