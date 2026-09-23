import "server-only";

import { auth } from "@clerk/nextjs/server";

import { ApiError } from "@/lib/api/errors";
import { ensureAppUserFromSession, type AppUser } from "@/lib/auth/ensure-app-user";
import type { Database } from "@/lib/types/database";

/**
 * Server-side authentication and authorization (task T036, constitution III).
 *
 * The authenticated identity always comes from the verified Clerk session. A
 * client-supplied user id is never trusted anywhere in this codebase — services
 * receive the `AppUser` resolved here and scope every query to `user.id`.
 *
 * Route Handlers get this through `withApi()`; Server Components and Server
 * Actions call it directly so they enforce the same rule as the API.
 */
export type UserRole = Database["public"]["Enums"]["user_role"];

/** Throws 401 when signed out. Also provisions the application row on first use. */
export async function requireUser(): Promise<AppUser> {
  const { userId } = await auth();
  if (!userId) throw ApiError.unauthenticated();

  const user = await ensureAppUserFromSession();
  if (!user) throw ApiError.unauthenticated();

  // A soft-deleted account keeps its rows for the grace period but must not act.
  if (user.deletionRequestedAt) {
    // Sign-in still works so the owner can cancel deletion; writes are refused
    // by the services that check this flag.
    return user;
  }
  return user;
}

/** Null instead of throwing — for Server Components that render a signed-out view. */
export async function getOptionalUser(): Promise<AppUser | null> {
  const { userId } = await auth();
  if (!userId) return null;
  return ensureAppUserFromSession();
}

/**
 * Role check against the database (never against a Clerk claim): `users.role`
 * is the source of truth and cannot be changed by any `authenticated`-callable
 * path (ADR-004 § 6, `protect_identity_columns`).
 */
export async function requireRole(roles: readonly UserRole[]): Promise<AppUser> {
  const user = await requireUser();
  if (!roles.includes(user.role)) throw ApiError.forbidden();
  return user;
}

export function isSuperAdmin(user: AppUser): boolean {
  return user.role === "SUPER_ADMIN";
}
