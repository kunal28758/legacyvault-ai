import "server-only";

import { audit } from "@/lib/audit/audit.service";
import { lookupDelivery, type DeliveryOutcome } from "@/lib/email/client";
import { logger } from "@/lib/observability/logger";
import * as notificationRepository from "@/lib/repositories/notification.repository";
import { payloadOf, requireString, type JobHandler } from "@/lib/jobs/types";

/**
 * Asks the provider what became of a security-critical email it accepted.
 *
 * SENT means only that the provider took the request; the release gate needs
 * DELIVERED — the recipient's mail server accepted the message. This job is
 * how that evidence arrives without depending on a webhook being configured
 * (the Resend webhook still records outcomes where it is). No outcome yet is
 * a failure, so the queue retries with back-off; an unreachable provider is a
 * failure too. Neither ever turns into DELIVERED.
 */
const STATUS: Record<Exclude<DeliveryOutcome, "pending">, "DELIVERED" | "BOUNCED" | "FAILED"> = {
  delivered: "DELIVERED",
  bounced: "BOUNCED",
  failed: "FAILED",
};

export const notificationConfirmHandler: JobHandler = async (job, db) => {
  const notificationId = requireString(payloadOf(job), "notificationId");
  const notification = await notificationRepository.findById(db, notificationId);
  // Gone, never emailed, or already settled (by a webhook or an earlier run).
  if (
    !notification ||
    notification.delivery_status !== "SENT" ||
    !notification.provider_message_id ||
    !notification.delivery_provider
  ) {
    return;
  }

  const outcome = await lookupDelivery(
    notification.delivery_provider as "resend" | "brevo",
    notification.provider_message_id,
  );
  if (outcome === "pending") throw new Error("delivery not confirmed yet");

  const recorded = await notificationRepository.recordOutcome(db, notificationId, STATUS[outcome]);
  if (recorded && outcome !== "delivered") {
    // Visible to operators: a warning that did not arrive holds a release.
    logger.warn({ jobId: job.id, outcome }, "critical email did not arrive");
    await audit.log({
      actorId: null,
      action: "notification.delivery_failed",
      resourceType: "notification",
      resourceId: notificationId,
      outcome: "FAILURE",
      metadata: {
        ownerUserId: notification.user_id,
        type: notification.type,
        outcome,
        provider: notification.delivery_provider,
      },
    });
  }
};
