import "server-only";

import { ApiError } from "@/lib/api/errors";
import { audit } from "@/lib/audit/audit.service";
import { createServiceClient, type TypedSupabaseClient } from "@/lib/db/server";
import { sendReleaseCodeEmail } from "@/lib/email/send";
import { logger } from "@/lib/observability/logger";
import { hashAccessToken, oneTimeCode } from "@/lib/security/access-token";
import { checkRateLimit } from "@/lib/security/rate-limit";
import {
  ACCESS_COOKIE_TTL_SECONDS,
  sealAccessSession,
  type AccessSession,
} from "@/lib/security/access-cookie";
import { BUCKETS, createSignedDownloadUrl, type BucketName } from "@/lib/storage/storage";
import type { AccessGrantType } from "@/lib/types/access";
import type { AccessScope } from "@/lib/types/dms";
import type { PlanSectionKey } from "@/lib/types/legacy-plan";
import type { SignedAccess } from "@/lib/types/document";

/**
 * The beneficiary side of an access link (ADR-014, FR-D011, FR-H011–H015).
 *
 * There is no Clerk session here. Authorization is the token row itself, which
 * is re-read and re-checked on every single request — revoked, expired, or a
 * beneficiary who has since been deactivated all end the session immediately
 * rather than at the end of the cookie's window. Everything is read-only, every
 * read is audited with the beneficiary as the actor, and encrypted fields are
 * never part of any response.
 *
 * The service client is used deliberately: a recipient has no database identity
 * of their own, so RLS cannot express this. The authorization is the scope
 * check below, and every query is additionally pinned to the token's owner.
 */
export interface AccessGrant {
  tokenId: string;
  ownerUserId: string;
  ownerName: string;
  beneficiaryId: string;
  beneficiaryName: string;
  grantType: AccessGrantType;
  scope: AccessScope;
  expiresAt: string;
  /** When this link was issued: for a release, when the release happened. */
  issuedAt: string;
  /** Release links only: when the contact first confirmed a code. */
  verifiedAt: string | null;
}

/**
 * Either a session, or (for a release link) a code was sent and must be
 * entered first. No cookie exists until then.
 */
export type ExchangeResult =
  | { cookie: { value: string; maxAge: number }; grant: AccessSummary }
  | { verificationRequired: true; sentTo: string; codeExpiresAt: string };

export interface AccessSummary {
  ownerName: string;
  beneficiaryName: string;
  grantType: AccessGrantType;
  expiresAt: string;
  issuedAt: string;
  verifiedAt: string | null;
  counts: { documents: number; assets: number; videos: number; planSections: number };
}

interface TokenRow {
  id: string;
  owner_user_id: string;
  beneficiary_id: string;
  grant_type: AccessGrantType;
  scope: unknown;
  expires_at: string;
  revoked_at: string | null;
  used_at: string | null;
  follows_document_shares: boolean;
  dead_man_switch_id: string | null;
  emergency_request_id: string | null;
  created_at: string;
  verified_at: string | null;
}

function asScope(value: unknown): AccessScope {
  const scope =
    value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  return {
    documents: Array.isArray(scope.documents) ? (scope.documents as string[]) : [],
    assets: Array.isArray(scope.assets) ? (scope.assets as AccessScope["assets"]) : [],
    videos: Array.isArray(scope.videos) ? (scope.videos as string[]) : [],
    planSections: Array.isArray(scope.planSections)
      ? (scope.planSections as AccessScope["planSections"])
      : [],
  };
}

/** The one error this surface returns for every failed authorization. */
function refused(): ApiError {
  return new ApiError(401, "UNAUTHENTICATED", "This link is no longer valid.");
}

/**
 * Is the grant behind a system link still standing? A release link works only
 * while its switch is RELEASED (recovery, disabling or a check-in end it here
 * even if a revocation were somehow missed), and an emergency link only while
 * its request is granted.
 */
