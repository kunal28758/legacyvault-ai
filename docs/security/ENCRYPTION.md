# Encryption — LegacyVault AI

**Purpose**: One place that explains what is encrypted, at which layer, with
which algorithm, where keys live, how they rotate, and what is hashed rather
than encrypted. It organizes decisions already made; it does not add any.

**Canonical sources**: constitution v2.0.1 Principle IV; `spec.md` FR-Q003,
FR-Q004, FR-Q018, NFR-SEC-001, § Data Protection Requirements;
`research.md` Decision 13; ADR-005 § 4, ADR-013, ADR-014 § 3, ADR-016;
`data-model.md` (`ENCRYPTED` markers, § Retention); tasks T007, T020, T213,
T230, T240.

**Status**: 📐 specified / 📋 planned. **Nothing is implemented** as of
2026-09-18; `lib/security/encryption.ts` does not yet exist.

---

## 1. Layers

| Layer | Mechanism | Covers | Status |
|---|---|---|---|
| In transit | TLS 1.2+ (Vercel, Supabase, Clerk, provider APIs) | all traffic (FR-Q004) | platform-provided |
| Database disks | Supabase provider encryption at rest | every table | platform-provided |
| Storage objects | Supabase Storage provider encryption at rest (AES-256), private buckets, signed URLs | documents, videos, quarantine objects (FR-H004, FR-K003) | platform-provided (ADR-005 § 4) |
| Application field encryption | AES-256-GCM in `lib/security/encryption.ts` (Node.js `crypto`), applied in the repository layer | the fields listed in § 2 | 📋 T020 |
| Access cookie | AES-GCM with a dedicated key (`ACCESS_COOKIE_KEY`) over `{ tokenId, exp }` | external-recipient access sessions | 📋 T230 (ADR-014) |
| Application-layer envelope encryption of file bodies | per-object data key wrapped by an app master key | documents (≤ 50 MB) | ⏸️ **deferred** (ADR-013) |

## 2. What is application-encrypted (`data-model.md` `ENCRYPTED`)

| Entity | Field(s) | Why |
|---|---|---|
| User (§ 1) | `identificationDetails` | government/identity numbers |
| FinancialAsset (§ 3) | `accountNumber`, `policyNumber` | FR-E003 |
| DigitalAsset (§ 5) | `credentials`, `recoveryInfo` | FR-G003 |
| AiDraftVersion (§ 28) | `content` (will draft sections / analysis findings) | may contain PII and legal content (ADR-016) |

The first three rows have **no direct write grant**: they are written only
through `create_asset()` / `set_encrypted_fields()`, which accept a well-formed
envelope (`{ ciphertext, iv, authTag, keyId }`) or NULL (ADR-004 r4;
`data-model.md` § Write-Protection Model 6). `AiDraftVersion.content` is
written by the AI draft functions / service client (ADR-016).

Decrypted values are returned only on authorized reads; for asset secrets the
read requires Clerk reverification and is audited (`asset.credential_viewed`,
FR-G004/G005). Encrypted fields are masked (`••••••`) in standard responses
and never written to logs.

**Not application-encrypted** (protected by RLS/grants and provider disk
encryption): names, emails, relationships, addresses, family information,
asset names/values/notes, plan step data, audit metadata. This is the
specified baseline, not an omission.

## 3. Algorithm and format (research Decision 13, T020)

- AES-256-GCM (authenticated encryption: confidentiality + integrity).
- A fresh random IV per encryption; auth tag stored with the ciphertext.
- Every ciphertext records the **`keyId`** of the key that produced it so
  that rotation can proceed without downtime.
- Encryption/decryption happens in repositories before persistence / after
  read — never in Route Handlers or UI.

## 4. Keys (constitution IV, FR-Q018)

| Key | Purpose | Location |
|---|---|---|
| `ENCRYPTION_KEY` | active application field key (32 bytes, base64) | server environment configuration (Vercel env / local `.env.local`), never in source or client bundles |
| `ENCRYPTION_KEY_PREVIOUS` | previous key kept readable during a rotation window (dual-read by `keyId`) | same |
| `ACCESS_COOKIE_KEY` | access-cookie encryption (ADR-014) | same |
| Provider keys (Supabase disks/objects) | managed by the platform, separate from the data | platform |

Rules: keys are never hard-coded, never stored alongside the data they
protect, never `NEXT_PUBLIC_`; `lib/config/env.ts` validates presence and
format at start-up (T007).

## 5. Rotation (📋 T240)

1. Set the new value in `ENCRYPTION_KEY`, move the old one to
   `ENCRYPTION_KEY_PREVIOUS` (dual-read window opens).
2. Run `scripts/rotate-encryption-key.ts`: re-encrypts every `ENCRYPTED`
   column and `ai_draft_versions.content` from the previous `keyId` to the
   active key in batches, with progress and an audit trail.
3. Remove `ENCRYPTION_KEY_PREVIOUS` once no ciphertext references the old
   `keyId`.
4. Rotating `ACCESS_COOKIE_KEY` invalidates outstanding access sessions
   (recipients simply re-exchange their still-valid token link).
5. The procedure is recorded in `docs/SECURITY.md` when written (T178).

## 6. Hashing (not encryption)

| Value | Storage | Note |
|---|---|---|
| Access tokens (`access_tokens.tokenHash`) | SHA-256 of the plaintext | plaintext exists only in the emailed link and the exchange request body |
| Emergency-access OTP (`emergency_access_requests.otpHash`) | hash of the 6-digit code | 15-minute expiry, 3 attempts |
| Passwords / MFA secrets | **not stored by the application** | owned by Clerk (ADR-003) |

## 7. Verification (constitution XVII)

`tests/unit/security/encryption.test.ts` (T213): round-trip, auth-tag tamper
detection, distinct IV per call, `keyId` recorded, dual-read by `keyId`,
wrong-key failure, rotation helper behaviour. Field-level protection is also
exercised by the write-protection suite (T215) and the document/asset
permission tests (T228, T241).

## 8. Deferred: application-layer encryption of file bodies (ADR-013)

Design is ready (encrypt in the upload `complete` step; serve through an
app-signed, time-limited decrypting download route; record
`encryptionMode = APP_ENVELOPE` and `encryptionKeyId` on `documents` /
`video_messages`). It is not part of the baseline because provider
encryption already satisfies constitution IV and FR-H004/K003, it would
remove signed-URL previews, and it is infeasible for 500 MB videos in
serverless functions. Activation triggers: customer-managed-key requirement,
threat-model outcome at the pre-production review (T185), or regulatory
demand.
