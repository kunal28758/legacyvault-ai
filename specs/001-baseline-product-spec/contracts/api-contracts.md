# API Contracts: LegacyVault AI — Baseline Product

**Created**: 2026-09-16 | **Revised**: 2026-09-18 r4 (ADR-001, 003, 004 r4, 005, 006, 007, 014 r4, 016; r3 targeted remediation H1/M1–M4/N1; r4 post-gate S1/C1)

**Base URL**: `/api/v1` — implemented as Next.js Route Handlers under
`app/api/v1/**/route.ts` (ADR-001). Every handler runs through the shared
`withApi()` pipeline: correlation id → authentication → CSRF origin check
(mutating methods) → rate limit → Zod validation → handler → response
envelope → safe error mapping.

**Common Headers**: `Content-Type: application/json`. Authentication is the
Clerk session cookie (httpOnly, secure, SameSite) verified server-side with
`auth()` on every request; token-scoped endpoints use the access cookie
described under *Beneficiary / Contact Access*. Every response carries
`X-Correlation-ID` and **`Cache-Control: private, no-store`** (user data is
never cacheable by shared caches — constitution XV); signed storage URLs are
returned in bodies, never redirected to.

**Common Response Format**:
```json
{
  "success": true|false,
  "data": { ... },
  "error": { "code": "ERROR_CODE", "message": "Human-readable message", "fields": { "path": ["message"] } },
  "meta": { "page": 1, "limit": 20, "total": 100, "correlationId": "…" }
}
```

**Authentication**: Clerk session for all endpoints except those marked ❌
(public) or `cookie` (access-cookie scoped). ✅+re-auth = the handler
additionally requires a recent Clerk **reverification** (`strict`, ≤ 10 min);
✅+verify (Dead Man Switch check-in/cancel) = reverification at
`multi_factor` when MFA is enabled, else `strict`.

**Authorization**: Server-side role check (`users.role` in PostgreSQL) and
resource-ownership check in the service layer on every operation (primary);
PostgreSQL RLS + column grants + guarded `SECURITY DEFINER` functions as the
second barrier (ADR-004 r2). Frontend/proxy guards are UX only.

**Rate limiting** (ADR-007): Clerk attack protection on sign-in/sign-up;
Vercel WAF per-IP rules on public paths; application limiter per policy —
`default` 100/15 min per user · `sensitive` 5/15 min per user · `ai` 20/hour
per user · `publicEmergency` 5/hour per IP **and** 3/hour per config ·
`accessExchange` 10/15 min per IP · `tokenAccess` 60/15 min per access
session. Exceeding returns `429` with `Retry-After`.

**CSRF**: mutating requests (POST/PATCH/PUT/DELETE) in the cookie/ambient-
credential auth modes — `public`, `user`, `admin`, `access-cookie` — must pass
an `Origin`/`Sec-Fetch-Site` same-origin check in `withApi()`; Clerk and access
cookies are SameSite. The non-cookie internal modes `cron` and `webhook` skip
the browser CSRF check **only** because every request is authenticated
explicitly (`Authorization: Bearer $CRON_SECRET`; Svix / provider signature
verified over the raw request body before parsing); they still receive the
correlation id, `Cache-Control: private, no-store`, safe error mapping and
DENIED/FAILURE audit rows. Browser CSRF protection is never relaxed for
cookie modes.

**Error safety**: no stack traces, database details, file paths or internal
identifiers in `error` (FR-Q016). Guarded-function failures map to
`403 FORBIDDEN` (ownership/state) or `422` (invariant) with generic messages.

---

## Auth — provided by Clerk (ADR-003)

Authentication endpoints are **not** application Route Handlers. Clerk's
components and APIs implement them; the application consumes the session and
mirrors events into its audit log.

