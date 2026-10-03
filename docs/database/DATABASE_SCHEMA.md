# Database Schema — LegacyVault AI

**Generated from the applied migrations** `supabase/migrations/0001_init.sql`,
`0002_rls_and_privileges.sql`, `0003_functions.sql`, `0004_storage_buckets.sql`
(task T242). The migrations are the source of truth; this file explains what
they express and why. `lib/types/database.ts` is generated from the same schema
with `pnpm db:types`.

At a glance: **28 tables**, **22 enums**, **87 indexes**, **37 RLS policies**,
**26 triggers**, **61 functions** (32 guarded, 11 system/service, 18 internal
helpers) and **3 private storage buckets**.

---

## 1. The write model (ADR-004)

Every table column falls into one of three classes, and the class decides what
an `authenticated` client may do with it. This is the single most important
thing to understand about this schema: **RLS is the second barrier, not the
first.** The first is that most columns carry no grant at all.

| Class | Who may write | How it is enforced | Example |
|---|---|---|---|
| **A** — plain, owner-editable | the owner, directly | `GRANT UPDATE (col, …)` column allow-list + an RLS policy, and a trigger that audits the change | `beneficiaries.name`, `financial_assets.estimated_value` |
| **B** — invariant-bearing | the owner, only through a guarded function | no grant; `SECURITY DEFINER` function validates, writes, audits | asset creation, plan finalization, token issue, every DMS/EA transition |
| **C** — system | the service role only | no grant to `authenticated` at all | `users.role`, `users.deletion_requested_at`, `access_tokens.token_hash`, `jobs.*` |

Two triggers make the model self-enforcing rather than a convention:

- `protect_identity_columns` refuses any `authenticated` change to
  `users.role`, `email`, `email_verified`, `mfa_enabled`, `name`,
  `clerk_user_id`, `last_login_at`, `deletion_requested_at`, `deleted_at`,
  `created_at` or `id` — including one made through a policy that would
  otherwise allow the row.
- `audit_class_a_change()` runs on the eight Class A tables, so a direct write
  produces an audit row *independently of application code*. It records which
  columns changed and their values for plain columns, and the field names only
  for encrypted ones (`values: "[encrypted]"`).

`audit_log` is append-only for every role, enforced by
`audit_log_append_only()` on UPDATE and DELETE.

---

## 2. Tables

### Identity and people

| Table | Purpose | Notes |
|---|---|---|
| `users` | the application half of an identity | keyed by internal UUID, `clerk_user_id UNIQUE`; `role` is the authorization source of truth (Class C); `identification_details` is an encryption envelope |
| `beneficiaries` | every external recipient, of any kind | one entity for direct shares, trusted contacts and emergency contacts (ADR-014 § 1); unique on `(user_id, email)` among live rows |
| `beneficiary_assignments` | who gets what | `(resource_type, resource_id)` + optional `allocation_percentage`; Σ ≤ 100 per resource is held under a row lock inside `assign_beneficiary()` |

### The plan

| Table | Purpose | Notes |
|---|---|---|
| `legacy_plans` | one draft per user | `lock_version` for optimistic concurrency; `steps_data` holds the wizard sections |
| `legacy_plan_versions` | immutable finalized snapshots | `snapshot_data`, `completeness`, `acknowledged_incomplete`, `incomplete_sections`; unique on `(legacy_plan_id, version_number)` |

### Assets

| Table | Encrypted columns |
|---|---|
| `financial_assets` | `account_number`, `policy_number` |
| `physical_assets` | — |
| `digital_assets` | `credentials`, `recovery_info` |

Each encrypted column is a JSONB envelope validated by `lv_is_envelope()`:
`{ ciphertext, iv, authTag, keyId }`, AES-256-GCM, written only through
`create_asset()` or `set_encrypted_fields()`.

### The vault

| Table | Purpose | Notes |
|---|---|---|
| `folders` | document tree | unique on `(user_id, parent_id, name)` among live rows |
| `documents` | current version of a file | `storage_bucket` + `storage_key`; `scan_status` (retired — `NOT_SCANNED` since 0006) |
| `document_versions` | every prior version | its own storage key; removed with the document |
| `document_attachments` | a document attached to a plan or asset | created by `attach_document()` |
| `video_messages` | recorded messages | `delivery_condition` decides which grant type may ever play them |
| `upload_sessions` | a two-step upload in flight | `declared_*` is what the browser claimed; the pipeline measures the object as stored |

