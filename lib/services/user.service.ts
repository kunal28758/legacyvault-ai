import "server-only";

import { ApiError } from "@/lib/api/errors";
import { audit } from "@/lib/audit/audit.service";
import type { AppUser } from "@/lib/auth/ensure-app-user";
import { assertAccountActive } from "@/lib/auth/require-user";
import { createUserClient } from "@/lib/db/server";
import * as userRepository from "@/lib/repositories/user.repository";
import type { UserProfile } from "@/lib/repositories/user.repository";

/**
 * Current-user service (task T035).
 *
 * Service conventions for every domain that follows:
 *  • the first argument is always the authenticated `AppUser` resolved from the
 *    Clerk session by `requireUser()` — never an id supplied by the client;
 *  • the service performs the authorization of record (ownership / role) and
 *    then picks the client: user-scoped by default so RLS applies as a second
 *    barrier; the service client only on the ADR-004 system paths;
 *  • invariant-bearing writes go through a guarded `rpc()` rather than a direct
 *    table write, so the rule is enforced inside the transaction;
 *  • outcomes that the database cannot see are audited here.
 */
export interface UpdateProfileInput {
  dateOfBirth?: string | null;
  phone?: string | null;
  alternateEmail?: string | null;
  address?: Record<string, unknown> | null;
  familyInfo?: Record<string, unknown> | null;
}

export interface PreferencesInput {
  preferences?: Record<string, unknown>;
  notificationPreferences?: Record<string, unknown>;
  securityPreferences?: Record<string, unknown>;
}

export async function getMe(user: AppUser): Promise<UserProfile> {
  const db = await createUserClient();
  const profile = await userRepository.findById(db, user.id);
  // RLS scopes the row to the caller, so a miss means the account is gone.
  if (!profile) throw ApiError.notFound();
  return profile;
}

export async function updateProfile(
  user: AppUser,
  input: UpdateProfileInput,
  correlationId: string,
): Promise<UserProfile> {
  assertAccountActive(user);
  const db = await createUserClient();
  const before = await userRepository.findById(db, user.id);
  if (!before) throw ApiError.notFound();

  const patch: userRepository.ProfilePatch = {};
  if ("dateOfBirth" in input) patch.date_of_birth = input.dateOfBirth ?? null;
  if ("phone" in input) patch.phone = input.phone ?? null;
  if ("alternateEmail" in input)
    patch.alternate_email = input.alternateEmail?.toLowerCase() ?? null;
  if ("address" in input) patch.address = (input.address ?? null) as never;
  if ("familyInfo" in input) patch.family_info = (input.familyInfo ?? null) as never;

  if (Object.keys(patch).length === 0) return before;

  const updated = await userRepository.updateProfile(db, user.id, patch);

  // The Class A trigger also records this change; the service row carries the
  // correlation id and the authorization outcome (ADR-004 r4 § 4).
  await audit.log({
    actorId: user.id,
    actorRole: user.role,
    action: "user.profile_updated",
    resourceType: "users",
    resourceId: user.id,
    outcome: "SUCCESS",
    metadata: audit.diff(
      before as unknown as Record<string, unknown>,
      updated as unknown as Record<string, unknown>,
    ),
    correlationId,
  });

  return updated;
}

export async function updatePreferences(
  user: AppUser,
  input: PreferencesInput,
  correlationId: string,
): Promise<UserProfile> {
  assertAccountActive(user);
  const db = await createUserClient();
  const patch: userRepository.ProfilePatch = {};
  if (input.preferences) patch.preferences = input.preferences as never;
  if (input.notificationPreferences)
    patch.notification_preferences = input.notificationPreferences as never;
  if (input.securityPreferences) patch.security_preferences = input.securityPreferences as never;

  if (Object.keys(patch).length === 0) return getMe(user);

  const updated = await userRepository.updateProfile(db, user.id, patch);
  await audit.log({
    actorId: user.id,
    actorRole: user.role,
    action: "user.preferences_updated",
    resourceType: "users",
    resourceId: user.id,
    outcome: "SUCCESS",
    metadata: { changed: Object.keys(patch) },
    correlationId,
  });
  return updated;
}

export async function completeOnboarding(
  user: AppUser,
  correlationId: string,
): Promise<UserProfile> {
  assertAccountActive(user);
  const db = await createUserClient();
  const updated = await userRepository.updateProfile(db, user.id, {
    onboarding_completed_at: new Date().toISOString(),
  });
  await audit.log({
    actorId: user.id,
    actorRole: user.role,
    action: "user.onboarding_completed",
    resourceType: "users",
    resourceId: user.id,
    outcome: "SUCCESS",
    correlationId,
  });
  return updated;
}
