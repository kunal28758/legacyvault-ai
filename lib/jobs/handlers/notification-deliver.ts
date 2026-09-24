import "server-only";

import { sendNotificationEmail } from "@/lib/email/send";
import {
  asNotificationPreferences,
  shouldEmailNotification,
} from "@/lib/notifications/preferences";
import { logger } from "@/lib/observability/logger";
import * as notificationRepository from "@/lib/repositories/notification.repository";
import { payloadOf, requireString, type JobHandler } from "@/lib/jobs/types";

/**
 * Delivers an in-app notification by email when the channel asks for it *and*
 * the person has not asked it not to.
 *
 * The notification row is the record; this only adds the email. A row already
 * marked SENT is left alone, so a retry cannot double-send, and a preference
 * that suppresses the email still leaves the notification in the app.
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

  const decision = shouldEmailNotification(
    notification.type,
    asNotificationPreferences(user.notification_preferences),
  );
  if (!decision.send) {
    // Delivered in the app, which is where the record lives; the email was the
    // part the person turned off.
    logger.info({ jobId: job.id, reason: decision.reason }, "notification email suppressed");
    await notificationRepository.markDelivered(db, notificationId, null, "DELIVERED");
    return;
  }

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
