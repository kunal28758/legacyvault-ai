import "server-only";

import type { AppUser } from "@/lib/auth/ensure-app-user";
import { createUserClient } from "@/lib/db/server";
import * as notificationRepository from "@/lib/repositories/notification.repository";
import type { NotificationListResult } from "@/lib/types/notification";
import type { NotificationListQuery } from "@/lib/validators/notification.validators";

/**
 * Notifications (FR-L001–L006).
 *
 * Rows are written by the guarded functions and the job runner; the only thing
 * the owner may change is whether they have been read, which is exactly the
 * column grant `authenticated` holds.
 */
export async function listNotifications(
  user: AppUser,
  query: NotificationListQuery,
): Promise<NotificationListResult> {
  const db = await createUserClient();
  const [{ rows, total }, unread] = await Promise.all([
    notificationRepository.list(db, user.id, {
      unreadOnly: query.unreadOnly,
      page: query.page,
      limit: query.limit,
    }),
    notificationRepository.unreadCount(db, user.id),
  ]);

  return {
    items: rows.map(notificationRepository.toNotification),
    total,
    unreadCount: unread,
    page: query.page,
    limit: query.limit,
  };
}

export async function unreadCount(user: AppUser): Promise<{ count: number }> {
  const db = await createUserClient();
  return { count: await notificationRepository.unreadCount(db, user.id) };
}

/** An empty id list marks everything unread as read. */
export async function markRead(
  user: AppUser,
  ids: readonly string[],
): Promise<{ updated: number; unreadCount: number }> {
  const db = await createUserClient();
  const updated = await notificationRepository.markRead(db, user.id, ids);
  return { updated, unreadCount: await notificationRepository.unreadCount(db, user.id) };
}
