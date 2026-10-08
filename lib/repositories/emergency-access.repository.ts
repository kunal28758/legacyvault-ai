import "server-only";

import type { TypedSupabaseClient } from "@/lib/db/server";
import type { AccessScope } from "@/lib/types/dms";
import type { EmergencyContact, EmergencyRequest } from "@/lib/types/emergency-access";
import type { Database } from "@/lib/types/database";

/**
 * Emergency access data access (FR-J001–J010).
 *
 * Configurations are Class B (the `ea_*` guarded functions). Requests are
 * Class C: they are created and advanced by the public request flow through
 * service-role functions, and the owner may only read them and decide them.
 *
 * `otp_hash` has no SELECT grant at all, so it cannot be read here even by
 * accident.
 */
export type EaConfigRow = Database["public"]["Tables"]["emergency_access_configs"]["Row"];

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

export async function listContacts(
  db: TypedSupabaseClient,
  userId: string,
): Promise<EmergencyContact[]> {
  const { data, error } = await db
    .from("emergency_access_configs")
    .select("*")
    .eq("user_id", userId)
    .is("deleted_at", null)
    .order("created_at", { ascending: false });
  if (error) throw error;
  if (!data || data.length === 0) return [];

  const { data: beneficiaries, error: beneficiaryError } = await db
    .from("beneficiaries")
    .select("id, name, email")
    .eq("user_id", userId)
    .in(
      "id",
      data.map((row) => row.beneficiary_id),
    );
  if (beneficiaryError) throw beneficiaryError;

  const byId = new Map((beneficiaries ?? []).map((row) => [row.id, row]));
  return data.map((row) => ({
    id: row.id,
    beneficiaryId: row.beneficiary_id,
    beneficiaryName: byId.get(row.beneficiary_id)?.name ?? "Beneficiary",
    beneficiaryEmail: byId.get(row.beneficiary_id)?.email ?? "",
    accessScope: asScope(row.access_scope),
    onTimeout: row.on_timeout,
    timeoutHours: row.timeout_hours,
    requestExpiryHours: row.request_expiry_hours,
    accessDurationHours: row.access_duration_hours,
    status: row.status,
    lastDesignationSentAt: row.last_designation_sent_at,
    createdAt: row.created_at,
  }));
}

export async function findConfig(
  db: TypedSupabaseClient,
  userId: string,
  configId: string,
): Promise<EaConfigRow | null> {
  const { data, error } = await db
    .from("emergency_access_configs")
    .select("*")
    .eq("id", configId)
    .eq("user_id", userId)
    .is("deleted_at", null)
    .maybeSingle();
  if (error) throw error;
  return data;
}

/** Requests across all of the caller's configurations. */
export async function listRequests(
  db: TypedSupabaseClient,
  userId: string,
  contacts: EmergencyContact[],
): Promise<EmergencyRequest[]> {
  if (contacts.length === 0) return [];
  const byConfig = new Map(contacts.map((contact) => [contact.id, contact]));

  const { data, error } = await db
    .from("emergency_access_requests")
    // `otp_hash` is deliberately absent: there is no grant for it.
    .select(
      "id, config_id, requester_email, status, request_expires_at, decided_at, expires_at, revoked_at, created_at, auto_grant_held_at",
    )
    .in("config_id", [...byConfig.keys()])
    .order("created_at", { ascending: false })
    .limit(100);
  if (error) throw error;

  return (data ?? []).map((row) => ({
    id: row.id,
    configId: row.config_id,
    beneficiaryName: byConfig.get(row.config_id)?.beneficiaryName ?? "Beneficiary",
    requesterEmail: row.requester_email,
    status: row.status,
    requestExpiresAt: row.request_expires_at,
    decidedAt: row.decided_at,
    expiresAt: row.expires_at,
    revokedAt: row.revoked_at,
    createdAt: row.created_at,
    autoGrantHeldAt: row.auto_grant_held_at,
  }));
}

/** Requests whose timeout or expiry has elapsed (service role only). */
export async function listExpirable(
  serviceDb: TypedSupabaseClient,
  now: Date,
): Promise<
  {
    id: string;
    config_id: string;
    status: string;
    request_expires_at: string;
    expires_at: string | null;
  }[]
> {
  const { data, error } = await serviceDb
    .from("emergency_access_requests")
    .select("id, config_id, status, request_expires_at, expires_at")
    .in("status", ["PENDING", "VERIFYING", "VERIFIED", "APPROVED", "AUTO_GRANTED", "ACTIVE"])
    .limit(200);
  if (error) throw error;

  return (data ?? []).filter((row) => {
    const requestExpired = new Date(row.request_expires_at).getTime() <= now.getTime();
    const accessExpired = row.expires_at
      ? new Date(row.expires_at).getTime() <= now.getTime()
      : false;
    const undecided = ["PENDING", "VERIFYING", "VERIFIED"].includes(row.status);
    return undecided ? requestExpired : accessExpired;
  });
}
