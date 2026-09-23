import { withApi } from "@/lib/api/with-api";
import * as userService from "@/lib/services/user.service";

export const POST = withApi(
  {
    auth: "user",
    rateLimit: "default",
    auditAction: "user.onboarding_completed",
    auditResourceType: "users",
  },
  async ({ user, correlationId }) => userService.completeOnboarding(user, correlationId),
);
