import "server-only";

import { isClerkAPIResponseError } from "@clerk/nextjs/errors";
import { clerkClient } from "@clerk/nextjs/server";

import { ApiError } from "@/lib/api/errors";
import { audit } from "@/lib/audit/audit.service";
import type { AppUser } from "@/lib/auth/ensure-app-user";
import { assertAccountActive } from "@/lib/auth/require-user";
import { createServiceClient, createUserClient, type TypedSupabaseClient } from "@/lib/db/server";
import { logger } from "@/lib/observability/logger";
import * as assetRepository from "@/lib/repositories/asset.repository";
import * as userRepository from "@/lib/repositories/user.repository";
import { decrypt, decryptStoredEnvelope, isEncryptionEnvelope } from "@/lib/security/encryption";
import type { Asset, AssetKind } from "@/lib/types/asset";
import type { Database, Tables } from "@/lib/types/database";
import { ACCOUNT_DELETION_GRACE_DAYS } from "@/lib/validators/user.validators";

/**
 * Account-level operations: taking your data out, and asking for the account
 * to go away (FR-B009–B012, api-contracts.md § Users).
 *
 * All are re-verified at the route. The export is assembled with the caller's
 * own client so RLS is the second barrier on every table, and the deletion
 * columns are Class C, so only the service client may set them — the browser
 * can ask, never write.
 *
 * Deletion has two entry points and one end: scheduling starts a 30-day grace
 * period that housekeeping later turns into a deletion, while deleting now
 * skips it. Both go through begin_account_deletion() (0012) and finish with
 * purgeAccount().
 */

const ENCRYPTED_KEYS_BY_KIND: Record<AssetKind, string[]> = {
  FINANCIAL_ASSET: ["accountNumber", "policyNumber"],
  PHYSICAL_ASSET: [],
  DIGITAL_ASSET: ["credentials", "recoveryInfo"],
};

/** An asset with its encrypted fields decrypted (absent when the kind has none). */
export type ExportedAsset = Asset &
  Partial<Record<"accountNumber" | "policyNumber" | "credentials" | "recoveryInfo", string | null>>;

export type ExportFormat = "json" | "xlsx" | "csv";

/** A deleted asset still inside its retention window: plain columns only. */
export interface DeletedAsset {
  kind: AssetKind;
  id: string;
  name: string;
  category: string;
  deleted_at: string;
}

/** One stored AI document analysis, decrypted. */
export interface ExportedAnalysis {
  draftId: string;
  documentId: string | null;
  versionNumber: number;
  createdAt: string;
  createdBy: string;
  provider: string | null;
  model: string | null;
  action: string | null;
  language: string | null;
  data: unknown;
}

// The owner may read every column of these two tables except the secret
// hashes (0002 § 4 column grants), so they are named rather than `*`.
const ACCESS_LINK_COLUMNS =
  "id, beneficiary_id, grant_type, scope, expires_at, revoked_at, revoked_reason, delivered_at, used_at, last_used_at, created_at, verified_at";
const EMERGENCY_REQUEST_COLUMNS =
  "id, config_id, requester_email, status, request_expires_at, decided_by, decided_at, granted_at, expires_at, revoked_at, revoked_by, created_at";

export type ExportedAccessLink = Pick<
  Tables<"access_tokens">,
  | "id"
  | "beneficiary_id"
  | "grant_type"
  | "scope"
  | "expires_at"
  | "revoked_at"
  | "revoked_reason"
  | "delivered_at"
  | "used_at"
  | "last_used_at"
  | "created_at"
  | "verified_at"
>;
export type ExportedEmergencyRequest = Pick<
  Tables<"emergency_access_requests">,
  | "id"
  | "config_id"
  | "requester_email"
  | "status"
  | "request_expires_at"
  | "decided_by"
  | "decided_at"
  | "granted_at"
  | "expires_at"
  | "revoked_at"
  | "revoked_by"
  | "created_at"
>;

