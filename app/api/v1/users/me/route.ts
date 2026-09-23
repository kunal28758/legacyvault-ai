import { withApi } from "@/lib/api/with-api";
import * as userService from "@/lib/services/user.service";
import { updateProfileSchema, type UpdateProfileBody } from "@/lib/validators/user.validators";

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