| Capability (spec) | Where it lives | Application responsibility |
|-------------------|----------------|----------------------------|
| Register, password policy (FR-A001, A002) | Clerk `<SignUp/>` at `/sign-up` | `user.created` webhook → `users` row, audit `user.registered` |
| Email verification (FR-A003, A004) | Clerk | mirror `emailVerified` |
| Login (FR-A005) | Clerk `<SignIn/>` at `/sign-in` | `session.created` → audit `auth.login`, `lastLoginAt`, new-device job (FR-A016) |
| MFA TOTP + backup codes (FR-A006, A017) | Clerk `<UserProfile/>` | mirror `mfaEnabled`; audit `auth.mfa_changed` |
| Sessions, 24 h lifetime, logout (FR-A007–A009, FR-Q006) | Clerk | `session.ended/revoked` → audit `auth.logout` |
| Password reset + sign-out others (FR-A010, A011) | Clerk | audit `auth.password_reset` |
| Lockout / bot protection (FR-A012, A013) | Clerk + Vercel WAF | **T203** verifies failed-attempt event coverage |
| Auth event logging (FR-A014) | — | Webhook handler writes `audit_log` for all `user.*`/`session.*` events |
| Active sessions list & revoke (FR-A015) | Clerk Backend API | `/security/sessions` below |
| Re-authentication (FR-A018) | Clerk reverification | `withApi({ reverification })` on ✅+re-auth endpoints |
| Idle timeout preference (FR-B006) | Application | `users.securityPreferences.idleTimeoutMinutes`; client-enforced sign-out |

Application-owned auth-adjacent endpoints: `POST /api/webhooks/clerk`
(internal) and `POST /security/events` (only if T203 requires it).

---

## Users (`/api/v1/users`)

| Method | Endpoint | Auth | Description |
|--------|----------|:----:|-------------|
| GET | `/users/me` | ✅ | Current user (app profile + mirrored Clerk fields + role + onboarding state) |
| PATCH | `/users/me` | ✅ | Update app-owned profile fields (dateOfBirth, phone, alternateEmail, address, familyInfo — Class A column allow-list; `identificationDetails` is encrypted server-side and written through `set_encrypted_fields()`, never by direct grant — ADR-004 r4) |
| — | *(email / password / name change)* | Clerk | Through Clerk with reverification; webhook mirrors + audits (FR-B007) |
| GET | `/users/me/preferences` | ✅ | preferences, notificationPreferences, securityPreferences |
| PATCH | `/users/me/preferences` | ✅ | Update any of the three preference objects; `securityPreferences.idleTimeoutMinutes ∈ {15,30,60,240,null}` |
| POST | `/users/me/onboarding/complete` | ✅ | Marks onboarding complete |
| GET | `/users/me/export` | ✅+re-auth | Export all user data as JSON (profile, beneficiaries, assets with decrypted sensitive fields, document metadata, plans + versions, confirmed AI drafts, own audit rows) |
| DELETE | `/users/me` | ✅+re-auth | Request account deletion (`confirmed: true`; 30-day grace; sessions revoked; DMS paused) |
| POST | `/users/me/cancel-deletion` | ✅ | Cancel pending deletion |

---

## Beneficiaries (`/api/v1/beneficiaries`)

| Method | Endpoint | Auth | Description |
|--------|----------|:----:|-------------|
| GET | `/beneficiaries` | ✅ | List (status filter; includes roles: assignedResources count, isTrustedContact, isEmergencyContact) |
| POST | `/beneficiaries` | ✅ | Create (status PENDING); sends the invitation automatically (ADR-014 § 7) → beneficiary + `invitationEmailSent` |
| GET | `/beneficiaries/:id` | ✅ | Details, assignments, tokens, DMS/EA roles |
| PATCH | `/beneficiaries/:id` | ✅ | Update contact fields (`confirmed: true` required for name/email changes — FR-D008) |
| POST | `/beneficiaries/:id/status` | ✅ | `{ status: ACTIVE|INACTIVE, confirmed: true }` → `set_beneficiary_status()`; INACTIVE revokes tokens |
| DELETE | `/beneficiaries/:id` | ✅ | `{ confirmed: true }` → `remove_beneficiary()` cascade (assignments, tokens, DMS contact link, EA config), soft delete, audit |
| POST | `/beneficiaries/:id/invite` | ✅ | Send/resend invitation email (sets `invitedAt`) |
| POST | `/beneficiaries/:id/tokens` | ✅ | Issue DIRECT_SHARE access token `{ scope, ttlDays ≤ 30 }` → `issue_access_token()`; every scope id must be owned by the caller **and currently assigned to this beneficiary** (`beneficiary_assignments`) — otherwise 422 `SCOPE_NOT_ASSIGNED` (FR-D011); `planSections` must be empty (not assignable); videos in scope must have delivery condition `IMMEDIATE` — otherwise 422 `DELIVERY_CONDITION_MISMATCH`; plaintext link emailed, returned once |
| GET | `/beneficiaries/:id/tokens` | ✅ | List tokens (hash never returned) |
| DELETE | `/beneficiaries/:id/tokens/:tokenId` | ✅ | Revoke token (`revokedReason = OWNER`) |
| POST | `/beneficiaries/:id/tokens/:tokenId/resend` | ✅+re-auth | `resend_access_token()` — revokes the current token (`RESENT`), mints exactly one replacement (`replacesTokenId`), emails it and returns the plaintext once; audited `access.token_resent` (ADR-014 § 6) |

