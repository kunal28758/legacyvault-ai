import { withApi } from "@/lib/api/with-api";
import * as accountService from "@/lib/services/account.service";

/**
 * Cancels a pending account deletion (api-contracts.md § Users).
 *
 * Deliberately available while the account is in its grace period — it is the
 * one action such an account must still be able to take.
 */
export const POST = withApi(
  {
    auth: "user",
    rateLimit: "sensitive",
    auditAction: "user.deletion_cancelled",
    auditResourceType: "users",
  },
  async ({ user, correlationId }) => accountService.cancelDeletion(user, correlationId),
);