### Protection

| Table | Purpose |
|---|---|
| `dead_man_switches` | one per user: schedule, escalation config, release scope, current state |
| `dead_man_switch_contacts` | who is notified, in order |
| `dead_man_switch_events` | every transition, with previous and new state |
| `emergency_access_configs` | one per designated contact: scope, timeout rule, durations |
| `emergency_access_requests` | a request in flight: `otp_hash` (never the code), attempts, decision, grant |
| `access_tokens` | one entity for all three grant types; `token_hash` only |

Partial unique indexes make more than one live link impossible: one
non-revoked token per `(dead_man_switch_id, beneficiary_id)` and one per
`emergency_request_id`.

### Platform

| Table | Purpose |
|---|---|
| `audit_log` | append-only trail; `actor_id`, `action`, `resource_type/id`, `outcome`, redacted `metadata`, `correlation_id` |
| `notifications` | in-app record plus its delivery state |
| `jobs` | the queue: `type`, `payload`, `status`, `run_at`, `attempts`, `max_attempts`, `idempotency_key UNIQUE` |
| `rate_limits` | fixed-window counters, `(key, window_start)` |
| `processed_webhook_events` | webhook idempotency, `(provider, event_id)` |
| `ai_drafts`, `ai_draft_versions`, `ai_interactions` | reserved for the deferred AI phase; **no application code writes them today** |

---

## 3. Guarded functions (32)

Owner-callable, `SECURITY DEFINER`, resolving the caller from the JWT subject
through `lv_require_user()` — never from a parameter.

`assign_beneficiary`, `attach_document`, `create_asset`, `create_legacy_plan`,
`create_plan_draft`, `delete_asset`, `delete_document`, `delete_video`,
`detach_document`, `dms_cancel_escalation`, `dms_check_in`, `dms_configure`,
`dms_disable`, `dms_pause`, `dms_resume`, `ea_configure_contact`,
`ea_decide_request`, `ea_remove_contact`, `ea_revoke`, `ea_update_contact`,
`finalize_legacy_plan`, `issue_access_token`, `remove_beneficiary`,
`resend_access_token`, `revoke_access_token`, `save_plan_step`,
`set_beneficiary_status`, `set_encrypted_fields`, `unassign_beneficiary`, plus
the three AI-draft functions reserved for the deferred phase
(`update_ai_draft`, `confirm_ai_draft`, `confirm_analysis_findings`).

## 4. System functions (11)

Executable by `service_role` only, for paths where no user session exists:
`claim_jobs`, `dms_transition`, `ea_request_access`, `ea_verify_otp`,
`ea_transition`, `promote_upload`, `rate_limit_hit`, `record_webhook_event`,
`system_issue_access_token`, `system_reissue_access_token`,
`system_mark_token_delivered`.

## 5. Error convention

Guarded functions raise SQLSTATEs the API maps to HTTP without leaking SQL:

| SQLSTATE | HTTP | Meaning |
|---|---|---|
| `42501` | 403 (401 on the access surface) | forbidden — ownership or role |
| `LV422` | 422 | a validation rule the database owns (`SCOPE_EMPTY`, `SCOPE_NOT_ASSIGNED`, `INVALID_EXPIRY`, …) |
| `LV409` | 409 | an illegal state transition or a lock conflict |
| `23505` | 409 `DUPLICATE` | a uniqueness rule |
| `22P02` | 422 | a malformed enum or UUID from the client |

## 6. Storage (migration 0004)

Two **private** buckets in use — `documents` (50 MB) and `videos` (500 MB);
the retired `quarantine` bucket (0004) is kept, private and unused (0006). There is deliberately **no storage policy for the
`authenticated` role**: the browser can neither read nor write an object
directly, and every transfer is a short-lived signed URL minted server-side
after the service layer has authorised it. Object keys are derived from the
owner's id, so a crafted filename cannot choose where bytes land.

## 7. Applying and regenerating

```bash
pnpm db:start          # local stack; applies every migration in order
pnpm db:reset          # rebuild from scratch
pnpm db:push           # apply to the linked hosted project
pnpm db:types          # regenerate lib/types/database.ts
pnpm test:integration  # asserts these guarantees against a live stack
```

---

| Date | Change |
|---|---|
| 2026-09-24 | Created (T242) from migrations 0001–0004 as applied. |