export interface AccountExport {
  exportedAt: string;
  profile: userRepository.UserProfile;
  beneficiaries: Tables<"beneficiaries">[];
  assignments: Tables<"beneficiary_assignments">[];
  assets: Record<AssetKind, ExportedAsset[]>;
  deletedAssets: DeletedAsset[];
  folders: Tables<"folders">[];
  documents: Tables<"documents">[];
  documentVersions: Tables<"document_versions">[];
  documentAttachments: Tables<"document_attachments">[];
  videos: Tables<"video_messages">[];
  legacyPlans: Tables<"legacy_plans">[];
  legacyPlanVersions: Tables<"legacy_plan_versions">[];
  aiDrafts: Tables<"ai_drafts">[];
  aiAnalyses: ExportedAnalysis[];
  aiInteractions: Tables<"ai_interactions">[];
  deadManSwitch: Tables<"dead_man_switches"> | null;
  deadManSwitchContacts: Tables<"dead_man_switch_contacts">[];
  deadManSwitchEvents: Tables<"dead_man_switch_events">[];
  emergencyContacts: Tables<"emergency_access_configs">[];
  emergencyRequests: ExportedEmergencyRequest[];
  accessLinks: ExportedAccessLink[];
  notifications: Tables<"notifications">[];
  auditLog: Tables<"audit_log">[];
}

type TableName = keyof Database["public"]["Tables"];

// PostgREST returns at most `max_rows` (1,000) rows per request, silently, so
// every list is read in pages until a short page comes back.
const PAGE = 1000;

async function all<T>(
  page: (from: number, to: number) => PromiseLike<{ data: unknown; error: unknown }>,
): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await page(from, from + PAGE - 1);
    if (error) throw error;
    const batch = (data ?? []) as T[];
    out.push(...batch);
    if (batch.length < PAGE) return out;
  }
}

function rows<T extends TableName>(
  db: TypedSupabaseClient,
  table: T,
  column: string,
  value: string,
  columns = "*",
): Promise<Tables<T>[]> {
  return all<Tables<T>>((from, to) =>
    db
      .from(table as never)
      .select(columns)
      .eq(column, value)
      .order("created_at")
      .order("id")
      .range(from, to),
  );
}

/** Child rows, reached through parents RLS has already scoped; ids sent in chunks. */
async function childRows<T extends TableName>(
  db: TypedSupabaseClient,
  table: T,
  column: string,
  parentIds: string[],
  columns = "*",
  tiebreak = "id",
): Promise<Tables<T>[]> {
  const out: Tables<T>[] = [];
  for (let i = 0; i < parentIds.length; i += 100) {
    const ids = parentIds.slice(i, i + 100);
    out.push(
      ...(await all<Tables<T>>((from, to) =>
        db
          .from(table as never)
          .select(columns)
          .in(column, ids)
          .order("created_at")
          .order(tiebreak)
          .range(from, to),
      )),
    );
  }
  return out;
}

const ASSET_TABLES = {
  FINANCIAL_ASSET: "financial_assets",
  PHYSICAL_ASSET: "physical_assets",
  DIGITAL_ASSET: "digital_assets",
} as const;

/**
 * Everything the account holds, including the sensitive fields — this is the
 * one read that returns them in bulk, which is why the route re-verifies and
 * why the audit row records how many were decrypted.
 *
 * Left out by design: file contents (documents and videos are listed),
 * `users.identification_details` (write-only; no read path exists), and the
 * secret hashes of access links and emergency requests (no column grant).
 */
