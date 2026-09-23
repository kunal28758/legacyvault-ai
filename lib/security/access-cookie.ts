import "server-only";

import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

import { getEnvGroup } from "@/lib/config/env";

/**
 * The beneficiary access cookie (ADR-014 § 3).
 *
 * The emailed link carries the token once; from then on the session is this
 * cookie, which holds nothing but `{ tokenId, exp }` encrypted with a dedicated
 * server key. It is not a capability on its own: every request still re-reads
 * the token row and re-checks revocation, expiry and the beneficiary's status,
 * so revoking a link ends the session on the next request rather than in thirty
 * minutes.
 */
export const ACCESS_COOKIE_NAME = "lv_access";
export const ACCESS_COOKIE_PATH = "/api/v1/access";
/** Sliding window, never extended past the token's own expiry. */
export const ACCESS_COOKIE_TTL_SECONDS = 30 * 60;

const ALGORITHM = "aes-256-gcm";
const IV_BYTES = 12;

export interface AccessSession {
  tokenId: string;
  /** Epoch seconds. The cookie is also given a matching Max-Age. */
  exp: number;
}

function key(): Buffer {
  return Buffer.from(getEnvGroup("accessCookie").ACCESS_COOKIE_KEY, "base64");
}

export function sealAccessSession(session: AccessSession): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key(), iv);
  const ciphertext = Buffer.concat([
    cipher.update(JSON.stringify(session), "utf8"),
    cipher.final(),
  ]);
  return [
    iv.toString("base64url"),
    cipher.getAuthTag().toString("base64url"),
    ciphertext.toString("base64url"),
  ].join(".");
}

/** Returns null for anything that is not a valid, unexpired session of ours. */
export function openAccessSession(value: string | undefined | null): AccessSession | null {
  if (!value) return null;
  const [ivPart, tagPart, dataPart] = value.split(".");
  if (!ivPart || !tagPart || !dataPart) return null;

  try {
    const decipher = createDecipheriv(ALGORITHM, key(), Buffer.from(ivPart, "base64url"));
    decipher.setAuthTag(Buffer.from(tagPart, "base64url"));
    const plaintext = Buffer.concat([
      decipher.update(Buffer.from(dataPart, "base64url")),
      decipher.final(),
    ]).toString("utf8");

    const parsed: unknown = JSON.parse(plaintext);
    if (!parsed || typeof parsed !== "object") return null;
    const session = parsed as Partial<AccessSession>;
    if (typeof session.tokenId !== "string" || typeof session.exp !== "number") return null;
    if (session.exp * 1000 <= Date.now()) return null;
    return { tokenId: session.tokenId, exp: session.exp };
  } catch {
    // Tampered, truncated, or sealed with a previous key.
    return null;
  }
}

/**
 * The cookie attributes, in one place.
 *
 * `SameSite=Strict` and the narrow path mean the cookie is never sent to the
 * owner-facing application, and `Secure` is dropped only for local http.
 */
export function accessCookieOptions(maxAgeSeconds: number) {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict" as const,
    path: ACCESS_COOKIE_PATH,
    maxAge: maxAgeSeconds,
  };
}
