import "server-only";

import { clerkClient } from "@clerk/nextjs/server";

import { ApiError } from "@/lib/api/errors";
import { audit } from "@/lib/audit/audit.service";
import type { AppUser } from "@/lib/auth/ensure-app-user";
import { createServiceClient } from "@/lib/db/server";
import { logger } from "@/lib/observability/logger";
import * as adminRepository from "@/lib/repositories/admin.repository";
import * as notificationRepository from "@/lib/repositories/notification.repository";
import * as jobRepository from "@/lib/repositories/job.repository";
import type {
  AdminAnalytics,
  AdminOperations,
  AdminUserDetail,
  AdminUserListResult,
  UserRole,
} from "@/lib/types/admin";
import type { ActivityListResult } from "@/lib/types/activity";

/**
 * Platform operations (FR-P001–P012).
 *
 * Two rules shape everything here. First, **an operator runs the platform, not
 * the vaults**: these functions return counts, states and timestamps, and there
 * is no path from any of them to plan content, asset values, document bytes, an
 * encrypted field or an access-link secret. Second, **every privileged action
 * is audited with the admin as the actor**, including the ones that ultimately
 * happen inside Clerk.
 *
 * The role guard itself is the route's `auth: "admin"`; these functions assume
 * it has run and re-check only the rules it cannot express.
 */
export async function listUsers(
  admin: AppUser,
  query: { q?: string; page: number; limit: number },
): Promise<AdminUserListResult> {
  const { rows, total } = await adminRepository.listUsers(createServiceClient(), {
    search: query.q,
    page: query.page,
    limit: query.limit,
  });
  // FR-P011: every admin action is in the trail, reads included — the search
  // term is recorded, the results are not.
  await trail(admin, "admin.users_listed", "users", null, {
    search: query.q ?? null,
    returned: rows.length,
  });
  return { items: rows, total, page: query.page, limit: query.limit };
}

export async function getUser(admin: AppUser, id: string): Promise<AdminUserDetail> {
  const db = createServiceClient();
  const user = await adminRepository.findUser(db, id);
  if (!user) throw ApiError.notFound();

  const [counts, deadManSwitch, activity] = await Promise.all([
    adminRepository.countsFor(db, id),
    adminRepository.switchFor(db, id),
    adminRepository.listAudit(db, { actorId: id, page: 1, limit: 20 }),
  ]);

  // Reading a support case is itself a privileged act and is recorded as one.
  await trail(admin, "admin.user_viewed", "users", id, { subjectEmail: user.email });

  return {
    ...user,
    counts: {
      beneficiaries: counts.beneficiaries,
      assets: counts.assets,
      documents: counts.documents,
      videos: counts.videos,
      legacyPlans: counts.legacyPlans,
      accessTokensLive: counts.accessTokensLive,
    },
    deadManSwitch,
    recentActivity: activity.rows,
  };
}

export async function listAudit(
  admin: AppUser,
  query: { actorId?: string; action?: string; outcome?: string; page: number; limit: number },
): Promise<ActivityListResult> {
  const { rows, total } = await adminRepository.listAudit(createServiceClient(), query);
  await trail(admin, "admin.audit_viewed", "audit_log", null, {
    actorId: query.actorId ?? null,
    action: query.action ?? null,
    outcome: query.outcome ?? null,
  });
  return { items: rows, total, page: query.page, limit: query.limit };
}

export async function analytics(admin: AppUser, days: number): Promise<AdminAnalytics> {
  const result = await adminRepository.analytics(createServiceClient(), new Date(), days);
  await trail(admin, "admin.analytics_viewed", "users", null, { days });
  return result;
}

export async function operations(admin: AppUser): Promise<AdminOperations> {
  const result = await adminRepository.operations(createServiceClient());
  await trail(admin, "admin.operations_viewed", "job", null, {
    deadJobs: result.deadJobs.length,
    undeliveredTokens: result.undeliveredTokens.length,
  });
  return result;
}

