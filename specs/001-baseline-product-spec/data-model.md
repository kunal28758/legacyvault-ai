# Data Model: LegacyVault AI — Baseline Product

**Phase**: 1 — Design & Contracts | **Created**: 2026-09-16 | **Revised**: 2026-09-18 (r3, targeted remediation H1/M1–M4/N1)

**Purpose**: Define entities, fields, relationships, validation rules, state
transitions, and the database write-protection model for the baseline product.

> **Revision history**
> - **2026-09-18 r1** — Identity externalized to Clerk (ADR-003); SQL
>   migrations on Supabase PostgreSQL (ADR-002); RLS on every table
>   (ADR-004); operational entities Job / UploadSession / RateLimitBucket.
> - **2026-09-18 r2** — Findings S1, I1–I5, U1–U3, I7, I11–I13, I15 from
>   `/speckit-analyze`: (a) one **write-protection model** — RLS for reads,
>   column-restricted direct writes only for plain user data, **guarded
>   `SECURITY DEFINER` functions** for every invariant-bearing write
>   (ADR-004 r2); (b) **all external recipients are Beneficiary records** and
>   all scoped access uses one `AccessToken` entity (ADR-014); (c) new
>   entities `DeadManSwitchContact`, `DocumentAttachment`, `AiDraft`,
>   `AiDraftVersion`, `ProcessedWebhookEvent`; (d) `AIInteraction` stays a
>   sanitized audit/cost record (ADR-016); (e) emergency-access timeout
>   rules, beneficiary lifecycle, acknowledged-incomplete finalization,
>   plan-section scope; (f) retention policy table.
> - **2026-09-18 r3** — Targeted remediation: `delete_asset()` guarded
>   function for atomic asset deletion (M2); video delivery-condition ↔
>   grant-type strict mapping in § 11 (M4); DIRECT_SHARE scope ⊆ the
>   beneficiary's current assignments in `issue_access_token()` (N1).
>   Entity count unchanged (29).
>
> Conventions: column names are `snake_case` in SQL (`supabase/migrations/`),
> shown here in logical `camelCase`. `ENCRYPTED` = application-level
> AES-256-GCM (`lib/security/encryption.ts`, versioned `keyId`).

---

## Entity Overview

| # | Entity | Description | Write class* | Owner |
|---|--------|-------------|:------------:|-------|
| 1 | User | Application profile, preferences and role for a Clerk identity | A (column allow-list) | System |
| 2 | Beneficiary | Any external recipient: beneficiary, trusted contact, emergency contact | A (column allow-list) + B (status/removal) | User |
| 3 | FinancialAsset | Bank accounts, investments, insurance, retirement | A + B (deletion → `delete_asset()`) | User |
| 4 | PhysicalAsset | Real estate, vehicles, valuables, property, business | A + B (deletion → `delete_asset()`) | User |
| 5 | DigitalAsset | Crypto, online accounts, domains, subscriptions | A + B (deletion → `delete_asset()`) | User |
| 6 | Document | Uploaded file in the secure vault | A (metadata columns) + B/C (lifecycle) | User |
| 7 | DocumentVersion | Version history for documents | C (created by promotion) | Document |
| 8 | Folder | Organizational container for documents | A | User |
| 9 | LegacyPlan | Structured will / legacy plan | B | User |
| 10 | LegacyPlanVersion | Finalized version snapshot | B (created by finalize) | LegacyPlan |
| 11 | VideoMessage | Video legacy message | A (metadata columns) + C (lifecycle) | User |
| 12 | DeadManSwitch | Inactivity monitoring configuration | B | User |
| 13 | DeadManSwitchEvent | DMS state transition record | B/C | DeadManSwitch |
| 14 | EmergencyAccessConfig | Emergency-contact designation for a beneficiary | B | User |
| 15 | EmergencyAccessRequest | Specific access request instance | B (owner decisions) / C (public + jobs) | EmergencyAccessConfig |
| 16 | BeneficiaryAssignment | Resource → beneficiary mapping with allocation | B | User |
| 17 | AuditLog | Immutable action record | C (SELECT own) | System |
| 18 | AIInteraction | Sanitized AI usage/audit record | C (SELECT own) | User |
| 19 | Notification | System notification/alert | C + A(readAt) | User |
| 20 | Session | *Externalized to Clerk* — no application table | — | Clerk |
| 21 | AccessToken | Time-limited scoped access token for any grant type | B (issue/revoke) / C (system grants) | User |
| 22 | Job | Durable background job (ADR-006) | C | System |
| 23 | UploadSession | Two-step direct-to-storage upload state (ADR-005) | C (SELECT own) | User |
| 24 | RateLimitBucket | Application rate-limit counters (ADR-007) | C | System |
| 25 | DeadManSwitchContact | Trusted contact link (switch ↔ beneficiary) | B | DeadManSwitch |
| 26 | DocumentAttachment | Document ↔ asset / legacy-plan link | B | User |
| 27 | AiDraft | AI will draft or document-analysis result awaiting confirmation | B | User |
| 28 | AiDraftVersion | Immutable content versions of an AiDraft | B (created by functions) | AiDraft |
| 29 | ProcessedWebhookEvent | Webhook idempotency record | C | System |

\* Write classes are defined in **§ Write-Protection Model** below.

---

## Write-Protection Model (ADR-004 r2)

RLS alone is row-level; it cannot stop a user from changing *which columns*
of their own row or from bypassing invariants that live in functions. The
baseline therefore combines three mechanisms, applied consistently:

### 1. Privilege baseline

```sql
-- Supabase grants ALL on public tables to anon/authenticated by default; revoke it.
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon, authenticated;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM PUBLIC, anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON FUNCTIONS FROM PUBLIC, anon, authenticated;
```
`anon` receives **no** grants anywhere. RLS is enabled on every table. The
`service_role` (server-only secret key) bypasses RLS and grants and is used
only from server code paths listed in ADR-004 (webhooks, cron/jobs, audit
writes, admin, token/OTP flows, upload promotion).

### 2. Table write classes

| Class | Reads (`authenticated`) | Writes (`authenticated`) | Used for |
|-------|-------------------------|--------------------------|----------|
| **A — plain user data** | `SELECT` own rows via RLS `USING (owner = self)` | Direct `INSERT`/`UPDATE` on own rows via RLS `WITH CHECK`, **restricted to an explicit column allow-list** (`GRANT UPDATE (col, …)`); no `DELETE` unless stated | Profile fields, assets, folders, beneficiary contact fields, document metadata, notification `readAt` |
| **B — guarded** | `SELECT` own rows via RLS | **No direct write grants.** All mutations through guarded `SECURITY DEFINER` functions (below) | Plans, assignments, attachments, tokens, DMS, emergency access, AI drafts, document lifecycle |
| **C — system** | `SELECT` own rows where stated; otherwise none | None — `service_role` only | Jobs, rate limits, webhook events, audit log, upload sessions, AI interactions, notification inserts |

"self" = the `users` row whose `clerkUserId = (select auth.jwt()->>'sub')`
(Clerk configured as Supabase third-party auth; RLS predicates wrap the call
in a sub-select for plan caching).

### 3. Guarded functions — mandatory rules

Every function callable by `authenticated` that writes Class B (or protected
Class A) data MUST:

1. Be declared `SECURITY DEFINER SET search_path = ''` in `LANGUAGE plpgsql`,
   with every object schema-qualified (`public.users`). (Documented reason
   for DEFINER, per ADR-002 §6: enforce invariants and state machines that
   row-level policies cannot express, while direct writes are revoked.)
