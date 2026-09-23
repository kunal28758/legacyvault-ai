import { withApi } from "@/lib/api/with-api";
import * as notificationService from "@/lib/services/notification.service";

/** Cheap poll for the navigation badge. */
export const GET = withApi(
  {
    auth: "user",
    rateLimit: "default",
    auditAction: "notification.unread_count",
    auditResourceType: "notification",
  },
  async ({ user }) => notificationService.unreadCount(user),
);