### Key Validations
- Email uniqueness per user (409)
- Lifecycle per Clarifications 2026-09-18; INACTIVE beneficiaries cannot receive assignments or tokens (422)
- All changes audited with previous/new values

---

## Assets (`/api/v1/assets`)

| Method | Endpoint | Auth | Description |
|--------|----------|:----:|-------------|
| **Financial** | | | |
| GET / POST | `/assets/financial` | ✅ | List / create via `create_asset('FINANCIAL_ASSET', …)` — encrypted fields written only through the function (ADR-004 r4) |
| GET / PATCH / DELETE | `/assets/financial/:id` | ✅ | Get (masked) / update plain columns (allow-list; `accountNumber`/`policyNumber` → `set_encrypted_fields()`) / soft delete via `delete_asset('FINANCIAL_ASSET', id)` — one transaction: assignments + attachments removed, audit written |
| GET | `/assets/financial/:id/decrypt` | ✅+re-auth | Decrypted sensitive fields — audited |
| **Physical** | | | |
| GET / POST | `/assets/physical` | ✅ | List / create via `create_asset('PHYSICAL_ASSET', …)` |
| GET / PATCH / DELETE | `/assets/physical/:id` | ✅ | Get / update (allow-list columns) / soft delete via `delete_asset('PHYSICAL_ASSET', id)` |
| **Digital** | | | |
| GET / POST | `/assets/digital` | ✅ | List / create via `create_asset('DIGITAL_ASSET', …)` — credentials/recoveryInfo written only through the function |
| GET / PATCH / DELETE | `/assets/digital/:id` | ✅ | Get (masked) / update plain columns (allow-list; `credentials`/`recoveryInfo` → `set_encrypted_fields()`) / soft delete via `delete_asset('DIGITAL_ASSET', id)` |
| GET | `/assets/digital/:id/decrypt` | ✅+re-auth | Decrypted credentials — audited (FR-G004/G005) |
| **Assignments** | | | |
| POST | `/assets/:type/:id/assign` | ✅ | `{ beneficiaryId, allocationPercentage? , confirmed: true }` → `assign_beneficiary()` (422 when Σ > 100) |
| DELETE | `/assets/:type/:id/assign/:assignmentId` | ✅ | `unassign_beneficiary()` |
| GET | `/assets/:type/:id/assignments` | ✅ | Assignments + remaining percentage (FR-D005) |
| **Document attachments (FR-E004, F003, G002)** | | | |
| GET | `/assets/:type/:id/documents` | ✅ | Attached vault documents |
| POST | `/assets/:type/:id/documents` | ✅ | `{ documentId }` → `attach_document()` |
| DELETE | `/assets/:type/:id/documents/:documentId` | ✅ | `detach_document()` |

`:type ∈ financial | physical | digital`. Encrypted fields masked in standard
GET; `/decrypt` requires reverification. Ownership enforced (403).

---

## Documents (`/api/v1/documents`)

