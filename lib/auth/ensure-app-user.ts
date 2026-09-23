import "server-only";

import { currentUser } from "@clerk/nextjs/server";
import type { User as ClerkUser } from "@clerk/nextjs/server";

import { createServiceClient } from "@/lib/db/server";
import { logger } from "@/lib/observability/logger";
import type { Database } from "@/lib/types/database";

/**
 * Clerk identity → `public.users` synchronisation (task T036, ADR-003).
 *
 * Clerk owns credentials, MFA and sessions; this table owns the profile, the
 * preferences and — critically — the **role**, which is the source of truth for
 * authorization (constitution III, FR-P012).
 *
 * The webhook (T198) is the primary sync path. This function is the idempotent
 * fallback for the race where a user's first authenticated request arrives
 * before the webhook does, and it is deliberately the only place that writes
 * mirrored Clerk fields. It uses the service client because the row may not
 * exist yet, so no RLS policy could match it — the Clerk subject is taken from
 * the verified session, never from client input.
 */
export type AppUserRow = Database["public"]["Tables"]["users"]["Row"];

export interface AppUser {
  id: string;
  clerkUserId: string;
  email: string;
  emailVerified: boolean;
  name: string;
  mfaEnabled: boolean;
  role: Database["public"]["Enums"]["user_role"];
  onboardingCompletedAt: string | null;
  deletionRequestedAt: string | null;
}

export interface ClerkIdentity {
  clerkUserId: string;
  email: string;
  name: string;
  emailVerified: boolean;
  mfaEnabled: boolean;
}

export function toAppUser(row: AppUserRow): AppUser {
  return {
    id: row.id,
    clerkUserId: row.clerk_user_id,
    email: row.email,
    emailVerified: row.email_verified,
    name: row.name,
    mfaEnabled: row.mfa_enabled,
    role: row.role,
    onboardingCompletedAt: row.onboarding_completed_at,
    deletionRequestedAt: row.deletion_requested_at,
  };
}

/** Normalises a Clerk user object (session or webhook payload) into our mirror fields. */
export function identityFromClerkUser(user: ClerkUser): ClerkIdentity {
  const primary =
    user.emailAddresses.find((address) => address.id === user.primaryEmailAddressId) ??
    user.emailAddresses[0];

  return {
    clerkUserId: user.id,
    email: (primary?.emailAddress ?? "").toLowerCase(),
    name:
      user.fullName ||
      [user.firstName, user.lastName].filter(Boolean).join(" ") ||
      user.username ||
      primary?.emailAddress ||
      "Account",
    emailVerified: primary?.verification?.status === "verified",
    mfaEnabled: Boolean(user.twoFactorEnabled),
  };
}

/**
 * Upserts the application row for a Clerk identity and returns it.
 *
 * Mirrored fields are refreshed on every call so a Clerk-side change (verified
 * email, enabled MFA, new display name) converges even if a webhook was missed.
 * `role` is never written here — promotion is an admin-only operation.
 */
export async function ensureAppUser(identity: ClerkIdentity): Promise<AppUser> {
  if (!identity.clerkUserId) throw new Error("ensureAppUser requires a Clerk subject");
  if (!identity.email) throw new Error("ensureAppUser requires an email address");

  const db = createServiceClient();

  const { data: existing, error: selectError } = await db
    .from("users")
    .select("*")
    .eq("clerk_user_id", identity.clerkUserId)
    .maybeSingle();

  if (selectError) throw selectError;

  const mirrored = {
    email: identity.email,
    email_verified: identity.emailVerified,
    name: identity.name,
    mfa_enabled: identity.mfaEnabled,
  };

  if (existing) {
    const unchanged =
      existing.email === mirrored.email &&
      existing.email_verified === mirrored.email_verified &&
      existing.name === mirrored.name &&
      existing.mfa_enabled === mirrored.mfa_enabled;

    if (unchanged) return toAppUser(existing);

    const { data: updated, error: updateError } = await db
      .from("users")
      .update(mirrored)
      .eq("id", existing.id)
      .select("*")
      .single();
    if (updateError) throw updateError;
    return toAppUser(updated);
  }

  const { data: inserted, error: insertError } = await db
    .from("users")
    .insert({ clerk_user_id: identity.clerkUserId, ...mirrored })
    .select("*")
    .single();

  if (insertError) {
    // A concurrent request (or the webhook) may have created the row first.
    if (insertError.code === "23505") {
      const { data: raced, error: reselectError } = await db
        .from("users")
        .select("*")
        .eq("clerk_user_id", identity.clerkUserId)
        .single();
      if (reselectError) throw reselectError;
      return toAppUser(raced);
    }
    throw insertError;
  }

  logger.info({ userId: inserted.id }, "application user provisioned for Clerk identity");
  return toAppUser(inserted);
}

/** Reads the current Clerk session user and syncs it. Returns null when signed out. */
export async function ensureAppUserFromSession(): Promise<AppUser | null> {
  const user = await currentUser();
  if (!user) return null;
  return ensureAppUser(identityFromClerkUser(user));
}
