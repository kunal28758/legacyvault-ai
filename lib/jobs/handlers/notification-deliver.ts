import "server-only";

import { sendNotificationEmail } from "@/lib/email/send";
import { logger } from "@/lib/observability/logger";
import * as notificationRepository from "@/lib/repositories/notification.repository";
import { payloadOf, requireString, type JobHandler } from "@/lib/jobs/types";

/**
 * Delivers an in-app notification by email when the channel asks for it.
 *
 * The notification row is the record; this only adds the email. A row already
 * marked SENT is left alone, so a retry cannot double-send.
 */
export const notificationDeliverHandler: JobHandler = async (job, db) => {
  const payload = payloadOf(job);
  const notificationId = requireString(payload, "notificationId");

  const notification = await notificationRepository.findById(db, notificationId);
  if (!notification) {
    logger.warn({ jobId: job.id }, "notification vanished before delivery");
    return;
  }
  if (notification.delivery_status === "SENT" || notification.delivery_status === "DELIVERED") {
    return;
  }
  if (notification.channel === "IN_APP") {
    await notificationRepository.markDelivered(db, notificationId, null, "DELIVERED");
    return;
  }

  const { data: user, error } = await db
    .from("users")
    .select("email, notification_preferences")
    .eq("id", notification.user_id)
    .maybeSingle();
  if (error) throw error;
  if (!user) throw new Error("user not found for notification delivery");

  try {
    const sent = await sendNotificationEmail({
      to: user.email,
      title: notification.title,
      content: notification.content,
      idempotencyKey: `notification:${notificationId}`,
    });
    await notificationRepository.markDelivered(db, notificationId, sent.providerMessageId, "SENT");
  } catch (cause) {
    await notificationRepository.markDelivered(db, notificationId, null, "FAILED");
    throw cause;
  }
};