/** One audit row per operator action, with the admin as the actor (FR-P011). */
async function trail(
  admin: AppUser,
  action: string,
  resourceType: string,
  resourceId: string | null,
  metadata: Record<string, unknown>,
): Promise<void> {
  await audit.log({
    actorId: admin.id,
    actorRole: admin.role,
    action,
    resourceType,
    resourceId,
    outcome: "SUCCESS",
    metadata,
  });
}

/**
 * Changes a role (FR-P004).
 *
 * `users.role` is the authorization source of truth and is refused to the
 * `authenticated` role by `protect_identity_columns`, so this is a service-role
 * write. An admin may not change their own role: losing the last operator to a
 * mis-click, or self-promoting, are both failure modes worth one extra rule.
 */
export async function setRole(
  admin: AppUser,
  id: string,
  role: UserRole,
  correlationId: string,
): Promise<AdminUserDetail> {
  if (id === admin.id) {
    throw new ApiError(422, "VALIDATION_ERROR", "You cannot change your own role.");
  }

  const db = createServiceClient();
  const subject = await adminRepository.findUser(db, id);
  if (!subject) throw ApiError.notFound();

  if (subject.role === "SUPER_ADMIN" && role === "USER") {
    const remaining = await adminRepository.listUsers(db, { page: 1, limit: 1000 });
    const admins = remaining.rows.filter(
      (row) => row.role === "SUPER_ADMIN" && !row.deletedAt && row.id !== id,
    );
    if (admins.length === 0) {
      throw new ApiError(
        409,
        "CONFLICT",
        "This is the last Super Admin — promote someone else first.",
      );
    }
  }

  const { error } = await db.from("users").update({ role }).eq("id", id);
  if (error) throw error;

  await audit.log({
    actorId: admin.id,
    actorRole: admin.role,
    action: "admin.role_changed",
    resourceType: "users",
    resourceId: id,
    outcome: "SUCCESS",
    metadata: { from: subject.role, to: role, subjectEmail: subject.email },
    correlationId,
  });

  await notify(
    db,
    id,
    "admin.role_changed",
    "Your LegacyVault role changed",
    `An administrator changed your role to ${role === "SUPER_ADMIN" ? "Super Admin" : "User"}.`,
  );

  return getUser(admin, id);
}

/** Support operation: lift a Clerk lockout (FR-P007). */
export async function unlockUser(
  admin: AppUser,
  id: string,
  correlationId: string,
): Promise<{ unlocked: true }> {
  const db = createServiceClient();
  const subject = await adminRepository.findUser(db, id);
  if (!subject) throw ApiError.notFound();

  try {
    const clerk = await clerkClient();
    await clerk.users.unlockUser(subject.clerkUserId);
  } catch (cause) {
    logger.error({ err: cause, subjectId: id }, "admin unlock failed");
    await audit.log({
      actorId: admin.id,
      actorRole: admin.role,
      action: "admin.user_unlocked",
      resourceType: "users",
      resourceId: id,
      outcome: "FAILURE",
      metadata: { reason: "clerk_unavailable" },
      correlationId,
    });
    throw new ApiError(503, "SERVICE_UNAVAILABLE", "The identity provider did not respond.");
  }

  await audit.log({
    actorId: admin.id,
    actorRole: admin.role,
    action: "admin.user_unlocked",
    resourceType: "users",
    resourceId: id,
    outcome: "SUCCESS",
    metadata: { subjectEmail: subject.email },
    correlationId,
  });
  return { unlocked: true };
}

/**
 * Support operation: clear a user's second factors (FR-P007).
 *
 * This lowers someone's account security, so it is re-verified at the route,
 * audited here, and — importantly — the user is told it happened.
 */
