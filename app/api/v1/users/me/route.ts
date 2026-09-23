import { withApi } from "@/lib/api/with-api";
import * as accountService from "@/lib/services/account.service";
import * as userService from "@/lib/services/user.service";
import {
  deleteAccountSchema,
  updateProfileSchema,
  type DeleteAccountBody,
  type UpdateProfileBody,
} from "@/lib/validators/user.validators";

/** Current user (api-contracts.md § Users). Thin: auth → validate → service. */
export const GET = withApi({ auth: "user" }, async ({ user }) => userService.getMe(user));

export const PATCH = withApi<UpdateProfileBody>(
  {
    auth: "user",
    rateLimit: "default",
    schema: { body: updateProfileSchema },
    auditAction: "user.profile_updated",
    auditResourceType: "users",
  },
  async ({ user, body, correlationId }) => userService.updateProfile(user, body, correlationId),
);

/**
 * Requests account deletion (api-contracts.md § Users).
 *
 * A 30-day grace period rather than an immediate wipe: the switch is paused,
 * every live access link is revoked and all sessions are signed out, and the
 * account can still cancel. Re-verified, because it is irreversible after the
 * grace period.
 */
export const DELETE = withApi<DeleteAccountBody>(
  {
    auth: "user",
    rateLimit: "sensitive",
    reverification: "strict",
    schema: { body: deleteAccountSchema },
    auditAction: "user.deletion_requested",
    auditResourceType: "users",
  },
  async ({ user, correlationId }) => accountService.requestDeletion(user, correlationId),
);
