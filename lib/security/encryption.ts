import "server-only";

import { createCipheriv, createDecipheriv, randomBytes, timingSafeEqual } from "node:crypto";

import { getEnvGroup } from "@/lib/config/env";

/**
 * Application-level field encryption (task T020, constitution IV, FR-Q018).
 *
 * AES-256-GCM with a random 96-bit IV per value. The envelope shape is fixed by
 * `data-model.md` § Write-Protection Model 6 and is validated again inside
 * `create_asset()` / `set_encrypted_fields()`, which are the only write paths
 * for an `ENCRYPTED` column — plaintext can never reach one.
 *
 * `keyId` travels with the ciphertext so `ENCRYPTION_KEY_PREVIOUS` can still be
 * read during a rotation window (T240). Keys come from server-only environment
 * configuration and are never logged, returned or stored beside the data.
 */
export interface EncryptionEnvelope {
  ciphertext: string;
  iv: string;
  authTag: string;
  keyId: string;
}

const IV_BYTES = 12;
const AUTH_TAG_BYTES = 16;
const ALGORITHM = "aes-256-gcm";

interface KeyMaterial {
  keyId: string;
  key: Buffer;
}

function activeKey(): KeyMaterial {
  const { ENCRYPTION_KEY } = getEnvGroup("encryption");
  return { keyId: ENCRYPTION_KEY.keyId, key: Buffer.from(ENCRYPTION_KEY.material, "base64") };
}

function keyFor(keyId: string): KeyMaterial {
  const env = getEnvGroup("encryption");
  if (env.ENCRYPTION_KEY.keyId === keyId) {
    return { keyId, key: Buffer.from(env.ENCRYPTION_KEY.material, "base64") };
  }
  if (env.ENCRYPTION_KEY_PREVIOUS?.keyId === keyId) {
    return { keyId, key: Buffer.from(env.ENCRYPTION_KEY_PREVIOUS.material, "base64") };
  }
  // The key id is not secret, but no key material is ever included here.
  throw new Error(`No encryption key is configured for keyId "${keyId}"`);
}

export function encrypt(plaintext: string): EncryptionEnvelope {
  const { keyId, key } = activeKey();
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return {
    ciphertext: ciphertext.toString("base64"),
    iv: iv.toString("base64"),
    authTag: cipher.getAuthTag().toString("base64"),
    keyId,
  };
}

export function decrypt(envelope: EncryptionEnvelope): string {
  if (!isEncryptionEnvelope(envelope)) {
    throw new Error("Malformed encryption envelope");
  }
  const { key } = keyFor(envelope.keyId);
  const decipher = createDecipheriv(ALGORITHM, key, Buffer.from(envelope.iv, "base64"));
  decipher.setAuthTag(Buffer.from(envelope.authTag, "base64"));
  // Throws on tampered ciphertext or auth tag — never returns unauthenticated data.
  return Buffer.concat([
    decipher.update(Buffer.from(envelope.ciphertext, "base64")),
    decipher.final(),
  ]).toString("utf8");
}

/** Same shape check the database performs in `lv_is_envelope()`. */
export function isEncryptionEnvelope(value: unknown): value is EncryptionEnvelope {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<EncryptionEnvelope>;
  return (
    typeof candidate.ciphertext === "string" &&
    candidate.ciphertext.length > 0 &&
    typeof candidate.iv === "string" &&
    decodedLength(candidate.iv) === IV_BYTES &&
    typeof candidate.authTag === "string" &&
    decodedLength(candidate.authTag) === AUTH_TAG_BYTES &&
    typeof candidate.keyId === "string" &&
    candidate.keyId.length > 0
  );
}

/** Encrypts when a value is present; `null` clears the column through the same guarded path. */
export function encryptOptional(value: string | null | undefined): EncryptionEnvelope | null {
  const trimmed = typeof value === "string" ? value.trim() : "";
  return trimmed.length > 0 ? encrypt(trimmed) : null;
}

/** Display hint for a masked field — never derived from the plaintext on the client. */
export function maskTail(plaintext: string, visible = 4): string {
  const compact = plaintext.replace(/\s+/g, "");
  if (compact.length <= visible) return "••••";
  return `•••• ${compact.slice(-visible)}`;
}

/** Constant-time comparison for hashes and tokens (never for encrypted payloads). */
export function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

function decodedLength(base64: string): number {
  try {
    return Buffer.from(base64, "base64").length;
  } catch {
    return -1;
  }
}