| Method | Endpoint | Auth | Description |
|--------|----------|:----:|-------------|
| GET | `/documents` | ✅ | List (folder filter) |
| POST | `/documents/uploads` | ✅ | **Step 1** — create upload session; returns signed upload URL into the private `documents` bucket. Optional `documentId` → `kind: DOCUMENT_VERSION` |
| POST | `/documents/uploads/:uploadId/complete` | ✅ | **Step 2** — actual size, magic bytes → `VALIDATED` → `promote_upload()` creates `Document` (or `DocumentVersion` + `currentVersionId`). No malware scan (ADR-017) |
| GET | `/documents/uploads/:uploadId` | ✅ | Upload/scan status |
| GET | `/documents/:id` | ✅ | Metadata (+ attachments, shares, versions summary) |
| GET | `/documents/:id/download` | ✅ | Signed download URL (15 min) — audited |
| GET | `/documents/:id/preview` | ✅ | Short-lived preview URL/data (PDF/image) — audited |
| PATCH | `/documents/:id` | ✅ | name / folderId / metadata (Class A allow-list) |
| DELETE | `/documents/:id` | ✅ | `delete_document()` — soft delete, object-removal job, shares/attachments removed, audit retained |
| GET | `/documents/:id/versions` | ✅ | Version history |
| POST | `/documents/:id/share` | ✅ | `{ beneficiaryId, confirmed: true }` → assignment (resourceType DOCUMENT), then emails a link that follows the beneficiary's shares (ADR-014 § 7) → `{ shares, accessEmailSent }` |
| DELETE | `/documents/:id/share/:beneficiaryId` | ✅ | Revoke share |
| **Folders** | | | |
| GET / POST | `/documents/folders` | ✅ | List tree / create |
| PATCH / DELETE | `/documents/folders/:id` | ✅ | Rename-move / soft delete (confirmation when non-empty) |

### Upload flow shapes (ADR-005)

**POST /documents/uploads**
```
Request:  { name, mimeType, sizeBytes, folderId?, documentId? }
Checks:   mimeType + extension whitelist, sizeBytes ≤ 52_428_800, ownership of folder/document
Response: { uploadId, uploadUrl, token, expiresAt }
```
**POST /documents/uploads/:uploadId/complete**
```
Server:   object exists → actual size ≤ 50 MB → magic bytes → VALIDATED
          → promote_upload()
Response: { uploadId, status, rejectionReason, retryable, inProgress, documentId? | videoId? }
Errors:   409 CONFLICT (expired / already completed / rejected); a failed check
          returns status REJECTED with a reason and deletes the object
```

### Key Validations
- Whitelist (PDF, images, text, office docs); declared MIME/extension + actual magic bytes
- Size ≤ 50 MB checked at declaration and at completion
- Invalid files are rejected and deleted; nothing is reachable until promoted. No malware scanning (ADR-017)
- Signed URLs expire in 15 minutes; bucket URLs never exposed; provider AES-256 at rest

---

## Legacy Plans (`/api/v1/legacy-plans`)

| Method | Endpoint | Auth | Description |
|--------|----------|:----:|-------------|
| GET | `/legacy-plans` | ✅ | List (draft + finalized) |
| POST | `/legacy-plans` | ✅ | `create_legacy_plan()` (409 if a DRAFT exists) |
| GET | `/legacy-plans/:id` | ✅ | Plan with step data and completeness |
| PATCH | `/legacy-plans/:id/steps/:step` | ✅ | `{ data, lockVersion }` → `save_plan_step()` (409 on lock conflict; 422 field errors) |
| GET | `/legacy-plans/:id/documents` | ✅ | Documents attached to the plan (step `document-attachments`) |
| POST / DELETE | `/legacy-plans/:id/documents[/:documentId]` | ✅ | `attach_document()` / `detach_document()` (resourceType LEGACY_PLAN) |
| POST | `/legacy-plans/:id/review` | ✅ | Review summary: per-section completeness, cross-entity checks, incomplete list |
| POST | `/legacy-plans/:id/finalize` | ✅ | `{ confirmed: true, lockVersion, acknowledgeIncomplete?: boolean }` → `finalize_legacy_plan()`; 422 `PLAN_INCOMPLETE` (with `incompleteSections`) unless acknowledged; 422 `PERSONAL_DETAILS_REQUIRED` always |
| GET | `/legacy-plans/:id/versions` | ✅ | Version history (incl. `acknowledgedIncomplete`, `incompleteSections`) |
| GET | `/legacy-plans/:id/versions/:versionId` | ✅ | Specific snapshot (read-only) |
| POST | `/legacy-plans/:id/new-draft` | ✅ | `create_plan_draft()` |

