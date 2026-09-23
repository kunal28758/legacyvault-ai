import { withApi } from "@/lib/api/with-api";
import * as emergencyService from "@/lib/services/emergency-access.service";

/** Requests raised against the caller's emergency-access configurations. */
export const GET = withApi(
  {
    auth: "user",
    rateLimit: "default",
    auditAction: "ea.requests_listed",
    auditResourceType: "emergency_access_request",
  },
  async ({ user }) => {
    const overview = await emergencyService.getOverview(user);
    return { items: overview.requests };
  },
);
