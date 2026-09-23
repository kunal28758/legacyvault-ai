import "server-only";

import type { TypedSupabaseClient } from "@/lib/db/server";
import type { Asset, AssetKind } from "@/lib/types/asset";
import type { Database } from "@/lib/types/database";

/**
 * Asset data access for the three asset tables (tasks T079–T090).
 *
 * The same repository conventions as everywhere else: the caller chooses the
 * client, every statement is scoped by owner in SQL as well as by RLS, and
 * PostgREST errors are surfaced unchanged.
 *
 * Two rules are specific to assets:
 *  • there is **no insert and no delete** here — rows are created by
 *    `create_asset()` and soft-deleted by `delete_asset()`, both Class B
 *    (0002 § 5: asset rows have no INSERT grant and no direct `deleted_at`);
 *  • the ENCRYPTED columns are readable (the ciphertext is useless without the
 *    key) but are **never mapped into a domain object**. `toAsset()` reduces
 *    them to presence booleans, and only `findEncrypted()` — used by the
 *    re-verified decrypt path — returns the envelopes themselves.
 */
export type FinancialRow = Database["public"]["Tables"]["financial_assets"]["Row"];
export type PhysicalRow = Database["public"]["Tables"]["physical_assets"]["Row"];
export type DigitalRow = Database["public"]["Tables"]["digital_assets"]["Row"];
export type AssetRow = FinancialRow | PhysicalRow | DigitalRow;

const TABLE_BY_KIND = {
  FINANCIAL_ASSET: "financial_assets",
  PHYSICAL_ASSET: "physical_assets",
  DIGITAL_ASSET: "digital_assets",
} as const;

/** Plain columns the browser may search on, per class. */
const SEARCH_COLUMNS: Record<AssetKind, string[]> = {
  FINANCIAL_ASSET: ["name", "institution", "notes"],
  PHYSICAL_ASSET: ["name", "location", "description", "notes"],
  DIGITAL_ASSET: ["name", "platform", "username", "notes"],
};