`:step` ∈ the section keys in data-model §9 (steps 3–7 store references to
beneficiaries/assets/documents; the wizard renders those modules inline).

---

## Dead Man Switch (`/api/v1/dead-man-switch`)

| Method | Endpoint | Auth | Description |
|--------|----------|:----:|-------------|
| GET | `/dead-man-switch` | ✅ | Config, status, next check-in, contacts, events summary |
| POST / PATCH | `/dead-man-switch` | ✅ | `{ inactivityPeriodDays, checkInFrequencyDays, escalationDelayHours, contactBeneficiaryIds[≥1], releaseScope, escalationRules }` → `dms_configure()` |
| POST | `/dead-man-switch/check-in` | ✅+verify | `dms_check_in()` |
| POST | `/dead-man-switch/pause` / `/resume` | ✅ | `dms_pause()` / `dms_resume()` |
| POST | `/dead-man-switch/cancel-escalation` | ✅+verify | `dms_cancel_escalation()` (also from RELEASED — revokes release tokens) |
| DELETE | `/dead-man-switch` | ✅+re-auth | `dms_disable()` |
| GET | `/dead-man-switch/events` | ✅ | Event history |

### Key Validations
- Contacts are the caller's beneficiaries and not INACTIVE; release scope
  references owned resources and valid plan-section keys; videos in the
  release scope must have delivery condition `IMMEDIATE` or `DEAD_MAN_SWITCH`
  (strict mapping, data-model § 11) — otherwise 422 `DELIVERY_CONDITION_MISMATCH`
- Release issues `DMS_RELEASE` access tokens scoped exactly to `releaseScope`

---

## Emergency Access (`/api/v1/emergency-access`)

| Method | Endpoint | Auth | Description |
|--------|----------|:----:|-------------|
| GET | `/emergency-access/contacts` | ✅ | Configured contacts (beneficiary + scope + timeout rule + status) |
| POST | `/emergency-access/contacts` | ✅ | `{ beneficiaryId, accessScope, onTimeout: WAIT|AUTO_GRANT|DENY, timeoutHours?, requestExpiryHours?, accessDurationHours? }` → `ea_configure_contact()` (videos in `accessScope` must have delivery condition `IMMEDIATE` or `EMERGENCY_ACCESS` — otherwise 422 `DELIVERY_CONDITION_MISMATCH`); sends designation email with request link |
| PATCH / DELETE | `/emergency-access/contacts/:id` | ✅ | `ea_update_contact()` / `ea_remove_contact()` |
| POST | `/emergency-access/contacts/:id/resend` | ✅ | Re-send designation email (rate-limited) |
| **Public request endpoints** | | | |
| POST | `/emergency-access/request` | ❌ `publicEmergency` | `{ configId, requesterEmail }` — email must match the contact; OTP emailed; response is generic (no enumeration) |
| POST | `/emergency-access/verify` | ❌ `publicEmergency` | `{ requestId, code }` — ≤ 3 attempts; on success owner is notified |
| GET | `/emergency-access/requests/:id/status` | ❌ (requestId + email) | Requester-facing status (pending / approved / denied / expired) — generic wording |
| **Owner endpoints** | | | |
| GET | `/emergency-access/requests` | ✅ | Pending/active/historical requests |
| POST | `/emergency-access/requests/:id/approve` | ✅+re-auth | `ea_decide_request(APPROVE)` → request APPROVED and exactly one `access.deliver` job enqueued in the same transaction (outbox insert inside the function); the job issues the EMERGENCY_ACCESS token (→ ACTIVE) and emails the link with reissue-on-retry (ADR-014 § 6) |
| POST | `/emergency-access/requests/:id/resend-access` | ✅+re-auth | Owner recovery path: enqueues a new `access.deliver` run that revokes the current token (`RESENT`) and re-mints exactly one; audited `access.resend_requested` |
| POST | `/emergency-access/requests/:id/deny` | ✅ | `ea_decide_request(DENY)` |
| POST | `/emergency-access/requests/:id/revoke` | ✅ | `ea_revoke()` |

