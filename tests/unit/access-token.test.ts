import { beforeEach, describe, expect, it } from "vitest";

import { resetEnvGroupCache } from "@/lib/config/env";
import {
  MAX_TOKEN_TTL_DAYS,
  accessLinkFor,
  accessTokenMatches,
  expiryFromDays,
  expiryFromHours,
  hashAccessToken,
  mintAccessToken,
} from "@/lib/security/access-token";

/**
 * Beneficiary access links (ADR-014).
 *
 * The security property is that the stored value cannot be turned back into a
 * working link: only a SHA-256 hash is persisted, and the plaintext exists for
 * exactly one response.
 */
beforeEach(() => {
  process.env.APP_URL = "https://vault.example.test";
  resetEnvGroupCache();
});

describe("token minting", () => {
  it("produces a 64-hex hash the guarded functions accept", () => {
    const { hash } = mintAccessToken();
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("never repeats a secret", () => {
    const seen = new Set(Array.from({ length: 200 }, () => mintAccessToken().plaintext));
    expect(seen.size).toBe(200);
  });

  it("uses a URL-safe secret with at least 256 bits of entropy", () => {
    const { plaintext } = mintAccessToken();
    expect(plaintext).toMatch(/^[A-Za-z0-9_-]+$/);
    // 32 bytes in base64url is 43 characters.
    expect(plaintext.length).toBeGreaterThanOrEqual(43);
  });

  it("does not leak the secret through the hash", () => {
    const { plaintext, hash } = mintAccessToken();
    expect(hash).not.toContain(plaintext);
    expect(hashAccessToken(plaintext)).toBe(hash);
  });
});

describe("token comparison", () => {
  it("matches only the right secret", () => {
    const { plaintext, hash } = mintAccessToken();
    expect(accessTokenMatches(plaintext, hash)).toBe(true);
    expect(accessTokenMatches(`${plaintext}x`, hash)).toBe(false);
    expect(accessTokenMatches(mintAccessToken().plaintext, hash)).toBe(false);
  });

  it("does not throw on a malformed stored hash", () => {
    expect(accessTokenMatches("anything", "not-a-hash")).toBe(false);
    expect(accessTokenMatches("anything", "")).toBe(false);
  });
});

describe("links and expiry", () => {
  it("builds the access link from the configured origin", () => {
    expect(accessLinkFor("secret-value")).toBe("https://vault.example.test/access?t=secret-value");
  });

  it("does not double a trailing slash", () => {
    process.env.APP_URL = "https://vault.example.test/";
    resetEnvGroupCache();
    expect(accessLinkFor("x")).toBe("https://vault.example.test/access?t=x");
  });

  it("computes expiries in the future", () => {
    const days = Date.parse(expiryFromDays(MAX_TOKEN_TTL_DAYS));
    expect(days).toBeGreaterThan(Date.now());
    expect(days).toBeLessThanOrEqual(Date.now() + MAX_TOKEN_TTL_DAYS * 86_400_000 + 1000);

    const hours = Date.parse(expiryFromHours(1));
    expect(hours).toBeGreaterThan(Date.now());
  });
});
