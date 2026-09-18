# Database Architecture — LegacyVault AI

**Purpose**: Explain how the database layer is organized — platform,
migrations, clients, write protection, transactions, RLS, storage, retention
and backups — so that the entity definitions in the data model can be read
in context. It contains **no schema definitions**: every table, column,
index, constraint, state machine and function is defined once in
`specs/001-baseline-product-spec/data-model.md`, which is authoritative.

**Canonical sources**: `data-model.md` (r2, 29 entities, § Write-Protection
Model, § Transactional functions catalog, § RLS Summary, § Retention);
ADR-002, ADR-004 r2, ADR-005, ADR-006, ADR-014, ADR-016; `plan.md` Phase 2;
tasks T018, T218, T019, T028, T029, T194, T196, T212, T215, T242, T245.

**Status**: ✅ implemented locally as of 2026-09-19 — `supabase/migrations/
0001_init.sql` (schema), `0002_rls_and_privileges.sql` (privileges, RLS,
triggers), `0003_functions.sql` (guarded + system functions) are applied on
the local stack (T018/T218/T019); hosted projects are not migrated yet.
`docs/DATABASE_SCHEMA.md` (T242) will be generated from the applied
migrations later and will then hold the physical schema listing.

---

## 1. Platform

- **PostgreSQL, managed by Supabase** (new projects run PostgreSQL 17; the
  specification's "16+" is satisfied). MongoDB is not used (ADR-002).
- One Supabase project per environment (staging, production) and the Supabase
  CLI local stack for development and CI (`development/ENVIRONMENT_MATRIX.md`).
- Supabase Storage (same project) provides the private buckets used by the
  vault and video features (§ 7).

## 2. Schema management

- The schema is owned by plain **SQL migrations** in `supabase/migrations/`,
  managed with the Supabase CLI (`supabase migration new`, `supabase db
  reset` locally, gated `supabase db push` per environment). **No ORM, no
  Prisma** (ADR-002).
- Planned initial migrations (`plan.md` Phase 2): `0001_init.sql` (T018 —
  tables, enums, FKs with explicit `ON DELETE`, indexes incl. partial/unique
  indexes, `updated_at` triggers, soft-delete columns),
  `0002_rls_and_privileges.sql` (T218 — privilege baseline, RLS, column
  grants, protective triggers, storage policies), `0003_functions.sql`
  (T019 — guarded and system functions).
- TypeScript types are generated from the applied schema into
  `lib/types/database.ts` (`supabase gen types`) and committed.
- Naming: `snake_case` in SQL; the data model shows logical `camelCase`
  names.

## 3. Entities by domain (names only — definitions in `data-model.md`)

| Domain | Entities (data-model §) |
|---|---|
| Identity & profile | User (1) — Clerk owns credentials; `Session` is externalized to Clerk (20) |
| Recipients & access | Beneficiary (2), BeneficiaryAssignment (16), AccessToken (21), DeadManSwitchContact (25) |
| Assets | FinancialAsset (3), PhysicalAsset (4), DigitalAsset (5), DocumentAttachment (26) |
| Vault & media | Document (6), DocumentVersion (7), Folder (8), VideoMessage (11), UploadSession (23) |
| Legacy plan | LegacyPlan (9), LegacyPlanVersion (10) |
| Dead Man Switch | DeadManSwitch (12), DeadManSwitchEvent (13) |
| Emergency access | EmergencyAccessConfig (14), EmergencyAccessRequest (15) |
| AI | AiDraft (27), AiDraftVersion (28), AIInteraction (18, sanitized) |
| Platform | AuditLog (17), Notification (19), Job (22), RateLimitBucket (24), ProcessedWebhookEvent (29) |

**29 entities = 28 tables** (24 domain + 4 operational — Job, UploadSession,
RateLimitBucket, ProcessedWebhookEvent); `Session` is externalized to Clerk.

## 4. Access clients (ADR-004)

| Client | Key | RLS / grants | Used for |
|---|---|---|---|
| `createUserClient()` | publishable key + the caller's Clerk session token as access token | enforced | reads, Class A writes, `rpc()` calls to guarded functions |
| `createServiceClient()` | server-only secret key | bypassed | webhooks, cron/jobs, audit writes, admin, token/OTP flows, upload promotion — each path performs its own authorization |

Both live in `lib/db/server.ts` (`server-only`); application code never opens
a browser database client. A user's own Clerk token is nevertheless accepted by
Supabase (it authorizes resumable uploads), so the column grants, the
function-only sensitive columns and the Class A audit triggers below — not the
absence of a browser client — are the boundary (ADR-004 r4). Clerk is configured as a Supabase third-party auth provider so
the session token's `sub` is available to policies (T195, T196).

## 5. Write-protection model (ADR-004 r2) — summary

Defined in full in `data-model.md` § Write-Protection Model; the summary:

1. **Privilege baseline**: `REVOKE ALL` on all tables and functions from
   `anon` and `authenticated`, default privileges likewise; grants are then
   explicit. `anon` receives nothing.
2. **Class A — plain user data**: RLS `SELECT` on own rows; direct
   `INSERT`/`UPDATE` on own rows limited to a **column allow-list** (§ 4 of
   the data model: plain profile fields, beneficiary contact fields, plain
   asset columns — asset rows are created through `create_asset()` —, folders,
   document/video metadata, `notifications.readAt`). `ENCRYPTED` columns
   (`identificationDetails`, `accountNumber`, `policyNumber`, `credentials`,
   `recoveryInfo`) have no direct grant and are written only through
   `create_asset()` / `set_encrypted_fields()`; every direct Class A change is recorded by the
   `audit_class_a_change()` trigger (data model § Write-Protection Model 6).
3. **Class B — guarded**: RLS `SELECT` on own rows; **no direct write
   grants**; all mutations through `SECURITY DEFINER` functions that follow
   nine mandatory rules (auth prologue on the Clerk subject, `FOR UPDATE`
   ownership checks, typed inputs, no dynamic SQL, no identity-column
   writes, invariant under lock, in-transaction audit row, `EXECUTE`
   granted only to `authenticated`, tested). Plans, assignments,
   attachments, tokens, Dead Man Switch, emergency access, AI drafts,
   asset creation / sensitive fields / deletion (`create_asset()`,
   `set_encrypted_fields()`, `delete_asset()`), document/video lifecycle
   (`delete_document()`, `delete_video()`).
4. **Class C — system**: `service_role` only (jobs, rate limits, webhook
   events, audit inserts, upload sessions), with `SELECT` own rows where the
   UI needs it.
5. A `BEFORE UPDATE` trigger on `users` protects identity/authorization
   columns even if a grant is ever mis-applied.

What this prevents: self-role escalation, mirrored-flag tampering, direct
assignment inserts that skip the allocation sum, direct finalization or
scan-status changes, and unauthorized state-machine transitions.

## 6. Transactions and state machines

- Multi-statement, all-or-nothing workflows are PostgreSQL functions invoked
  via `rpc()` (NFR-REL-001): plan create/save/finalize/new-draft, assignment
  and removal cascade, attachment, token issue/revoke, Dead Man Switch and
  emergency-access transitions, AI draft confirmation, job claiming
  (`data-model.md` § 5 catalog).
- Optimistic locking on the legacy plan (`lockVersion`) is enforced inside
  `save_plan_step()`.
- State machines for the Dead Man Switch (§ 12) and emergency-access
  requests (§ 15) are guarded on the current state; job-driven transitions
  use service-role functions, owner transitions use guarded functions.
- Concurrency: rows are locked `FOR UPDATE` before invariants (allocation
  sum) are computed; job claiming uses `FOR UPDATE SKIP LOCKED`.

## 7. Storage (ADR-005)

Three private buckets — `quarantine`, `documents`, `videos`. Uploads go
directly from the browser into `quarantine/{clerkUserId}/{uploadId}` via a
signed upload URL (documents) or a resumable TUS target (videos); the server
`complete` step validates and scans, then `promote_upload()` moves the object
and creates the metadata rows atomically. `storage.objects` RLS grants no
client reads and allows writes only under the caller's quarantine prefix.
Downloads use server-minted 15-minute signed URLs. Object encryption at rest
is provider-managed (application envelope encryption deferred — ADR-013).

## 8. Background jobs in the database (ADR-006)

The `jobs` table is the queue (no Redis/BullMQ): `claim_jobs()` claims due
rows with `FOR UPDATE SKIP LOCKED`; handlers are idempotent; exponential
backoff and dead-lettering are recorded on the row; unknown job types remain
QUEUED. Triggers are Vercel Cron endpoints (with a `pg_cron` + `pg_net`
redundant trigger in production).

## 9. Auditability

`audit_log` is append-only (no update/delete grants; a trigger raises for
every role). Guarded functions insert their own SUCCESS rows in the same
transaction; the application audit service records Class A/C writes and
DENIED/FAILURE outcomes. Users may `SELECT` their own rows (powers
`/api/v1/audit-logs`).

## 10. Retention, backups and recovery

- Retention and purge rules per table are in `data-model.md` § Retention &
  Purge Policy and are executed by housekeeping (T199, T245). Audit-log
  retention is indefinite pending an owner/legal decision.
- Backups: Supabase automated backups with PITR for production; off-platform
  `pg_dump` copies to an encrypted, access-restricted bucket; documented
  restore procedures and drills (T186, T187; NFR-DR-001/002).

## 11. Testing the database layer (constitution XVII)

RLS cross-user suite (T212), write-protection suite (T215), guarded-function
behaviour in the feature suites (T225 plan, T226 beneficiaries, T229
allocation, T235 Dead Man Switch, T236 emergency access), job runner suite
(T217). Tests run against the Supabase CLI local stack with HS256 test JWTs
that carry Clerk-shaped claims (ADR-004 r2 § 7).