function numeric(value: number | string | null): number | null {
  if (value === null) return null;
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function toAsset(kind: AssetKind, row: AssetRow): Asset {
  const base = {
    id: row.id,
    name: row.name,
    estimatedValue: numeric(row.estimated_value),
    currency: row.currency,
    notes: row.notes,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };

  if (kind === "FINANCIAL_ASSET") {
    const financial = row as FinancialRow;
    return {
      ...base,
      kind,
      category: financial.category,
      institution: financial.institution,
      hasAccountNumber: Boolean(financial.account_number),
      hasPolicyNumber: Boolean(financial.policy_number),
    };
  }
  if (kind === "PHYSICAL_ASSET") {
    const physical = row as PhysicalRow;
    return {
      ...base,
      kind,
      category: physical.category,
      description: physical.description,
      location: physical.location,
      ownershipDetails: physical.ownership_details,
    };
  }
  const digital = row as DigitalRow;
  return {
    ...base,
    kind,
    category: digital.category,
    platform: digital.platform,
    username: digital.username,
    hasCredentials: Boolean(digital.credentials),
    hasRecoveryInfo: Boolean(digital.recovery_info),
  };
}

/** See the note in `beneficiary.repository.ts`: PostgREST grammar is stripped, not escaped. */
function sanitizeSearch(term: string): string {
  return term
    .replace(/[^\p{L}\p{N}\s.@_-]/gu, " ")
    .trim()
    .slice(0, 60);
}

export interface AssetListFilters {
  category?: string;
  search?: string;
  page: number;
  limit: number;
}

export async function list(
  db: TypedSupabaseClient,
  userId: string,
  kind: AssetKind,
  filters: AssetListFilters,
): Promise<{ rows: Asset[]; total: number }> {
  let query = db
    .from(TABLE_BY_KIND[kind])
    .select("*", { count: "exact" })
    .eq("user_id", userId)
    .is("deleted_at", null);

  if (filters.category) query = query.eq("category", filters.category as never);

  const term = filters.search ? sanitizeSearch(filters.search) : "";
  if (term) {
    query = query.or(SEARCH_COLUMNS[kind].map((column) => `${column}.ilike.*${term}*`).join(","));
  }

  const from = (filters.page - 1) * filters.limit;
  const { data, error, count } = await query
    .order("created_at", { ascending: false })
    .range(from, from + filters.limit - 1);
  if (error) throw error;

  return { rows: (data ?? []).map((row) => toAsset(kind, row as AssetRow)), total: count ?? 0 };
}

export async function findById(
  db: TypedSupabaseClient,
  userId: string,
  kind: AssetKind,
  id: string,
): Promise<Asset | null> {
  const { data, error } = await db
    .from(TABLE_BY_KIND[kind])
    .select("*")
    .eq("id", id)
    .eq("user_id", userId)
    .is("deleted_at", null)
    .maybeSingle();
  if (error) throw error;
  return data ? toAsset(kind, data as AssetRow) : null;
}

/** Ids of the caller's live assets, for the plan-completeness cross-check. */
export async function listIds(
  db: TypedSupabaseClient,
  userId: string,
  kind: AssetKind,
): Promise<string[]> {
  const { data, error } = await db
    .from(TABLE_BY_KIND[kind])
    .select("id")
    .eq("user_id", userId)
    .is("deleted_at", null);
  if (error) throw error;
  return (data ?? []).map((row) => row.id);
}

/**
 * Class A update on the plain-column allow-list only (0002 § 5).
 *
 * The encrypted columns are deliberately absent from these types: attempting
 * one would be refused by the missing column grant anyway, and it must go
 * through `set_encrypted_fields()`.
 */
export type FinancialPatch = Partial<
  Pick<
    Database["public"]["Tables"]["financial_assets"]["Update"],
    "name" | "category" | "institution" | "estimated_value" | "currency" | "notes"
  >
>;
export type PhysicalPatch = Partial<
  Pick<
    Database["public"]["Tables"]["physical_assets"]["Update"],
    | "name"
    | "category"
    | "description"
    | "location"
    | "estimated_value"
    | "currency"
    | "ownership_details"
    | "notes"
  >
>;
export type DigitalPatch = Partial<
  Pick<
    Database["public"]["Tables"]["digital_assets"]["Update"],
    "name" | "category" | "platform" | "username" | "estimated_value" | "currency" | "notes"
  >
>;
export type AssetPatch = FinancialPatch | PhysicalPatch | DigitalPatch;

export async function update(
  db: TypedSupabaseClient,
  userId: string,
  kind: AssetKind,
  id: string,
  patch: AssetPatch,
): Promise<Asset> {
  const { data, error } = await db
    .from(TABLE_BY_KIND[kind])
    .update(patch as never)
    .eq("id", id)
    .eq("user_id", userId)
    .is("deleted_at", null)
    .select("*")
    .single();
  if (error) throw error;
  return toAsset(kind, data as AssetRow);
}

/**
 * The stored encryption envelopes for one asset.
 *
 * Only the decrypt path calls this. It returns the ciphertext envelopes, never
 * plaintext — decryption happens in `lib/security/encryption`, above this layer,
 * so the key material never reaches a query.
 */
export async function findEncrypted(
  db: TypedSupabaseClient,
  userId: string,
  kind: AssetKind,
  id: string,
): Promise<Record<string, string | null> | null> {
  if (kind === "PHYSICAL_ASSET") return {};

  if (kind === "FINANCIAL_ASSET") {
    const { data, error } = await db
      .from("financial_assets")
      .select("account_number, policy_number")
      .eq("id", id)
      .eq("user_id", userId)
      .is("deleted_at", null)
      .maybeSingle();
    if (error) throw error;
    return data ? { accountNumber: data.account_number, policyNumber: data.policy_number } : null;
  }

  const { data, error } = await db
    .from("digital_assets")
    .select("credentials, recovery_info")
    .eq("id", id)
    .eq("user_id", userId)
    .is("deleted_at", null)
    .maybeSingle();
  if (error) throw error;
  return data ? { credentials: data.credentials, recoveryInfo: data.recovery_info } : null;
}

/* ── Assignments against a resource ───────────────────────────────────────── */

export interface ResourceAssignmentRow {
  id: string;
  beneficiaryId: string;
  resourceId: string;
  allocationPercentage: number | null;
  createdAt: string;
}

/** Every assignment the caller holds against assets of this class. */
export async function listAssignmentsByKind(
  db: TypedSupabaseClient,
  userId: string,
  kind: AssetKind,
  resourceId?: string,
): Promise<ResourceAssignmentRow[]> {
  let query = db
    .from("beneficiary_assignments")
    .select("id, beneficiary_id, resource_id, allocation_percentage, created_at")
    .eq("user_id", userId)
    .eq("resource_type", kind);
  if (resourceId) query = query.eq("resource_id", resourceId);

  const { data, error } = await query.order("created_at", { ascending: true });
  if (error) throw error;

  return (data ?? []).map((row) => ({
    id: row.id,
    beneficiaryId: row.beneficiary_id,
    resourceId: row.resource_id,
    allocationPercentage: numeric(row.allocation_percentage),
    createdAt: row.created_at,
  }));
}

/** Display names for the beneficiaries referenced by a set of assignments. */
export async function beneficiaryNames(
  db: TypedSupabaseClient,
  userId: string,
  ids: readonly string[],
): Promise<Map<string, string>> {
  if (ids.length === 0) return new Map();
  const { data, error } = await db
    .from("beneficiaries")
    .select("id, name")
    .eq("user_id", userId)
    .in("id", [...new Set(ids)]);
  if (error) throw error;
  return new Map((data ?? []).map((row) => [row.id, row.name]));
}