async function grantStands(db: TypedSupabaseClient, token: TokenRow): Promise<boolean> {
  if (token.grant_type === "DMS_RELEASE") {
    if (!token.dead_man_switch_id) return false;
    const { data, error } = await db
      .from("dead_man_switches")
      .select("status")
      .eq("id", token.dead_man_switch_id)
      .eq("user_id", token.owner_user_id)
      .maybeSingle();
    if (error) throw error;
    return data?.status === "RELEASED";
  }
  if (token.grant_type === "EMERGENCY_ACCESS") {
    if (!token.emergency_request_id) return false;
    const { data, error } = await db
      .from("emergency_access_requests")
      .select("status")
      .eq("id", token.emergency_request_id)
      .maybeSingle();
    if (error) throw error;
    return ["APPROVED", "AUTO_GRANTED", "ACTIVE"].includes(data?.status ?? "");
  }
  return true;
}

async function loadGrant(
  db: TypedSupabaseClient,
  tokenId: string,
  { requireVerified = true }: { requireVerified?: boolean } = {},
): Promise<AccessGrant & { beneficiaryEmail: string }> {
  const { data: token, error } = await db
    .from("access_tokens")
    .select(
      "id, owner_user_id, beneficiary_id, grant_type, scope, expires_at, revoked_at, used_at, follows_document_shares, dead_man_switch_id, emergency_request_id, created_at, verified_at",
    )
    .eq("id", tokenId)
    .maybeSingle<TokenRow>();
  if (error) throw error;
  if (!token || token.revoked_at || Date.parse(token.expires_at) <= Date.now()) throw refused();
  // A release session exists only after a confirmed code; one without is refused.
  if (requireVerified && token.grant_type === "DMS_RELEASE" && !token.verified_at) throw refused();

  const [beneficiaryResult, ownerResult, stands] = await Promise.all([
    db
      .from("beneficiaries")
      .select("id, name, email, status, deleted_at, user_id")
      .eq("id", token.beneficiary_id)
      .maybeSingle(),
    db.from("users").select("id, name, deleted_at").eq("id", token.owner_user_id).maybeSingle(),
    grantStands(db, token),
  ]);
  const { data: beneficiary, error: beneficiaryError } = beneficiaryResult;
  if (beneficiaryError) throw beneficiaryError;
  if (
    !beneficiary ||
    beneficiary.deleted_at ||
    beneficiary.status === "INACTIVE" ||
    beneficiary.user_id !== token.owner_user_id
  ) {
    throw refused();
  }
  const { data: owner, error: ownerError } = ownerResult;
  if (ownerError) throw ownerError;
  if (!owner || owner.deleted_at) throw refused();
  if (!stands) throw refused();

  const scope = asScope(token.scope);
  if (token.grant_type === "DIRECT_SHARE") {
    scope.documents = await sharedDocuments(db, token, scope.documents);
  }

  return {
    tokenId: token.id,
    ownerUserId: token.owner_user_id,
    ownerName: owner.name,
    beneficiaryId: beneficiary.id,
    beneficiaryName: beneficiary.name,
    grantType: token.grant_type,
    scope,
    expiresAt: token.expires_at,
    issuedAt: token.created_at,
    verifiedAt: token.verified_at,
    beneficiaryEmail: beneficiary.email,
  };
}

/**
 * A DIRECT_SHARE link opens only documents shared with its beneficiary right
 * now. A link minted by sharing (`follows_document_shares`) shows all of them;
 * any other keeps its fixed list minus whatever has since been unshared — it
 * can lose documents, never gain them. DMS and emergency grants keep their
 * released scope.
 */
async function sharedDocuments(
  db: TypedSupabaseClient,
  token: TokenRow,
  issued: string[],
): Promise<string[]> {
  if (!token.follows_document_shares && issued.length === 0) return [];
  const { data, error } = await db
    .from("beneficiary_assignments")
    .select("resource_id")
    .eq("user_id", token.owner_user_id)
    .eq("beneficiary_id", token.beneficiary_id)
    .eq("resource_type", "DOCUMENT");
  if (error) throw error;
  const shared = (data ?? []).map((row) => row.resource_id);
  return token.follows_document_shares ? shared : issued.filter((id) => shared.includes(id));
}

function summarize(grant: AccessGrant): AccessSummary {
  return {
    ownerName: grant.ownerName,
    beneficiaryName: grant.beneficiaryName,
    grantType: grant.grantType,
    expiresAt: grant.expiresAt,
    issuedAt: grant.issuedAt,
    verifiedAt: grant.verifiedAt,
    counts: {
      documents: grant.scope.documents.length,
      assets: grant.scope.assets.length,
      videos: grant.scope.videos.length,
      planSections: grant.scope.planSections.length,
    },
  };
}