2. Start with the **auth prologue**: read `auth.jwt()->>'sub'`; raise
   `UNAUTHENTICATED` (SQLSTATE `42501`) if null; resolve `v_user_id` from
   `public.users` (`deleted_at IS NULL`); raise if not found.
3. Fetch every row it will mutate **`FOR UPDATE`** with an explicit ownership
   predicate (`user_id = v_user_id`, or ownership via join for child rows);
   raise `FORBIDDEN` (`42501`) when no row matches — the same error for
   "missing" and "not yours" (no existence oracle).
4. Accept only **typed parameters** (uuid, enum types, numeric with CHECK,
   `jsonb` validated with a schema-check helper); dispatch across resource
   tables with static `CASE` statements; **never** build dynamic SQL from
   inputs (`EXECUTE format(...)` with user data is prohibited).
5. Never touch identity/authorization columns (`users.role`, `clerk_user_id`,
   mirrored Clerk fields). There is **no** `authenticated`-callable function
   that changes a role.
6. Enforce the invariant inside the same transaction under the row lock
   (allocation sum ≤ 100, state-machine guard, one DRAFT per user, scope
   references owned resources, lock-version match).
7. Insert an `audit_log` row in the same transaction (`actor_id = v_user_id`,
   `correlation_id = p_correlation_id`, action, resource, `outcome = SUCCESS`,
   redacted before/after values). Failures raise and roll back; the API layer
   audits `DENIED`/`FAILURE` outcomes through the service client.
8. Have `REVOKE EXECUTE … FROM PUBLIC, anon;` and `GRANT EXECUTE … TO
   authenticated;` (system functions: grant to `service_role` only).
9. Be covered by integration tests (T215): unauthenticated call, cross-user
   call, invariant violation, happy path, audit row present.

Defense in depth on `users`: a `BEFORE UPDATE` trigger `protect_identity_columns`
additionally raises when a request whose JWT role is `authenticated` changes
`role`, `email`, `email_verified`, `mfa_enabled`, `clerk_user_id`,
`last_login_at`, `deletion_requested_at` or `deleted_at` — even if a grant is
ever mis-applied.

### 4. Column allow-lists (Class A direct writes by `authenticated`)

| Table | INSERT own | UPDATE own — allowed columns | DELETE |
|-------|:----------:|------------------------------|:------:|
| users | ✗ | dateOfBirth, phone, alternateEmail, address, identificationDetails, familyInfo, preferences, notificationPreferences, securityPreferences, onboardingCompletedAt | ✗ |
| beneficiaries | ✓ (status defaults PENDING) | name, relationship, email, phone, notes | ✗ (→ `remove_beneficiary()`) |
| financial_assets / physical_assets / digital_assets | ✓ | all domain columns **except** `deletedAt`; never `userId`, `id`, `createdAt`, `deletedAt` (soft delete only through `delete_asset()`) | ✗ (→ `delete_asset()`) |
| folders | ✓ | name, parentId, deletedAt | ✗ |
| documents | ✗ | name, folderId, metadata | ✗ (→ `delete_document()`) |
| video_messages | ✗ | title, description, deliveryCondition, metadata | ✗ (→ `delete_video()`) |
| notifications | ✗ | readAt | ✗ |

Everything not listed is Class B or C. Application services still perform
their own authorization and audit logging for Class A writes (ADR-004 primary
control); the grants are the second barrier.

### 5. Guarded function catalog

| Function (executor) | Class / purpose | Invariants enforced |
|---------------------|-----------------|---------------------|
| `create_legacy_plan(p_corr)` (auth) | insert DRAFT plan | ≤ 1 DRAFT per user (partial unique index + check) |
| `save_plan_step(p_plan_id, p_step, p_data, p_expected_lock_version, p_corr)` (auth) | auto-save | ownership, status = DRAFT, optimistic lock (`lockVersion` match → +1), step key valid |
| `finalize_legacy_plan(p_plan_id, p_expected_lock_version, p_acknowledge_incomplete, p_corr)` (auth) | DRAFT → FINALIZED + snapshot | ownership, lock, Personal Details complete, `p_acknowledge_incomplete` required when other sections incomplete, snapshot stores completeness + incomplete list, enqueue notification job |
| `create_plan_draft(p_from_plan_id, p_corr)` (auth) | new DRAFT from finalized | ownership, no existing DRAFT, version+1 |
| `assign_beneficiary(p_beneficiary_id, p_resource_type, p_resource_id, p_allocation, p_corr)` (auth) | insert assignment | ownership of beneficiary **and** resource, beneficiary status ≠ INACTIVE, resource row locked, Σ allocation ≤ 100 |
| `unassign_beneficiary(p_assignment_id, p_corr)` (auth) | delete assignment | ownership |
| `set_beneficiary_status(p_beneficiary_id, p_status, p_corr)` (auth) | ACTIVE ⇄ INACTIVE by owner | INACTIVE revokes all tokens for that beneficiary |
| `remove_beneficiary(p_beneficiary_id, p_corr)` (auth) | cascade removal | deletes assignments, revokes tokens, removes DMS contact links, deactivates EA configs, soft-deletes row — atomically |
| `attach_document(p_document_id, p_resource_type, p_resource_id, p_corr)` / `detach_document(p_attachment_id, p_corr)` (auth) | document links | ownership of document and target; unique link |
| `issue_access_token(p_beneficiary_id, p_scope, p_token_hash, p_expires_at, p_corr)` (auth) | DIRECT_SHARE token | ownership, beneficiary ACTIVE/PENDING, ttl ≤ 30 days; **scope ⊆ current `beneficiary_assignments` of p_beneficiary_id** — every `documents`/`assets`/`videos` id must be owned by the caller **and** currently assigned to that beneficiary, `planSections` must be empty (not assignable) → otherwise 422 `SCOPE_NOT_ASSIGNED` (FR-D011); videos in scope must have `deliveryCondition = IMMEDIATE` (§ 11 strict mapping) → otherwise 422 `DELIVERY_CONDITION_MISMATCH` |
| `revoke_access_token(p_token_id, p_corr)` (auth) | revoke | ownership |
| `delete_document(p_document_id, p_corr)` / `delete_video(p_video_id, p_corr)` (auth) | soft delete + enqueue object removal | ownership; assignments/attachments removed; audit retained (FR-H017) |
| `delete_asset(p_resource_type, p_asset_id, p_corr)` (auth) | soft delete of one FINANCIAL_ASSET / PHYSICAL_ASSET / DIGITAL_ASSET | ownership (`FOR UPDATE` on the asset row); in one transaction: removes the asset's `beneficiary_assignments` and `document_attachments`, sets `deletedAt`, writes the audit row (previous values redacted per the audit rules); direct `deletedAt` writes on asset tables are denied |
| `dms_configure(p_config, p_contact_beneficiary_ids, p_release_scope, p_corr)` (auth) | create/update switch | one switch per user; ≥ 1 contact; contacts owned & not INACTIVE; scope ids owned; videos in `p_release_scope` must have `deliveryCondition` IMMEDIATE or DEAD_MAN_SWITCH (§ 11 strict mapping) else 422 `DELIVERY_CONDITION_MISMATCH`; `nextCheckInAt` computed |
| `dms_pause / dms_resume / dms_disable / dms_check_in / dms_cancel_escalation (p_corr)` (auth) | owner transitions | state-machine guard; event row; reverification is enforced by the API layer before the call |
| `ea_configure_contact(p_beneficiary_id, p_access_scope, p_on_timeout, p_timeout_hours, p_request_expiry_hours, p_corr)` / `ea_update_contact` / `ea_remove_contact` (auth) | designation | beneficiary owned & not INACTIVE; scope ids owned; videos in `p_access_scope` must have `deliveryCondition` IMMEDIATE or EMERGENCY_ACCESS (§ 11 strict mapping) else 422 `DELIVERY_CONDITION_MISMATCH`; unique per beneficiary |
| `ea_decide_request(p_request_id, p_decision, p_token_hash, p_expires_at, p_corr)` (auth) | owner APPROVE/DENY | request belongs to caller's config; state VERIFIED; approve issues EMERGENCY_ACCESS token |
| `ea_revoke(p_request_id, p_corr)` (auth) | owner revoke | state ACTIVE; token revoked |
| `update_ai_draft(p_draft_id, p_content_encrypted, p_corr)` (auth) | user edit → new USER version | ownership; status DRAFT/PENDING_CONFIRMATION |
| `confirm_ai_draft(p_draft_id, p_version_id, p_corr)` (auth) | WILL draft → CONFIRMED | ownership; version belongs to draft; supersedes prior CONFIRMED |
| `confirm_analysis_findings(p_draft_id, p_assets, p_beneficiaries, p_corr)` (auth) | create records from selected findings | ownership; typed payloads; each created row audited; draft → CONFIRMED |
| **System (service_role only, SECURITY INVOKER)** | | |
| `promote_upload(p_upload_id, p_target, p_metadata)` | upload → Document/Version or VideoMessage | session state SCANNED_CLEAN; atomic rows |
| `dms_transition(p_switch_id, p_from, p_to, p_event_type, p_metadata)` | job-driven transitions | guard on `p_from` |
| `ea_request_access(p_config_id, p_requester_email, p_otp_hash)` / `ea_verify_otp(p_request_id, p_otp_hash)` / `ea_transition(...)` | public + job flows | email must match beneficiary email; ≤ 3 attempts; timeout rules |
| `system_issue_access_token(p_beneficiary_id, p_grant_type, p_scope, p_token_hash, p_expires_at, p_dms_id, p_request_id)` | DMS_RELEASE / EMERGENCY_ACCESS tokens | scope ⊆ release/access scope (already validated against the § 11 delivery-condition mapping at configuration time; re-checked at issue: DMS_RELEASE admits IMMEDIATE/DEAD_MAN_SWITCH videos, EMERGENCY_ACCESS admits IMMEDIATE/EMERGENCY_ACCESS videos) |
| `claim_jobs(p_limit, p_runner_id)` | `FOR UPDATE SKIP LOCKED` claim | — |
| `rate_limit_hit(p_key, p_window_start, p_limit)` | atomic counter | — |
| `record_webhook_event(p_provider, p_event_id, p_event_type)` | idempotency insert; returns `false` if already processed | PK (provider, eventId) |

