import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { resetEnvGroupCache } from "@/lib/config/env";
import {
  ACCESS_COOKIE_PATH,
  accessCookieOptions,
  openAccessSession,
  sealAccessSession,
} from "@/lib/security/access-cookie";

/**
 * The beneficiary access cookie (ADR-014 § 3).
 *
 * It is the only thing standing between a stranger and someone's vault once
 * the link has been used, so the properties asserted here are: it cannot be
 * read, it cannot be edited, it cannot be minted with another key, and it dies
 * on its own. Keys are synthetic and generated per run.
 */
const KEY = Buffer.from(new Uint8Array(32).fill(5)).toString("base64");
const OTHER_KEY = Buffer.from(new Uint8Array(32).fill(6)).toString("base64");
const TOKEN_ID = "11111111-1111-4111-8111-111111111111";

function future(seconds = 900): number {
  return Math.floor(Date.now() / 1000) + seconds;
}

beforeEach(() => {
  process.env.ACCESS_COOKIE_KEY = KEY;
  resetEnvGroupCache();
});

afterEach(() => {
  delete process.env.ACCESS_COOKIE_KEY;
  resetEnvGroupCache();
});

describe("access cookie", () => {
  it("round-trips a session and reveals nothing in the cookie value", () => {
    const sealed = sealAccessSession({ tokenId: TOKEN_ID, exp: future() });

    expect(sealed).not.toContain(TOKEN_ID);
    expect(sealed.split(".")).toHaveLength(3);
    expect(openAccessSession(sealed)?.tokenId).toBe(TOKEN_ID);
  });

  it("produces a different value every time", () => {
    const session = { tokenId: TOKEN_ID, exp: future() };
    expect(sealAccessSession(session)).not.toBe(sealAccessSession(session));
  });

  it("refuses a tampered value", () => {
    const sealed = sealAccessSession({ tokenId: TOKEN_ID, exp: future() });
    const [iv, tag, data] = sealed.split(".");

    // Flip a whole byte of the ciphertext — base64url's last character can
    // carry unused bits, so editing a character is not always a real change.
    const bytes = Buffer.from(data, "base64url");
    bytes[0] ^= 0xff;
    expect(openAccessSession([iv, tag, bytes.toString("base64url")].join("."))).toBeNull();

    const tagBytes = Buffer.from(tag, "base64url");
    tagBytes[0] ^= 0xff;
    expect(openAccessSession([iv, tagBytes.toString("base64url"), data].join("."))).toBeNull();
    expect(openAccessSession([iv, tag].join("."))).toBeNull();
    expect(openAccessSession("not-a-cookie")).toBeNull();
    expect(openAccessSession(undefined)).toBeNull();
  });

  it("refuses a session sealed with a different key", () => {
    const sealed = sealAccessSession({ tokenId: TOKEN_ID, exp: future() });

    process.env.ACCESS_COOKIE_KEY = OTHER_KEY;
    resetEnvGroupCache();
    expect(openAccessSession(sealed)).toBeNull();
  });

  it("refuses an expired session even though it is authentic", () => {
    const sealed = sealAccessSession({ tokenId: TOKEN_ID, exp: future(-1) });
    expect(openAccessSession(sealed)).toBeNull();
  });

  it("scopes the cookie to the access API and keeps it off the wire elsewhere", () => {
    const options = accessCookieOptions(1800);
    expect(options.httpOnly).toBe(true);
    expect(options.sameSite).toBe("strict");
    expect(options.path).toBe(ACCESS_COOKIE_PATH);
    expect(ACCESS_COOKIE_PATH.startsWith("/api/v1/access")).toBe(true);
    expect(options.maxAge).toBe(1800);
  });
});