/**
 * Turns the emailed secret into a session (ADR-014 § 3, § 5).
 *
 * The plaintext is hashed and compared in the database; it is never stored,
 * logged or echoed. First use marks the token and promotes a still-pending
 * beneficiary to ACTIVE.
 */
export async function exchange(
  token: string,
  correlationId: string,
  code?: string,
): Promise<ExchangeResult> {
  const db = createServiceClient();
  const { data: row, error } = await db
    .from("access_tokens")
    .select("id")
    .eq("token_hash", hashAccessToken(token))
    .maybeSingle();
  if (error) throw error;
  if (!row) {
    await audit.log({
      actorId: null,
      actorRole: "BENEFICIARY",
      action: "access.exchange_rejected",
      resourceType: "access_token",
      outcome: "DENIED",
      metadata: { reason: "UNKNOWN_TOKEN" },
      correlationId,
    });
    throw refused();
  }

  let grant = await loadGrant(db, row.id, { requireVerified: false });
  if (grant.grantType === "DMS_RELEASE") {
    // Every new session on a release link needs a fresh code sent to the
    // contact's own address: holding the link alone opens nothing.
    if (!code) return startVerification(db, grant, correlationId);
    await checkVerification(db, grant.tokenId, code);
    grant = await loadGrant(db, row.id);
  }
  const now = new Date().toISOString();

  const { error: usedError } = await db
    .from("access_tokens")
    .update({ used_at: now, last_used_at: now })
    .eq("id", grant.tokenId)
    .is("used_at", null);
  if (usedError) throw usedError;
  const { error: touchError } = await db
    .from("access_tokens")
    .update({ last_used_at: now })
    .eq("id", grant.tokenId);
  if (touchError) throw touchError;

  // A beneficiary who opens their link has accepted it (Clarifications 2026-09-18).
  const { error: statusError } = await db
    .from("beneficiaries")
    .update({ status: "ACTIVE", activated_at: now })
    .eq("id", grant.beneficiaryId)
    .eq("status", "PENDING");
  if (statusError) throw statusError;

  await audit.log({
    actorId: grant.beneficiaryId,
    actorRole: "BENEFICIARY",
    action: "access.exchanged",
    resourceType: "access_token",
    resourceId: grant.tokenId,
    outcome: "SUCCESS",
    metadata: { grantType: grant.grantType, ownerUserId: grant.ownerUserId },
    correlationId,
  });

  // The window never outlives the token itself.
  const remaining = Math.floor((Date.parse(grant.expiresAt) - Date.now()) / 1000);
  const maxAge = Math.max(60, Math.min(ACCESS_COOKIE_TTL_SECONDS, remaining));
  const session: AccessSession = {
    tokenId: grant.tokenId,
    exp: Math.floor(Date.now() / 1000) + maxAge,
  };

  return { cookie: { value: sealAccessSession(session), maxAge }, grant: summarize(grant) };
}

/** "j•••@example.com": enough to know which inbox to check. */
function maskEmail(email: string): string {
  const [local, domain] = email.split("@");
  return `${local.slice(0, 1)}•••@${domain ?? ""}`;
}

async function startVerification(
  db: TypedSupabaseClient,
  grant: AccessGrant & { beneficiaryEmail: string },
  correlationId: string,
): Promise<ExchangeResult> {
  const budget = await checkRateLimit({
    policy: "sensitive",
    subject: `release-code:${grant.tokenId}`,
  });
  if (!budget.allowed) {
    throw new ApiError(
      429,
      "RATE_LIMITED",
      "Too many codes were requested for this link. Try again in a few minutes.",
    );
  }

  const code = oneTimeCode();
  const { data: codeExpiresAt, error } = await db.rpc("system_start_release_verification", {
    p_token_id: grant.tokenId,
    p_code_hash: hashAccessToken(code),
  });
  if (error) {
    if (error.code === "LV409") throw refused();
    throw error;
  }

  try {
    await sendReleaseCodeEmail({
      to: grant.beneficiaryEmail,
      beneficiaryName: grant.beneficiaryName,
      ownerName: grant.ownerName,
      code,
      // Each code is its own message; nothing reuses a previous one.
      idempotencyKey: `release-code:${grant.tokenId}:${codeExpiresAt as string}`,
    });
  } catch (cause) {
    // Nobody knows the code now, so it simply expires.
    logger.error({ err: cause, correlationId }, "release code email failed");
    throw new ApiError(
      503,
      "SERVICE_UNAVAILABLE",
      "We could not send your code. Please try again in a few minutes.",
    );
  }
  return {
    verificationRequired: true,
    sentTo: maskEmail(grant.beneficiaryEmail),
    codeExpiresAt: codeExpiresAt as string,
  };
}