---

## Entity Definitions

### 1. User

Application record for a Clerk identity. **Credentials, password, MFA secrets,
verification and reset tokens, and lockout counters are owned by Clerk and
MUST NOT be stored here** (ADR-003). Fields marked *mirrored* are copied from
Clerk via webhook and are read-only in the application. `role` is owned by
this table and is the source of truth for authorization; it is changed only by
the admin service through the service client (never by an
`authenticated`-callable path).

| Field | Type | Constraints | Notes |
|-------|------|-------------|-------|
| id | UUID | PK | Internal identifier used by all FKs |
| clerkUserId | String | UNIQUE, NOT NULL, indexed | Clerk `user_…` subject; RLS key |
| email | String | UNIQUE, NOT NULL, indexed | *Mirrored*; lowercase normalized |
| emailVerified | Boolean | NOT NULL, default false | *Mirrored* |
| name | String | NOT NULL | *Mirrored* display name (edited via Clerk). The legal name used in the plan is captured in `LegacyPlan.stepsData.personalDetails` |
| mfaEnabled | Boolean | NOT NULL, default false | *Mirrored*; used for security score |
| dateOfBirth | Date | NULL | |
| phone | String | NULL | |
| alternateEmail | String | NULL | FR-B003 |
| address | JSONB | NULL | Structured address |
| identificationDetails | String | NULL, ENCRYPTED | |
| familyInfo | JSONB | NULL | Spouse, children, parents, dependents |
| role | Enum | NOT NULL, default USER | USER, SUPER_ADMIN — protected column |
| preferences | JSONB | NULL, default {} | language, currency, dateFormat, theme |
| notificationPreferences | JSONB | NULL, default {} | channels, frequency |
| securityPreferences | JSONB | NULL, default {} | `idleTimeoutMinutes` (15/30/60/240/null=off — app-enforced idle sign-out, FR-B006), `loginNotifications`, `securityReviewReminder` |
| onboardingCompletedAt | DateTime | NULL | SC-001 |
| lastLoginAt | DateTime | NULL | From Clerk `session.created` webhook — protected |
| deletionRequestedAt | DateTime | NULL | 30-day grace start — protected |
| createdAt / updatedAt | DateTime | NOT NULL, auto | |
| deletedAt | DateTime | NULL | Soft delete — protected |

**Indexes**: clerkUserId (unique), email (unique), role, deletionRequestedAt
(partial WHERE NOT NULL), deletedAt.
**Protected columns** (no `authenticated` grant + trigger): role, email,
emailVerified, mfaEnabled, name, clerkUserId, lastLoginAt,
deletionRequestedAt, deletedAt, createdAt.

---

### 2. Beneficiary

The single record type for every external recipient (Clarifications
2026-09-18): ordinary beneficiaries, Dead Man Switch trusted contacts (linked
via `DeadManSwitchContact`) and emergency contacts (linked via
`EmergencyAccessConfig`). "Emergency beneficiary" (FR-D010) = a beneficiary
with an active `EmergencyAccessConfig`; there is no separate flag.

| Field | Type | Constraints | Notes |
|-------|------|-------------|-------|
| id | UUID | PK | |
| userId | UUID | FK → User, NOT NULL, indexed | Owner |
| name | String | NOT NULL | |
| relationship | String | NOT NULL | spouse, child, sibling, friend, advisor, … |
| email | String | NOT NULL | Lowercase normalized; access links and OTPs go here |
| phone | String | NULL | |
| status | Enum | NOT NULL, default PENDING | PENDING, ACTIVE, INACTIVE — protected (functions only) |
| invitedAt | DateTime | NULL | Last invitation/designation email |
| activatedAt | DateTime | NULL | First successful access-token exchange or owner activation |
| notes | Text | NULL | |
| createdAt / updatedAt | DateTime | NOT NULL, auto | |
| deletedAt | DateTime | NULL | Soft delete via `remove_beneficiary()` |

**Indexes**: (userId, email) unique WHERE deletedAt IS NULL (FR-D003), userId,
status.

**Lifecycle**: `PENDING → ACTIVE` (first token exchange, or
`set_beneficiary_status`), `ACTIVE → INACTIVE` (owner; revokes tokens; no new
tokens/assignments), `INACTIVE → ACTIVE` (owner). Removal = cascade function.

---

### 3. FinancialAsset

