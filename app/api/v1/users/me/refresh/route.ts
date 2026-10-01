import { withApi } from "@/lib/api/with-api";
import * as userService from "@/lib/services/user.service";

/**
 * Re-syncs the caller's profile from Clerk (api-contracts.md § Users).
 *
 * Called after the user changes a security factor in Clerk's own UI so the
 * mirror the dashboard and security scores read — `users.mfa_enabled`,
 * email-verification, name — reflects it immediately rather than on the next
 * webhook or the 24-hour refresh. Idempotent; nothing is created here.
 */
export const POST = withApi({ auth: "user", rateLimit: "default" }, async ({ user }) =>
  userService.refreshFromProvider(user),
);
