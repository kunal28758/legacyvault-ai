import { Webhook } from "svix";

import { withApi } from "@/lib/api/with-api";
import { ApiError } from "@/lib/api/errors";
import { audit } from "@/lib/audit/audit.service";
import * as jobRepository from "@/lib/repositories/job.repository";
import { processWebhookOnce } from "@/lib/repositories/webhook.repository";
import { ensureAppUser } from "@/lib/auth/ensure-app-user";
import { getEnvGroup } from "@/lib/config/env";
import { createServiceClient, type TypedSupabaseClient } from "@/lib/db/server";
import { logger } from "@/lib/observability/logger";

/**
 * Clerk webhook (task T198, ADR-003 § 3).
 *
 * The primary Clerk → `public.users` sync path and the source of the
 * authentication audit trail (FR-A014). Runs with the service client because
 * no Clerk session exists on a webhook request.
 *
 * Security properties, in order:
 *  1. the Svix signature is verified over the RAW body before anything is
 *     parsed — an invalid signature returns 401 with no side effects;
 *  2. `record_webhook_event()` makes replays a no-op (unique on provider+id),
 *     and a delivery whose processing fails is forgotten so the retry runs it
 *     (`processWebhookOnce`); every case below is idempotent;
 *  3. the browser CSRF check does not apply (no cookies; authenticated per
 *     request by signature) — `withApi` handles that distinction.
 */
export const dynamic = "force-dynamic";

interface ClerkEmailAddress {
  id: string;
  email_address: string;
  verification?: { status?: string } | null;
}

interface ClerkUserData {
  id: string;
  primary_email_address_id?: string | null;
  email_addresses?: ClerkEmailAddress[];
  first_name?: string | null;
  last_name?: string | null;
  username?: string | null;
  two_factor_enabled?: boolean;
}

interface ClerkSessionData {
  id: string;
  user_id: string;
  client_id?: string;
}

interface ClerkWebhookEvent {
  type: string;
  data: ClerkUserData & ClerkSessionData & Record<string, unknown>;
}

function identityFromWebhook(data: ClerkUserData) {
  const primary =
    data.email_addresses?.find((address) => address.id === data.primary_email_address_id) ??
    data.email_addresses?.[0];
  return {
    clerkUserId: data.id,
    email: (primary?.email_address ?? "").toLowerCase(),
    name:
      [data.first_name, data.last_name].filter(Boolean).join(" ") ||
      data.username ||
      primary?.email_address ||
      "Account",
    emailVerified: primary?.verification?.status === "verified",
    mfaEnabled: Boolean(data.two_factor_enabled),
  };
}

export const POST = withApi(
  {
    auth: "webhook",
    auditAction: "webhook.clerk",
    auditResourceType: "processed_webhook_event",
    verify: (rawBody, headers) => {
      const secret = getEnvGroup("clerkWebhook").CLERK_WEBHOOK_SIGNING_SECRET;
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
  async ({ request, correlationId, logger: log }) => {
    const svixId = request.headers.get("svix-id");
    if (!svixId) throw ApiError.unauthenticated("Invalid webhook signature.");

    const event = (await request.json()) as ClerkWebhookEvent;
    const db = createServiceClient();

    // Idempotency: a duplicate delivery is acknowledged and ignored; one whose
    // processing fails is forgotten, so Clerk's retry runs it.
    const outcome = await processWebhookOnce(
      db,
      { provider: "CLERK", id: svixId, type: event.type },
      () => handleEvent(db, event, correlationId, log),
    );
    if (outcome.duplicate) {
      log.info({ eventType: event.type }, "duplicate Clerk webhook ignored");
      return { received: true, duplicate: true };
    }
    return { received: true };
  },
);

async function handleEvent(
  db: TypedSupabaseClient,
  event: ClerkWebhookEvent,
  correlationId: string,
  log: Pick<typeof logger, "warn">,
): Promise<void> {
  switch (event.type) {
    case "user.created":
    case "user.updated": {
      const identity = identityFromWebhook(event.data);
      if (!identity.email) {
        log.warn({ eventType: event.type }, "Clerk user event without an email address");
        break;
      }
      const appUser = await ensureAppUser(identity);
      await audit.log({
        actorId: appUser.id,
        actorRole: appUser.role,
        action: event.type === "user.created" ? "user.registered" : "user.mirrored",
        resourceType: "users",
        resourceId: appUser.id,
        outcome: "SUCCESS",
        metadata: { source: "clerk_webhook" },
        correlationId,
      });
      break;
    }

    case "user.deleted": {
      // Deleted outside the app (Clerk's own account page or dashboard). Close
      // the account exactly as the app does — access links revoked, Dead
      // Man's Switch and emergency access stopped, one `user.deleted` audit —
      // but keep the data: whether such a deletion also erases it is an open
      // decision (docs/release/ACCOUNT_DELETION_READINESS.md § 6). After an
      // in-app deletion the account is already deleted (or gone) and this
      // changes nothing.
      const { data: existing, error: lookupError } = await db
        .from("users")
        .select("id")
        .eq("clerk_user_id", event.data.id)
        .maybeSingle();
      if (lookupError) throw lookupError;
      if (existing) {
        const { error: deleteError } = await db.rpc("begin_account_deletion", {
          p_user_id: existing.id,
          p_corr: correlationId,
          p_purge: false,
        });
        if (deleteError) throw deleteError;
      }
      break;
    }

    case "session.created":
    case "session.ended":
    case "session.removed":
    case "session.revoked": {
      const { data: appUser } = await db
        .from("users")
        .select("id, role")
        .eq("clerk_user_id", event.data.user_id)
        .maybeSingle();
      if (!appUser) break;

      if (event.type === "session.created") {
        await db
          .from("users")
          .update({ last_login_at: new Date().toISOString() })
          .eq("id", appUser.id);
      }

      await audit.log({
        actorId: appUser.id,
        actorRole: appUser.role,
        action: event.type === "session.created" ? "auth.login" : "auth.logout",
        resourceType: "session",
        resourceId: null,
        outcome: "SUCCESS",
        // Session id is an opaque Clerk identifier, not a credential.
        metadata: { source: "clerk_webhook", event: event.type },
        correlationId,
      });
      if (event.type === "session.created") {
        // Detection runs in the queue: a slow identity provider must never
        // delay a sign-in, and a duplicate webhook must not notify twice.
        await jobRepository.enqueue(
          db,
          "security.new-device",
          { userId: appUser.id, sessionId: event.data.id },
          `security.new-device:${event.data.id}`,
        );
      }
      break;
    }

    default:
      logger.debug({ eventType: event.type }, "unhandled Clerk webhook event");
  }
}