Granted access is consumed through the shared **Beneficiary / Contact
Access** endpoints below (the emailed link carries the token once; the
contact exchanges it for an access cookie). Timeout handling (`WAIT`,
`AUTO_GRANT`, `DENY`, request expiry) runs via housekeeping jobs.

---

## Video Legacy (`/api/v1/videos`)

| Method | Endpoint | Auth | Description |
|--------|----------|:----:|-------------|
| GET | `/videos` | ✅ | List |
| POST | `/videos/uploads` | ✅ | **Step 1** — upload session; target in the private `videos` bucket |
| POST | `/videos/uploads/:uploadId/complete` | ✅ | **Step 2** — size ≤ 500 MB + container magic bytes → `video.process` job → promote |
| GET | `/videos/uploads/:uploadId` | ✅ | Processing status |
| GET | `/videos/:id` | ✅ | Metadata |
| GET | `/videos/:id/stream` | ✅ | Signed playback URL (15 min) — audited (FR-K008) |
| PATCH | `/videos/:id` | ✅ | title / description / deliveryCondition / metadata |
| DELETE | `/videos/:id` | ✅ | `delete_video()` |
| POST | `/videos/:id/assign` | ✅ | `{ beneficiaryId, confirmed: true }` → assignment (VIDEO_MESSAGE) |
| DELETE | `/videos/:id/assign/:beneficiaryId` | ✅ | Remove assignment |

Upload-only in baseline (recording deferred). **Delivery condition ↔ grant
type (strict mapping — data-model § 11, Clarifications 2026-09-18)** is
enforced server-side on every video access and validated when a scope is
configured or a token is issued: `IMMEDIATE` → any valid grant whose scope
includes the video; `DEAD_MAN_SWITCH` → `DMS_RELEASE` grants only;
`EMERGENCY_ACCESS` → `EMERGENCY_ACCESS` grants only. No hierarchical or
cross-acceptance; a mismatch returns `422 DELIVERY_CONDITION_MISMATCH`. The
owner's own `/videos/:id/stream` is authorized by ownership.

---

## AI (`/api/v1/ai`)

| Method | Endpoint | Auth | Description |
|--------|----------|:----:|-------------|
| POST | `/ai/assistant/message` | ✅ `ai` | Body `{ message, history?: { role ∈ {user, assistant}, content }[], attachmentIds?: uuid[] }` — `history` is the **client-held, session-scoped** prior turns (max **20** turns, bounded per-turn length, Zod-validated). `attachmentIds` (max **3**, unique) are the caller's own vault documents, uploaded through the normal upload pipeline (private storage → size and type check → promotion); each is re-checked server-side through RLS — owner, not deleted, an AI-readable type — before any byte is read, or the request is refused (`404` / `FILE_INFECTED` / `FILE_TYPE_MISMATCH` / `FILE_TOO_LARGE`) with nothing sent to the model. Each attachment beyond the first is one more hit on the caller's `ai` budget; reading one is audited (`ai.assistant_attachment_read`). Attachment content goes only to providers approved for vault documents that can read the file type; if none can, `422 AI_UNAVAILABLE` (`details.reason: "unsupported"`). A provider failure after the first token ends the stream with one `error` event (`reason: "interrupted"`). Streamed reply with disclaimer; missing-information detection from the plan. The server does **not** persist `message` or `history` text; only a sanitized `ai_interactions` metadata row (provider, model, tokens, sanitized summary — no content) may be persisted (ADR-016) |
| GET | `/ai/assistant/interactions` | ✅ | Sanitized `ai_interactions` records of the **current user only** (usage/audit metadata). Never exposes persisted conversation or message content — none is stored |
| **Will generator (AiDraft kind = WILL_DRAFT)** | | | |
| POST | `/ai/will-generator/drafts` | ✅ `ai` | `{ input?: string, instructions?: string }` — NL input extracted (FR-M001/M002) + plan data → new draft (version 1, createdBy AI) |
| GET | `/ai/will-generator/drafts` | ✅ | Drafts for the current plan |
| GET | `/ai/will-generator/drafts/:draftId` | ✅ | Current version (decrypted for owner), section confidence, status |
| GET | `/ai/will-generator/drafts/:draftId/versions` | ✅ | Version history (FR-M011) |
| PATCH | `/ai/will-generator/drafts/:draftId` | ✅ | `{ sections }` → `update_ai_draft()` (new USER version) |
| POST | `/ai/will-generator/drafts/:draftId/regenerate` | ✅ `ai` | `{ instructions? }` → new AI version |
| POST | `/ai/will-generator/drafts/:draftId/confirm` | ✅+re-auth | `{ confirmed: true, versionId }` → `confirm_ai_draft()` (FR-M010) |
| GET | `/ai/will-generator/drafts/:draftId/export` | ✅ | PDF of the confirmed version (FR-M012) |
| **Document analysis (AiDraft kind = DOCUMENT_ANALYSIS)** | | | |
| POST | `/ai/document-analysis/analyses` | ✅ `ai` | `{ documentId }` → 202 `{ draftId }`; job runs extraction + structured findings |
| GET | `/ai/document-analysis/analyses/:draftId` | ✅ | Status / progress / findings with confidence (FR-N006) |
| POST | `/ai/document-analysis/analyses/:draftId/confirm` | ✅ | `{ confirmed: true, selected: { assets: [...], beneficiaries: [...] } }` → `confirm_analysis_findings()` (FR-N007/N008) |
| POST | `/ai/document-analysis/analyses/:draftId/reject` | ✅ | Marks REJECTED (purged per retention) |

