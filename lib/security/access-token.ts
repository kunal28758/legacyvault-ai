import "server-only";

import { createHash, randomBytes, randomInt, timingSafeEqual } from "node:crypto";

import { getEnvGroup } from "@/lib/config/env";

/**
 * Beneficiary access links (ADR-014).
 *
 * The link carries a 256-bit random secret. Only its SHA-256 hash is ever
 * stored, so a copy of the database cannot be turned back into a working link,
 * and the plaintext exists solely in the response that mints it — it is never
 * logged, never written to a job payload, and never persisted.
 *
 * The hash is hex because that is what the guarded functions check
 * (`^[0-9a-f]{64}$`).
 */
const TOKEN_BYTES = 32;

export interface MintedToken {
  /** The secret that goes in the link. Hand it to the recipient and forget it. */
  plaintext: string;
  hash: string;
}

export function mintAccessToken(): MintedToken {
  const plaintext = randomBytes(TOKEN_BYTES).toString("base64url");
  return { plaintext, hash: hashAccessToken(plaintext) };
}

export function hashAccessToken(plaintext: string): string {
  return createHash("sha256").update(plaintext, "utf8").digest("hex");
}

/**
 * A six-digit one-time code (emergency requests, release verification). Like a
 * token, only `hashAccessToken(code)` is ever stored.
 */
export function oneTimeCode(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, "0");
}

/** Constant-time comparison, for the exchange endpoint. */
export function accessTokenMatches(plaintext: string, storedHash: string): boolean {
  const candidate = Buffer.from(hashAccessToken(plaintext), "hex");
  const stored = Buffer.from(storedHash, "hex");
  if (candidate.length !== stored.length) return false;
  return timingSafeEqual(candidate, stored);
}

/**
 * The URL a beneficiary receives.
 *
 * The secret travels in the fragment, which a browser never sends to a server:
 * it reaches no request line, so no platform or application request log, no
 * Referer, and no server-rendered page. The portal moves it into a POST body
 * and clears the address bar. (Older links used `?t=`; the proxy converts those.)
 */
export function accessLinkFor(plaintext: string): string {
  const { APP_URL } = getEnvGroup("core");
  return `${APP_URL.replace(/\/$/, "")}/access#t=${plaintext}`;
}

/** The longest a DIRECT_SHARE link may live (FR-D011). */
export const MAX_TOKEN_TTL_DAYS = 30;

/**
 * The database refuses an expiry beyond `now() + 30 days` by its own clock. A
 * request for exactly the maximum, timed by a server clock a little ahead of the
 * database's, landed just past it and was refused (INVALID_EXPIRY) — a share
 * link then went unsent. Requesting a few minutes less keeps every ttlDays
 * request inside the limit whatever the skew.
 */
export const EXPIRY_CLOCK_MARGIN_MS = 5 * 60 * 1000;

export function expiryFromDays(days: number): string {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000 - EXPIRY_CLOCK_MARGIN_MS).toISOString();
}

export function expiryFromHours(hours: number): string {
  return new Date(Date.now() + hours * 60 * 60 * 1000).toISOString();
}
