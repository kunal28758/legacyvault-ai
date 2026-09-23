import "server-only";

import { cookies } from "next/headers";

import { ApiError } from "@/lib/api/errors";
import { ACCESS_COOKIE_NAME, openAccessSession } from "@/lib/security/access-cookie";
import { requireGrant, type AccessGrant } from "@/lib/services/access-portal.service";

/**
 * Resolves the beneficiary grant behind the access cookie (ADR-014 § 3).
 *
 * Opening the cookie is only the first half: the token row is then re-read and
 * re-checked, so a link revoked a second ago cannot be used with a cookie
 * minted a minute ago.
 */
export async function requireAccessGrant(): Promise<AccessGrant> {
  const jar = await cookies();
  const session = openAccessSession(jar.get(ACCESS_COOKIE_NAME)?.value);
  if (!session) throw new ApiError(401, "UNAUTHENTICATED", "This link is no longer valid.");
  return requireGrant(session.tokenId);
}

/** The same, but for endpoints that work with or without a live session. */
export async function optionalAccessGrant(): Promise<AccessGrant | null> {
  try {
    return await requireAccessGrant();
  } catch {
    return null;
  }
}