### Key Constraints
- All provider calls server-side; keys never exposed; every response labelled AI-generated with the legal disclaimer
- Nothing persisted as authoritative without the explicit confirm endpoint; `AIInteraction` never stores content
- Rate limited (`ai`); provider outage → 503 `AI_UNAVAILABLE`, non-AI features unaffected

---

## Notifications (`/api/v1/notifications`)

| Method | Endpoint | Auth | Description |
|--------|----------|:----:|-------------|
| GET | `/notifications` | ✅ | Paginated list |
| GET | `/notifications/unread-count` | ✅ | |
| PATCH | `/notifications/:id/read` | ✅ | Sets `readAt` |
| POST | `/notifications/read-all` | ✅ | |

---

## Security (`/api/v1/security`)

| Method | Endpoint | Auth | Description |
|--------|----------|:----:|-------------|
| GET | `/security/sessions` | ✅ | Clerk Backend API — device, browser, city/country, last active |
| DELETE | `/security/sessions/:id` | ✅ | Ownership verified → Clerk revoke → audit |
| GET | `/security/login-history` | ✅ | From `audit_log` |
| GET | `/security/audit-history` | ✅ | Security-related audit events |
| GET | `/security/status` | ✅ | Score/indicators (MFA, verified email, backup codes, recent review, unresolved alerts) |
| POST | `/security/events` | ✅ | Server-validated client security events (only if T203 requires) |

---

## Audit Logs (`/api/v1/audit-logs`)

| Method | Endpoint | Auth | Description |
|--------|----------|:----:|-------------|
| GET | `/audit-logs` | ✅ | Own audit rows (filters, pagination) |
| GET | `/audit-logs/admin` | ✅ Super Admin | Platform-wide |

---

## Admin (`/api/v1/admin`)

| Method | Endpoint | Auth | Description |
|--------|----------|:----:|-------------|
| GET | `/admin/users` | ✅ Super Admin | List/search |
| GET | `/admin/users/:id` | ✅ Super Admin | Details (masked) |
| PATCH | `/admin/users/:id/role` | ✅ Super Admin +re-auth | Service-client update of `users.role`; audited; never self-service |
| POST | `/admin/users/:id/unlock` | ✅ Super Admin | Clerk Backend API unlock; audited |
| POST | `/admin/users/:id/reset-mfa` | ✅ Super Admin +re-auth | Clerk Backend API; audited; user notified |
| GET | `/admin/analytics[/registrations|/storage]` | ✅ Super Admin | Analytics |
| POST | `/admin/access-tokens/:id/resend` | ✅ Super Admin +re-auth | Recovery path for dead-lettered DMS_RELEASE / EMERGENCY_ACCESS deliveries (`access.delivery_failed`): enqueues `access.deliver …:r{n}` (revoke + exactly one replacement); audited with the admin as actor (ADR-014 § 6) |

---

## Beneficiary / Contact Access (access-cookie scoped — ADR-014)

