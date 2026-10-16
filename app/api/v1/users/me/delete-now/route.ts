import { withApi } from "@/lib/api/with-api";
import * as accountService from "@/lib/services/account.service";
import {
  deleteAccountNowSchema,
  type DeleteAccountNowBody,
} from "@/lib/validators/user.validators";

/**
 * Deletes the caller's own account permanently, now — no grace period.
 *
 * A separate route from `DELETE /users/me` (the scheduled deletion) so that
 * neither can ever be taken for the other. The account is always the session's
 * own; the body carries only the typed confirmation phrase. Re-verification is
 * `multi_factor`: Clerk's `strict_mfa`, which asks for both factors when the
 * account has a second one, within the last 10 minutes.
 */
export const POST = withApi<DeleteAccountNowBody>(
  {
    auth: "user",
    rateLimit: "sensitive",
    reverification: "multi_factor",
    schema: { body: deleteAccountNowSchema },
    auditAction: "user.deleted",
    auditResourceType: "users",
  },
  async ({ user, correlationId }) => accountService.deleteAccountNow(user, correlationId),
);