| Field | Type | Constraints | Notes |
|-------|------|-------------|-------|
| id | UUID | PK | |
| userId | UUID | FK → User, NOT NULL, indexed | |
| name | String | NOT NULL | |
| category | Enum | NOT NULL | BANK_ACCOUNT, FIXED_DEPOSIT, MUTUAL_FUND, STOCK, INSURANCE, RETIREMENT |
| institution | String | NULL | |
| accountNumber | String | NULL, ENCRYPTED | |
| policyNumber | String | NULL, ENCRYPTED | |
| estimatedValue | Decimal | NULL | |
| currency | String | NOT NULL, default "USD" | ISO 4217 |
| notes | Text | NULL | |
| metadata | JSONB | NULL | Category-specific fields |
| createdAt / updatedAt | DateTime | NOT NULL, auto | |
| deletedAt | DateTime | NULL | Set by `delete_asset()` |

**Indexes**: userId, category, deletedAt. Documents are linked through
`DocumentAttachment` (not stored on the asset).

---

### 4. PhysicalAsset

| Field | Type | Constraints | Notes |
|-------|------|-------------|-------|
| id | UUID | PK | |
| userId | UUID | FK → User, NOT NULL, indexed | |
| name | String | NOT NULL | |
| category | Enum | NOT NULL | REAL_ESTATE, VEHICLE, GOLD_JEWELRY, PERSONAL_PROPERTY, BUSINESS_ASSET |
| description | Text | NULL | |
| location | String | NULL | |
| estimatedValue | Decimal | NULL | |
| currency | String | NOT NULL, default "USD" | |
| ownershipDetails | Text | NULL | |
| notes | Text | NULL | |
| metadata | JSONB | NULL | |
| createdAt / updatedAt | DateTime | NOT NULL, auto | |
| deletedAt | DateTime | NULL | Set by `delete_asset()` |

**Indexes**: userId, category, deletedAt.

---

### 5. DigitalAsset

| Field | Type | Constraints | Notes |
|-------|------|-------------|-------|
| id | UUID | PK | |
| userId | UUID | FK → User, NOT NULL, indexed | |
| name | String | NOT NULL | |
| category | Enum | NOT NULL | CRYPTO_WALLET, ONLINE_ACCOUNT, DOMAIN, SUBSCRIPTION, SOCIAL_MEDIA, OTHER |
| platform | String | NULL | |
| username | String | NULL | |
| credentials | String | NULL, ENCRYPTED | |
| recoveryInfo | String | NULL, ENCRYPTED | |
| estimatedValue | Decimal | NULL | |
| currency | String | NOT NULL, default "USD" | |
| notes | Text | NULL | |
| metadata | JSONB | NULL | |
| createdAt / updatedAt | DateTime | NOT NULL, auto | |
| deletedAt | DateTime | NULL | Set by `delete_asset()` |

**Indexes**: userId, category, deletedAt.

---

### 6. Document

| Field | Type | Constraints | Notes |
|-------|------|-------------|-------|
| id | UUID | PK | |
| userId | UUID | FK → User, NOT NULL, indexed | |
| folderId | UUID | FK → Folder, NULL | Root if NULL |
| name | String | NOT NULL | Original filename |
| mimeType | String | NOT NULL | Validated |
| sizeBytes | BigInt | NOT NULL | ≤ 50 MB |
| storageBucket | String | NOT NULL, default "documents" | Private bucket |
| storageKey | String | NOT NULL | Object path |
| encryptionMode | Enum | NOT NULL, default PROVIDER_SSE | PROVIDER_SSE (baseline), APP_ENVELOPE (ADR-013, reserved) |
| encryptionKeyId | String | NULL | Only when APP_ENVELOPE |
| scanStatus | Enum | NOT NULL, default PENDING | PENDING, CLEAN, INFECTED, ERROR — protected (system) |
| currentVersionId | UUID | FK → DocumentVersion, NULL | Latest version |
| metadata | JSONB | NULL | Custom metadata |
| createdAt / updatedAt | DateTime | NOT NULL, auto | |
| deletedAt | DateTime | NULL | Set by `delete_document()` |

**Indexes**: userId, folderId, deletedAt. Created only by `promote_upload()`.

---

### 7. DocumentVersion

| Field | Type | Constraints | Notes |
|-------|------|-------------|-------|
| id | UUID | PK | |
| documentId | UUID | FK → Document, NOT NULL, indexed | |
| versionNumber | Int | NOT NULL | Increments per document |
| storageKey | String | NOT NULL | |
| sizeBytes | BigInt | NOT NULL | |
| uploadedBy | UUID | FK → User, NOT NULL | |
| createdAt | DateTime | NOT NULL, auto | |

**Indexes**: (documentId, versionNumber) unique.

---

### 8. Folder

| Field | Type | Constraints | Notes |
|-------|------|-------------|-------|
| id | UUID | PK | |
| userId | UUID | FK → User, NOT NULL, indexed | |
| parentId | UUID | FK → Folder, NULL | NULL = root |
| name | String | NOT NULL | |
| createdAt / updatedAt | DateTime | NOT NULL, auto | |
| deletedAt | DateTime | NULL | |

**Indexes**: `UNIQUE NULLS NOT DISTINCT (userId, parentId, name) WHERE deletedAt IS NULL`
(prevents duplicate root folders), userId.

---

### 9. LegacyPlan

| Field | Type | Constraints | Notes |
|-------|------|-------------|-------|
| id | UUID | PK | |
| userId | UUID | FK → User, NOT NULL, indexed | |
| status | Enum | NOT NULL, default DRAFT | DRAFT, FINALIZED |
| currentStep | Int | NOT NULL, default 1 | |
| stepsData | JSONB | NOT NULL, default {} | Keyed by section key (see below) |
| completionStatus | JSONB | NOT NULL, default {} | Per-section completion flags |
| version | Int | NOT NULL, default 1 | |
| finalizedAt | DateTime | NULL | |
| confirmedBy | UUID | FK → User, NULL | |
| lockVersion | Int | NOT NULL, default 0 | Optimistic locking (`save_plan_step`) |
| createdAt / updatedAt | DateTime | NOT NULL, auto | |
| deletedAt | DateTime | NULL | |

**Section keys** (also the plan-section scope vocabulary): `personal-details`,
`family-information`, `beneficiaries`, `financial-assets`, `physical-assets`,
`digital-assets`, `witness-details`, `special-wishes`, `document-attachments`.
Steps 3–7 store references (beneficiary/asset/document ids) rather than
copies; the finalize snapshot resolves them.

**Indexes**: partial unique (userId) WHERE status = 'DRAFT' (FR-C010), userId.
All writes via functions (Class B).

---

### 10. LegacyPlanVersion

| Field | Type | Constraints | Notes |
|-------|------|-------------|-------|
| id | UUID | PK | |
| legacyPlanId | UUID | FK → LegacyPlan, NOT NULL, indexed | |
| versionNumber | Int | NOT NULL | |
| snapshotData | JSONB | NOT NULL | Fully resolved plan at finalization (beneficiaries, assets, attachments by value) |
| completeness | JSONB | NOT NULL | Per-section completeness at finalization |
| acknowledgedIncomplete | Boolean | NOT NULL, default false | US20 scenario 2 |
| incompleteSections | Text[] | NOT NULL, default {} | Section keys acknowledged as incomplete |
| finalizedAt | DateTime | NOT NULL | |
| createdAt | DateTime | NOT NULL, auto | |

**Indexes**: (legacyPlanId, versionNumber) unique. Plan-section access
(tokens) always reads the **latest** version of the owner's plan.

---

### 11. VideoMessage

