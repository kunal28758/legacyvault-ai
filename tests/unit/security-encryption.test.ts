import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { resetEnvGroupCache } from "@/lib/config/env";
import {
  decrypt,
  encrypt,
  encryptOptional,
  isEncryptionEnvelope,
  maskTail,
  safeEqual,
} from "@/lib/security/encryption";

/**
 * Field encryption (task T020, constitution IV, FR-Q018).
 *
 * Synthetic keys generated per test run — never a real key, never a fixture
 * committed to the repository (constitution XVII).
 */
const KEY_A = "k1:" + Buffer.from(new Uint8Array(32).fill(7)).toString("base64");
const KEY_B = "k0:" + Buffer.from(new Uint8Array(32).fill(9)).toString("base64");

beforeEach(() => {
  process.env.ENCRYPTION_KEY = KEY_A;
  delete process.env.ENCRYPTION_KEY_PREVIOUS;
  resetEnvGroupCache();
});

afterEach(() => {
  delete process.env.ENCRYPTION_KEY;
  delete process.env.ENCRYPTION_KEY_PREVIOUS;
  resetEnvGroupCache();
});

describe("AES-256-GCM field encryption", () => {
  it("round-trips a value and records the active key id", () => {
    const envelope = encrypt("4111 1111 1111 1111");
    expect(envelope.keyId).toBe("k1");
    expect(envelope.ciphertext).not.toContain("4111");
    expect(decrypt(envelope)).toBe("4111 1111 1111 1111");
  });

  it("produces a distinct IV per call, so equal plaintexts differ", () => {
    const first = encrypt("same value");
    const second = encrypt("same value");
    expect(first.iv).not.toBe(second.iv);
    expect(first.ciphertext).not.toBe(second.ciphertext);
    expect(decrypt(first)).toBe(decrypt(second));
  });

  it("refuses tampered ciphertext (authentication tag check)", () => {
    const envelope = encrypt("sensitive");
    const flipped = Buffer.from(envelope.ciphertext, "base64");
    flipped[0] ^= 0xff;
    expect(() => decrypt({ ...envelope, ciphertext: flipped.toString("base64") })).toThrow();
  });

  it("refuses a tampered auth tag", () => {
    const envelope = encrypt("sensitive");
    const tag = Buffer.from(envelope.authTag, "base64");
    tag[0] ^= 0xff;
    expect(() => decrypt({ ...envelope, authTag: tag.toString("base64") })).toThrow();
  });

  it("reads a value written with the previous key during a rotation window", () => {
    process.env.ENCRYPTION_KEY = KEY_B;
    resetEnvGroupCache();
    const underOldKey = encrypt("written before rotation");
    expect(underOldKey.keyId).toBe("k0");

    // Rotate: the old key becomes ENCRYPTION_KEY_PREVIOUS.
    process.env.ENCRYPTION_KEY = KEY_A;
    process.env.ENCRYPTION_KEY_PREVIOUS = KEY_B;
    resetEnvGroupCache();

    expect(decrypt(underOldKey)).toBe("written before rotation");
    expect(encrypt("written after rotation").keyId).toBe("k1");
  });

  it("fails closed when the key id is unknown", () => {
    const envelope = encrypt("value");
    expect(() => decrypt({ ...envelope, keyId: "k9" })).toThrow(/k9/);
  });

  it("validates the envelope shape the database also enforces", () => {
    expect(isEncryptionEnvelope(encrypt("v"))).toBe(true);
    expect(isEncryptionEnvelope({ ciphertext: "x", iv: "short", authTag: "y", keyId: "k1" })).toBe(
      false,
    );
    expect(isEncryptionEnvelope({ ciphertext: "x" })).toBe(false);
    expect(isEncryptionEnvelope("plaintext")).toBe(false);
    expect(isEncryptionEnvelope(null)).toBe(false);
  });

  it("treats blank input as a cleared field rather than encrypting empty text", () => {
    expect(encryptOptional("   ")).toBeNull();
    expect(encryptOptional(null)).toBeNull();
    expect(encryptOptional(undefined)).toBeNull();
    expect(encryptOptional("value")).not.toBeNull();
  });

  it("masks a value to its last four characters only", () => {
    expect(maskTail("4111111111114821")).toBe("•••• 4821");
    expect(maskTail("12")).toBe("••••");
    expect(maskTail("4111111111114821")).not.toContain("4111");
  });

  it("compares in constant time without throwing on length mismatch", () => {
    expect(safeEqual("abc", "abc")).toBe(true);
    expect(safeEqual("abc", "abd")).toBe(false);
    expect(safeEqual("abc", "abcdef")).toBe(false);
  });
});