const VERIFICATION_ERRORS: Record<string, string> = {
  RETRY: "That code is not right. Check the latest email and try again.",
  LOCKED: "Too many wrong codes. Send a new code to try again.",
  EXPIRED: "That code has expired. Send a new code to try again.",
  NO_CHALLENGE: "Send a new code to continue.",
};

/** Throws unless the code matches the live challenge; attempts are counted in the database. */
async function checkVerification(
  db: TypedSupabaseClient,
  tokenId: string,
  code: string,
): Promise<void> {
  const { data, error } = await db.rpc("system_check_release_verification", {
    p_token_id: tokenId,
    p_code_hash: hashAccessToken(code),
  });
  if (error) throw error;
  const outcome = data as string;
  if (outcome === "VERIFIED") return;
  if (outcome === "NOT_LIVE") throw refused();
  throw new ApiError(422, "VALIDATION_ERROR", VERIFICATION_ERRORS[outcome] ?? "Send a new code.", {
    details: { restart: outcome !== "RETRY" },
  });
}

/** Re-checks the grant behind a cookie. Every resource endpoint starts here. */
export async function requireGrant(tokenId: string): Promise<AccessGrant> {
  return loadGrant(createServiceClient(), tokenId);
}

export interface AccessResourceList {
  grant: AccessSummary;
  documents: { id: string; name: string; mimeType: string; sizeBytes: number }[];
  assets: { id: string; type: string; name: string; category: string }[];
  videos: { id: string; title: string; description: string | null; mimeType: string }[];
  planSections: { key: string; available: boolean }[];
}

/** Exactly what the scope names, and nothing else, resolved to real rows. */
export async function listResources(
  grant: AccessGrant,
  correlationId: string,
): Promise<AccessResourceList> {
  const db = createServiceClient();

  const documents = grant.scope.documents.length
    ? (
        (
          await db
            .from("documents")
            .select("id, name, mime_type, size_bytes")
            .eq("user_id", grant.ownerUserId)
            .is("deleted_at", null)
            .in("id", grant.scope.documents)
        ).data ?? []
      ).map((row) => ({
        id: row.id,
        name: row.name,
        mimeType: row.mime_type,
        sizeBytes: row.size_bytes,
      }))
    : [];

  const assets: AccessResourceList["assets"] = [];
  for (const kind of ["FINANCIAL_ASSET", "PHYSICAL_ASSET", "DIGITAL_ASSET"] as const) {
    const ids = grant.scope.assets.filter((asset) => asset.type === kind).map((asset) => asset.id);
    if (ids.length === 0) continue;
    const { data } = await db
      .from(TABLE_BY_KIND[kind])
      .select("id, name, category")
      .eq("user_id", grant.ownerUserId)
      .is("deleted_at", null)
      .in("id", ids);
    for (const row of data ?? []) {
      assets.push({ id: row.id, type: kind, name: row.name, category: String(row.category) });
    }
  }

  const videos = grant.scope.videos.length
    ? (
        (
          await db
            .from("video_messages")
            .select("id, title, description, mime_type")
            .eq("user_id", grant.ownerUserId)
            .is("deleted_at", null)
            .in("id", grant.scope.videos)
        ).data ?? []
      ).map((row) => ({
        id: row.id,
        title: row.title,
        description: row.description,
        mimeType: row.mime_type,
      }))
    : [];

  const finalized = grant.scope.planSections.length ? await latestFinalized(db, grant) : null;
  const planSections = grant.scope.planSections.map((key) => ({
    key,
    available: Boolean(finalized && sectionOf(finalized.snapshot, key)),
  }));

  await audit.log({
    actorId: grant.beneficiaryId,
    actorRole: "BENEFICIARY",
    action: "access.resources_listed",
    resourceType: "access_token",
    resourceId: grant.tokenId,
    outcome: "SUCCESS",
    metadata: { grantType: grant.grantType },
    correlationId,
  });

  return { grant: summarize(grant), documents, assets, videos, planSections };
}

