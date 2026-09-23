import "server-only";

import type { TypedSupabaseClient } from "@/lib/db/server";
import type { Database } from "@/lib/types/database";

/**
 * User data access (task T035 repository half).
 *
 * Repository conventions for every entity that follows:
 *  • a repository receives an already-chosen Supabase client — it never decides
 *    between the user-scoped and service clients, because that is an
 *    authorization decision and belongs to the service;
 *  • every query is still scoped by owner in SQL, so a service bug cannot widen
 *    access beyond what RLS would allow anyway (defence in depth);
 *  • repositories map rows to domain shapes and surface PostgREST errors
 *    unchanged, so `mapDatabaseError()` can translate SQLSTATE precisely;
 *  • no business rules here — those live in `lib/services`.
 */
export type UserRow = Database["public"]["Tables"]["users"]["Row"];

export interface UserProfile {
  id: string;
  email: string;
  emailVerified: boolean;
  name: string;
  mfaEnabled: boolean;
  role: Database["public"]["Enums"]["user_role"];
  dateOfBirth: string | null;
  phone: string | null;
  alternateEmail: string | null;
  address: Record<string, unknown> | null;
  familyInfo: Record<string, unknown> | null;
  preferences: Record<string, unknown>;
  notificationPreferences: Record<string, unknown>;
  securityPreferences: Record<string, unknown>;
  /** Presence only — the encrypted value itself is never returned by a read. */
  hasIdentificationDetails: boolean;
  onboardingCompletedAt: string | null;
  lastLoginAt: string | null;
  deletionRequestedAt: string | null;
  createdAt: string;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

export function toUserProfile(row: UserRow): UserProfile {
  return {
    id: row.id,
    email: row.email,
    emailVerified: row.email_verified,
    name: row.name,
    mfaEnabled: row.mfa_enabled,
    role: row.role,
    dateOfBirth: row.date_of_birth,
    phone: row.phone,
    alternateEmail: row.alternate_email,
    address: asRecord(row.address),
    familyInfo: asRecord(row.family_info),
    preferences: asRecord(row.preferences) ?? {},
    notificationPreferences: asRecord(row.notification_preferences) ?? {},
    securityPreferences: asRecord(row.security_preferences) ?? {},
    hasIdentificationDetails: Boolean(row.identification_details),
    onboardingCompletedAt: row.onboarding_completed_at,
    lastLoginAt: row.last_login_at,
    deletionRequestedAt: row.deletion_requested_at,
    createdAt: row.created_at,
  };
}

/** Reads the caller's own row. With the user client, RLS also scopes this. */
export async function findById(
  db: TypedSupabaseClient,
  userId: string,
): Promise<UserProfile | null> {
  const { data, error } = await db.from("users").select("*").eq("id", userId).maybeSingle();
  if (error) throw error;
  return data ? toUserProfile(data) : null;
}

/**
 * Class A profile update: only the allow-listed plain columns.
 *
 * `identification_details` is deliberately absent — it is an `ENCRYPTED` column
 * with no `authenticated` grant, written only by `set_encrypted_fields()`
 * (ADR-004 r4). Attempting it here would fail at the database anyway.
 */
export type ProfilePatch = Partial<
  Pick<
    Database["public"]["Tables"]["users"]["Update"],
    | "date_of_birth"
    | "phone"
    | "alternate_email"
    | "address"
    | "family_info"
    | "preferences"
    | "notification_preferences"
    | "security_preferences"
    | "onboarding_completed_at"
  >
>;

export async function updateProfile(
  db: TypedSupabaseClient,
  userId: string,
  patch: ProfilePatch,
): Promise<UserProfile> {
  const { data, error } = await db
    .from("users")
    .update(patch)
    .eq("id", userId)
    .select("*")
    .single();
  if (error) throw error;
  return toUserProfile(data);
}
