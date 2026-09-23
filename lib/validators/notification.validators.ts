import { z } from "zod";

export const notificationListQuerySchema = z.object({
  unreadOnly: z
    .enum(["true", "false"])
    .optional()
    .transform((value) => value === "true"),
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(30),
});

export const markReadBodySchema = z.object({
  /** Empty marks everything unread as read. */
  ids: z.array(z.uuid()).max(200).default([]),
});

export type NotificationListQuery = z.infer<typeof notificationListQuerySchema>;
export type MarkReadBody = z.infer<typeof markReadBodySchema>;
