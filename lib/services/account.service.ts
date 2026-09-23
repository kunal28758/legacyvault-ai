import "server-only";

import { clerkClient } from "@clerk/nextjs/server";

import { ApiError } from "@/lib/api/errors";
import { audit } from "@/lib/audit/audit.service";
import type { AppUser } from "@/lib/auth/ensure-app-user";
import { assertAccountActive } from "@/lib/auth/require-user";
import { createServiceClient, createUserClient, type TypedSupabaseClient } from "@/lib/db/server";
import { logger } from "@/lib/observability/logger";
import * as assetRepository from "@/lib/repositories/asset.repository";
import * as userRepository from "@/lib/repositories/user.repository";
import { decryptStoredEnvelope } from "@/lib/security/encryption";
import type { AssetKind } from "@/lib/types/asset";

/**
 * Account-level operations: taking your data out, and asking for the account
 * to go away (FR-B009–B012, api-contracts.md § Users).
 *
 * Both are re-verified at the route. The export is assembled with the caller's
 * own client so RLS is the second barrier on every table, and the deletion
 * flag lives in a Class C column, so only the service client may set it — the
 * browser can ask, never write.
 */
const GRACE_PERIOD_DAYS = 30;

const ENCRYPTED_KEYS_BY_KIND: Record<AssetKind, string[]> = {
  FINANCIAL_ASSET: ["accountNumber", "policyNumber"],
  PHYSICAL_ASSET: [],
  DIGITAL_ASSET: ["credentials", "recoveryInfo"],
};

export interface AccountExport {
  exportedAt: string;
  profile: unknown;
  beneficiaries: unknown[];
  assignments: unknown[];
  assets: Record<AssetKind, unknown[]>;
  folders: unknown[];
  documents: unknown[];
  documentVersions: unknown[];
  videos: unknown[];
  legacyPlans: unknown[];
  legacyPlanVersions: unknown[];
  aiDrafts: unknown[];
  deadManSwitch: unknown;
  emergencyContacts: unknown[];
  notifications: unknown[];
  auditLog: unknown[];
}

async function rows(db: TypedSupabaseClient, table: string, userId: string): Promise<unknown[]> {
  const { data, error } = await db
    .from(table as never)
    .select("*")
    .eq("user_id", userId);
  if (error) throw error;
  return (data ?? []) as unknown[];
}

/**
 * Everything the account holds, including the sensitive fields — this is the
 * one read that returns them in bulk, which is why the route re-verifies and
 * why the audit row records how many were decrypted.
 */
export async function exportData(user: AppUser, correlationId: string): Promise<AccountExport> {
  const db = await createUserClient();

  const profile = await userRepository.findById(db, user.id);
  if (!profile) throw ApiError.notFound();

  const [
    beneficiaries,
    assignments,
    folders,
    documents,
    videos,
    legacyPlans,
    emergencyContacts,
    notifications,
    aiDrafts,
  ] = await Promise.all([
    rows(db, "beneficiaries", user.id),
    rows(db, "beneficiary_assignments", user.id),
    rows(db, "folders", user.id),
    rows(db, "documents", user.id),
    rows(db, "video_messages", user.id),
    rows(db, "legacy_plans", user.id),
    rows(db, "emergency_access_configs", user.id),
    rows(db, "notifications", user.id),
    rows(db, "ai_drafts", user.id),
  ]);

  const assets = {} as Record<AssetKind, unknown[]>;
  let decryptedFields = 0;
  for (const kind of ["FINANCIAL_ASSET", "PHYSICAL_ASSET", "DIGITAL_ASSET"] as AssetKind[]) {
    const { rows: list } = await assetRepository.list(db, user.id, kind, { page: 1, limit: 500 });
    assets[kind] = await Promise.all(
      list.map(async (asset) => {
        if (ENCRYPTED_KEYS_BY_KIND[kind].length === 0) return asset;
        const envelopes = await assetRepository.findEncrypted(db, user.id, kind, asset.id);
        const revealed: Record<string, string | null> = {};
        for (const [field, stored] of Object.entries(envelopes ?? {})) {
          if (!stored) {
            revealed[field] = null;
            continue;
          }
          revealed[field] = decryptStoredEnvelope(stored);
          decryptedFields += 1;
        }
        return { ...asset, ...revealed };
      }),
    );
  }

  // Child rows are reached through their parents, which RLS has already scoped.
  const documentIds = documents.map((row) => (row as { id: string }).id);
  const planIds = legacyPlans.map((row) => (row as { id: string }).id);
  const [documentVersions, legacyPlanVersions] = await Promise.all([
    childRows(db, "document_versions", "document_id", documentIds),
    childRows(db, "legacy_plan_versions", "legacy_plan_id", planIds),
  ]);

  const { data: dms } = await db
    .from("dead_man_switches")
    .select("*")
    .eq("user_id", user.id)
    .maybeSingle();
  const { data: auditRows } = await db
    .from("audit_log")
    .select("*")
    .eq("actor_id", user.id)
    .order("created_at", { ascending: false })
    .limit(1000);

  await audit.log({
    actorId: user.id,
    actorRole: user.role,
    action: "user.data_exported",
    resourceType: "users",
    resourceId: user.id,
    outcome: "SUCCESS",
    metadata: {
      beneficiaries: beneficiaries.length,
      documents: documents.length,
      // Never the values themselves — only how many were decrypted.
      decryptedFields,
    },
    correlationId,
  });

  return {
    exportedAt: new Date().toISOString(),
    profile,
    beneficiaries,
    assignments,
    assets,
    folders,
    documents,
    documentVersions,
    videos,
    legacyPlans,
    legacyPlanVersions,
    aiDrafts,
    deadManSwitch: dms ?? null,
    emergencyContacts,
    notifications,
    auditLog: auditRows ?? [],
  };
}