export async function resetMfa(
  admin: AppUser,
  id: string,
  correlationId: string,
): Promise<{ reset: true }> {
  const db = createServiceClient();
  const subject = await adminRepository.findUser(db, id);
  if (!subject) throw ApiError.notFound();

  try {
    const clerk = await clerkClient();
    await clerk.users.disableUserMFA(subject.clerkUserId);
  } catch (cause) {
    logger.error({ err: cause, subjectId: id }, "admin MFA reset failed");
    await audit.log({
      actorId: admin.id,
      actorRole: admin.role,
      action: "admin.mfa_reset",
      resourceType: "users",
      resourceId: id,
      outcome: "FAILURE",
      metadata: { reason: "clerk_unavailable" },
      correlationId,
    });
    throw new ApiError(503, "SERVICE_UNAVAILABLE", "The identity provider did not respond.");
  }

  const { error } = await db.from("users").update({ mfa_enabled: false }).eq("id", id);
  if (error) throw error;

  await audit.log({
    actorId: admin.id,
    actorRole: admin.role,
    action: "admin.mfa_reset",
    resourceType: "users",
    resourceId: id,
    outcome: "SUCCESS",
    metadata: { subjectEmail: subject.email },
    correlationId,
  });

  await notify(
    db,
    id,
    "security.mfa_reset",
    "Two-factor authentication was reset",
    "An administrator reset the two-factor authentication on your LegacyVault account. If you did not ask for this, contact support immediately and set it up again.",
  );

  return { reset: true };
}

/**
 * Recovery for a link that was minted but never delivered (ADR-014 § 6).
 *
 * This does not resend the old secret — it cannot, because the plaintext was
 * never stored. It queues another delivery run, which revokes the undelivered
 * token and mints exactly one replacement.
 */
export async function resendAccessToken(
  admin: AppUser,
  tokenId: string,
  correlationId: string,
): Promise<{ queued: boolean }> {
  const db = createServiceClient();
  const { data: token, error } = await db
    .from("access_tokens")
    .select(
      "id, grant_type, beneficiary_id, owner_user_id, dead_man_switch_id, emergency_request_id, revoked_at",
    )
    .eq("id", tokenId)
    .maybeSingle();
  if (error) throw error;
  if (!token) throw ApiError.notFound();
  if (token.grant_type === "DIRECT_SHARE") {
    throw new ApiError(
      422,
      "VALIDATION_ERROR",
      "Direct shares are resent by their owner, not by an operator.",
    );
  }

  const source =
    token.grant_type === "DMS_RELEASE"
      ? await releaseEventFor(db, token.dead_man_switch_id)
      : token.emergency_request_id;
  if (!source) throw ApiError.notFound("The grant behind this link no longer exists.");

  const { data: jobId, error: enqueueError } = await db.rpc("lv_enqueue_access_delivery", {
    p_grant: token.grant_type,
    p_source: source,
    p_beneficiary: token.beneficiary_id,
    p_payload:
      token.grant_type === "DMS_RELEASE"
        ? ({ switchId: token.dead_man_switch_id, releaseEventId: source } as never)
        : ({ requestId: token.emergency_request_id } as never),
    p_resend: true,
  });
  if (enqueueError) throw enqueueError;

  await audit.log({
    actorId: admin.id,
    actorRole: admin.role,
    action: "admin.access_token_resent",
    resourceType: "access_token",
    resourceId: tokenId,
    outcome: "SUCCESS",
    metadata: { grantType: token.grant_type, ownerUserId: token.owner_user_id, jobId },
    correlationId,
  });
  return { queued: jobId !== null };
}

/** The RELEASE event a DMS grant hangs off, which is its delivery source id. */
async function releaseEventFor(
  db: ReturnType<typeof createServiceClient>,
  switchId: string | null,
): Promise<string | null> {
  if (!switchId) return null;
  const { data, error } = await db
    .from("dead_man_switch_events")
    .select("id")
    .eq("dead_man_switch_id", switchId)
    .eq("event_type", "RELEASE")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data?.id ?? null;
}

/** Tells the affected user what an operator did to their account. */
async function notify(
  db: ReturnType<typeof createServiceClient>,
  userId: string,
  type: string,
  title: string,
  content: string,
): Promise<void> {
  try {
    const notificationId = await notificationRepository.insertSystem(db, {
      userId,
      type,
      title,
      content,
      channel: "BOTH",
      metadata: { source: "admin" },
    });
    await jobRepository.enqueue(
      db,
      "notification.deliver",
      { notificationId },
      `notification.deliver:${notificationId}`,
    );
  } catch (cause) {
    // The operation itself already succeeded and is audited; failing to tell
    // the user must not roll it back, but it must be visible.
    logger.error({ err: cause, userId, type }, "admin notification failed");
  }
}
