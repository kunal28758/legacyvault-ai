import { withApi } from "@/lib/api/with-api";
import * as notificationService from "@/lib/services/notification.service";
import { markReadBodySchema, type MarkReadBody } from "@/lib/validators/notification.validators";

/** Marks the given notifications read, or all of them when the list is empty. */
export const POST = withApi<MarkReadBody>(
  {
    auth: "user",
    rateLimit: "default",
    schema: { body: markReadBodySchema },
    auditAction: "notification.read",
    auditResourceType: "notification",
  },
  async ({ user, body }) => notificationService.markRead(user, body.ids),
);
