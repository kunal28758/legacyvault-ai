import { withApi } from "@/lib/api/with-api";
import * as userService from "@/lib/services/user.service";
import {
  updatePreferencesSchema,
  type UpdatePreferencesBody,
} from "@/lib/validators/user.validators";

export const GET = withApi({ auth: "user" }, async ({ user }) => {
  const profile = await userService.getMe(user);
  return {
    preferences: profile.preferences,
    notificationPreferences: profile.notificationPreferences,
    securityPreferences: profile.securityPreferences,
  };
});

export const PATCH = withApi<UpdatePreferencesBody>(
  {
    auth: "user",
    rateLimit: "default",
    schema: { body: updatePreferencesSchema },
    auditAction: "user.preferences_updated",
    auditResourceType: "users",
  },
  async ({ user, body, correlationId }) => userService.updatePreferences(user, body, correlationId),
);
