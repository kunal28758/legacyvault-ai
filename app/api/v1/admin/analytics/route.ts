import { withApi } from "@/lib/api/with-api";
import * as adminService from "@/lib/services/admin.service";
import {
  adminAnalyticsQuerySchema,
  type AdminAnalyticsQuery,
} from "@/lib/validators/admin.validators";

/** Platform analytics (FR-P006): registrations, storage, protection and jobs. */
export const GET = withApi<undefined, AdminAnalyticsQuery>(
  {
    auth: "admin",
    rateLimit: "default",
    schema: { query: adminAnalyticsQuerySchema },
    auditAction: "admin.analytics_viewed",
    auditResourceType: "users",
  },
  async ({ user, query }) => adminService.analytics(user, query.days),
);