| Field | Type | Constraints | Notes |
|-------|------|-------------|-------|
| id | UUID | PK | |
| userId | UUID | FK → User, NOT NULL, indexed | |
| title | String | NOT NULL | |
| description | Text | NULL | |
| storageBucket | String | NOT NULL, default "videos" | Private bucket |
| storageKey | String | NOT NULL | |
| encryptionMode | Enum | NOT NULL, default PROVIDER_SSE | PROVIDER_SSE, APP_ENVELOPE (reserved) |
| encryptionKeyId | String | NULL | |
| scanStatus | Enum | NOT NULL, default PENDING | PENDING, CLEAN, INFECTED, ERROR — protected |
| mimeType | String | NOT NULL | MP4/WebM/MOV |
| sizeBytes | BigInt | NOT NULL | ≤ 500 MB |
| deliveryCondition | Enum | NOT NULL | IMMEDIATE, DEAD_MAN_SWITCH, EMERGENCY_ACCESS |
| metadata | JSONB | NULL | |
| createdAt / updatedAt | DateTime | NOT NULL, auto | |
| deletedAt | DateTime | NULL | Set by `delete_video()` |

**Indexes**: userId, deliveryCondition. Upload-only in baseline (recording
deferred — Clarifications 2026-09-18).

**Delivery condition ↔ grant type (strict mapping — FR-K006, Clarifications
2026-09-18)**: a recipient may play a video only through an access token whose
`grantType` matches the video's `deliveryCondition`: `IMMEDIATE` → any valid
grant (DIRECT_SHARE, DMS_RELEASE, EMERGENCY_ACCESS) whose scope includes the
video; `DEAD_MAN_SWITCH` → `DMS_RELEASE` only; `EMERGENCY_ACCESS` →
`EMERGENCY_ACCESS` only. No hierarchical or cross-acceptance. Enforced
server-side on **every** video access (`/access/videos/:id`) and validated when
a scope is configured or a token is issued (`issue_access_token()`,
`dms_configure()`, `ea_configure_contact()`, `system_issue_access_token()`); a
mismatch returns `422 DELIVERY_CONDITION_MISMATCH`. The owner's own playback is
authorized by ownership and is not subject to the mapping.

---

### 12. DeadManSwitch

| Field | Type | Constraints | Notes |
|-------|------|-------------|-------|
| id | UUID | PK | |
| userId | UUID | FK → User, UNIQUE, NOT NULL | One switch per user |
| status | Enum | NOT NULL, default INACTIVE | State machine below |
| inactivityPeriodDays | Int | NOT NULL, CHECK 7–365 | |
| checkInFrequencyDays | Int | NOT NULL, CHECK 1–90 | |
| escalationDelayHours | Int | NOT NULL, default 24, CHECK 1–168 | |
| releaseScope | JSONB | NOT NULL, default {} | Access-scope shape (§21); validated against owned resources |
| escalationRules | JSONB | NOT NULL, default {} | Step count / channels |
| lastCheckInAt | DateTime | NULL | |
| nextCheckInAt | DateTime | NULL | Drives the hourly scan |
| currentEscalationStep | Int | NOT NULL, default 0 | |
| pausedAt | DateTime | NULL | |
| createdAt / updatedAt | DateTime | NOT NULL, auto | |