const TABLE_BY_KIND = {
  FINANCIAL_ASSET: "financial_assets",
  PHYSICAL_ASSET: "physical_assets",
  DIGITAL_ASSET: "digital_assets",
} as const;

function inScope(grant: AccessGrant, kind: "documents" | "videos", id: string): void {
  if (!grant.scope[kind].includes(id)) throw ApiError.notFound();
}

export interface AccessDocument {
  id: string;
  name: string;
  mimeType: string;
  sizeBytes: number;
  createdAt: string;
}

export async function documentDetail(
  grant: AccessGrant,
  id: string,
  correlationId: string,
): Promise<AccessDocument> {
  inScope(grant, "documents", id);
  const db = createServiceClient();
  const { data, error } = await db
    .from("documents")
    .select("id, name, mime_type, size_bytes, created_at")
    .eq("id", id)
    .eq("user_id", grant.ownerUserId)
    .is("deleted_at", null)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw ApiError.notFound();

  await auditAccess(grant, "access.document_viewed", "document", id, correlationId);
  return {
    id: data.id,
    name: data.name,
    mimeType: data.mime_type,
    sizeBytes: data.size_bytes,
    createdAt: data.created_at,
  };
}

/** A signed URL, minted per request and never cached (ADR-005). */
export async function documentDownload(
  grant: AccessGrant,
  id: string,
  correlationId: string,
): Promise<SignedAccess> {
  inScope(grant, "documents", id);
  const db = createServiceClient();
  const { data, error } = await db
    .from("documents")
    .select("name, mime_type, storage_bucket, storage_key")
    .eq("id", id)
    .eq("user_id", grant.ownerUserId)
    .is("deleted_at", null)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw ApiError.notFound();

  const signed = await createSignedDownloadUrl(
    data.storage_bucket as BucketName,
    data.storage_key,
    {
      downloadAs: data.name,
    },
  );
  await auditAccess(grant, "access.document_downloaded", "document", id, correlationId);
  return {
    url: signed.url,
    expiresAt: signed.expiresAt,
    name: data.name,
    mimeType: data.mime_type,
  };
}

export interface AccessAsset {
  id: string;
  type: string;
  name: string;
  category: string;
  notes: string | null;
  estimatedValue: number | null;
  currency: string | null;
}

/**
 * A read-only view of an asset.
 *
 * The ENCRYPTED columns are not selected at all: an account number or a set of
 * credentials is never part of a beneficiary's view, whatever the grant.
 */
export async function assetView(
  grant: AccessGrant,
  type: string,
  id: string,
  correlationId: string,
): Promise<AccessAsset> {
  const kind = type as keyof typeof TABLE_BY_KIND;
  if (!TABLE_BY_KIND[kind]) throw ApiError.notFound();
  if (!grant.scope.assets.some((asset) => asset.type === kind && asset.id === id)) {
    throw ApiError.notFound();
  }

  const db = createServiceClient();
  const { data, error } = await db
    .from(TABLE_BY_KIND[kind])
    .select("id, name, category, notes, estimated_value, currency")
    .eq("id", id)
    .eq("user_id", grant.ownerUserId)
    .is("deleted_at", null)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw ApiError.notFound();

  await auditAccess(grant, "access.asset_viewed", kind, id, correlationId);
  return {
    id: data.id,
    type: kind,
    name: data.name,
    category: String(data.category),
    notes: data.notes,
    estimatedValue: data.estimated_value,
    currency: data.currency,
  };
}

/**
 * A signed playback URL.
 *
 * The delivery condition is re-checked here as well as at issue time: a video
 * marked "on switch release" must never play from an emergency grant, even if
 * an older token still names it.
 */
