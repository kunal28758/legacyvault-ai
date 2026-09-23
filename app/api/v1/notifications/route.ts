import { withApi } from "@/lib/api/with-api";
import * as notificationService from "@/lib/services/notification.service";
import {
  notificationListQuerySchema,
  type NotificationListQuery,
} from "@/lib/validators/notification.validators";

/** In-app notifications (api-contracts.md § Notifications). */
export const GET = withApi<undefined, NotificationListQuery>(
  {
    auth: "user",
    rateLimit: "default",
    schema: { query: notificationListQuerySchema },
    auditAction: "notification.listed",
    auditResourceType: "notification",
  },
  async ({ user, query }) => notificationService.listNotifications(user, query),
);