Trusted contacts live in `DeadManSwitchContact` (#25) — no JSON contact list.

**Indexes**: userId (unique), status, nextCheckInAt.

**State machine** (owner transitions via `dms_*` functions; job transitions
via `dms_transition`, each guarded on the current state):
```
INACTIVE → ACTIVE        (dms_configure / enable)
ACTIVE → REMINDER_SENT   (job: check-in sent)
REMINDER_SENT → ACTIVE   (dms_check_in)
REMINDER_SENT → GRACE_PERIOD (job: window expired)
GRACE_PERIOD → ACTIVE    (dms_check_in)
GRACE_PERIOD → ESCALATING (job: grace expired)
ESCALATING → ACTIVE      (dms_cancel_escalation — reverified)
ESCALATING → RELEASING   (job: steps exhausted)
RELEASING → RELEASED     (job: release executed)
RELEASED → ACTIVE        (dms_cancel_escalation — reverified; tokens revoked)
ANY → PAUSED             (dms_pause)
PAUSED → ACTIVE          (dms_resume)
ANY → INACTIVE           (dms_disable — reverified)
```

---

### 13. DeadManSwitchEvent

| Field | Type | Constraints | Notes |
|-------|------|-------------|-------|
| id | UUID | PK | |
| deadManSwitchId | UUID | FK → DeadManSwitch, NOT NULL, indexed | |
| eventType | Enum | NOT NULL | CHECK_IN, MISSED_CHECK_IN, ESCALATION_STEP, RECOVERY, RELEASE, PAUSE, RESUME, CONFIG_CHANGE |
| previousState | String | NOT NULL | |
| newState | String | NOT NULL | |
| metadata | JSONB | NULL | |
| createdAt | DateTime | NOT NULL, auto | |

**Indexes**: deadManSwitchId, eventType, createdAt. Insert-only.

---

### 14. EmergencyAccessConfig

Designates an existing beneficiary as an emergency contact.

| Field | Type | Constraints | Notes |
|-------|------|-------------|-------|
| id | UUID | PK | Appears in the contact's request link |
| userId | UUID | FK → User, NOT NULL, indexed | |
| beneficiaryId | UUID | FK → Beneficiary, NOT NULL | Contact identity (name/email/phone come from the beneficiary) |
| accessScope | JSONB | NOT NULL | Access-scope shape (§21); validated against owned resources |
| verificationMethod | Enum | NOT NULL, default EMAIL_OTP | EMAIL_OTP (baseline; other factors future) |
| onTimeout | Enum | NOT NULL, default WAIT | WAIT, AUTO_GRANT, DENY (FR-J006) |
| timeoutHours | Int | NULL, CHECK 1–168 | Required when onTimeout ≠ WAIT |
| requestExpiryHours | Int | NOT NULL, default 72 | Pending request expires (→ EXPIRED) |
| accessDurationHours | Int | NOT NULL, default 72 | Granted access lifetime |
| status | Enum | NOT NULL, default ACTIVE | ACTIVE, INACTIVE |
| lastDesignationSentAt | DateTime | NULL | Designation email (re-sendable) |
| createdAt / updatedAt | DateTime | NOT NULL, auto | |
| deletedAt | DateTime | NULL | |

**Indexes**: (userId, beneficiaryId) unique WHERE deletedAt IS NULL, userId,
status.

---

### 15. EmergencyAccessRequest

| Field | Type | Constraints | Notes |
|-------|------|-------------|-------|
| id | UUID | PK | |
| configId | UUID | FK → EmergencyAccessConfig, NOT NULL, indexed | |
| requesterEmail | String | NOT NULL | Must equal the beneficiary's email |
| status | Enum | NOT NULL, default PENDING | State machine below |
| otpHash | String | NULL | Hash of the 6-digit code (never plaintext) |
| otpExpiresAt | DateTime | NULL | 15 minutes |
| verificationAttempts | Int | NOT NULL, default 0 | Max 3 |
| requestExpiresAt | DateTime | NOT NULL | now + config.requestExpiryHours |
| decidedBy | Enum | NULL | OWNER, SYSTEM |
| decidedAt | DateTime | NULL | |
| accessTokenId | UUID | FK → AccessToken, NULL | Issued on grant |
| grantedAt | DateTime | NULL | |
| expiresAt | DateTime | NULL | Access expiry (config.accessDurationHours) |
| revokedAt | DateTime | NULL | |
| revokedBy | Enum | NULL | OWNER, SYSTEM, EXPIRY |
| createdAt / updatedAt | DateTime | NOT NULL, auto | |

**State machine**:
```
PENDING → VERIFYING          (OTP sent)
VERIFYING → VERIFIED         (OTP correct)
VERIFYING → FAILED           (3 wrong attempts or OTP expired)
VERIFIED → APPROVED          (owner, ea_decide_request)
VERIFIED → DENIED            (owner, or SYSTEM when onTimeout = DENY)
VERIFIED → AUTO_GRANTED      (SYSTEM when onTimeout = AUTO_GRANT)
PENDING|VERIFYING|VERIFIED → EXPIRED (requestExpiresAt reached)
APPROVED|AUTO_GRANTED → ACTIVE (token issued, timer started)
ACTIVE → EXPIRED             (expiresAt reached — token revoked)
ACTIVE → REVOKED             (owner ea_revoke)
```

**Indexes**: configId, status, requestExpiresAt, expiresAt.

---

### 16. BeneficiaryAssignment

| Field | Type | Constraints | Notes |
|-------|------|-------------|-------|
| id | UUID | PK | |
| userId | UUID | FK → User, NOT NULL | |
| beneficiaryId | UUID | FK → Beneficiary, NOT NULL | |
| resourceType | Enum | NOT NULL | FINANCIAL_ASSET, PHYSICAL_ASSET, DIGITAL_ASSET, DOCUMENT, VIDEO_MESSAGE |
| resourceId | UUID | NOT NULL | Polymorphic; ownership verified in `assign_beneficiary()` |
| allocationPercentage | Decimal(5,2) | NULL, CHECK 0–100 | Per resource (Clarifications 2026-09-18) |
| createdAt / updatedAt | DateTime | NOT NULL, auto | |

**Indexes**: (beneficiaryId, resourceType, resourceId) unique, userId,
(resourceType, resourceId).
**Invariant**: Σ allocationPercentage per (resourceType, resourceId) ≤ 100 —
enforced only inside `assign_beneficiary()` under `FOR UPDATE` of the resource
row; **no direct write grants** (Class B).

---

### 17. AuditLog

| Field | Type | Constraints | Notes |
|-------|------|-------------|-------|
| id | UUID | PK | |
| actorId | UUID | NULL | NULL for system actions |
| actorRole | String | NULL | Role at time of action |
| action | String | NOT NULL | e.g. `user.login`, `document.downloaded`, `dms.job_health_failure` |
| resourceType | String | NOT NULL | |
| resourceId | UUID | NULL | |
| outcome | Enum | NOT NULL | SUCCESS, FAILURE, DENIED |
| metadata | JSONB | NULL | Redacted before/after values, request details |
| ipAddress | String | NULL | |
| userAgent | String | NULL | |
| correlationId | String | NULL | |
| createdAt | DateTime | NOT NULL, auto | |

**Indexes**: actorId, action, (resourceType, resourceId), createdAt,
correlationId.
**Protection**: `authenticated` may `SELECT` rows where `actorId = self`
(powers `/api/v1/audit-logs`); inserts by guarded functions and the audit
service; `BEFORE UPDATE OR DELETE` trigger raises for every role (append-only).

---

### 18. AIInteraction

Sanitized usage/audit record. **Never contains draft text, findings, or raw
user content** — those live in `AiDraft`/`AiDraftVersion` (#27/#28).

| Field | Type | Constraints | Notes |
|-------|------|-------------|-------|
| id | UUID | PK | |
| userId | UUID | FK → User, NOT NULL, indexed | |
| sessionType | Enum | NOT NULL | ASSISTANT, WILL_GENERATOR, DOCUMENT_ANALYSIS |
| provider | String | NOT NULL | "openai", "gemini" |
| model | String | NULL | |
| promptVersion | String | NULL | |
| draftId | UUID | FK → AiDraft, NULL | Link to produced draft (if any) |
| inputSummary | Text | NULL | Sanitized (no raw PII) |
| outputSummary | Text | NULL | Sanitized |
| validation | JSONB | NULL | Warnings/confidence from `lib/ai/validation.ts` (no content) |
| tokenCount | Int | NULL | |
| costEstimate | Decimal | NULL | |
| createdAt | DateTime | NOT NULL, auto | |

**Indexes**: userId, sessionType, createdAt. Class C (SELECT own).

---

### 19. Notification

| Field | Type | Constraints | Notes |
|-------|------|-------------|-------|
| id | UUID | PK | |
| userId | UUID | FK → User, NOT NULL, indexed | |
| type | String | NOT NULL | e.g. `auth.new_device`, `dms.checkin`, `ea.request` |
| title | String | NOT NULL | |
| content | Text | NOT NULL | No sensitive data |
| channel | Enum | NOT NULL | EMAIL, IN_APP, BOTH |
| deliveryStatus | Enum | NOT NULL, default PENDING | PENDING, SENT, DELIVERED, BOUNCED, FAILED |
| providerMessageId | String | NULL | For delivery webhooks |
| readAt | DateTime | NULL | Only column `authenticated` may update |
| retryCount | Int | NOT NULL, default 0 | |
| lastRetryAt | DateTime | NULL | |
| metadata | JSONB | NULL | |
| createdAt | DateTime | NOT NULL, auto | |

**Indexes**: (userId, readAt), type, deliveryStatus, providerMessageId,
createdAt.

---

### 20. Session — *externalized to Clerk (ADR-003)*

No application `sessions` table. Clerk owns session issuance, expiry (24 h
inactivity, platform-wide), revocation and per-session device data.

| Requirement | How it is satisfied |
|-------------|---------------------|
| Active session list (FR-A015, FR-O002) | `SecurityService.getActiveSessions()` → Clerk Backend API |
| Session revocation (FR-A015, FR-O003) | `SecurityService.revokeSession()` → ownership check → Clerk Backend API → audit |
| Login history (FR-O004) | `AuditLog` rows from the Clerk webhook handler |
| New-device detection (FR-A016) | Job on `session.created` (city/country/browser only) |
| Idle timeout preference (FR-B006) | `users.securityPreferences.idleTimeoutMinutes`, enforced client-side (T220) within the platform lifetime |

---

### 21. AccessToken *(replaces BeneficiaryAccessToken — ADR-014)*

One entity for every scoped external grant. Plaintext tokens are generated in
application code, delivered once by email, and stored only as a hash. The
recipient exchanges the token for a short-lived httpOnly access cookie
(`POST /api/v1/access/exchange`); the token itself never appears in
subsequent request paths.

| Field | Type | Constraints | Notes |
|-------|------|-------------|-------|
| id | UUID | PK | |
| ownerUserId | UUID | FK → User, NOT NULL, indexed | Whose resources are exposed |
| beneficiaryId | UUID | FK → Beneficiary, NOT NULL, indexed | Recipient (all recipients are beneficiaries) |
| grantType | Enum | NOT NULL | DIRECT_SHARE, DMS_RELEASE, EMERGENCY_ACCESS |
| deadManSwitchId | UUID | FK → DeadManSwitch, NULL | Required when DMS_RELEASE |
| emergencyRequestId | UUID | FK → EmergencyAccessRequest, NULL | Required when EMERGENCY_ACCESS |
| tokenHash | String | UNIQUE, NOT NULL | SHA-256 of the plaintext |
| scope | JSONB | NOT NULL | `{ documents: uuid[], assets: [{type,id}], videos: uuid[], planSections: string[] }` — all owned by ownerUserId; for DIRECT_SHARE additionally ⊆ the beneficiary's current `beneficiary_assignments` (`planSections` empty — FR-D011); videos must satisfy the § 11 delivery-condition mapping for the grant type |
| expiresAt | DateTime | NOT NULL | ≤ 30 days (DIRECT_SHARE), config-driven otherwise |
| revokedAt | DateTime | NULL | |
| usedAt | DateTime | NULL | First exchange |
| lastUsedAt | DateTime | NULL | Sliding; for security review |
| createdAt | DateTime | NOT NULL, auto | |

**CHECK**: `(grantType='DMS_RELEASE') = (deadManSwitchId IS NOT NULL)` and
`(grantType='EMERGENCY_ACCESS') = (emergencyRequestId IS NOT NULL)`.
**Indexes**: tokenHash (unique), beneficiaryId, ownerUserId, expiresAt.
**Access cookie**: stateless — `{ tokenId, exp }` encrypted with a dedicated
server key (`ACCESS_COOKIE_KEY`), `httpOnly; Secure; SameSite=Strict;
Path=/api/v1/access`, 30-minute sliding TTL, never beyond `expiresAt`;
revocation is re-checked against this table on every request. No table.

---

### 22. Job *(operational — ADR-006)*

| Field | Type | Constraints | Notes |
|-------|------|-------------|-------|
| id | UUID | PK | |
| type | String | NOT NULL, indexed | `dms.scan`, `dms.send-checkin`, `dms.advance`, `dms.release`, `ea.auto-decide`, `ea.expire`, `notification.deliver`, `ai.analyze-document`, `video.process`, `file.scan`, `security.new-device-check`, `storage.remove-object`, `user.hard-delete` |
| payload | JSONB | NOT NULL, default {} | No secrets / document content |
| status | Enum | NOT NULL, default QUEUED | QUEUED, RUNNING, SUCCEEDED, FAILED, DEAD |
| runAt | DateTime | NOT NULL, default now() | |
| attempts | Int | NOT NULL, default 0 | |
| maxAttempts | Int | NOT NULL, default 5 | Exponential backoff |
| lockedAt | DateTime | NULL | |
| lockedBy | String | NULL | |
| lastError | Text | NULL | Sanitized |
| idempotencyKey | String | UNIQUE, NULL | e.g. `dms:{switchId}:{nextCheckInAt}` |
| progress | JSONB | NULL | For UI polling (NFR-PER-004) |
| finishedAt | DateTime | NULL | Health checks |
| createdAt / updatedAt | DateTime | NOT NULL, auto | |

**Indexes**: (status, runAt), type, idempotencyKey (unique), finishedAt.
Unknown job types (handler not yet registered) remain QUEUED with a warning —
never DEAD — so phases can register handlers later. Class C.

---

### 23. UploadSession *(operational — ADR-005)*

| Field | Type | Constraints | Notes |
|-------|------|-------------|-------|
| id | UUID | PK | Object name under `quarantine/{clerkUserId}/` |
| userId | UUID | FK → User, NOT NULL, indexed | |
| kind | Enum | NOT NULL | DOCUMENT, DOCUMENT_VERSION, VIDEO |
| targetDocumentId | UUID | FK → Document, NULL | New-version uploads |
| declaredName | String | NOT NULL | |
| declaredMimeType | String | NOT NULL | Whitelisted |
| declaredSizeBytes | BigInt | NOT NULL | ≤ 50 MB / ≤ 500 MB |
| folderId | UUID | FK → Folder, NULL | |
| status | Enum | NOT NULL, default PENDING | PENDING, UPLOADED, VALIDATING, SCANNING, SCANNED_CLEAN, PROMOTED, REJECTED, EXPIRED |
| rejectionReason | String | NULL | User-facing (FR-H003) |
| expiresAt | DateTime | NOT NULL | Default 1 hour |
| createdAt / updatedAt | DateTime | NOT NULL, auto | |

**Indexes**: userId, status, expiresAt. Class C with `SELECT` own (status
polling). `promote_upload()` requires `SCANNED_CLEAN`.

---

### 24. RateLimitBucket *(operational — ADR-007)*

| Field | Type | Constraints | Notes |
|-------|------|-------------|-------|
| key | String | PK part | `{policy}:{subject}` |
| windowStart | DateTime | PK part | |
| count | Int | NOT NULL, default 0 | `rate_limit_hit()` |

Class C.

---

### 25. DeadManSwitchContact

| Field | Type | Constraints | Notes |
|-------|------|-------------|-------|
| deadManSwitchId | UUID | FK → DeadManSwitch, NOT NULL | PK part |
| beneficiaryId | UUID | FK → Beneficiary, NOT NULL | PK part; must be owned by the switch owner and not INACTIVE |
| notifyOrder | Int | NOT NULL, default 1 | Escalation order |
| createdAt | DateTime | NOT NULL, auto | |

Written only by `dms_configure()`; removed by `remove_beneficiary()`. Release
tokens (`grantType = DMS_RELEASE`) are issued to these beneficiaries.

---

### 26. DocumentAttachment

Links a vault document to an asset or to the legacy plan (FR-E004, FR-F003,
FR-G002, plan step `document-attachments`).

| Field | Type | Constraints | Notes |
|-------|------|-------------|-------|
| id | UUID | PK | |
| userId | UUID | FK → User, NOT NULL, indexed | |
| documentId | UUID | FK → Document, NOT NULL | |
| resourceType | Enum | NOT NULL | FINANCIAL_ASSET, PHYSICAL_ASSET, DIGITAL_ASSET, LEGACY_PLAN |
| resourceId | UUID | NOT NULL | Ownership verified in `attach_document()` |
| createdAt | DateTime | NOT NULL, auto | |

**Indexes**: (documentId, resourceType, resourceId) unique, (resourceType,
resourceId), userId. Class B.

---

### 27. AiDraft *(ADR-016)*

Persistent, versioned container for AI-generated will drafts and
document-analysis findings. Nothing here is authoritative until `CONFIRMED`.

| Field | Type | Constraints | Notes |
|-------|------|-------------|-------|
| id | UUID | PK | |
| userId | UUID | FK → User, NOT NULL, indexed | |
| kind | Enum | NOT NULL | WILL_DRAFT, DOCUMENT_ANALYSIS |
| legacyPlanId | UUID | FK → LegacyPlan, NULL | WILL_DRAFT |
| sourceDocumentId | UUID | FK → Document, NULL | DOCUMENT_ANALYSIS |
| status | Enum | NOT NULL, default DRAFT | DRAFT, PENDING_CONFIRMATION, CONFIRMED, REJECTED, SUPERSEDED |
| currentVersionId | UUID | FK → AiDraftVersion, NULL | |
| confirmedVersionId | UUID | FK → AiDraftVersion, NULL | |
| overallConfidence | Decimal(4,3) | NULL | 0–1 |
| confirmedAt | DateTime | NULL | |
| createdAt / updatedAt | DateTime | NOT NULL, auto | |
| deletedAt | DateTime | NULL | |

**Indexes**: userId, kind, status, legacyPlanId, sourceDocumentId. Class B.
A confirmed WILL_DRAFT is the authoritative AI document for FR-M010/M011 and
is included by reference in the next legacy-plan finalize snapshot; PDF export
renders the confirmed version.

---

### 28. AiDraftVersion

| Field | Type | Constraints | Notes |
|-------|------|-------------|-------|
| id | UUID | PK | |
| draftId | UUID | FK → AiDraft, NOT NULL, indexed | |
| versionNumber | Int | NOT NULL | |
| createdBy | Enum | NOT NULL | AI, USER |
| content | JSONB | NOT NULL, ENCRYPTED | Sections (will) or findings (analysis) — may contain PII |
| sectionConfidence | JSONB | NULL | Per-section / per-finding confidence and flags (no content) |
| provider | String | NULL | |
| model | String | NULL | |
| promptVersion | String | NULL | |
| interactionId | UUID | FK → AIInteraction, NULL | Usage record for this generation |
| createdAt | DateTime | NOT NULL, auto | |

**Indexes**: (draftId, versionNumber) unique. Immutable; created by
`lib/services/ai/draft.service.ts` (AI versions, service client) and
`update_ai_draft()` (USER versions).

---

### 29. ProcessedWebhookEvent *(operational)*

| Field | Type | Constraints | Notes |
|-------|------|-------------|-------|
| provider | Enum | PK part | CLERK, EMAIL |
| eventId | String | PK part | `svix-id` / provider event id |
| eventType | String | NOT NULL | |
| receivedAt | DateTime | NOT NULL, default now() | |
| processedAt | DateTime | NULL | |

Inserted first via `record_webhook_event()`; a duplicate returns `false` and
the handler responds 200 without side effects. Class C; pruned after 30 days.

---

## Relationship Diagram

```
User (1) ──── (N) Beneficiary ─┬── (N) BeneficiaryAssignment ── polymorphic → Financial/Physical/DigitalAsset | Document | VideoMessage
                               ├── (N) AccessToken (DIRECT_SHARE | DMS_RELEASE | EMERGENCY_ACCESS)
                               ├── (N) DeadManSwitchContact ── (1) DeadManSwitch ── (N) DeadManSwitchEvent
                               └── (0..1) EmergencyAccessConfig ── (N) EmergencyAccessRequest ── (0..1) AccessToken
User (1) ──── (N) FinancialAsset / PhysicalAsset / DigitalAsset ── (N) DocumentAttachment ── (1) Document
User (1) ──── (N) Document ── (N) DocumentVersion ; Document (N) ── (0..1) Folder
User (1) ──── (N) LegacyPlan ── (N) LegacyPlanVersion ; LegacyPlan ── (N) DocumentAttachment (LEGACY_PLAN)
User (1) ──── (N) VideoMessage
User (1) ──── (1) DeadManSwitch
User (1) ──── (N) AiDraft ── (N) AiDraftVersion ── (0..1) AIInteraction
User (1) ──── (N) AIInteraction / Notification / UploadSession / AuditLog (as actor)
User (1) ──── (N) Clerk sessions   (external — no table)
System ─────── Job / RateLimitBucket / ProcessedWebhookEvent
```

---

## Validation Rules (from spec)

| Rule | Entities | Implementation |
|------|----------|----------------|
| Allocation ≤ 100 % per resource | BeneficiaryAssignment | CHECK per row + sum enforced in `assign_beneficiary()` under `FOR UPDATE`; no direct writes |
| One DRAFT plan per user | LegacyPlan | Partial unique index + `create_legacy_plan()` check |
| No duplicate beneficiary email per user | Beneficiary | Unique (userId, email) WHERE deletedAt IS NULL |
| Beneficiary lifecycle / removal cascade | Beneficiary, AccessToken, DeadManSwitchContact, EmergencyAccessConfig | `set_beneficiary_status()`, `remove_beneficiary()` |
| Finalization minimum + acknowledgment | LegacyPlan, LegacyPlanVersion | `finalize_legacy_plan()` (Personal Details complete; `acknowledgedIncomplete` otherwise) |
| Password strength / session expiry / reset single-use | *Clerk* | Clerk configuration (T195) |
| Idle timeout preference | User.securityPreferences | Client-enforced (T220), ≤ platform lifetime |
| File size ≤ 50 MB / ≤ 500 MB, type, magic bytes, scan | UploadSession → Document/VideoMessage | Declared checks at session creation; actual size + magic bytes + scan at `complete`; `promote_upload()` requires SCANNED_CLEAN |
| Access scope ⊆ owned resources | AccessToken, DeadManSwitch.releaseScope, EmergencyAccessConfig.accessScope | Validated in `issue_access_token()`, `dms_configure()`, `ea_configure_contact()`; system grants ⊆ configured scope; DIRECT_SHARE scope additionally ⊆ the beneficiary's current assignments (FR-D011, 422 `SCOPE_NOT_ASSIGNED`); videos must satisfy the § 11 delivery-condition ↔ grant-type mapping (422 `DELIVERY_CONDITION_MISMATCH`) |
| Token / OTP single-use & expiry | AccessToken, EmergencyAccessRequest | Hash-only storage, `expiresAt`, `revokedAt`; housekeeping sweeps; cookie exchange |
| Emergency request email match, attempts, timeout rules | EmergencyAccessRequest | `ea_request_access()`, `ea_verify_otp()`, `ea_transition()` (WAIT/AUTO_GRANT/DENY, request expiry) |
| Audit log append-only | AuditLog | Trigger + no update/delete grants |
| Cross-user isolation | all user-owned tables | Service-layer checks (primary) + RLS (secondary) + column grants + guarded functions |
| Webhook idempotency | ProcessedWebhookEvent | `record_webhook_event()` PK |

---

## Row Level Security Summary

- RLS **enabled on every table**; `anon` has no grants or policies.
- `authenticated`: `SELECT` policies on own rows for every user-owned table
  (Class A, B, and the SELECT-own Class C tables: `audit_log`,
  `ai_interactions`, `upload_sessions`, `notifications`,
  `emergency_access_requests` via config ownership, `access_tokens` via
  ownerUserId, `ai_draft_versions` via draft ownership).
- `authenticated` `INSERT`/`UPDATE` policies **only** on Class A tables, and
  only for the allow-listed columns (§ Write-Protection Model 4).
- All other writes: guarded `SECURITY DEFINER` functions (Class B) or the
  `service_role` from server code (Class C).
- `storage.objects`: no client `SELECT`; `INSERT` only into `quarantine`
  under the caller's `clerk_user_id/` prefix (resumable uploads); all other
  object access is server-side via signed URLs.
- Policy predicates use `(select auth.jwt()->>'sub')` for plan caching.

---

## Retention & Purge Policy (housekeeping — T199)

| Data | Retention | Mechanism |
|------|-----------|-----------|
| `audit_log` | Indefinite in baseline (legally significant); a formal retention schedule is an **owner/legal decision** (PROJECT_STATUS open item) | Backups; never mutated |
| `jobs` | SUCCEEDED 14 d; FAILED/DEAD 90 d | prune |
| `rate_limits` | Rolling window | prune |
| `processed_webhook_events` | 30 d | prune |
| `upload_sessions` + quarantine objects | EXPIRED/REJECTED 24 h; PROMOTED 30 d | delete objects, prune rows |
| `notifications` | 180 d | prune |
| `ai_interactions` | 12 months (sanitized) | prune |
| `ai_drafts` REJECTED / SUPERSEDED (+ versions) | 90 d | purge encrypted content |
| `ai_drafts` CONFIRMED | Life of the owning plan/account | — |
| Soft-deleted beneficiaries / assets / documents / videos | Storage objects removed at deletion (job); rows purged 30 d after `deletedAt` | purge (audit rows retained) |
| Access tokens | Rows retained 90 d after expiry/revocation for forensics | prune |
| Deleted accounts | 30-day grace (`deletionRequestedAt`) then hard delete (T189) | `user.hard-delete` job |
