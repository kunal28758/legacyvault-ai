import type { Database } from "@/lib/types/database";
import type { AccessScope } from "@/lib/types/dms";

/**
 * Access tokens (ADR-014).
 *
 * The plaintext link is returned exactly once, by the endpoint that mints it.
 * Only its SHA-256 hash is stored, so a database copy cannot be turned back
 * into a working link — and nothing here ever carries the plaintext.
 */
export type AccessGrantType = Database["public"]["Enums"]["access_grant_type"];
export type TokenRevokedReason = Database["public"]["Enums"]["token_revoked_reason"];

export interface AccessTokenSummary {
  id: string;
  beneficiaryId: string;
  beneficiaryName: string;
  grantType: AccessGrantType;
  scope: AccessScope;
  expiresAt: string;
  revokedAt: string | null;
  revokedReason: TokenRevokedReason | null;
  deliveredAt: string | null;
  usedAt: string | null;
  lastUsedAt: string | null;
  createdAt: string;
}

/** Returned once, on issue or resend, and never stored anywhere afterwards. */
export interface IssuedAccessToken {
  token: AccessTokenSummary;
  /** The plaintext link. Shown to the owner once; not persisted. */
  link: string;
}
