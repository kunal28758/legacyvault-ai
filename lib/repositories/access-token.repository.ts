import "server-only";

import type { TypedSupabaseClient } from "@/lib/db/server";
import type { AccessScope } from "@/lib/types/dms";
import type { AccessTokenSummary } from "@/lib/types/access";

/**
 * Access token data access (ADR-014).
 *
 * `token_hash` is excluded from the `authenticated` SELECT grant, so it cannot
 * be read through a user-scoped client at all — these queries name their
 * columns explicitly to make that visible at the call site too.
 */
const TOKEN_COLUMNS =
  "id, beneficiary_id, grant_type, scope, expires_at, revoked_at, revoked_reason, delivered_at, used_at, last_used_at, created_at, verified_at";

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

interface TokenRow {
  id: string;
  beneficiary_id: string;
  grant_type: AccessTokenSummary["grantType"];
  scope: unknown;
  expires_at: string;
  revoked_at: string | null;
  revoked_reason: AccessTokenSummary["revokedReason"];
  delivered_at: string | null;
  used_at: string | null;
  last_used_at: string | null;
  created_at: string;
  verified_at: string | null;
}

function toSummary(row: TokenRow, beneficiaryName: string): AccessTokenSummary {
  return {
    id: row.id,
    beneficiaryId: row.beneficiary_id,
    beneficiaryName,
    grantType: row.grant_type,
    scope: asScope(row.scope),
    expiresAt: row.expires_at,
    revokedAt: row.revoked_at,
    revokedReason: row.revoked_reason,
    deliveredAt: row.delivered_at,
    usedAt: row.used_at,
    lastUsedAt: row.last_used_at,
    createdAt: row.created_at,
    verifiedAt: row.verified_at,
  };
}

/** Every link of the owner's that still opens something: not revoked, not expired. */
export async function listLive(
  db: TypedSupabaseClient,
  userId: string,
  now: Date,
): Promise<AccessTokenSummary[]> {
  const { data, error } = await db
    .from("access_tokens")
    .select(TOKEN_COLUMNS)
    .eq("owner_user_id", userId)
    .is("revoked_at", null)
    .gt("expires_at", now.toISOString())
    .order("created_at", { ascending: false })
    .limit(100);
  if (error) throw error;
  const rows = (data ?? []) as TokenRow[];
  if (rows.length === 0) return [];

  const { data: people, error: peopleError } = await db
    .from("beneficiaries")
    .select("id, name")
    .eq("user_id", userId)
    .in("id", [...new Set(rows.map((row) => row.beneficiary_id))]);
  if (peopleError) throw peopleError;
  const names = new Map((people ?? []).map((person) => [person.id, person.name]));
  return rows.map((row) => toSummary(row, names.get(row.beneficiary_id) ?? "Beneficiary"));
}

export async function listForBeneficiary(
  db: TypedSupabaseClient,
  userId: string,
  beneficiaryId: string,
  beneficiaryName: string,
): Promise<AccessTokenSummary[]> {
  const { data, error } = await db
    .from("access_tokens")
    .select(TOKEN_COLUMNS)
    .eq("owner_user_id", userId)
    .eq("beneficiary_id", beneficiaryId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []).map((row) => toSummary(row as TokenRow, beneficiaryName));
}

export async function findById(
  db: TypedSupabaseClient,
  userId: string,
  tokenId: string,
): Promise<AccessTokenSummary | null> {
  const { data, error } = await db
    .from("access_tokens")
    .select(TOKEN_COLUMNS)
    .eq("id", tokenId)
    .eq("owner_user_id", userId)
    .maybeSingle();
  if (error) throw error;
  return data ? toSummary(data as TokenRow, "Beneficiary") : null;
}
