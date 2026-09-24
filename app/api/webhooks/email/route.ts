import { Webhook } from "svix";

import { ApiError } from "@/lib/api/errors";
import { withApi } from "@/lib/api/with-api";
import { getEnvGroup } from "@/lib/config/env";
import { createServiceClient } from "@/lib/db/server";

/**
 * Email delivery events (ADR-009, api-contracts.md § Internal).
 *
 * Without this, `notifications.delivery_status` stops at SENT — meaning "the
 * provider accepted it", which is not the same as "it arrived". A bounce is
 * worth knowing about for exactly the messages this product sends: a check-in
 * reminder or an access link that never lands is a silent failure of the
 * promise.
 *
 * Same shape as the Clerk webhook: the Svix signature is verified over the RAW
 * body first, replays are a no-op, and the handler only ever moves a status.
 */
export const dynamic = "force-dynamic";

interface ResendEvent {
  type: string;
  data?: { email_id?: string };
}

/** Provider event → the delivery status the column records. */
const STATUS_BY_EVENT: Record<string, "SENT" | "DELIVERED" | "BOUNCED" | "FAILED"> = {
  "email.sent": "SENT",
  "email.delivered": "DELIVERED",
  "email.delivery_delayed": "SENT",
  "email.bounced": "BOUNCED",
  "email.complained": "FAILED",
  "email.failed": "FAILED",
};

export const POST = withApi(
  {
    auth: "webhook",
    auditAction: "webhook.email",
    auditResourceType: "processed_webhook_event",
    verify: (rawBody, headers) => {
      const secret = getEnvGroup("email").EMAIL_WEBHOOK_SECRET;
      try {
        new Webhook(secret).verify(rawBody, {
          "svix-id": headers.get("svix-id") ?? "",
          "svix-timestamp": headers.get("svix-timestamp") ?? "",
          "svix-signature": headers.get("svix-signature") ?? "",
        });
      } catch {
        throw ApiError.unauthenticated("Invalid webhook signature.");
      }
    },
  },
  async ({ request, logger: log }) => {
    const svixId = request.headers.get("svix-id");
    if (!svixId) throw ApiError.unauthenticated("Invalid webhook signature.");

    const event = (await request.json()) as ResendEvent;
    const db = createServiceClient();

    const { data: isNew, error } = await db.rpc("record_webhook_event", {
      p_provider: "EMAIL",
      p_event_id: svixId,
      p_event_type: event.type,
    });
    if (error) throw error;
    if (!isNew) return { received: true, duplicate: true };

    const status = STATUS_BY_EVENT[event.type];
    const providerMessageId = event.data?.email_id;
    if (!status || !providerMessageId) {
      log.info({ eventType: event.type }, "email webhook event ignored");
      return { received: true, applied: false };
    }

    // A late `sent` must not overwrite a `delivered` or a `bounced`.
    const terminal = ["DELIVERED", "BOUNCED", "FAILED"];
    const { data: rows, error: updateError } = await db
      .from("notifications")
      .update({ delivery_status: status })
      .eq("provider_message_id", providerMessageId)
      .not("delivery_status", "in", `(${terminal.join(",")})`)
      .select("id");
    if (updateError) throw updateError;

    log.info({ eventType: event.type, applied: (rows ?? []).length }, "email delivery event");
    return { received: true, applied: (rows ?? []).length > 0 };
  },
);