export async function videoAccess(
  grant: AccessGrant,
  id: string,
  correlationId: string,
): Promise<SignedAccess> {
  inScope(grant, "videos", id);
  const db = createServiceClient();
  const { data, error } = await db
    .from("video_messages")
    .select("title, mime_type, delivery_condition, storage_bucket, storage_key")
    .eq("id", id)
    .eq("user_id", grant.ownerUserId)
    .is("deleted_at", null)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw ApiError.notFound();

  const allowed =
    data.delivery_condition === "IMMEDIATE" ||
    (data.delivery_condition === "DEAD_MAN_SWITCH" && grant.grantType === "DMS_RELEASE") ||
    (data.delivery_condition === "EMERGENCY_ACCESS" && grant.grantType === "EMERGENCY_ACCESS");
  if (!allowed) {
    await auditAccess(grant, "access.video_refused", "video_message", id, correlationId, "DENIED");
    throw new ApiError(
      422,
      "DELIVERY_CONDITION_MISMATCH",
      "This message is not available through this kind of access.",
    );
  }

  const signed = await createSignedDownloadUrl(
    (data.storage_bucket as BucketName) ?? BUCKETS.videos,
    data.storage_key,
  );
  await auditAccess(grant, "access.video_played", "video_message", id, correlationId);
  return {
    url: signed.url,
    expiresAt: signed.expiresAt,
    name: data.title,
    mimeType: data.mime_type,
  };
}

export interface AccessPlanSection {
  key: string;
  versionNumber: number;
  finalizedAt: string;
  data: Record<string, unknown>;
}

/** One section of the owner's latest finalized plan version (FR-I012, FR-J001). */
export async function planSection(
  grant: AccessGrant,
  section: string,
  correlationId: string,
): Promise<AccessPlanSection> {
  if (!grant.scope.planSections.includes(section as PlanSectionKey)) throw ApiError.notFound();

  const db = createServiceClient();
  const finalized = await latestFinalized(db, grant);
  if (!finalized) throw ApiError.notFound("There is no finalized plan to show.");

  const data = sectionOf(finalized.snapshot, section);
  if (!data) throw ApiError.notFound("That section was not completed.");

  await auditAccess(
    grant,
    "access.plan_section_viewed",
    "legacy_plan",
    finalized.planId,
    correlationId,
  );
  return {
    key: section,
    versionNumber: finalized.versionNumber,
    finalizedAt: finalized.finalizedAt,
    data,
  };
}

async function latestFinalized(
  db: TypedSupabaseClient,
  grant: AccessGrant,
): Promise<{
  planId: string;
  versionNumber: number;
  finalizedAt: string;
  snapshot: Record<string, unknown>;
} | null> {
  const { data: plans, error } = await db
    .from("legacy_plans")
    .select("id")
    .eq("user_id", grant.ownerUserId)
    .is("deleted_at", null);
  if (error) throw error;
  const planIds = (plans ?? []).map((plan) => plan.id);
  if (planIds.length === 0) return null;

  const { data: version, error: versionError } = await db
    .from("legacy_plan_versions")
    .select("legacy_plan_id, version_number, finalized_at, snapshot_data")
    .in("legacy_plan_id", planIds)
    .order("finalized_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (versionError) throw versionError;
  if (!version) return null;

  const snapshot =
    version.snapshot_data && typeof version.snapshot_data === "object"
      ? (version.snapshot_data as Record<string, unknown>)
      : {};
  return {
    planId: version.legacy_plan_id,
    versionNumber: version.version_number,
    finalizedAt: version.finalized_at,
    snapshot,
  };
}

function sectionOf(
  snapshot: Record<string, unknown>,
  section: string,
): Record<string, unknown> | null {
  // Versions store the wizard's step data under `stepsData`.
  const steps = snapshot.stepsData;
  const source =
    steps && typeof steps === "object" && !Array.isArray(steps)
      ? (steps as Record<string, unknown>)
      : snapshot;
  const value = source[section];
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

async function auditAccess(
  grant: AccessGrant,
  action: string,
  resourceType: string,
  resourceId: string,
  correlationId: string,
  outcome: "SUCCESS" | "DENIED" = "SUCCESS",
): Promise<void> {
  await audit.log({
    actorId: grant.beneficiaryId,
    action,
    resourceType,
    resourceId,
    outcome,
    metadata: { grantType: grant.grantType, ownerUserId: grant.ownerUserId },
    correlationId,
  });
}

/** Ends the session. The token itself is untouched — this is a sign-out, not a revoke. */
export async function logout(grant: AccessGrant | null, correlationId: string): Promise<void> {
  if (!grant) return;
  await audit.log({
    actorId: grant.beneficiaryId,
    actorRole: "BENEFICIARY",
    action: "access.logged_out",
    resourceType: "access_token",
    resourceId: grant.tokenId,
    outcome: "SUCCESS",
    correlationId,
  });
}