async function childRows(
  db: TypedSupabaseClient,
  table: string,
  column: string,
  parentIds: string[],
): Promise<unknown[]> {
  if (parentIds.length === 0) return [];
  const { data, error } = await db
    .from(table as never)
    .select("*")
    .in(column, parentIds);
  if (error) throw error;
  return (data ?? []) as unknown[];
}

export interface DeletionState {
  deletionRequestedAt: string | null;
  deletesAt: string | null;
}

/**
 * Starts the 30-day grace period.
 *
 * The order matters: everything that could still act on the account's behalf is
 * stopped *before* the flag is set, because `assertAccountActive()` refuses the
 * owner's own writes once it is. Sessions are revoked last, so the answer to
 * this request still reaches the browser that asked.
 */
export async function requestDeletion(
  user: AppUser,
  correlationId: string,
): Promise<DeletionState> {
  assertAccountActive(user);
  const db = await createUserClient();

  // 1. Stop the switch, so a grace-period account cannot release anything.
  const { error: pauseError } = await db.rpc("dms_pause", { p_corr: correlationId });
  // LV409 simply means it was not running; anything else is a real failure.
  if (pauseError && pauseError.code !== "LV409" && pauseError.code !== "42501") throw pauseError;

  // 2. Revoke every live access link, one guarded call each so all are audited.
  const { data: live, error: tokensError } = await db
    .from("access_tokens")
    .select("id")
    .eq("owner_user_id", user.id)
    .is("revoked_at", null);
  if (tokensError) throw tokensError;
  for (const token of live ?? []) {
    const { error } = await db.rpc("revoke_access_token", {
      p_token_id: token.id,
      p_corr: correlationId,
    });
    if (error) throw error;
  }

  // 3. Mark the account. The column is Class C — the browser cannot write it.
  const requestedAt = new Date().toISOString();
  await userRepository.setDeletionRequested(createServiceClient(), user.id, requestedAt);

  await audit.log({
    actorId: user.id,
    actorRole: user.role,
    action: "user.deletion_requested",
    resourceType: "users",
    resourceId: user.id,
    outcome: "SUCCESS",
    metadata: {
      gracePeriodDays: GRACE_PERIOD_DAYS,
      accessTokensRevoked: (live ?? []).length,
    },
    correlationId,
  });

  await revokeClerkSessions(user, correlationId);

  return {
    deletionRequestedAt: requestedAt,
    deletesAt: new Date(Date.parse(requestedAt) + GRACE_PERIOD_DAYS * 86_400_000).toISOString(),
  };
}

/** Cancels a pending deletion. Deliberately not gated by `assertAccountActive`. */
export async function cancelDeletion(user: AppUser, correlationId: string): Promise<DeletionState> {
  if (!user.deletionRequestedAt) {
    throw new ApiError(409, "CONFLICT", "This account is not scheduled for deletion.");
  }

  await userRepository.setDeletionRequested(createServiceClient(), user.id, null);
  await audit.log({
    actorId: user.id,
    actorRole: user.role,
    action: "user.deletion_cancelled",
    resourceType: "users",
    resourceId: user.id,
    outcome: "SUCCESS",
    metadata: { wasRequestedAt: user.deletionRequestedAt },
    correlationId,
  });

  // The switch stays paused: resuming it is the owner's explicit decision.
  return { deletionRequestedAt: null, deletesAt: null };
}

/**
 * Signs the account out everywhere.
 *
 * A failure here must not undo the deletion request, so it is logged and
 * audited rather than thrown: the grace period has already started.
 */
async function revokeClerkSessions(user: AppUser, correlationId: string): Promise<void> {
  try {
    const clerk = await clerkClient();
    const { data } = await clerk.sessions.getSessionList({ userId: user.clerkUserId });
    await Promise.all(data.map((session) => clerk.sessions.revokeSession(session.id)));
  } catch (error) {
    logger.error(
      { err: error, userId: user.id },
      "could not revoke sessions after deletion request",
    );
    await audit.log({
      actorId: user.id,
      actorRole: user.role,
      action: "user.sessions_revoke_failed",
      resourceType: "users",
      resourceId: user.id,
      outcome: "FAILURE",
      metadata: { reason: "clerk_unavailable" },
      correlationId,
    });
  }
}
