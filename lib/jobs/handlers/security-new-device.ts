import "server-only";

import { clerkClient } from "@clerk/nextjs/server";

import type { TypedSupabaseClient } from "@/lib/db/server";
import * as jobRepository from "@/lib/repositories/job.repository";
import * as notificationRepository from "@/lib/repositories/notification.repository";
import { logger } from "@/lib/observability/logger";
import { payloadOf, requireString, type JobHandler } from "@/lib/jobs/types";

/**
 * New-device and unusual-location detection (FR-A016).
 *
 * A sign-in from somewhere the account has not been seen before is the earliest
 * signal a person gets that someone else has their password. The check runs
 * here rather than in the webhook so a slow identity provider can never delay
 * or fail the sign-in itself.
 *
 * The signature is deliberately coarse — browser, device type and country, and
 * never the IP address — because it is written to the audit trail, and a
 * precise device fingerprint kept forever is a tracking record, not a security
 * control.
 */
interface Signature {
  browser: string;
  device: string;
  country: string;
}

function signatureOf(activity: {
  browserName?: string;
  deviceType?: string;
  country?: string;
  isMobile?: boolean;
}): Signature {
  return {
    browser: activity.browserName?.trim() || "unknown browser",
    device: activity.deviceType?.trim() || (activity.isMobile ? "mobile" : "desktop"),
    country: activity.country?.trim() || "unknown location",
  };
}

function describe(signature: Signature): string {
  return `${signature.browser} on ${signature.device}, ${signature.country}`;
}

function matches(a: Signature, b: Signature): boolean {
  return a.browser === b.browser && a.device === b.device && a.country === b.country;
}

/** The signatures this account has signed in from before. */
async function knownSignatures(
  db: TypedSupabaseClient,
  userId: string,
  excludeAuditId: string | null,
): Promise<Signature[]> {
  const { data, error } = await db
    .from("audit_log")
    .select("id, metadata")
    .eq("actor_id", userId)
    .eq("action", "auth.device_seen")
    .order("created_at", { ascending: false })
    .limit(50);
  if (error) throw error;

  return (data ?? [])
    .filter((row) => row.id !== excludeAuditId)
    .map((row) => {
      const metadata =
        row.metadata && typeof row.metadata === "object" && !Array.isArray(row.metadata)
          ? (row.metadata as Record<string, unknown>)
          : {};
      return {
        browser: String(metadata.browser ?? ""),
        device: String(metadata.device ?? ""),
        country: String(metadata.country ?? ""),
      };
    })
    .filter((signature) => signature.browser !== "");
}

export const securityNewDeviceHandler: JobHandler = async (job, db) => {
  const payload = payloadOf(job);
  const userId = requireString(payload, "userId");

  // Deleted (0012) or already purged: recording the device or alerting would
  // write new personal data for an account that is being erased.
  const { data: account, error: accountError } = await db
    .from("users")
    .select("deleted_at")
    .eq("id", userId)
    .maybeSingle();
  if (accountError) throw accountError;
  if (!account || account.deleted_at) {
    logger.info({ jobId: job.id }, "new-device check skipped: account is deleted");
    return;
  }
  const sessionId = requireString(payload, "sessionId");

  let activity: Signature;
  try {
    const clerk = await clerkClient();
    const session = await clerk.sessions.getSession(sessionId);
    if (!session.latestActivity) {
      // Nothing to compare yet; a session with no recorded activity is not
      // evidence of anything and must not produce a false alarm.
      logger.info({ jobId: job.id }, "new-device check skipped: no session activity");
      return;
    }
    activity = signatureOf(session.latestActivity);
  } catch (cause) {
    // A provider outage must not be reported to the user as a new device.
    logger.warn({ err: cause, jobId: job.id }, "new-device check could not read the session");
    return;
  }

  const known = await knownSignatures(db, userId, null);
  const seenBefore = known.some((signature) => matches(signature, activity));

  // Recorded either way: this row is what the next sign-in compares against.
  const { error: auditError } = await db.from("audit_log").insert({
    actor_id: userId,
    action: "auth.device_seen",
    resource_type: "session",
    resource_id: null,
    outcome: "SUCCESS",
    metadata: { ...activity, recognised: seenBefore } as never,
  });
  if (auditError) throw auditError;

  if (seenBefore) return;

  // The person can turn the alert off; the trail above is kept either way.
  const { data: owner, error: ownerError } = await db
    .from("users")
    .select("security_preferences")
    .eq("id", userId)
    .maybeSingle();
  if (ownerError) throw ownerError;
  const preferences =
    owner?.security_preferences && typeof owner.security_preferences === "object"
      ? (owner.security_preferences as Record<string, unknown>)
      : {};
  if (preferences.loginNotifications === false) {
    logger.info({ jobId: job.id }, "new-device alert suppressed by preference");
    return;
  }

  const notificationId = await notificationRepository.insertSystem(db, {
    userId,
    type: "security.new_device",
    title: "New sign-in to your LegacyVault account",
    content: `Someone signed in from ${describe(activity)}. If that was you, nothing to do. If it was not, change your password and review your active sessions in the Security Center.`,
    channel: "BOTH",
    metadata: { ...activity },
  });
  await jobRepository.enqueue(
    db,
    "notification.deliver",
    { notificationId },
    `notification.deliver:${notificationId}`,
  );
};