export async function exportData(
  user: AppUser,
  correlationId: string,
  format: ExportFormat = "json",
): Promise<AccountExport> {
  const db = await createUserClient();

  const profile = await userRepository.findById(db, user.id);
  if (!profile) throw ApiError.notFound();

  const [
    beneficiaries,
    assignments,
    folders,
    documents,
    documentAttachments,
    videos,
    legacyPlans,
    emergencyContacts,
    notifications,
    aiDrafts,
    aiInteractions,
    accessLinks,
    auditLog,
  ] = await Promise.all([
    rows(db, "beneficiaries", "user_id", user.id),
    rows(db, "beneficiary_assignments", "user_id", user.id),
    rows(db, "folders", "user_id", user.id),
    rows(db, "documents", "user_id", user.id),
    rows(db, "document_attachments", "user_id", user.id),
    rows(db, "video_messages", "user_id", user.id),
    rows(db, "legacy_plans", "user_id", user.id),
    rows(db, "emergency_access_configs", "user_id", user.id),
    rows(db, "notifications", "user_id", user.id),
    rows(db, "ai_drafts", "user_id", user.id),
    rows(db, "ai_interactions", "user_id", user.id),
    rows(db, "access_tokens", "owner_user_id", user.id, ACCESS_LINK_COLUMNS),
    rows(db, "audit_log", "actor_id", user.id),
  ]);

  const assets = {} as Record<AssetKind, ExportedAsset[]>;
  const deletedAssets: DeletedAsset[] = [];
  let decryptedFields = 0;
  for (const kind of ["FINANCIAL_ASSET", "PHYSICAL_ASSET", "DIGITAL_ASSET"] as AssetKind[]) {
    const list: Asset[] = [];
    for (let page = 1; ; page++) {
      const batch = await assetRepository.list(db, user.id, kind, { page, limit: 500 });
      list.push(...batch.rows);
      if (batch.rows.length === 0 || list.length >= batch.total) break;
    }
    assets[kind] = await Promise.all(
      list.map(async (asset): Promise<ExportedAsset> => {
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
    const removed = await all<{ id: string; name: string; category: string; deleted_at: string }>(
      (from, to) =>
        db
          .from(ASSET_TABLES[kind])
          .select("id, name, category, deleted_at")
          .eq("user_id", user.id)
          .not("deleted_at", "is", null)
          .order("deleted_at")
          .range(from, to),
    );
    deletedAssets.push(...removed.map((row) => ({ kind, ...row })));
  }

  const { data: dms, error: dmsError } = await db
    .from("dead_man_switches")
    .select("*")
    .eq("user_id", user.id)
    .maybeSingle();
  if (dmsError) throw dmsError;

  const dmsIds = dms ? [dms.id] : [];
  const [
    documentVersions,
    legacyPlanVersions,
    aiVersions,
    deadManSwitchContacts,
    deadManSwitchEvents,
    emergencyRequests,
  ] = await Promise.all([
    childRows(
      db,
      "document_versions",
      "document_id",
      documents.map((row) => row.id),
    ),
    childRows(
      db,
      "legacy_plan_versions",
      "legacy_plan_id",
      legacyPlans.map((row) => row.id),
    ),
    childRows(
      db,
      "ai_draft_versions",
      "draft_id",
      aiDrafts.map((row) => row.id),
    ),
    childRows(db, "dead_man_switch_contacts", "dead_man_switch_id", dmsIds, "*", "beneficiary_id"),
    childRows(db, "dead_man_switch_events", "dead_man_switch_id", dmsIds),
    childRows(
      db,
      "emergency_access_requests",
      "config_id",
      emergencyContacts.map((row) => row.id),
      EMERGENCY_REQUEST_COLUMNS,
    ),
  ]);

  // Stored analyses are application-encrypted envelopes (ADR-016).
  const draftDocument = new Map(aiDrafts.map((row) => [row.id, row.source_document_id]));
  const aiAnalyses = aiVersions.map((version): ExportedAnalysis => {
    let stored: { payload?: { action?: string; data?: unknown }; language?: string | null } = {};
    if (isEncryptionEnvelope(version.content)) {
      try {
        stored = JSON.parse(decrypt(version.content)) as typeof stored;
        decryptedFields += 1;
      } catch (cause) {
        logger.error({ err: cause, versionId: version.id }, "export: analysis not decryptable");
      }
    }
    return {
      draftId: version.draft_id,
      documentId: draftDocument.get(version.draft_id) ?? null,
      versionNumber: version.version_number,
      createdAt: version.created_at,
      createdBy: version.created_by,
      provider: version.provider,
      model: version.model,
      action: stored.payload?.action ?? null,
      language: stored.language ?? null,
      data: stored.payload?.data ?? null,
    };
  });

  await audit.log({
    actorId: user.id,
    actorRole: user.role,
    action: "user.data_exported",
    resourceType: "users",
    resourceId: user.id,
    outcome: "SUCCESS",
    metadata: {
      format,
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
    deletedAssets,
    folders,
    documents,
    documentVersions,
    documentAttachments,
    videos,
    legacyPlans,
    legacyPlanVersions,
    aiDrafts,
    aiAnalyses,
    aiInteractions,
    deadManSwitch: dms ?? null,
    deadManSwitchContacts,
    deadManSwitchEvents,
    emergencyContacts,
    emergencyRequests: emergencyRequests as unknown as ExportedEmergencyRequest[],
    accessLinks: accessLinks as unknown as ExportedAccessLink[],
    notifications,
    auditLog,
  };
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
  //    A concurrent duplicate loses the compare-and-set and keeps the first date.
  const requestedAt = new Date().toISOString();
  if (!(await userRepository.setDeletionRequested(createServiceClient(), user.id, requestedAt))) {
    throw ApiError.conflict("CONFLICT", "This account is already scheduled for deletion.");
  }

  await audit.log({
    actorId: user.id,
    actorRole: user.role,
    action: "user.deletion_requested",
    resourceType: "users",
    resourceId: user.id,
    outcome: "SUCCESS",
    metadata: {
      gracePeriodDays: ACCOUNT_DELETION_GRACE_DAYS,
      accessTokensRevoked: (live ?? []).length,
    },
    correlationId,
  });

  await revokeClerkSessions(user, correlationId);

  return {
    deletionRequestedAt: requestedAt,
    deletesAt: new Date(
      Date.parse(requestedAt) + ACCOUNT_DELETION_GRACE_DAYS * 86_400_000,
    ).toISOString(),
  };
}

/** Cancels a pending deletion. Deliberately not gated by `assertAccountActive`. */
export async function cancelDeletion(user: AppUser, correlationId: string): Promise<DeletionState> {
  if (!user.deletionRequestedAt) {
    throw new ApiError(409, "CONFLICT", "This account is not scheduled for deletion.");
  }

  // Loses to a deletion that has already begun: the account stays deleted.
  if (!(await userRepository.setDeletionRequested(createServiceClient(), user.id, null))) {
    throw new ApiError(409, "CONFLICT", "This account is not scheduled for deletion.");
  }
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

export interface ImmediateDeletionResult {
  /**
   * DELETED — storage, the Clerk identity and every domain row are gone.
   * CLEANUP_PENDING — access is already closed and the rest is queued; the
   * `user.hard-delete` job retries until it completes.
   */
  status: "DELETED" | "CLEANUP_PENDING";
}

/**
 * Deletes the account permanently, now — no grace period.
 *
 * Allowed from the grace period too (bringing a scheduled deletion forward);
 * nothing can turn it back into a scheduled one, because once the account is
 * marked deleted requireUser() refuses every request it makes.
 *
 * 1. begin_account_deletion() closes access and queues the hard delete in one
 *    transaction, so nothing after it can leave the account half-open.
 * 2. Sessions are revoked, so signed-in devices are signed out.
 * 3. The hard delete runs inline, so the answer can say it is done. If any
 *    step fails, the queued job finishes it and the answer says so.
 */
export async function deleteAccountNow(
  user: AppUser,
  correlationId: string,
): Promise<ImmediateDeletionResult> {
  const db = createServiceClient();
  // False means a concurrent request began it first; the purge is idempotent.
  const { error } = await db.rpc("begin_account_deletion", {
    p_user_id: user.id,
    p_corr: correlationId,
  });
  if (error) throw error;

  await revokeClerkSessions(user, correlationId);

  try {
    await purgeAccount(db, user.id, user.clerkUserId);
    return { status: "DELETED" };
  } catch (cause) {
    logger.error({ err: cause, userId: user.id }, "account purge deferred to the job queue");
    return { status: "CLEANUP_PENDING" };
  }
}

/** Buckets that may hold an account's objects; `quarantine` only from before 0006. */
const PURGE_BUCKETS = ["documents", "videos", "quarantine"] as const;
const LIST_PAGE = 1000;
const REMOVE_BATCH = 100;
const ID_CHUNK = 100;
const SAFE_PREFIX = /^[A-Za-z0-9_-]{8,}$/;

/**
 * The hard delete (T189): private storage, then the Clerk identity, then the
 * `users` row, whose foreign keys cascade to every domain table. `audit_log`
 * has no foreign key to `users` and is kept.
 *
 * Every step is idempotent — a missing object, an already-deleted Clerk user
 * and an already-deleted row are all the desired end state — so the
 * `user.hard-delete` job simply runs it again until it completes. The order
 * makes a partial run safe to stop anywhere: the row, which is what marks the
 * account deleted and blocks it, goes last; and the Clerk identity goes
 * before it, so a person can never sign in again to an account that has no
 * row (which would provision a fresh one).
 *
 * It refuses an account that is not marked deleted: only
 * begin_account_deletion() starts this.
 */
export async function purgeAccount(
  db: TypedSupabaseClient,
  userId: string,
  clerkUserId: string,
): Promise<{ objectsRemoved: number; rowDeleted: boolean }> {
  // Both become storage folder names below. An empty or path-like value would
  // list the bucket root — every account's folder — so it is refused outright.
  if (![userId, clerkUserId].every((prefix) => SAFE_PREFIX.test(prefix))) {
    throw new Error("refusing to purge: unsafe account identifier");
  }
  const { data: row, error: rowError } = await db
    .from("users")
    .select("clerk_user_id, deleted_at")
    .eq("id", userId)
    .maybeSingle();
  if (rowError) throw rowError;
  if (row && (!row.deleted_at || row.clerk_user_id !== clerkUserId)) {
    throw new Error("refusing to purge: the account is not marked deleted or the identity differs");
  }

  const objectsRemoved = await removeAccountObjects(db, userId, clerkUserId);

  try {
    const clerk = await clerkClient();
    await clerk.users.deleteUser(clerkUserId);
  } catch (cause) {
    if (!(isClerkAPIResponseError(cause) && cause.status === 404)) throw cause;
  }

  // `document_versions.uploaded_by` has no ON DELETE action, so the account's
  // documents (and with them their versions) go first; the row then cascades.
  const { error: documentsError } = await db.from("documents").delete().eq("user_id", userId);
  if (documentsError) throw documentsError;

  const { data: deleted, error: deleteError } = await db
    .from("users")
    .delete()
    .eq("id", userId)
    .not("deleted_at", "is", null)
    .select("id");
  if (deleteError) throw deleteError;
  const rowDeleted = (deleted ?? []).length > 0;

  if (rowDeleted || objectsRemoved > 0) {
    const { error: auditError } = await db.from("audit_log").insert({
      actor_id: userId,
      action: "user.purged",
      resource_type: "users",
      resource_id: userId,
      outcome: "SUCCESS",
      metadata: { objectsRemoved, rowDeleted } as never,
    });
    if (auditError) throw auditError;
  }
  return { objectsRemoved, rowDeleted };
}

/**
 * Removes every object the account owns: those its rows point at, and
 * everything under its prefixes — keys are `<userId>/<uploadId>`
 * (uploadObjectKey), and the retired quarantine bucket used the Clerk subject.
 * The prefixes are listed again afterwards, and anything still there fails the
 * run, so the job is retried instead of reporting a deletion that did not
 * happen.
 */
async function removeAccountObjects(
  db: TypedSupabaseClient,
  userId: string,
  clerkUserId: string,
): Promise<number> {
  const keys = new Map<string, Set<string>>(PURGE_BUCKETS.map((bucket) => [bucket, new Set()]));
  const add = (bucket: string, key: string | null) => {
    if (!key) return;
    if (!keys.has(bucket)) keys.set(bucket, new Set());
    keys.get(bucket)?.add(key);
  };

  const [documents, videos] = await Promise.all([
    db.from("documents").select("id, storage_bucket, storage_key").eq("user_id", userId),
    db.from("video_messages").select("storage_bucket, storage_key").eq("user_id", userId),
  ]);
  if (documents.error) throw documents.error;
  if (videos.error) throw videos.error;
  const bucketOf = new Map((documents.data ?? []).map((doc) => [doc.id, doc.storage_bucket]));
  for (const doc of documents.data ?? []) add(doc.storage_bucket, doc.storage_key);
  for (const video of videos.data ?? []) add(video.storage_bucket, video.storage_key);
  // Chunked: every id travels in the request URL, which has a length limit.
  const documentIds = [...bucketOf.keys()];
  for (let index = 0; index < documentIds.length; index += ID_CHUNK) {
    const { data: versions, error } = await db
      .from("document_versions")
      .select("document_id, storage_key")
      .in("document_id", documentIds.slice(index, index + ID_CHUNK));
    if (error) throw error;
    for (const version of versions ?? []) {
      add(bucketOf.get(version.document_id) ?? "documents", version.storage_key);
    }
  }

  const prefixes = [userId, clerkUserId];
  for (const bucket of PURGE_BUCKETS) {
    for (const prefix of prefixes) {
      for (const key of await listObjects(db, bucket, prefix)) add(bucket, key);
    }
  }

  let removed = 0;
  for (const [bucket, set] of keys) {
    const list = [...set];
    for (let index = 0; index < list.length; index += REMOVE_BATCH) {
      const { data, error } = await db.storage
        .from(bucket)
        .remove(list.slice(index, index + REMOVE_BATCH));
      if (error) throw error;
      removed += data?.length ?? 0;
    }
  }

  for (const bucket of PURGE_BUCKETS) {
    for (const prefix of prefixes) {
      if ((await listObjects(db, bucket, prefix)).length > 0) {
        throw new Error(`storage objects remain in ${bucket} after the purge`);
      }
    }
  }
  return removed;
}

/** Every object key under `prefix`, following folders and pages. */
async function listObjects(
  db: TypedSupabaseClient,
  bucket: string,
  prefix: string,
): Promise<string[]> {
  const keys: string[] = [];
  for (let offset = 0; ; offset += LIST_PAGE) {
    const { data, error } = await db.storage
      .from(bucket)
      .list(prefix, { limit: LIST_PAGE, offset });
    if (error) throw error;
    for (const entry of data ?? []) {
      const path = `${prefix}/${entry.name}`;
      // Folders are listed without an id.
      if (entry.id) keys.push(path);
      else keys.push(...(await listObjects(db, bucket, path)));
    }
    if ((data ?? []).length < LIST_PAGE) return keys;
  }
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
