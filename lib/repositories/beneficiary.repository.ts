import "server-only";

import type { TypedSupabaseClient } from "@/lib/db/server";
import type { Beneficiary, BeneficiaryAssignment } from "@/lib/types/beneficiary";
import type { Database } from "@/lib/types/database";

/**
 * Beneficiary data access (tasks T071–T076 repository half).
 *
 * Follows the conventions set in `user.repository.ts`: the caller chooses the
 * client, every statement is still scoped by owner in SQL, PostgREST errors are
 * surfaced unchanged so `mapDatabaseError()` can translate the SQLSTATE, and no
 * business rule lives here.
 *
 * `beneficiaries` is Class A for INSERT/UPDATE — the column grants in
 * 0002_rls_and_privileges.sql allow exactly (name, relationship, email, phone,
 * notes), and the `beneficiaries_audit_class_a` trigger records the change.
 * Status, removal and assignments are Class B and go through guarded functions
 * from the service, never from here.
 */
export type BeneficiaryRow = Database["public"]["Tables"]["beneficiaries"]["Row"];
export type BeneficiaryStatus = Database["public"]["Enums"]["beneficiary_status"];

export function toBeneficiary(row: BeneficiaryRow): Beneficiary {
  return {
    id: row.id,
    name: row.name,
    relationship: row.relationship,
    email: row.email,
    phone: row.phone,
    status: row.status,
    invitedAt: row.invited_at,
    activatedAt: row.activated_at,
    notes: row.notes,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * Search runs in SQL so pagination stays correct, which puts the term inside a
 * PostgREST `or=` expression. Everything that carries meaning in that grammar —
 * commas, parentheses, backslashes and the wildcards — is stripped rather than
 * escaped. RLS and the explicit `user_id` predicate are ANDed with it either
 * way, so the worst a crafted term could reach is the caller’s own rows.
 */
function sanitizeSearch(term: string): string {
  return term
    .replace(/[^\p{L}\p{N}\s.@_-]/gu, " ")
    .trim()
    .slice(0, 60);
}

export interface ListFilters {
  status?: BeneficiaryStatus;
  search?: string;
  page: number;
  limit: number;
}

export async function list(
  db: TypedSupabaseClient,
  userId: string,
  filters: ListFilters,
): Promise<{ rows: Beneficiary[]; total: number }> {
  let query = db
    .from("beneficiaries")
    .select("*", { count: "exact" })
    .eq("user_id", userId)
    .is("deleted_at", null);

  if (filters.status) query = query.eq("status", filters.status);

  const term = filters.search ? sanitizeSearch(filters.search) : "";
  if (term) {
    query = query.or(`name.ilike.*${term}*,email.ilike.*${term}*,relationship.ilike.*${term}*`);
  }

  const from = (filters.page - 1) * filters.limit;
  const { data, error, count } = await query
    .order("created_at", { ascending: false })
    .range(from, from + filters.limit - 1);
  if (error) throw error;

  return { rows: (data ?? []).map(toBeneficiary), total: count ?? 0 };
}

export async function findById(
  db: TypedSupabaseClient,
  userId: string,
  id: string,
): Promise<Beneficiary | null> {
  const { data, error } = await db
    .from("beneficiaries")
    .select("*")
    .eq("id", id)
    .eq("user_id", userId)
    .is("deleted_at", null)
    .maybeSingle();
  if (error) throw error;
  return data ? toBeneficiary(data) : null;
}

/** Duplicate detection, for a friendlier 409 than the unique index alone gives. */
export async function findByEmail(
  db: TypedSupabaseClient,
  userId: string,
  email: string,
): Promise<Beneficiary | null> {
  const { data, error } = await db
    .from("beneficiaries")
    .select("*")
    .eq("user_id", userId)
    .eq("email", email)
    .is("deleted_at", null)
    .maybeSingle();
  if (error) throw error;
  return data ? toBeneficiary(data) : null;
}

export interface BeneficiaryInsert {
  name: string;
  relationship: string;
  email: string;
  phone: string | null;
  notes: string | null;
}

export async function insert(
  db: TypedSupabaseClient,
  userId: string,
  input: BeneficiaryInsert,
): Promise<Beneficiary> {
  const { data, error } = await db
    .from("beneficiaries")
    .insert({
      user_id: userId,
      name: input.name,
      relationship: input.relationship,
      email: input.email,
      phone: input.phone,
      notes: input.notes,
    })
    .select("*")
    .single();
  if (error) throw error;
  return toBeneficiary(data);
}

/** Only the Class A allow-list; `status`, `invited_at` and `activated_at` are not grantable. */
export type BeneficiaryPatch = Partial<
  Pick<
    Database["public"]["Tables"]["beneficiaries"]["Update"],
    "name" | "relationship" | "email" | "phone" | "notes"
  >
>;

export async function update(
  db: TypedSupabaseClient,
  userId: string,
  id: string,
  patch: BeneficiaryPatch,
): Promise<Beneficiary> {
  const { data, error } = await db
    .from("beneficiaries")
    .update(patch)
    .eq("id", id)
    .eq("user_id", userId)
    .is("deleted_at", null)
    .select("*")
    .single();
  if (error) throw error;
  return toBeneficiary(data);
}

/**
 * `invited_at` has no `authenticated` UPDATE grant — it is not a field the owner
 * types, it records what the system did — so the timestamp is a system write.
 * The caller must have proven ownership through the user-scoped client first.
 */
export async function markInvited(
  serviceDb: TypedSupabaseClient,
  userId: string,
  id: string,
  at: string,
): Promise<Beneficiary> {
  const { data, error } = await serviceDb
    .from("beneficiaries")
    .update({ invited_at: at })
    .eq("id", id)
    .eq("user_id", userId)
    .is("deleted_at", null)
    .select("*")
    .single();
  if (error) throw error;
  return toBeneficiary(data);
}

/**
 * Stamps `invited_at` only while none is recorded, and returns null when another
 * request got there first — the guard that makes the automatic invitation
 * idempotent. Same ownership precondition as `markInvited`.
 */
export async function markInvitedIfUninvited(
  serviceDb: TypedSupabaseClient,
  userId: string,
  id: string,
  at: string,
): Promise<Beneficiary | null> {
  const { data, error } = await serviceDb
    .from("beneficiaries")
    .update({ invited_at: at })
    .eq("id", id)
    .eq("user_id", userId)
    .is("deleted_at", null)
    .is("invited_at", null)
    .select("*")
    .maybeSingle();
  if (error) throw error;
  return data ? toBeneficiary(data) : null;
}

/* ── Assignments and contact roles ────────────────────────────────────────── */

export async function listAssignments(
  db: TypedSupabaseClient,
  userId: string,
  beneficiaryId?: string,
): Promise<BeneficiaryAssignment[]> {
  let query = db
    .from("beneficiary_assignments")
    .select("id, beneficiary_id, resource_type, resource_id, allocation_percentage, created_at")
    .eq("user_id", userId);
  if (beneficiaryId) query = query.eq("beneficiary_id", beneficiaryId);

  const { data, error } = await query.order("created_at", { ascending: false });
  if (error) throw error;

  const rows = data ?? [];
  const names = await resourceNames(db, userId, rows);

  return rows.map((row) => ({
    id: row.id,
    beneficiaryId: row.beneficiary_id,
    resourceType: row.resource_type,
    resourceId: row.resource_id,
    resourceName: names.get(row.resource_id) ?? null,
    allocationPercentage: row.allocation_percentage,
    createdAt: row.created_at,
  }));
}

const NAME_SOURCE = {
  FINANCIAL_ASSET: { table: "financial_assets", column: "name" },
  PHYSICAL_ASSET: { table: "physical_assets", column: "name" },
  DIGITAL_ASSET: { table: "digital_assets", column: "name" },
  DOCUMENT: { table: "documents", column: "name" },
  VIDEO_MESSAGE: { table: "video_messages", column: "title" },
} as const;

/**
 * What each assignment actually points at.
 *
 * Resolved here, in one query per resource class, so the browser does not have
 * to download whole catalogues of documents, assets and videos just to put a
 * name next to a row.
 */
async function resourceNames(
  db: TypedSupabaseClient,
  userId: string,
  rows: { resource_type: string; resource_id: string }[],
): Promise<Map<string, string>> {
  const names = new Map<string, string>();

  for (const [type, source] of Object.entries(NAME_SOURCE)) {
    const ids = rows.filter((row) => row.resource_type === type).map((row) => row.resource_id);
    if (ids.length === 0) continue;

    const { data, error } = await db
      .from(source.table)
      .select(`id, ${source.column}`)
      .eq("user_id", userId)
      .in("id", ids);
    if (error) throw error;
    for (const row of (data ?? []) as unknown as Record<string, string>[]) {
      names.set(row.id, row[source.column]);
    }
  }
  return names;
}

export async function findAssignmentById(
  db: TypedSupabaseClient,
  userId: string,
  assignmentId: string,
): Promise<BeneficiaryAssignment | null> {
  const { data, error } = await db
    .from("beneficiary_assignments")
    .select("id, beneficiary_id, resource_type, resource_id, allocation_percentage, created_at")
    .eq("id", assignmentId)
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  const names = await resourceNames(db, userId, [data]);
  return {
    id: data.id,
    beneficiaryId: data.beneficiary_id,
    resourceType: data.resource_type,
    resourceId: data.resource_id,
    resourceName: names.get(data.resource_id) ?? null,
    allocationPercentage: data.allocation_percentage,
    createdAt: data.created_at,
  };
}

/** Beneficiaries the Dead Man’s Switch would notify and release to. */
export async function listTrustedContactIds(
  db: TypedSupabaseClient,
  userId: string,
): Promise<string[]> {
  const { data: switches, error: switchError } = await db
    .from("dead_man_switches")
    .select("id")
    .eq("user_id", userId);
  if (switchError) throw switchError;
  if (!switches || switches.length === 0) return [];

  const { data, error } = await db
    .from("dead_man_switch_contacts")
    .select("beneficiary_id")
    .in(
      "dead_man_switch_id",
      switches.map((row) => row.id),
    );
  if (error) throw error;
  return (data ?? []).map((row) => row.beneficiary_id);
}

/** Beneficiaries designated as emergency contacts on an active configuration. */
export async function listEmergencyContactIds(
  db: TypedSupabaseClient,
  userId: string,
): Promise<string[]> {
  const { data, error } = await db
    .from("emergency_access_configs")
    .select("beneficiary_id")
    .eq("user_id", userId)
    .eq("status", "ACTIVE")
    .is("deleted_at", null);
  if (error) throw error;
  return (data ?? []).map((row) => row.beneficiary_id);
}