Used for all three grant types (DIRECT_SHARE, DMS_RELEASE, EMERGENCY_ACCESS).
The emailed link is `https://…/access?t=<token>`; the public page immediately
exchanges the token and removes it from the URL (`history.replaceState`).

| Method | Endpoint | Auth | Description |
|--------|----------|:----:|-------------|
| POST | `/access/exchange` | ❌ `accessExchange` | `{ token }` → validates hash, expiry, revocation, beneficiary status → sets access cookie (`httpOnly; Secure; SameSite=Strict; Path=/api/v1/access`, 30-min sliding, ≤ token expiry) → marks beneficiary ACTIVE on first use → audit |
| GET | `/access/resources` | cookie `tokenAccess` | Scoped resource list + grant type + expiry |
| GET | `/access/documents/:id` | cookie | Metadata (in scope) |
| GET | `/access/documents/:id/download` | cookie | Signed URL (15 min) — audited |
| GET | `/access/assets/:type/:id` | cookie | Read-only asset view (encrypted fields never returned) |
| GET | `/access/videos/:id` | cookie | Signed playback URL — delivery condition ↔ grant type strict mapping enforced on every access (mismatch → 422 `DELIVERY_CONDITION_MISMATCH`) — audited |
| GET | `/access/plan-sections/:section` | cookie | Read-only rendering of the section from the owner's **latest finalized** plan version (FR-I012, FR-J001) |
| POST | `/access/logout` | cookie | Clears the access cookie |

### Key Constraints
- Token plaintext appears only in the emailed link and the exchange body; never in request paths, logs, or responses
- Every resource request re-checks `access_tokens.revokedAt/expiresAt` and beneficiary status
- Read-only; every access audited (`access.*` actions, actor = beneficiary id)
- Service client with token-scope authorization (no Clerk session)
- System-grant links (DMS_RELEASE, EMERGENCY_ACCESS) are delivered by the `access.deliver` job with a deterministic per-contact idempotency key and reissue-on-retry; at most one non-revoked token exists per (switch, beneficiary) / per emergency request; plaintext is never persisted (ADR-014 § 6)

---

## Internal Endpoints (not part of the public `/v1` surface)

| Method | Endpoint | Auth | Description |
|--------|----------|:----:|-------------|
| POST | `/api/webhooks/clerk` | `webhook` mode — Svix signature (raw body) | `record_webhook_event()` idempotency → `users` sync, audit, new-device job |
| POST | `/api/webhooks/email` | `webhook` mode — provider signature (raw body) | Delivery events → `notifications.deliveryStatus` |
| GET/POST | `/api/internal/cron/run-jobs` | `Authorization: Bearer $CRON_SECRET` | Drain due jobs (every 5 min) |
| GET/POST | `/api/internal/cron/dms-scan` | `CRON_SECRET` | Enqueue **one** idempotent `dms.scan` job (hourly; `idempotency_key = dms.scan:{YYYY-MM-DDTHH}` — duplicate Vercel Cron / `pg_cron` triggers are no-ops). The job handler performs the scan and enqueues per-switch transition jobs; its SUCCEEDED `finished_at` is the scheduler heartbeat used by the health check |
| GET/POST | `/api/internal/cron/housekeeping` | `CRON_SECRET` | Expiry/timeout sweeps, abandoned-upload cleanup, retention purges, deletion grace (daily) |
| GET | `/api/v1/health` | ❌ | Public: `{ status: "ok"|"degraded" }` only. With `Authorization: Bearer $CRON_SECRET` or Super Admin session: `{ status, database, storage, jobs: { lastRunAgeSeconds }, dmsScan }` |

Internal endpoints are excluded from Clerk protection in `proxy.ts`, verify
their own credentials on **every request** (`withApi({ auth:'cron' })` —
bearer `CRON_SECRET`; `withApi({ auth:'webhook', verify })` — Svix / provider
signature verified over the raw request body before parsing), are idempotent,
and write audit rows for security-relevant outcomes. Because they carry no
cookies and are authenticated per request, the browser CSRF check does not
apply to them; an invalid secret or signature returns 401 with no side
effects. They still receive the correlation id, `no-store` and safe error
mapping.
