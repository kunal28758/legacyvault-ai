# Tasks: LegacyVault AI — Baseline Product

**Feature**: `specs/001-baseline-product-spec` | **Generated**: 2026-09-16 | **Revised**: 2026-09-18 r4 (r3 targeted remediation H1/M1–M4/N1; r4 post-gate S1/C1, T210 moved to Phase 1 — wording only, task IDs/count unchanged)

**Spec**: [spec.md](./spec.md) | **Plan**: [plan.md](./plan.md) | **Data Model**: [data-model.md](./data-model.md) | **Contracts**: [contracts/api-contracts.md](./contracts/api-contracts.md) | **ADRs**: [docs/ARCHITECTURE_DECISIONS.md](../../docs/ARCHITECTURE_DECISIONS.md)

> **Revision 2026-09-18 r1** — Re-baselined to the single Next.js 16 application
> architecture (ADR-001 … ADR-013, constitution v2.0.1). Task IDs are preserved
> where the task's purpose survives; retired IDs are in the **Removed Tasks**
> ledger; r1 added T192–T212.
>
> **Revision 2026-09-18 r2 (post-`/speckit-analyze` remediation)** — adds
> T213–T247: mandatory test tasks (constitution XVII), the write-protection
> model (ADR-004 r2), unified access tokens + cookie exchange (ADR-014),
> production malware scanning (ADR-015), AI draft persistence (ADR-016),
> wizard steps 3–7/11, documentation tasks (constitution XVIII), operational
> tasks, and phase-ordering fixes (T036 and T155 moved into Phase 2; removal
> of `@supabase/ssr` and the `db-test` probe moved into T028). Existing task
> text is updated in place where the design changed.
> **Implementation started 2026-09-19.** Tasks are marked `[x]` only when the code exists and the checks pass (BRAIN § 17 rule 6); Phase 1 batch T001–T017, T192–T194, T202 complete; Phase 2 database foundation T018/T218/T019 complete (2026-09-19); T195/T196/T210 stay open until the owner verifies the external dashboards (`docs/DEPLOYMENT.md`).
>
> **Phase A — real backend foundation, 2026-09-23.** The demo workspace is being replaced module by module with real PostgreSQL persistence. Phase A delivered the platform: Clerk→`public.users` sync (T036/T198), the two Supabase clients (T028), the `withApi()` pipeline (T030), safe errors (T021), pino logging (T022), correlation ids (T023), security headers (T024), the Postgres rate limiter (T025), Zod request validation (T026), the audit service (T027), AES-256-GCM field encryption (T020), the health endpoint, the `users/me` endpoints (T034/T035) and `seed-admin` (T033). Two prerequisites were resolved and documented (`docs/DEPLOYMENT.md` § 3a): Clerk now issues the `role: authenticated` session claim and Supabase registers Clerk as a third-party issuer — without both, every query is `anon` and RLS denies it. Feature data outside `users` is still the demo workspace until its phase lands.
>
> **Website batch 2026-09-19 (college-evaluation sprint, commit `feat: build LegacyVault AI application experience`).** The user-facing product was built ahead of the remaining Phase 2 infrastructure, deliberately and without weakening it: the `(marketing)`, `(auth)` and `(dashboard)` route groups, the application shell, and every product page (dashboard, 11-step will wizard, beneficiaries, assets, document vault, video legacy, Dead Man’s Switch, emergency access, AI assistant, Security Center, notifications, settings) exist as **UI backed by a clearly-labelled demo workspace** (`lib/demo/*`, sessionStorage, typed with `lib/types/database.ts` enums). Only the pure-UI tasks listed below are marked complete; page tasks whose definition includes API wiring (T051, T056, T064–T070, T075/T076, T083/T086/T088/T089, T095/T096, T099, T101, T112, T118, T124/T129, T136/T137/T140, T144, T158, T184, T189, T200, T221–T224) have their **UI portion done** and remain open until T030/T036 and their services exist. No infrastructure task (T020–T036, T155, T181, T197–T199, T212–T217) is marked complete — demo state is not persistence.

**Conventions**: `[P]` = parallelizable (different files, no dependency);
`[USn]` = user story; paths are relative to the repository root (single app).
All Route Handlers use `withApi()` (T030); all services receive the
authenticated app user from `requireUser()` (T036); all data access goes
through `lib/repositories/*` using the clients in `lib/db/server.ts` (T028);
every invariant-bearing write goes through a guarded function (T019; see
`data-model.md` § Write-Protection Model).

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Normalize the existing root Next.js 16 scaffold, tooling, and platform configuration

- [x] T001 Create the single-application directory skeleton at the repository root per plan.md: `components/{ui,layout,forms,data-display,feedback,wizard,shared}`, `hooks/`, `stores/`, `styles/`, `emails/`, `lib/{api,auth,db,repositories,services,services/ai,ai,email,storage,jobs,security,security/scanners,audit,observability,config,validators,types}`, `supabase/migrations/`, `scripts/`, `tests/{unit,integration,e2e,helpers}`, `.github/workflows/`. No `frontend/` or `backend/` directories (ADR-001)
- [x] T002 Normalize the existing Next.js 16.3 scaffold (created 2026-09-17 at root): replace template content in `app/page.tsx`, set metadata (title "LegacyVault AI", description) in `app/layout.tsx`, remove the `Arial` override in `app/globals.css`, confirm `next.config.ts`/`tsconfig.json`. (The temporary `app/api/db-test/route.ts` and `lib/supabase/*` are removed in T028, not here.) Read `node_modules/next/dist/docs/01-app/` (getting-started, proxy, route handlers, `after`, `maxDuration`, content-security-policy guide) before any framework code (AGENTS.md)
- [x] T003 [P] Install UI dependencies: `shadcn/ui` (CLI), `framer-motion`, `gsap`, `zustand`, `@tanstack/react-query`, `zod`, `react-hook-form`, `@hookform/resolvers`, `@react-pdf/renderer`, `tus-js-client`
- [x] T005 [P] Install server/platform dependencies in the root `package.json`: `@clerk/nextjs`, `svix`, `@supabase/supabase-js` (present), `supabase` (CLI, dev), `file-type`, `unpdf`, `openai`, `@google/genai`, `resend`, `@react-email/components`, `@sentry/nextjs`, `pino`, `server-only`; dev: `vitest`, `@testing-library/react`, `@playwright/test`, `@axe-core/playwright`, `@clerk/testing`, `jose`, `tsx`, `prettier`. Keep `@supabase/ssr` installed until T028 replaces the scaffold clients (then remove it — Supabase Auth is not used, ADR-003). Justify each in `docs/ARCHITECTURE_DECISIONS.md` references (Constitution IX)
- [x] T006 [P] Configure ESLint (extend existing `eslint.config.mjs`) and Prettier for the single project; add `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm test:integration`, `pnpm test:e2e`, `pnpm db:*` scripts to `package.json`
- [x] T007 [P] Create `lib/config/env.ts` — Zod-validated environment loading with `import 'server-only'` for the server schema. Server: `CLERK_SECRET_KEY`, `CLERK_WEBHOOK_SIGNING_SECRET`, `SUPABASE_URL`, `SUPABASE_SECRET_KEY`, `ENCRYPTION_KEY` (32-byte base64, active `keyId`), `ENCRYPTION_KEY_PREVIOUS` (optional, rotation window), `ACCESS_COOKIE_KEY` (32-byte base64, ADR-014), `OPENAI_API_KEY`, `GEMINI_API_KEY`, `AI_DEFAULT_PROVIDER`, `RESEND_API_KEY`, `EMAIL_FROM`, `EMAIL_WEBHOOK_SECRET`, `SENTRY_DSN`, `CRON_SECRET`, `APP_URL`, `MALWARE_SCANNER_PROVIDER` (`noop|clamav`), `CLAMAV_HOST`, `CLAMAV_PORT`, `CLAMAV_TLS`, `ADMIN_EMAIL`, `NODE_ENV`. Public: `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`, `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `NEXT_PUBLIC_SENTRY_DSN`. Fail fast on missing/invalid values; **refuse to start when `NODE_ENV=production` and `MALWARE_SCANNER_PROVIDER=noop`** (ADR-015). No secret may be `NEXT_PUBLIC_` (Constitution I)
- [x] T008 [P] Create `.env.example` at the project root listing every variable from T007 with placeholder values only (no real secrets — Constitution I, XIX). `.env.local` is never committed
- [x] T009 [P] Complete `.gitignore` (state on 2026-09-18 01:10: `.agents/`, `.agents-backup/`, `.env`, `.env.*`, `!.env.example`, `node_modules/`, `.next/` — the `create-next-app` overwrite has been reverted, but the Next.js entries are missing): add `next-env.d.ts`, `*.tsbuildinfo`, `coverage/`, `/out/`, `/build`, `.vercel`, `*.pem`, `*.log`, `.DS_Store`, `supabase/.temp/`, `test-results/`, `playwright-report/`. Verify with `git check-ignore -v .env.local .agents next-env.d.ts`
- [x] T010 [P] Configure the Tailwind CSS v4 design system in `app/globals.css` using `@theme` (CSS-first, no `tailwind.config.ts`): dark-first colour tokens with blue/purple/cyan accents, surface/glass tokens, spacing scale, typography (Geist from `next/font` already wired; add display font if adopted). Constitution XIII
- [x] T011 [P] Create `styles/` utilities imported by `app/globals.css`: glassmorphism classes, gradient utilities, animation base classes, `prefers-reduced-motion` guards; light-mode overrides under `[data-theme="light"]` (UX-002, Constitution XIII, XIV)
- [x] T012 [P] Initialize shadcn/ui at the root (`components/ui/`), dark theme; add Button, Input, Card, Dialog, Sheet, Tabs, Table, Badge, Avatar, Dropdown, Toast, Skeleton, Tooltip, Progress
- [x] T013 [P] Create `lib/api/client.ts` — typed browser fetch client for `/api/v1`: same-origin credentials, JSON headers, envelope parsing (`{ success, data, error, meta }`), 401/403/422/429 handling (429 surfaces `Retry-After`), reverification-required handling (re-throw a typed error the re-auth gate can catch)
- [x] T014 [P] Create `lib/api/query-client.ts` — TanStack Query client configuration (staleTime, retry policy that never retries 4xx, error handling) and `components/providers.tsx` (QueryClientProvider)
- [x] T015 [P] Set up testing: `vitest.config.ts` (unit + integration projects, TypeScript, React Testing Library, `tests/setup.ts`), `playwright.config.ts` (E2E against `next dev`, `@clerk/testing` for real sessions on a Clerk development instance), `tests/helpers/jwt.ts` (mints HS256 JWTs with the local Supabase JWT secret and Clerk-shaped claims `sub`, `role: authenticated` for RLS/policy tests — ADR-004 r2 §7), `tests/helpers/db.ts` (user-scoped and service clients against the local stack, per-test data reset), one passing smoke test in each project
- [ ] T016 [P] Create `.github/workflows/ci.yml` — pnpm install → lint → typecheck → unit tests → integration tests (Supabase CLI local stack) → build → `supabase db lint`/migration dry-run; cache pnpm store
- [x] T017 Update `app/layout.tsx` — `<ClerkProvider>` (dark appearance), fonts, `components/providers.tsx`, theme attribute handling, metadata ("LegacyVault AI"), favicon; `<html lang="en">` with `suppressHydrationWarning` for theme
- [x] T192 [P] Create `proxy.ts` (Next 16 file convention; was `middleware.ts`) — `clerkMiddleware()` protected-first with `createRouteMatcher` public routes: `/`, `/sign-in(.*)`, `/sign-up(.*)`, `/access(.*)`, `/emergency-access/(.*)`, `/api/webhooks/(.*)`, `/api/internal/cron/(.*)`, `/api/v1/health`, `/api/v1/access/(.*)`, `/api/v1/emergency-access/(request|verify|requests/[^/]+/status)`; call `auth.protect()` for everything else; inject a per-request CSP nonce per the Next.js CSP guide; matcher includes `/(api|trpc)(.*)`. Proxy protection is a UX/defense layer only — handlers re-check auth (Constitution III)
- [x] T193 [P] Create `vercel.json` — cron definitions: `/api/internal/cron/run-jobs` every 5 minutes, `/api/internal/cron/dms-scan` hourly, `/api/internal/cron/housekeeping` daily 03:00 UTC (ADR-006). Set `maxDuration` on the cron/AI/scan Route Handlers via route segment config
- [x] T194 [P] Initialize the Supabase CLI: `supabase init` → `supabase/config.toml`; document `supabase start`/`supabase db reset`/`supabase gen types typescript --local > lib/types/database.ts` in `docs/DEPLOYMENT.md`; add `pnpm db:start`, `db:reset`, `db:migrate:new`, `db:types`, `db:push` scripts (ADR-002)
- [ ] T195 [P] Clerk application configuration checklist (dashboard, per environment — record in `docs/DEPLOYMENT.md`): email/password enabled; password policy min 12 + upper/lower/number/special; email verification required before sign-in; MFA TOTP + backup codes enabled; session inactivity lifetime 24 h (verify the Clerk plan supports inactivity timeout and session-token customization); attack protection: lockout after 5 failed attempts for 30 min, bot protection on; reverification enabled; Supabase third-party auth integration enabled (adds `role: authenticated` claim); webhook endpoint `/api/webhooks/clerk` with events `user.created|updated|deleted`, `session.created|ended|removed|revoked`; branded emails. FR-A001–A013, A017 (ADR-003)
- [ ] T196 [P] Supabase project configuration checklist (per environment — record in `docs/DEPLOYMENT.md`): Clerk added as third-party auth provider; private buckets `quarantine`, `documents`, `videos`; global file-size limit ≥ 500 MB (Pro plan) — FR-K002; automated backups on, PITR add-on for production; `pg_cron`/`pg_net` extensions available for the production redundancy trigger; publishable vs secret key usage documented (ADR-002, ADR-005, ADR-011)
- [x] T202 [P] Create `docs/DEPLOYMENT.md` (initial) — environment matrix (dev/staging/prod × Vercel/Supabase/Clerk/ClamAV), environment variables (from T007) and where they live, platform prerequisites with verification status (Vercel cron frequency + `maxDuration`, Supabase file-size limit + PITR, Clerk plan features, ClamAV hosting), local development setup, migration workflow. Completed in Phase 25 (T175/T211/T238/T239)
- [ ] T210 [P] Verify platform prerequisites and configure edge protections — Vercel plan supports minute-level cron and the `maxDuration` needed for job/AI/scan handlers (largest video scan); Supabase file-size limit ≥ 500 MB and PITR (prod); Clerk plan supports inactivity timeout, session-token customization and reverification; ClamAV endpoint reachable from Vercel functions; Vercel WAF rate-limit rules for `/api/v1/emergency-access/{request,verify}`, `/api/v1/access/*`, `/api/v1/ai/*`; record outcomes in `docs/DEPLOYMENT.md` (ADR-007, ADR-011, ADR-015). *Moved to Phase 1 in r4: the plan requires these prerequisites to be verified before Phase 2 depends on cron frequency, `maxDuration` and storage limits; the WAF rules and the ClamAV reachability check are completed when those routes/hosts exist (T211, T247) and recorded as verified.*

**Checkpoint**: App builds and starts; Clerk pages render; local Supabase stack reachable; CI configured; prerequisites recorded.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Core infrastructure that MUST be complete before ANY user story

**⚠️ CRITICAL**: No user story work can begin until this phase is complete

- [x] T018 Create `supabase/migrations/0001_init.sql` — all **28 tables** (29 entities — `Session` is externalized to Clerk) from data-model.md in `snake_case`: `users` (clerk_user_id UNIQUE, email UNIQUE, role enum USER/SUPER_ADMIN default USER, mirrored email_verified/mfa_enabled/name, alternate_email, no credential columns), `beneficiaries` (unique (user_id, email) WHERE deleted_at IS NULL; status enum PENDING/ACTIVE/INACTIVE; invited_at, activated_at), `financial_assets`, `physical_assets`, `digital_assets`, `documents` (storage_bucket, storage_key, encryption_mode enum, encryption_key_id, scan_status enum), `document_versions`, `folders` (`UNIQUE NULLS NOT DISTINCT (user_id, parent_id, name) WHERE deleted_at IS NULL`), `legacy_plans` (status enum, lock_version, **partial unique index on user_id WHERE status='DRAFT'**), `legacy_plan_versions` (snapshot_data, completeness, acknowledged_incomplete, incomplete_sections), `video_messages`, `dead_man_switches` (user_id UNIQUE, status enum, release_scope), `dead_man_switch_contacts` (PK switch+beneficiary), `dead_man_switch_events`, `emergency_access_configs` (beneficiary_id NOT NULL, on_timeout enum WAIT/AUTO_GRANT/DENY, timeout_hours, request_expiry_hours, access_duration_hours), `emergency_access_requests` (otp_hash, request_expires_at, decided_by, access_token_id), `beneficiary_assignments` (unique compound, CHECK 0–100), `document_attachments` (unique document+resource), `access_tokens` (token_hash UNIQUE, grant_type enum with conditional-FK CHECKs, delivered_at, delivery_provider_message_id, replaces_token_id, revoked_reason enum, partial unique indexes: one non-revoked token per (dead_man_switch_id, beneficiary_id) for DMS_RELEASE and per emergency_request_id for EMERGENCY_ACCESS — ADR-014 § 6), `audit_log`, `ai_interactions` (draft_id), `ai_drafts`, `ai_draft_versions` (encrypted content), `notifications`, `jobs`, `upload_sessions` (status incl. SCANNED_CLEAN), `rate_limits`, `processed_webhook_events`. Include all FKs with explicit ON DELETE, indexes (every FK indexed), `updated_at` triggers, soft-delete columns (ADR-002, ADR-014, ADR-016)
- [x] T218 Create `supabase/migrations/0002_rls_and_privileges.sql` — the **privilege baseline and RLS** per data-model.md § Write-Protection Model 1–4: `REVOKE ALL ON ALL TABLES/FUNCTIONS IN SCHEMA public FROM anon, authenticated` + `ALTER DEFAULT PRIVILEGES`; `ENABLE ROW LEVEL SECURITY` on every table; `SELECT` own-row policies for every user-owned table (incl. SELECT-own on audit_log, ai_interactions, upload_sessions, notifications, emergency_access_requests via config, access_tokens via owner, ai_draft_versions via draft); Class A `INSERT`/`UPDATE` policies with `WITH CHECK (owner = self)` **and column grants** exactly as the allow-list table (users, beneficiaries, three asset tables — **UPDATE only, no INSERT**, and never the encrypted columns `identification_details`, `account_number`, `policy_number`, `credentials`, `recovery_info` —, folders, documents metadata, video metadata, notifications.read_at); **no** write grants on Class B/C tables; `audit_class_a_change()` `SECURITY DEFINER` `AFTER INSERT OR UPDATE` triggers on users, beneficiaries, financial_assets, physical_assets, digital_assets, folders, documents, video_messages (redacted diff, actor from `auth.jwt()->>'sub'`, `metadata.source='db_trigger'`, skipped while `app.audit_in_function` is set — data-model § Write-Protection Model 6, ADR-004 r4); `protect_identity_columns` BEFORE UPDATE trigger on `users`; `BEFORE UPDATE OR DELETE` raise trigger on `audit_log`; `storage.objects` policies (INSERT only into `quarantine/<clerk sub>/`). Policy predicates use `(select auth.jwt()->>'sub')` (ADR-004 r2)
- [x] T019 Create `supabase/migrations/0003_functions.sql` — every function in data-model.md § Write-Protection Model 5. Guarded `SECURITY DEFINER SET search_path = ''` functions for `authenticated` (`create_legacy_plan`, `save_plan_step`, `finalize_legacy_plan`, `create_plan_draft`, `assign_beneficiary`, `unassign_beneficiary`, `set_beneficiary_status`, `remove_beneficiary`, `attach_document`, `detach_document`, `issue_access_token`, `revoke_access_token`, `resend_access_token`, `delete_document`, `delete_video`, `create_asset`, `set_encrypted_fields`, `delete_asset`, `dms_configure`, `dms_pause`, `dms_resume`, `dms_disable`, `dms_check_in`, `dms_cancel_escalation`, `ea_configure_contact`, `ea_update_contact`, `ea_remove_contact`, `ea_decide_request`, `ea_revoke`, `update_ai_draft`, `confirm_ai_draft`, `confirm_analysis_findings`) each implementing the nine mandatory rules (auth prologue followed by `set_config('app.audit_in_function','on', true)` so the Class A audit trigger does not double-write, `FOR UPDATE` ownership, typed inputs, no dynamic SQL, no identity columns, invariant under lock, in-transaction audit row, `REVOKE EXECUTE FROM PUBLIC, anon; GRANT EXECUTE TO authenticated`); system `SECURITY INVOKER` functions granted to `service_role` only (`promote_upload` requiring SCANNED_CLEAN, `dms_transition`, `ea_request_access`, `ea_verify_otp`, `ea_transition`, `system_issue_access_token`, `system_reissue_access_token`, `system_mark_token_delivered`, `claim_jobs` with `FOR UPDATE SKIP LOCKED`, `rate_limit_hit`, `record_webhook_event`); `ea_decide_request(APPROVE)` records the decision and enqueues the `access.deliver` job in the same transaction (outbox insert into `jobs` inside the function) — it no longer takes a token hash (ADR-014 § 6); `dms_transition(→ RELEASED)` and `ea_transition(→ AUTO_GRANTED)` perform the same outbox insert; `create_asset()` / `set_encrypted_fields()` validate the encryption envelope and are the only write path for `ENCRYPTED` columns (ADR-004 r4). Apply locally (`supabase db reset`) and generate `lib/types/database.ts`
- [x] T020 [P] Create `lib/security/encryption.ts` — AES-256-GCM using Node.js `crypto`: `encrypt(plaintext): { ciphertext, iv, authTag, keyId }`, `decrypt(payload): plaintext`; active key from `ENCRYPTION_KEY`, dual-read from `ENCRYPTION_KEY_PREVIOUS` by `keyId` (rotation window, T240). Constitution IV, FR-Q018
- [x] T021 [P] Create `lib/api/errors.ts` — `ApiError` class with safe `code`/`message`/`status`/optional `fields`; `toErrorResponse()` producing `{ success:false, error:{ code, message, fields? } }`; maps PostgreSQL `42501` from guarded functions to `403 FORBIDDEN` and invariant errors (`PLAN_INCOMPLETE`, `ALLOCATION_EXCEEDED`, `INVALID_TRANSITION`) to `422`; MUST NOT include stack traces, database details, file paths or internal identifiers; full error logged server-side and captured in Sentry with correlation id (Constitution X, FR-Q016)
- [x] T022 [P] Create `lib/observability/logger.ts` — `pino` structured JSON logger with redaction paths (authorization, cookie, token, password, secret, key, document content fields, `t` query parameter, `/access` and `/emergency-access` request paths), child logger bound to correlation id, environment-aware level. MUST NOT log passwords, tokens, keys, private document content (Constitution XVI, FR-Q017)
- [x] T023 [P] Create `lib/api/correlation.ts` — generate/propagate a UUID correlation id per request (honour inbound `X-Correlation-ID` only from trusted internal calls), set response header, bind to logger and Sentry scope, pass to audit rows and guarded functions (`p_correlation_id`) (NFR-OBS-001)
- [x] T024 [P] Configure security headers in `next.config.ts` `headers()` — HSTS (preload in prod), `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy` denying camera, microphone and geolocation (baseline is upload-only for video — Clarifications 2026-09-18); CSP with per-request nonce injected in `proxy.ts` (T192). Constitution XI, XXI, FR-Q015
- [x] T025 [P] Create `lib/security/rate-limit.ts` — Postgres-backed fixed-window limiter using `rate_limit_hit()` RPC: `enforceRateLimit({ policy, subject })` returning remaining/reset; policies: `default` 100/15 min per user, `sensitive` 5/15 min per user, `ai` 20/hour per user, `publicEmergency` 5/hour per IP **and** 3/hour per config id, `accessExchange` 10/15 min per IP, `tokenAccess` 60/15 min per access session; client IP taken only from the platform-provided header; 429 with `Retry-After`. Store is an interface so Upstash Redis can replace it later (ADR-007, FR-Q008)
- [x] T026 [P] Create `lib/api/validate.ts` — Zod validation of `body`/`query`/`params` used by `withApi()`; on failure return 422 with field-level errors (never echo raw input). Constitution X, FR-Q009
- [x] T027 [P] Create `lib/audit/audit.service.ts` — `audit.log({ actorId, actorRole, action, resourceType, resourceId, outcome, metadata?, ipAddress?, userAgent?, correlationId })` inserting into `audit_log` with the service client (used for Class A/C writes and for DENIED/FAILURE outcomes; guarded functions write their own SUCCESS rows); no update/delete methods; helper for previous/new value diffs that redacts encrypted fields. Constitution XII
- [x] T028 [P] Create `lib/db/server.ts` — `import 'server-only'`; `createUserClient()` = publishable key + Clerk `getToken()` as `accessToken` (RLS + column grants enforced; used for reads, Class A writes and `rpc()` calls to guarded functions); `createServiceClient()` = `SUPABASE_SECRET_KEY` (RLS bypass; system paths only); both typed with `Database`. Document allowed call sites for the service client in a header comment (ADR-004 r2). **Delete** the scaffold files `lib/supabase/client.ts`, `lib/supabase/server.ts` and `app/api/db-test/route.ts`, then remove `@supabase/ssr` from `package.json`
- [ ] T029 [P] Create `lib/storage/storage.service.ts` — Supabase Storage wrapper: `createSignedUploadUrl(bucket, path, { expiresIn })`, `createResumableUploadTarget(bucket, path)`, `headObject(bucket, path)`, `readRange(bucket, path, bytes)`, `openReadStream(bucket, path)` (for scanning), `createSignedDownloadUrl(bucket, path, expiresIn=900)`, `promote(fromBucket, toBucket, path)` (copy + delete), `remove(bucket, path)`. Buckets `quarantine`/`documents`/`videos` are private; never returns public URLs (ADR-005, Constitution IV)
- [x] T030 Create `lib/api/with-api.ts` — the Route Handler pipeline: options `{ auth: 'public'|'user'|'admin'|'access-cookie'|'cron'|'webhook', reverification?: 'strict'|'multi_factor', rateLimit?: policy, schema?: { body?, query?, params? }, verify?: (rawBody, headers) => Promise<void> /* webhook only */ }`; steps: correlation id → **`Cache-Control: private, no-store` on every response** (Constitution XV) → auth (Clerk `auth()` → `ensureAppUser()` → role check; `access-cookie` = decrypt cookie (T230) + re-check `access_tokens` revoked/expiry + beneficiary status; `cron` verifies `Authorization: Bearer $CRON_SECRET`; `webhook` runs the route's `verify` over the **raw request body** (Svix / provider signature) before any parsing — invalid → 401 with no side effects) → CSRF `Origin`/`Sec-Fetch-Site` same-origin check for POST/PATCH/PUT/DELETE in the cookie/ambient-credential modes `public`/`user`/`admin`/`access-cookie` (FR-Q007); **skipped only for `cron` and `webhook`**, which carry no cookies and are authenticated per request by `CRON_SECRET` / signature, and which still receive the correlation id, `no-store`, safe error mapping and DENIED/FAILURE audit → rate limit → Zod validation → handler(ctx) → `{ success:true, data, meta }` → error mapping (T021) + Sentry + DENIED/FAILURE audit. Create `app/api/v1/health/route.ts`: public response `{ status }` only; detailed `{ status, database, storage, jobs, dmsScan }` when called with `CRON_SECRET` or a Super Admin session (ADR-001, ADR-010)
- [ ] T032 [P] Create `lib/security/file-validation.ts` — `validateDeclared({ name, mimeType, sizeBytes, kind })` (extension + MIME whitelist: PDF/JPEG/PNG/GIF/WEBP/TXT/DOC/DOCX/XLS/XLSX for documents; MP4/WebM/MOV for videos; size ≤ 50 MB / 500 MB) and `validateActual({ headBytes, actualSize, declared })` using `file-type` magic-byte detection; returns `{ valid, reason }` with clear user-facing reasons. Constitution XI, FR-H002, FR-H003, FR-K002, FR-Q010
- [ ] T219 [P] Create `lib/security/access-scope.ts` + `lib/validators/access-scope.validators.ts` — the single definition of the access-scope shape used by `access_tokens.scope`, `dead_man_switches.release_scope` and `emergency_access_configs.access_scope` (`{ documents: uuid[], assets: [{ type, id }], videos: uuid[], planSections: sectionKey[] }`), the plan-section key vocabulary (data-model.md §9), `isSubsetScope(requested, allowed)`, `scopeContains(scope, resourceType, id)` used by the access-cookie handlers, and the Zod `accessScopeSchema` reused by T097, T123, T134, T230, T231 (ADR-014)
- [x] T033 Create `scripts/seed-admin.ts` + `supabase/seed.sql` — promote the Clerk user whose email equals `ADMIN_EMAIL` to `role = SUPER_ADMIN` in `users` via the service client (creating the row via `ensureAppUser` semantics if missing); no passwords are seeded (Clerk owns credentials). Log an audit row `admin.role_seeded`
- [x] T036 [P] Create `lib/auth/` — `require-user.ts` (`requireUser()`: Clerk `auth()` → 401 if none → `ensureAppUser()` → returns app user + role), `require-role.ts` (`requireRole(['SUPER_ADMIN'])` → 403 reading `users.role` from the database), `ensure-app-user.ts` (idempotent upsert by `clerk_user_id` via the service client, mirroring email/name/verified/mfa flags). Used by `withApi()`, the Clerk webhook (T198), Server Components and Server Actions. Constitution III: server-side enforcement; role source of truth = database. *(Moved to Phase 2 in r2 — foundational for T030/T198.)*
- [ ] T155 [P] Create `lib/services/notification.service.ts` + `lib/jobs/handlers/notification-deliver.ts` — `send(userId, type, title, content, channel, metadata?)` (insert `notifications` via service client; IN_APP immediate; EMAIL via `notification.deliver` job → `EmailService` with retry/backoff 3 attempts; respects `notificationPreferences`), `sendToBeneficiary(beneficiaryId, template, props)` for external recipients (no `notifications` row; audit only), `markRead`, `markAllRead`, `getUnreadCount`, `list(pagination)`; delivery status updated by T209. *(Moved to Phase 2 in r2 so later phases never stub it.)*
- [ ] T181 [P] Create `lib/security/malware-scanner.ts` — `MalwareScanner` interface `scan(input: { bucket, path } | Buffer, filename): Promise<{ verdict: 'CLEAN'|'INFECTED'|'ERROR', threat?: string }>`; `NoOpScanner` (development only — returns CLEAN with a warning log; forbidden in production by T007); `MalwareScannerFactory` reading `MALWARE_SCANNER_PROVIDER` (`noop|clamav` — T247). INFECTED objects stay in `quarantine` and are deleted by housekeeping; results written to `upload_sessions.status`, `documents.scan_status` / `video_messages.scan_status` and the audit trail. FR-H016, FR-Q011 (ADR-015)
- [ ] T197 Create `lib/jobs/` — `enqueue(type, payload, { runAt?, idempotencyKey?, maxAttempts? })`, handler `registry.ts` (unknown types stay QUEUED with a warning — never DEAD — so later phases can register handlers), `runner.ts` (claims via `claim_jobs()` RPC, runs handlers within the remaining `maxDuration` budget, exponential backoff, dead-letter after `max_attempts`, sets `finished_at`, updates `progress`), and `app/api/internal/cron/run-jobs/route.ts` (`withApi({ auth:'cron' })`, `maxDuration` set). Handlers MUST be idempotent (ADR-006)
- [x] T198 Create `app/api/webhooks/clerk/route.ts` — `withApi({ auth:'webhook', verify })` — Svix signature verified with `CLERK_WEBHOOK_SIGNING_SECRET` over the raw request body before parsing (T030; browser CSRF check not applied — authenticated per request); idempotency via `record_webhook_event('CLERK', svixId, type)` (duplicate → 200 no-op); handle `user.created`/`user.updated`/`user.deleted` → `ensureAppUser`/mirror/soft-delete and `session.created`/`session.ended`/`session.removed`/`session.revoked` → `audit_log` auth events (FR-A014), set `last_login_at`, enqueue `security.new-device-check` with city/country/browser only (FR-A016). Use the service client (ADR-003)
- [ ] T199 Create `app/api/internal/cron/housekeeping/route.ts` — daily sweeps: expire `access_tokens`; enqueue `ea.auto-decide` (AUTO_GRANT/DENY rules) and `ea.expire` (request expiry and active-access expiry) for due emergency requests; retry failed notifications (enqueue `notification.deliver`); delete stale `quarantine` objects + EXPIRED/REJECTED `upload_sessions` (> 24 h); process account-deletion grace periods (enqueue `user.hard-delete`); run the retention purges of T245; `withApi({ auth:'cron' })`, idempotent
- [ ] T212 [P] Create `tests/integration/rls.test.ts` — for every user-owned table: user A cannot read/update/delete user B's rows through `createUserClient()`; `anon` key has no access; `audit_log` update/delete raises; SELECT-own works for audit_log/ai_interactions/upload_sessions. Uses `tests/helpers/jwt.ts` (local HS256 JWTs with Clerk-shaped claims — ADR-004 r2 §7). Runs against the local Supabase stack in CI (ADR-004, SC-005)
- [ ] T213 [P] Create `tests/unit/security/encryption.test.ts` — round-trip, auth-tag tamper detection, distinct IV per call, `keyId` recorded, dual-read of `ENCRYPTION_KEY_PREVIOUS` by `keyId`, decryption failure with wrong key, rotation helper re-encrypts to the active key (Constitution IV, XVII)
- [ ] T214 [P] Create `tests/unit/api/with-api.test.ts` — pipeline behaviour: 401 without session, 403 wrong role, reverification-required error shape, CSRF rejection on cross-origin mutation, 429 with `Retry-After`, 422 Zod field errors (no raw input echoed), `Cache-Control: private, no-store` on every response, `X-Correlation-ID` present, error envelope never contains stack/DB/path strings, `cron` auth requires the bearer secret, `access-cookie` auth rejects expired/revoked tokens; CSRF/internal-auth matrix: cross-origin mutation with a valid `user` session rejected, with a valid `admin` session rejected, with a valid access cookie rejected, on a `public` mutating route rejected; valid `CRON_SECRET` accepted; valid webhook signature (verified over the raw body) accepted; invalid cron secret → 401; invalid webhook signature → 401; an invalid secret/signature causes no side effects (no DB write, no job enqueued, no `processed_webhook_events` row); `cron`/`webhook` responses still carry `X-Correlation-ID` and `no-store` (Constitution X, XI, XV, XVII)
- [ ] T215 [P] Create `tests/integration/write-protection.test.ts` — the S1 guarantees: `authenticated` client cannot `UPDATE users.role|email|mfa_enabled|email_verified` (grant + trigger), cannot INSERT/UPDATE `beneficiary_assignments`, `legacy_plans`, `documents.scan_status`, `upload_sessions.status`, `dead_man_switches`, `emergency_access_requests`, `access_tokens`, `ai_drafts` directly; every guarded function raises `42501` when unauthenticated and for another user's rows; `EXECUTE` on system functions is denied to `authenticated`; guarded functions write an `audit_log` row; `anon` can execute nothing; **S1 boundary (ADR-004 r4)**: `authenticated` cannot INSERT into the three asset tables and cannot UPDATE `users.identification_details`, `financial_assets.account_number|policy_number`, `digital_assets.credentials|recovery_info` directly; `set_encrypted_fields()` rejects a malformed envelope (`INVALID_ENCRYPTION_ENVELOPE`) and accepts a valid one; a direct PostgREST update of an allow-listed plain column (e.g. `beneficiaries.email`) produces an `audit_log` row from `audit_class_a_change()` with `metadata.source='db_trigger'` and no application involvement; a guarded-function call produces exactly one audit row (trigger suppressed) (ADR-004 r2/r4, Constitution I, VII, XII, XVII)
- [ ] T216 [P] Create `tests/unit/security/file-validation.test.ts` and `tests/unit/security/rate-limit.test.ts` — extension/MIME whitelist, magic-byte mismatch (`.exe` renamed `.pdf`), size limits at declaration and actual, video container detection; rate-limit policies, window rollover, per-IP + per-config `publicEmergency`, `Retry-After` computation (FR-H002/H003, FR-K002, FR-Q008, FR-Q010)
- [ ] T217 [P] Create `tests/integration/jobs.test.ts` — `claim_jobs` under concurrency (SKIP LOCKED, no double claim), exponential backoff, dead-letter after `max_attempts`, idempotency-key conflict handling, unknown job type stays QUEUED, `finished_at` recorded, runner respects the duration budget (ADR-006, NFR-REL-002)
- [ ] T242 Create `docs/DATABASE_SCHEMA.md` — generated from the applied migrations: entities, relationships, indexes, enums, write classes and column allow-lists, RLS policies, grants, guarded/system function catalog with executor roles (Constitution XVIII)
- [ ] T246 Extend `.github/workflows/ci.yml` — required checks for merge: unit + integration (local Supabase) + E2E smoke; coverage thresholds for `lib/security`, `lib/services`, `lib/ai` (≥ 80 % lines); tests tagged `@security` (T212–T215, T228, T229, T235, T236) are **blocking** and cannot be skipped (NFR-SEC-003, Constitution XVII)

**Checkpoint**: Schema, privileges/RLS and guarded functions applied; pipeline, auth helpers, audit, storage, jobs, notifications operational; RLS + write-protection + pipeline test suites green; CI gate enforced. User story implementation can now begin.

---

## Phase 3: User Story 1 — Secure Registration and Onboarding (Priority: P1) 🏁 MVP

**Goal**: Users can register, verify email, sign in (Clerk) and reach the dashboard with an app profile

**Independent Test**: Sign up → verify email → sign in → onboarding → dashboard; `users` row exists; audit rows written

### Implementation for User Story 1

- [x] T034 [P] [US1] Create `lib/validators/user.validators.ts` — Zod schemas: `updateProfileSchema` (dateOfBirth, phone, alternateEmail, address object, identificationDetails, familyInfo), `preferencesSchema`, `notificationPreferencesSchema`, `securityPreferencesSchema` (`idleTimeoutMinutes ∈ {15,30,60,240,null}`, `loginNotifications`, `securityReviewReminder`), `onboardingSchema`. (Password/email schemas are not needed — Clerk enforces FR-A002 per T195)
- [x] T035 [P] [US1] Create `lib/services/user.service.ts` + `lib/repositories/user.repository.ts` — `getMe(userId)`, `updateProfile(userId, data)` (plain fields: Class A column allow-list via the user client; `identificationDetails`: encrypt via T020, then `set_encrypted_fields('USER', userId, …)` — the column has no direct grant; audit with redacted diff), `updatePreferences`, `completeOnboarding`. Uses `ensureAppUser` from T036. Audit `user.profile_updated`
- [ ] T039 [P] [US1] Create `lib/email/` — `provider.ts` (`EmailProvider.send({ to, subject, react|html, text })`), `providers/resend.ts`, `providers/console.ts` (dev), `send-template.ts` facade, and React Email templates in `emails/` (beneficiary invitation, **access link** (all grant types), DMS check-in, DMS escalation, DMS release, emergency-contact designation with request link, emergency OTP, emergency decision/expiry, document shared, security alert). Templates render sanitized data; no sensitive data in bodies (Constitution II, ADR-009). Clerk sends verification/reset emails itself
- [x] T040 [P] [US1] Create `app/(auth)/sign-in/[[...sign-in]]/page.tsx` — Clerk `<SignIn/>` with `appearance` matching the dark glassmorphism design system, gradient background, Framer Motion fade-in; links to sign-up. Constitution XIII
- [x] T041 [P] [US1] Create `app/(auth)/sign-up/[[...sign-up]]/page.tsx` — Clerk `<SignUp/>` themed; Clerk handles email verification step (FR-A003/A004) and password policy display
- [x] T045 [P] [US1] Create `components/layout/auth-layout.tsx` — Shared auth page layout: centered glass card, logo, gradient background
- [ ] T046 [US1] Create `hooks/use-current-user.ts` — wraps Clerk `useUser()`/`useAuth()` with a TanStack query for `GET /api/v1/users/me` (app profile, role, onboarding state, security preferences); exposes `user`, `profile`, `isLoaded`, `signOut`. No Zustand auth store (Clerk owns auth state)
- [x] T047 [US1] Create `app/(auth)/layout.tsx` — server layout: if `auth()` has a session, redirect to `/dashboard`; otherwise render `auth-layout`
- [ ] T048 [US1] Create `app/(dashboard)/layout.tsx` — server layout: `auth.protect()` (redirect to sign-in), `ensureAppUser()`, redirect to `/onboarding` when `onboarding_completed_at` is null, mount the idle-timeout provider (T220), render sidebar + header shell; no `use cache`/static prerendering in this group (ADR-001 cache safety)
- [x] T049 [P] [US1] Create `components/layout/sidebar.tsx` — navigation to all modules (Dashboard, Legacy Plan, Beneficiaries, Assets, Documents, Dead Man Switch, Emergency Access, Video Legacy, AI, Security Center, Settings; Admin link when role = SUPER_ADMIN — UX only), active state, collapsible on mobile, glassmorphism, Framer Motion slide
- [x] T050 [P] [US1] Create `components/layout/header.tsx` — Clerk `<UserButton/>` (themed) or custom avatar menu (profile, settings, sign out), notification bell slot, breadcrumb
- [ ] T051 [US1] Create `app/(dashboard)/dashboard/page.tsx` — Server Component reading via services: welcome, quick-action cards (Create Plan, Add Beneficiary, Upload Document), recent activity (audit-derived), security status summary; skeleton loading; Framer Motion staggered cards
- [ ] T200 [US1] Create `app/(dashboard)/onboarding/page.tsx` — first-run onboarding (name confirmation from Clerk, date of birth, country, preferences) posting to `PATCH /api/v1/users/me` and `POST /users/me/onboarding/complete`; target < 3 minutes end to end (SC-001)

**Checkpoint**: Users can sign up, verify email, sign in, complete onboarding and see the dashboard. Auth is Clerk-enforced; authorization is server-side.

---

## Phase 4: User Story 16 — Account Login and Session Security (Priority: P1)

**Goal**: MFA, sessions, lockout, idle timeout and new-device detection operational through Clerk + app audit

**Independent Test**: Sign in → enable MFA → sign out → sign in with TOTP → set idle timeout 15 min → auto sign-out after inactivity → new-device email received. (Session list/revocation is verified in Phase 15.)

### Implementation for User Story 16

- [ ] T056 [US16] Create `app/(dashboard)/settings/security/page.tsx` — embeds Clerk `<UserProfile/>` security section (MFA enable/disable with QR, backup codes one-time view, password change, connected devices) themed to the design system, plus the application security preferences (idle timeout, login notifications — T220); Clerk enforces reverification for its changes (FR-A006, A017, A018, FR-B006, FR-O005, FR-O006)
- [ ] T182 [US16] Create `lib/jobs/handlers/security-new-device-check.ts` — job triggered by `session.created` (T198): compare the session's browser/device type/city/country (from Clerk session activity; city/country only — no precise location) with the user's prior `auth.login` audit rows; if new, write audit `auth.new_device_login` and send a security notification ("New sign-in from [browser] on [device] in [city, country]") honouring `securityPreferences.loginNotifications`. FR-A016, Constitution II
- [ ] T201 [US16] Create `lib/auth/reverification.ts` — `requireReverification(level: 'strict'|'multi_factor')` for `withApi()` using Clerk's `has({ reverification })` and returning the reverification-required error shape; client `components/forms/re-auth-gate.tsx` using Clerk `useReverification()` to wrap sensitive actions (decrypt fields, disable DMS, admin role changes, DMS check-in/cancel, emergency approvals, AI draft confirmation), showing a themed explanatory dialog before Clerk's step-up UI and retrying the original request afterwards. FR-A018, FR-G004, FR-I003, FR-I008
- [ ] T203 [US16] Verify Clerk coverage of FR-A008 (24 h session lifetime), FR-A011 (all other sessions revoked on password reset), FR-A012/A013 (lockout 5 attempts/30 min) and FR-A014 (event coverage). If failed sign-in attempts are not delivered by webhook, implement a custom sign-in flow (Clerk `useSignIn`) that reports failures to `POST /api/v1/security/events` (server validates payload shape, rate-limits, records `auth.login_failed` with IP/user agent). Document results and configuration in `docs/SECURITY.md` (ADR-003 open item)
- [ ] T220 [US16] Create `hooks/use-idle-timeout.ts` + `components/providers/idle-timeout-provider.tsx` — application-enforced idle sign-out per `securityPreferences.idleTimeoutMinutes` (15/30/60/240/off): activity listeners, cross-tab sync (BroadcastChannel), 60-second warning dialog, `signOut()` on expiry with audit `auth.idle_timeout` via `POST /api/v1/security/events`; bounded above by the platform 24 h lifetime. Settings UI in T056 (FR-B006, Clarifications 2026-09-18)

**Checkpoint**: MFA, sessions, lockout, reverification, idle timeout and new-device detection verified; FR-A014 coverage documented.

---

## Phase 5: User Story 2 — Creating a Digital Legacy Plan (Priority: P1)

**Goal**: Users can create, progress through all eleven steps, auto-save, and finalize a legacy plan (with acknowledged incompleteness) via the multi-step wizard

**Independent Test**: Create plan → fill steps 1–9 (embedded modules for 3–7) → auto-save → review → finalize (acknowledge incomplete sections) → confirmation → view version history

### Implementation for User Story 2

- [ ] T057 [P] [US2] Create `lib/validators/legacy-plan.validators.ts` — Zod schemas per section key: `personalDetailsSchema` (legal name, DOB, address, ID info), `familyInformationSchema`, `beneficiariesStepSchema` (beneficiary ids), `assetsStepSchema` (asset ids per class), `witnessDetailsSchema`, `specialWishesSchema`, `documentAttachmentsStepSchema` (document ids), `stepUpdateSchema` (section key + data + `lockVersion`), `finalizeSchema` (`confirmed: z.literal(true)`, `lockVersion`, `acknowledgeIncomplete: z.boolean().optional()`). Constraints from data-model.md
- [ ] T058 [P] [US2] Create `lib/services/legacy-plan.service.ts` + `lib/repositories/legacy-plan.repository.ts` — thin wrappers over the guarded functions via the user client: `create` (`create_legacy_plan()`, 409 if a DRAFT exists), `getForUser`, `updateStep` (`save_plan_step()`; 409 on lock conflict; 422 field errors), `getReview` (per-section completeness + cross-entity checks), `finalize` (`finalize_legacy_plan()`; surfaces `PLAN_INCOMPLETE` with `incompleteSections` unless `acknowledgeIncomplete`; `PERSONAL_DETAILS_REQUIRED` always), `createNewDraft` (`create_plan_draft()`), `getVersionHistory`, `getVersion`. NFR-REL-001, US20 scenario 2
- [ ] T059 [US2] Create Route Handlers `app/api/v1/legacy-plans/route.ts` (GET list, POST create), `[id]/route.ts` (GET), `[id]/steps/[step]/route.ts` (PATCH auto-save), `[id]/documents/route.ts` (GET, POST) + `[id]/documents/[documentId]/route.ts` (DELETE) via T227 attachments service, `[id]/review/route.ts` (POST), `[id]/finalize/route.ts` (POST), `[id]/versions/route.ts` (GET), `[id]/versions/[versionId]/route.ts` (GET), `[id]/new-draft/route.ts` (POST) — all via `withApi({ auth:'user', schema })`
- [ ] T061 [P] [US2] Create `components/wizard/wizard-provider.tsx` — wizard context: currentStep, stepsData, completionStatus, `lockVersion`, debounced auto-save (3 s) via TanStack mutation, navigation (next/previous/goToStep), per-step validation, dirty-state tracking, conflict (409) handling with reload prompt
- [x] T062 [P] [US2] Create `components/wizard/wizard-stepper.tsx` — step indicator for eleven steps: numbered steps, completion checkmarks, active highlight, clickable completed steps, horizontal (desktop) / vertical (mobile), Framer Motion transitions
- [x] T063 [P] [US2] Create `components/wizard/wizard-step.tsx` — step wrapper: content slot, validation display, save status ("Saved", "Saving…", "Unsaved changes"), slide animation
- [ ] T064 [US2] Create `app/(dashboard)/legacy-plan/page.tsx` — no plan → "Create Plan" CTA; DRAFT → wizard with all eleven steps (T065–T069, T221–T224); FINALIZED → summary with "Create New Version"
- [ ] T065 [US2] Create `app/(dashboard)/legacy-plan/steps/personal-details.tsx` — Step 1 form (legal name for the plan — distinct from the Clerk display name —, DOB, address, ID info) with inline validation (react-hook-form + Zod)
- [ ] T066 [P] [US2] Create `app/(dashboard)/legacy-plan/steps/family-information.tsx` — Step 2 (spouse, children add/remove, parents, dependents) with dynamic arrays
- [ ] T221 [P] [US2] Create `app/(dashboard)/legacy-plan/steps/beneficiaries.tsx` — Step 3: embeds the beneficiary module (list + add dialog from T075) inside `wizard-step`; the step stores selected beneficiary ids in `stepsData.beneficiaries`; completeness = at least one ACTIVE/PENDING beneficiary (FR-C001)
- [ ] T222 [P] [US2] Create `app/(dashboard)/legacy-plan/steps/{financial-assets,physical-assets,digital-assets}.tsx` — Steps 4–6: embedded asset module views (tables + add/edit dialogs from T083/T086/T088) with per-asset beneficiary assignment shortcuts; steps store asset ids; completeness = user marked the class "none" or ≥ 1 asset with an assignment (FR-C001, FR-C005)
- [ ] T067 [P] [US2] Create `app/(dashboard)/legacy-plan/steps/witness-details.tsx` — Step 7 in the wizard order defined by FR-C001 (witness rows add/remove)
- [ ] T068 [P] [US2] Create `app/(dashboard)/legacy-plan/steps/special-wishes.tsx` — Step 8 (wishes/instructions)
- [ ] T223 [P] [US2] Create `app/(dashboard)/legacy-plan/steps/document-attachments.tsx` — Step 9: attach vault documents to the plan (`POST /legacy-plans/:id/documents`) or upload inline via `components/shared/file-upload.tsx` (T096) then attach; lists attachments with detach; completeness = ≥ 1 attachment or explicit "none" (FR-C001)
- [ ] T069 [US2] Create `app/(dashboard)/legacy-plan/steps/review.tsx` — Step 10: review by section, incomplete-section warnings, completeness %, "Finalize" dialog that lists incomplete sections and requires the acknowledgment checkbox when any exist (Personal Details cannot be acknowledged away) (FR-C006, FR-C007, US20 scenario 2)
- [ ] T224 [US2] Create `app/(dashboard)/legacy-plan/steps/confirmation.tsx` — Step 11: post-finalization confirmation (version number, finalized timestamp, acknowledged sections if any, export/print entry point, "Create new draft" and "Share with beneficiaries" next steps) (FR-C001)
- [ ] T070 [US2] Create `app/(dashboard)/legacy-plan/versions/page.tsx` — finalized versions list with timestamps, `acknowledgedIncomplete` badge, read-only version view
- [ ] T225 [US2] Create `tests/integration/legacy-plan.test.ts` — `create_legacy_plan` one-DRAFT rule (409), `save_plan_step` lock conflict (409) and step validation, finalize without `confirmed` (400), `PERSONAL_DETAILS_REQUIRED`, `PLAN_INCOMPLETE` without acknowledgment then success with acknowledgment (snapshot records `acknowledgedIncomplete` + list), version snapshot resolves references by value, `create_plan_draft` increments version, cross-user access denied (Constitution VII, XVII)

**Checkpoint**: Users can create and finalize a legacy plan through the full eleven-step wizard with auto-save, acknowledged-incomplete finalization and atomic versioning.

---

## Phase 6: User Story 3 — Adding and Managing Beneficiaries (Priority: P1)

**Goal**: Users can add, edit, deactivate and remove beneficiaries with duplicate detection, lifecycle rules and audit logging

**Independent Test**: Add beneficiary → attempt duplicate → edit → deactivate → remove (cascade) → verify audit trail

### Implementation for User Story 3

- [ ] T071 [P] [US3] Create `lib/validators/beneficiary.validators.ts` — `createBeneficiarySchema` (name 1–100, relationship, email, phone?, notes?), `updateBeneficiarySchema` (partial contact fields + `confirmed: boolean` required for name/email changes per FR-D008), `statusSchema` (`status: ACTIVE|INACTIVE`, `confirmed: true`), `removeSchema` (`confirmed: true`)
- [ ] T072 [P] [US3] Create `lib/services/beneficiary.service.ts` + repository — `create` (Class A insert via user client; 409 on duplicate email; audit), `update` (contact fields only; `confirmed: true` for name/email; audit with previous values), `setStatus` (`set_beneficiary_status()` — INACTIVE revokes tokens), `remove` (`remove_beneficiary()` cascade: assignments, tokens, DMS contact links, EA configs, soft delete — Clarifications 2026-09-18), `list` (with derived roles: assignment count, trusted contact, emergency contact), `getById`, `invite` (invitation email via T039; sets `invitedAt`). Constitution VII
- [ ] T073 [US3] Create Route Handlers `app/api/v1/beneficiaries/route.ts` (GET, POST), `[id]/route.ts` (GET, PATCH, DELETE), `[id]/status/route.ts` (POST), `[id]/invite/route.ts` (POST) via `withApi`
- [ ] T075 [P] [US3] Create `app/(dashboard)/beneficiaries/page.tsx` — data table (name, relationship, email, status badge, roles), add dialog, edit/deactivate/remove actions with confirmation, empty state, skeletons, Framer Motion list animation
- [ ] T076 [US3] Create `app/(dashboard)/beneficiaries/[id]/page.tsx` — detail: info, edit form, status control, assignments list, access tokens list (issue/revoke — T097), DMS/EA role indicators, confirmation dialog for authoritative changes
- [ ] T226 [US3] Create `tests/integration/beneficiaries.test.ts` — duplicate email 409, PENDING → ACTIVE on first token exchange, owner ACTIVE ⇄ INACTIVE (tokens revoked; assignments/tokens refused for INACTIVE), `remove_beneficiary()` cascade removes assignments, revokes tokens, unlinks DMS contact, deactivates EA config, soft-deletes, writes audit rows for each step; cross-user denied (FR-D003, FR-D007, US3 scenario 4, Constitution XVII)

**Checkpoint**: Complete beneficiary management with validation, duplicate detection, lifecycle, removal cascade and audit trail.

---

## Phase 7: User Story 17 — Account Recovery (Priority: P2)

**Goal**: Users can recover accounts via Clerk password reset and MFA backup codes; support path exists for total loss

**Independent Test**: Forgot password → reset email → reset → sign in (other sessions revoked) → sign in with backup code

### Implementation for User Story 17

- [ ] T204 [US17] Verify Clerk account-recovery flows end to end (forgot password with sign-out of other sessions — FR-A010/A011; backup-code sign-in — FR-A017) and document the manual identity-verification support process for users who lose both password and MFA device (spec edge case "Lost account access") in `docs/SUPPORT_RUNBOOK.md`; admin path uses `POST /admin/users/:id/reset-mfa` (T148). Audit rows for `auth.password_reset` and `auth.backup_code_used` confirmed present via the webhook handler (T198)

**Checkpoint**: Account recovery operational through Clerk with documented support fallback.

---

## Phase 8: User Story 4 — Managing Financial Assets (Priority: P2)

**Goal**: Users can add, categorize, and manage financial assets with encrypted sensitive fields

**Independent Test**: Create financial asset → verify encrypted storage → masked display → decrypt with reverification → audit row

### Implementation for User Story 4

- [ ] T079 [P] [US4] Create `lib/validators/asset.validators.ts` — `createFinancialAssetSchema` (name, category enum BANK_ACCOUNT|FIXED_DEPOSIT|MUTUAL_FUND|STOCK|INSURANCE|RETIREMENT, institution?, accountNumber?, policyNumber?, estimatedValue?, currency ISO-4217 default "USD", notes?, metadata?), `updateFinancialAssetSchema`, `createPhysicalAssetSchema`, `updatePhysicalAssetSchema`, `createDigitalAssetSchema`, `updateDigitalAssetSchema`
- [ ] T080 [P] [US4] Create `lib/services/asset.service.ts` + repositories — user client throughout: `createFinancial` → `create_asset('FINANCIAL_ASSET', plain, encrypted)` RPC (accountNumber/policyNumber encrypted via T020 first; the asset tables have no direct INSERT grant; audited in-transaction), `getFinancial` (masked "••••••"), `decryptFinancialField` (requires reverification context; decrypt; audit `asset.credential_viewed`), `updateFinancial` (plain columns: direct Class A allow-list update, trigger-audited; encrypted fields: re-encrypt, then `set_encrypted_fields('FINANCIAL_ASSET', id, …)`; service audit diff redacted), `deleteFinancial` → `delete_asset('FINANCIAL_ASSET', id)` RPC (one transaction: ownership + row lock, assignments and attachments removed, soft delete, audit row; direct `deletedAt` writes are denied), `listFinancial` (masked, with attachment and assignment counts). Same pattern for physical/digital in T085/T087
- [ ] T081 [US4] Create Route Handlers `app/api/v1/assets/financial/route.ts` (GET, POST), `financial/[id]/route.ts` (GET, PATCH, DELETE), `financial/[id]/decrypt/route.ts` (GET, `withApi({ reverification:'strict', rateLimit:'sensitive' })`); mirror for `physical/` and `digital/` (with `decrypt`)
- [ ] T083 [P] [US4] Create `app/(dashboard)/assets/financial/page.tsx` — categorized list (tabs), table (name, category, institution, value), add/edit dialogs with category-specific fields, masked fields with "Reveal" through the re-auth gate (T201), attached documents panel (T227)
- [ ] T084 [US4] Apply the re-auth gate (T201) across the asset UIs — "Reveal" for encrypted fields, delete confirmations that require reverification when the asset has assignments; consistent explanatory copy (FR-A018, FR-G004)

**Checkpoint**: Financial assets fully manageable with encrypted sensitive fields and reverification gates.

---

## Phase 9: User Story 5 — Managing Physical Assets (Priority: P2)

**Goal**: Users can add and manage physical assets with category-specific metadata

**Independent Test**: Create physical assets across categories → verify metadata → attach documents

### Implementation for User Story 5

- [ ] T085 [P] [US5] Add physical asset methods to `lib/services/asset.service.ts` — `createPhysical` (→ `create_asset('PHYSICAL_ASSET', plain, {})`), `getPhysical`, `updatePhysical` (direct allow-list, trigger-audited), `deletePhysical` (→ `delete_asset('PHYSICAL_ASSET', id)`), `listPhysical`; categories REAL_ESTATE, VEHICLE, GOLD_JEWELRY, PERSONAL_PROPERTY, BUSINESS_ASSET; multiple document attachments via T227 (FR-F003)
- [ ] T086 [US5] Create `app/(dashboard)/assets/physical/page.tsx` — category tabs, add/edit dialogs with category-specific fields, attached documents panel

**Checkpoint**: Physical asset management complete.

---

## Phase 10: User Story 6 — Managing Digital Assets (Priority: P2)

**Goal**: Users can manage digital assets with encrypted credentials and masked display

**Independent Test**: Create digital asset with credentials → masked → reverify → plaintext → audit row

### Implementation for User Story 6

- [ ] T087 [P] [US6] Add digital asset methods to `lib/services/asset.service.ts` — `createDigital` (→ `create_asset('DIGITAL_ASSET', plain, encrypted)` with credentials + recoveryInfo encrypted via T020), `updateDigital` (plain columns direct; credentials/recoveryInfo via `set_encrypted_fields('DIGITAL_ASSET', id, …)`), `decryptDigitalField` (reverification, audit `asset.credential_viewed` — FR-G005), `deleteDigital` (→ `delete_asset('DIGITAL_ASSET', id)`); categories CRYPTO_WALLET, ONLINE_ACCOUNT, DOMAIN, SUBSCRIPTION, SOCIAL_MEDIA, OTHER
- [ ] T088 [US6] Create `app/(dashboard)/assets/digital/page.tsx` — platform icons, masked credentials, "Reveal" via re-auth gate, category filter, add/edit with credential fields, attached documents panel
- [ ] T089 [US6] Create `app/(dashboard)/assets/page.tsx` — overview: counts and totals per asset class, unassigned-asset warnings, navigation, recent changes

**Checkpoint**: All three asset categories complete with encryption and audit logging.

---

## Phase 11: User Story 7 — Secure Document Vault (Priority: P2)

**Goal**: Users can upload (direct-to-storage), validate, scan, organize, version, attach, share and download documents securely

**Independent Test**: Create upload session → PUT to signed URL → complete → scan → download via signed URL → new version → attach to an asset → share with beneficiary; spoofed/oversized/infected files rejected

### Implementation for User Story 7

- [ ] T205 [P] [US7] Create `lib/storage/upload-session.ts` — `upload_sessions` state helpers (PENDING → UPLOADED → VALIDATING → SCANNING → SCANNED_CLEAN → PROMOTED | REJECTED | EXPIRED) via the service client; storage policies for `storage.objects` are part of T218 (ADR-005)
- [ ] T090 [P] [US7] Create `lib/services/document.service.ts` + repository — `createUploadSession(user, { name, mimeType, sizeBytes, folderId?, documentId? })` (T032 declared checks, ownership of folder/document, insert `upload_sessions`, signed upload URL to `quarantine/{clerkUserId}/{uploadId}`, 1 h expiry), `completeUpload(user, uploadId)` (session ownership + state, `headObject` actual size ≤ 50 MB, `readRange` magic bytes (T032), malware scan (T181/T247; inline ≤ 10 MB else enqueue `file.scan` and return 202) → SCANNED_CLEAN → `promote_upload()` RPC → `documents` + `document_versions`, audit `document.uploaded`), `getUploadStatus`, `getDownloadUrl` (authorize owner / access-cookie scope → signed URL 15 min → audit `document.downloaded`), `getPreviewUrl` (audit `document.viewed`), `updateMetadata` (Class A allow-list), `delete` (`delete_document()` — soft delete, enqueue `storage.remove-object`, removes shares/attachments, audit — FR-H017), `listVersions`, `share`/`unshare` (assignments via `assign_beneficiary`/`unassign_beneficiary` with resourceType DOCUMENT, audit), `listByFolder`
- [ ] T091 [P] [US7] Create `lib/services/folder.service.ts` — `create` (unique per parent per user, NULLS NOT DISTINCT), `rename`, `move`, `delete` (soft; requires confirmation when non-empty), `list` (tree)
- [ ] T093 [US7] Create Route Handlers `app/api/v1/documents/route.ts` (GET), `uploads/route.ts` (POST), `uploads/[uploadId]/route.ts` (GET status), `uploads/[uploadId]/complete/route.ts` (POST), `[id]/route.ts` (GET, PATCH, DELETE), `[id]/download/route.ts`, `[id]/preview/route.ts`, `[id]/versions/route.ts`, `[id]/share/route.ts` (POST), `[id]/share/[beneficiaryId]/route.ts` (DELETE), `folders/route.ts`, `folders/[id]/route.ts` per api-contracts.md
- [ ] T227 [US7] Create `lib/services/attachment.service.ts` + Route Handlers `app/api/v1/assets/[type]/[id]/documents/route.ts` (GET, POST) and `documents/[documentId]/route.ts` (DELETE), plus the legacy-plan attachment handlers wired in T059 — `attach(user, documentId, resourceType, resourceId)` → `attach_document()`, `detach` → `detach_document()`, `listForResource`, `listForDocument`; `components/shared/attached-documents.tsx` panel used by asset pages and the wizard step (FR-E004, FR-F003, FR-G002, analysis finding I2)
- [ ] T247 [US7] Create `lib/security/scanners/clamav.ts` — `ClamAvScanner` implementing `MalwareScanner` over clamd `INSTREAM` (TLS endpoint from `CLAMAV_HOST/PORT/TLS`), streaming the quarantine object in chunks, timeouts, `ERROR` verdict on connection failure (never CLEAN by default); register in the factory; `lib/jobs/handlers/file-scan.ts` uses it and records verdicts on `upload_sessions`, `documents.scan_status` / `video_messages.scan_status` and the audit log; INFECTED objects deleted from quarantine (ADR-015, FR-H016, FR-Q011)
- [ ] T095 [P] [US7] Create `app/(dashboard)/documents/page.tsx` — folder tree, grid/list toggle, upload dropzone (T096), file-type icons, upload/scan status, folder dialog, actions (download, share, attach to asset/plan, delete, versions), empty state, skeletons
- [ ] T096 [US7] Create `components/shared/file-upload.tsx` — drag-and-drop; client-side pre-check of type/size (UX only); calls `POST /documents/uploads`, PUTs the file to the signed URL with progress, then calls `complete`; polls status while SCANNING; shows clear rejection reasons (FR-H003)
- [ ] T228 [US7] Create `tests/integration/document-permissions.test.ts` — owner can read/download; other user 403 by id; access-cookie scope allows only listed documents and denies others; expired/revoked token denied; signed URL expiry; upload rejections (extension/MIME mismatch, magic bytes, oversize at declaration and at completion); `promote_upload()` refuses non-SCANNED_CLEAN; INFECTED verdict blocks promotion and audits; `delete_document()` removes shares/attachments and keeps audit rows; video delivery-condition strict mapping (IMMEDIATE playable through any grant that includes the video; DEAD_MAN_SWITCH only through DMS_RELEASE; EMERGENCY_ACCESS only through EMERGENCY_ACCESS; every other combination → 422 `DELIVERY_CONDITION_MISMATCH` on access and at token/scope configuration time); DIRECT_SHARE token scope never exceeds the beneficiary's current assignments (FR-H002–H005, H011–H017, FR-K006, FR-D011, Constitution XVII)

**Checkpoint**: Secure document vault with direct-to-storage upload, validation/scan gating (production scanner), folders, versioning, attachments and signed URL downloads.

---

## Phase 12: User Story 18 — Assigning Assets and Documents to Beneficiaries (Priority: P2)

**Goal**: Users can assign beneficiaries to resources with allocation constraints; recipients access via scoped tokens exchanged for an access cookie

**Independent Test**: Assign → set allocation → over-allocate (422) → issue token → open `/access?t=…` → exchange → cookie-scoped resources incl. plan section → scope enforced

### Implementation for User Story 18

- [ ] T097 [P] [US18] Create `lib/services/assignment.service.ts` + `lib/security/tokens.ts` — `assign(user, beneficiaryId, resourceType, resourceId, allocation?)` via `assign_beneficiary()` RPC (ownership of both, Σ ≤ 100 % per resource → 422 `ALLOCATION_EXCEEDED` with remaining %, INACTIVE beneficiary refused, audit), `unassign`, `listByResource` (with remaining %), `listByBeneficiary`, `issueAccessToken(user, beneficiaryId, scope, ttlDays ≤ 30)` (crypto-random token, SHA-256 hash → `issue_access_token()`, which enforces FR-D011: every `documents`/`assets`/`videos` id in scope must be owned by the caller **and currently assigned to that beneficiary in `beneficiary_assignments`**, `planSections` must be empty (not assignable) — otherwise 422 `SCOPE_NOT_ASSIGNED`; videos in scope must have delivery condition IMMEDIATE — otherwise 422 `DELIVERY_CONDITION_MISMATCH`; plaintext link emailed via T039 and returned once), `listTokens`, `revokeToken` (`revoke_access_token()`), `resendToken(user, tokenId)` (`resend_access_token()` — re-applies every `issue_access_token()` invariant (scope ⊆ current assignments → 422 `SCOPE_NOT_ASSIGNED`, beneficiary not INACTIVE, video mapping → 422 `DELIVERY_CONDITION_MISMATCH`, ttl ≤ 30 days), then revokes the previous DIRECT_SHARE token with `revokedReason = RESENT`, mints exactly one replacement linked by `replacesTokenId`, emails it via T039 and returns the plaintext once; audit `access.token_resent`). Also `lib/jobs/handlers/access-deliver.ts` — the **system-grant delivery job** `access.deliver` (ADR-014 § 6): idempotency key `access.deliver:{grantType}:{sourceId}:{beneficiaryId}[:r{n}]` (sourceId = RELEASE event id for DMS_RELEASE, request id for EMERGENCY_ACCESS; for resend runs `n` = count of existing `access.deliver` jobs for the same (grantType, sourceId, beneficiaryId) + 1, computed inside the enqueue transaction), payload never contains a token; guard that the source is still eligible (switch RELEASED / request APPROVED|AUTO_GRANTED|ACTIVE) else SUCCEEDED no-op; first run mints in memory + `system_issue_access_token()`; a retry finds the undelivered token and calls `system_reissue_access_token(…, 'UNDELIVERED_REPLACED')` (revoke + exactly one replacement, audit `access.token_replaced`); a `:r{n}` resend run does the same with `'RESENT'`; sends through `sendToBeneficiary` (T155); provider acceptance → `system_mark_token_delivered()`; after `max_attempts` → CRITICAL audit `access.delivery_failed` + Super Admin alert (+ owner notification for EMERGENCY_ACCESS). Constitution VII, FR-D011, ADR-014
- [ ] T098 [US18] Create Route Handlers `app/api/v1/assets/[type]/[id]/assign/route.ts` (POST), `assign/[assignmentId]/route.ts` (DELETE), `assignments/route.ts` (GET), `app/api/v1/beneficiaries/[id]/tokens/route.ts` (GET, POST), `tokens/[tokenId]/route.ts` (DELETE), `tokens/[tokenId]/resend/route.ts` (POST, `reverification:'strict'` — ADR-014 § 6)
- [ ] T099 [US18] Add assignment UI to `app/(dashboard)/beneficiaries/[id]/page.tsx` — "Assign to Resource" dialog (type → resource → allocation %), allocation bars, remaining-percentage display, informational per-beneficiary aggregate (FR-D005, Clarifications 2026-09-18)
- [ ] T230 [US18] Create `lib/security/access-session.ts` + `app/api/v1/access/exchange/route.ts` + `app/api/v1/access/logout/route.ts` — `exchange(token)`: hash lookup, expiry/revocation/beneficiary-status checks, sets `used_at`/`last_used_at`, PENDING → ACTIVE, audit `access.exchanged`; mints the stateless access cookie (`{ tokenId, exp }` AES-GCM-encrypted with `ACCESS_COOKIE_KEY`, `httpOnly; Secure; SameSite=Strict; Path=/api/v1/access`, 30-min sliding, ≤ token expiry); `readAccessSession(req)` used by `withApi({ auth:'access-cookie' })` re-checking `access_tokens` on every call; `rateLimit:'accessExchange'` (ADR-014, analysis finding S2)
- [ ] T100 [US18] Create access-cookie Route Handlers `app/api/v1/access/resources/route.ts` (GET scoped list + grant type + expiry), `access/documents/[id]/route.ts` + `download/route.ts`, `access/assets/[type]/[id]/route.ts` (encrypted fields never returned), `access/videos/[id]/route.ts` (delivery condition ↔ grant type enforced on every access per data-model § 11 strict mapping: IMMEDIATE → any grant whose scope includes the video, DEAD_MAN_SWITCH → DMS_RELEASE only, EMERGENCY_ACCESS → EMERGENCY_ACCESS only; mismatch → 422 `DELIVERY_CONDITION_MISMATCH`) — `withApi({ auth:'access-cookie', rateLimit:'tokenAccess' })`, service client with token-scope authorization, read-only, every access audited with the beneficiary as actor (FR-D011, FR-H015, FR-K008)
- [ ] T231 [US18] Create `app/api/v1/access/plan-sections/[section]/route.ts` + `lib/services/plan-section-renderer.ts` — validates the section key against the scope, reads the owner's **latest finalized** `legacy_plan_versions` snapshot, returns a read-only rendering of that section (never a draft); audited (FR-I012, FR-J001, Clarifications 2026-09-18, analysis finding I7)
- [ ] T101 [US18] Create `app/(public)/access/page.tsx` — public page: reads `?t=`, immediately `POST /access/exchange`, strips the token from the URL (`history.replaceState`), then renders the scoped resource list (documents with download, read-only asset views, videos, plan sections), grant type, expiry timer, clear expired/revoked/INACTIVE states, logout
- [ ] T229 [US18] Create `tests/integration/allocation.test.ts` — Σ allocation ≤ 100 per resource (second assignment 60 % after 50 % → 422 with remaining 50), concurrent assignments race under `FOR UPDATE` never exceed 100, direct INSERT into `beneficiary_assignments` denied to `authenticated`, unassign frees allocation, INACTIVE beneficiary refused, cross-user resource refused, audit rows written; `delete_asset()` removes the asset's assignments and attachments and soft-deletes it atomically (rolled back as a whole on failure) while direct `UPDATE … SET deleted_at` on asset tables by `authenticated` is denied; `issue_access_token()` (DIRECT_SHARE) rejects any scope id not currently assigned to the beneficiary (422 `SCOPE_NOT_ASSIGNED`) and accepts a scope that is a subset of its assignments; `resend_access_token()` revokes the previous DIRECT_SHARE token (`revokedReason = RESENT`) and mints exactly one replacement linked by `replacesTokenId`, audited, and is refused with 422 `SCOPE_NOT_ASSIGNED` when a scoped resource is no longer assigned to the beneficiary (no replacement minted, previous token untouched) (FR-D004/D005, FR-D011, Constitution VII, XVII)

**Checkpoint**: Assignments with allocation constraints and cookie-scoped access (incl. plan sections) fully operational.

---

## Phase 13: User Story 20 — Final Review and Legacy Plan Completion (Priority: P2)

**Goal**: Comprehensive final review ensuring completeness

**Independent Test**: Plan with beneficiaries + assets + documents → review → completeness indicators → finalize (with/without acknowledgment)

### Implementation for User Story 20

- [ ] T102 [US20] Extend `lib/services/legacy-plan.service.ts` `getReview()` — cross-entity completeness: beneficiary count/status, asset assignment coverage, unassigned assets, beneficiaries without allocations, document attachments, allocation totals per resource, incomplete steps; structured report with section scores, warnings and the exact `incompleteSections` list the finalize function will use
- [ ] T103 [US20] Update `app/(dashboard)/legacy-plan/steps/review.tsx` — cross-entity completeness (beneficiaries with allocations, asset coverage, document status), section percentages, warning badges, actionable links, summary card; acknowledgment flow consistent with T069

**Checkpoint**: Comprehensive review with cross-entity completeness indicators operational.

---

## Phase 14: User Story 8 — AI Assistant for Legacy Planning (Priority: P2)

**Goal**: Conversational assistant with server-side provider abstraction, validation, disclaimers and persistent draft infrastructure

**Independent Test**: Ask about legacy planning → streamed guidance with disclaimer → provider switched via env → outage → graceful error

### Implementation for User Story 8

- [ ] T104 [P] [US8] Create `lib/ai/provider.ts` — `AIProvider` interface: `generateText(req)`, `generateStructured<T>(req, zodSchema): Promise<{ data: T, usage, model, provider }>` (provider structured-output mode + Zod parse on receipt), `stream(req)`; `AIRequest` (system, messages, temperature, maxTokens, model?); `AIUsage` (tokens, estimated cost). Constitution VI, FR-R001
- [ ] T105 [P] [US8] Create `lib/ai/providers/openai.ts` — `openai` SDK; `OPENAI_API_KEY` server-only; structured outputs via JSON schema derived from Zod; retries with backoff; error mapping; never logs prompt content containing user data (FR-R002)
- [ ] T106 [P] [US8] Create `lib/ai/providers/gemini.ts` — `@google/genai`; `GEMINI_API_KEY`; `responseSchema` for structured outputs; retries; error mapping
- [ ] T107 [US8] Create `lib/ai/factory.ts` — `getProvider(name?)` defaulting to `AI_DEFAULT_PROVIDER`; fallback to the secondary provider on outage; `AIUnavailableError` → 503 `AI_UNAVAILABLE` for graceful degradation (FR-R010)
- [ ] T108 [P] [US8] Create `lib/ai/validation.ts` — `validateResponse(output, context)`: completeness checks, unsupported-claim and fabricated-reference heuristics (citations, statutes, case names), uncertainty markers → `{ isValid, warnings[], confidence: 0–1, flaggedSpans[] }` (FR-R003–R005)
- [ ] T206 [P] [US8] Create `lib/ai/prompts/` (versioned templates with `promptVersion`) and `lib/ai/schemas/` (Zod output schemas: assistant reply with `disclaimer` + `confidence`, will-draft sections with per-section confidence, extraction schema for NL input, document findings). Usage/cost recorded on `ai_interactions` (ADR-008)
- [ ] T233 [US8] Create `lib/services/ai/draft.service.ts` + `lib/repositories/ai-draft.repository.ts` — `createDraft(kind, links)`, `addAiVersion(draftId, content, sectionConfidence, usage)` (service client; content encrypted with T020; links the `ai_interactions` row), `addUserVersion` (→ `update_ai_draft()` via user client), `getDraft`/`listVersions` (decrypt for owner), `confirmWill` (→ `confirm_ai_draft()`), `confirmAnalysis` (→ `confirm_analysis_findings()`), `reject`, `supersede`; `ai_interactions` never receives content (ADR-016)
- [ ] T109 [US8] Create `lib/services/ai/assistant.service.ts` — `chat(user, message, clientHistory?)` — `clientHistory` is the **client-held, session-scoped** prior turns (max 20 turns, bounded per-turn length, Zod-validated; used only to build the prompt, never persisted): system prompt (legacy-planning guide, never claims to be a lawyer, recommends professional counsel, answers product/process questions — FR-L006), context from the user's plan (missing-information detection — FR-L004), provider call (stream), validation, `ai_interactions` row with sanitized metadata only (no message text, no raw PII — Constitution XVI, ADR-016), disclaimer in every response (FR-L007)
- [ ] T110 [US8] Create Route Handlers `app/api/v1/ai/assistant/message/route.ts` (POST `{ message, history?: Turn[] }` — `history` = client-held prior turns, max 20, bounded per-turn length; streaming response, `withApi({ rateLimit:'ai' })`, `maxDuration` set; message/history text is **not persisted**) and `interactions/route.ts` (GET — sanitized `ai_interactions` records of the current user only; never conversation or message content)
- [ ] T112 [P] [US8] Create `app/(dashboard)/ai/assistant/page.tsx` — chat UI (streaming), persistent disclaimer banner, in-session history kept as **client-held state only** (sent as `history` with each message, cleared on sign-out and on idle timeout, never persisted server-side), skeletons, glassmorphism message cards, Framer Motion
- [ ] T113 [P] [US8] Create `components/shared/ai-disclaimer.tsx` — always-visible disclaimer ("informational guidance only, not legal advice; consult a qualified attorney") and "AI-generated" label component (FR-M013, FR-R009)
- [ ] T232 [US8] Create `tests/unit/ai/validation.test.ts` + `tests/unit/ai/factory.test.ts` + `tests/integration/ai-drafts.test.ts` — fabricated citation/statute detection, unsupported-claim flags, confidence scoring, disclaimer presence, structured-output schema failure handling, provider fallback on outage and `AI_UNAVAILABLE` when both fail, no prompt content in logs; draft versioning (AI/USER), content encrypted at rest, `ai_interactions` contains no content, `confirm_ai_draft()` requires ownership and supersedes prior confirmed, `confirm_analysis_findings()` creates records atomically (FR-R003–R010, FR-M010/M011, FR-N007/N008, Constitution XVII)
- [ ] T244 [US8] Create `docs/AI_MODULE.md` — provider abstraction, prompt/schema versioning, validation heuristics, confidence semantics, draft persistence and confirmation model, cost controls, outage behaviour (Constitution XVIII)

**Checkpoint**: AI assistant with provider abstraction, structured/validated outputs, disclaimers, draft persistence and graceful degradation.

---

## Phase 15: User Story 14 — Security Center (Priority: P2)

**Goal**: Users can view and manage their security posture — sessions, login history, MFA, password, idle timeout

**Independent Test**: Sign in from two browsers → Security Center shows both → revoke one → login history present → security score updates when MFA enabled

### Implementation for User Story 14

- [ ] T114 [P] [US14] Create `lib/services/security.service.ts` — `getActiveSessions(user)` (Clerk Backend API `sessions.getSessionList({ userId })` → browser/device/city/country/last active), `revokeSession(user, sessionId)` (verify session belongs to user → Clerk revoke → audit `auth.session_revoked`), `getLoginHistory(user, pagination)` (audit auth events), `getSecurityAuditHistory`, `getSecurityStatus(user)` (score: MFA +30, verified email +20, backup codes +15, recent security review +15, no unresolved new-device alerts +20), `recordClientEvent` (T203/T220). FR-O001–O009
- [ ] T115 [US14] Create Route Handlers `app/api/v1/security/sessions/route.ts` (GET), `sessions/[id]/route.ts` (DELETE), `login-history/route.ts`, `audit-history/route.ts`, `status/route.ts`, `events/route.ts` (POST — idle-timeout events from T220 and, if T203 requires, failed sign-in reports)
- [ ] T117 [P] [US14] Create `app/(dashboard)/security-center/page.tsx` — score gauge with breakdown, sessions list with revoke, login timeline, alerts, quick actions (open Clerk security settings, review backup codes, set idle timeout), cyan accents, Framer Motion counter
- [ ] T118 [US14] Create `app/(dashboard)/settings/page.tsx` — app profile fields (incl. alternate email), preferences (theme, date format, currency), notification preferences; links to `settings/security` (Clerk-managed email/password/MFA — FR-B007 enforced by Clerk reverification)

**Checkpoint**: Security Center with Clerk-backed session management, login history, and security score operational.

---

## Phase 16: User Story 9 — AI Will Generator (Priority: P3)

**Goal**: AI generates versioned will drafts from NL input + plan data with editing, confirmation, and PDF export

**Independent Test**: Provide NL input → generate → review → edit (USER version) → regenerate → confirm (reverified) → export PDF → versions listed

### Implementation for User Story 9

- [ ] T119 [P] [US9] Create `lib/services/ai/will-generator.service.ts` — `generate(user, { input?, instructions? })` (extract structured info from NL input with the extraction schema — FR-M001/M002; load plan + beneficiaries + assets + attachments; `generateStructured` with the will-draft schema; validation for hallucinations/unsupported claims and internal consistency — names match records, assets exist, allocations valid (FR-M009); creates the draft + AI version via T233 with per-section confidence), `edit` (USER version), `regenerate(instructions?)` (new AI version), `confirm(versionId)` (→ `confirm_ai_draft()`, audit — FR-M010/M011), `listVersions`; never claims legal validity (Constitution V)
- [ ] T120 [US9] Create Route Handlers `app/api/v1/ai/will-generator/drafts/route.ts` (GET, POST), `drafts/[draftId]/route.ts` (GET, PATCH), `drafts/[draftId]/versions/route.ts` (GET), `drafts/[draftId]/regenerate/route.ts` (POST), `drafts/[draftId]/confirm/route.ts` (POST, `reverification:'strict'`, `confirmed: true`), `drafts/[draftId]/export/route.ts` (GET PDF; `runtime = 'nodejs'`) — `rateLimit:'ai'`
- [ ] T121 [P] [US9] Create `app/(dashboard)/ai/will-generator/page.tsx` — NL input + generate CTA, draft viewer with version selector, section-by-section display with inline editing, confidence indicators, regenerate with instructions, "Confirm and Save" through the re-auth gate, "Export PDF" (confirmed version), AI-generated labels (FR-M013), disclaimer (FR-M014)
- [ ] T122 [US9] Create `lib/services/ai/pdf-export.service.ts` — `@react-pdf/renderer` document from the confirmed version: header/branding, sections, beneficiaries, assets, signature lines, footer disclaimer ("AI-generated draft — consult legal counsel"), timestamp, draft version number

**Checkpoint**: AI-powered will generation with NL input, versioning, editing, confirmation gates, and PDF export.

---

## Phase 17: User Story 10 — Dead Man Switch Configuration (Priority: P3)

**Goal**: Users can configure the Dead Man Switch state machine with check-in parameters, trusted contacts (beneficiaries) and release scope

**Independent Test**: Configure DMS → schedule → select contacts and release scope (incl. plan sections) → status shows next check-in

### Implementation for User Story 10

- [ ] T123 [P] [US10] Create `lib/validators/dms.validators.ts` — `configureDeadManSwitchSchema` (inactivityPeriodDays 7–365, checkInFrequencyDays 1–90, escalationDelayHours 1–168 default 24, `contactBeneficiaryIds: uuid[]` ≥ 1, releaseScope `{ documents: uuid[], assets: [{type,id}], videos: uuid[], planSections: sectionKey[] }`, escalationRules), `updateDeadManSwitchSchema`, `checkInSchema`, `cancelEscalationSchema`
- [ ] T124 [P] [US10] Create `lib/services/dead-man-switch.service.ts` + repository — wrappers over guarded functions via the user client: `configure` (`dms_configure()` — validates contacts are the caller's non-INACTIVE beneficiaries and scope ids are owned; one switch per user; status ACTIVE; computes `next_check_in_at`; CONFIG_CHANGE event; audit), `getConfig` (with contacts and scope resolved), `pause` / `resume` / `disable` (`dms_pause/resume/disable()`; disable behind reverification), `getEvents`. Scheduling is data-driven (`next_check_in_at`) — the hourly `dms-scan` picks it up (ADR-006). State machine per data-model.md
- [ ] T125 [US10] Create Route Handlers `app/api/v1/dead-man-switch/route.ts` (GET, POST, PATCH, DELETE with `reverification:'strict'`), `pause/route.ts`, `resume/route.ts`, `events/route.ts`
- [ ] T127 [P] [US10] Create `app/(dashboard)/dead-man-switch/page.tsx` — setup form (inactivity slider, frequency, trusted-contact picker from beneficiaries, release-scope selector for documents/assets/videos/plan sections), status dashboard (state badge, next check-in countdown, event timeline), pause/resume/disable (disable through re-auth gate)

**Checkpoint**: Dead Man Switch configurable with beneficiary contacts, state machine and release scope selection.

---

## Phase 18: User Story 19 — Responding to Dead Man Switch Check-ins (Priority: P3)

**Goal**: Scheduled scan sends check-ins; users check in with identity verification; missed check-ins escalate; scoped release to beneficiary contacts; health monitored

**Independent Test**: DMS active → scan enqueues check-in → email → check in (reverified) → timer reset. Simulate miss (test clock) → escalation → recovery cancels. Simulate scan stall → CRITICAL audit + alert

### Implementation for User Story 19

- [ ] T128 [P] [US19] Create `app/api/internal/cron/dms-scan/route.ts` + `lib/jobs/handlers/dms-scan.ts` + `lib/jobs/handlers/dms-send-checkin.ts` — the hourly endpoint **only enqueues one** idempotent `dms.scan` job (`idempotency_key = dms.scan:{YYYY-MM-DDTHH}`, so concurrent Vercel Cron / `pg_cron` triggers within the same hour are no-ops); the `dms.scan` handler performs the scan — selects switches `status = ACTIVE AND next_check_in_at <= now()` (and the T129 deadlines) and enqueues the per-switch transition jobs, e.g. `dms.send-checkin` with `idempotency_key = dms:{id}:{next_check_in_at}` — then completes; the runner writes `jobs.finished_at`, and that SUCCEEDED `dms.scan` row is the scheduler heartbeat read by T183 (no other heartbeat mechanism); the send-checkin handler sends the check-in notification (email + in-app, link to T207), transitions ACTIVE → REMINDER_SENT via `dms_transition()`, records the event. Idempotent, retry-safe (FR-I002)
- [ ] T129 [P] [US19] Create `lib/jobs/handlers/dms-advance.ts` — enqueued by the scan for switches in REMINDER_SENT/GRACE_PERIOD/ESCALATING whose deadline passed: REMINDER_SENT → GRACE_PERIOD (secondary reminder), GRACE_PERIOD → ESCALATING (trusted-contact notification to the linked beneficiaries, `current_escalation_step`++ with `escalation_delay_hours` between steps), steps exhausted → RELEASING (enqueue `dms.release`). Each transition via `dms_transition()` + event + audit (FR-I005, FR-I006)
- [ ] T130 [US19] Add `checkIn(user)` and `cancelEscalation(user)` to `lib/services/dead-man-switch.service.ts` — call `dms_check_in()` / `dms_cancel_escalation()`; Route Handlers `app/api/v1/dead-man-switch/check-in/route.ts` and `cancel-escalation/route.ts` enforce Clerk reverification (`multi_factor` when MFA enabled, else `strict`); check-in → ACTIVE, reset `next_check_in_at` and escalation step, CHECK_IN event; cancel → ACTIVE (also from RELEASED: revokes DMS_RELEASE tokens), RECOVERY event; audit both (FR-I003, FR-I004, FR-I007, FR-I008)
- [ ] T131 [US19] Create `lib/jobs/handlers/dms-release.ts` — for RELEASING switches: transition → RELEASED via `dms_transition()` (RELEASE event) and, in the same transaction (outbox insert performed inside `dms_transition()`), enqueue **exactly one** `access.deliver` job per `dead_man_switch_contacts` beneficiary (`access.deliver:DMS_RELEASE:{releaseEventId}:{beneficiaryId}`, payload without any token); the delivery job (T097) issues each DMS_RELEASE token scoped **exactly** to `release_scope` (documents, assets, videos, plan sections) through `system_issue_access_token()` and emails the access link (`/access?t=…`) with reissue-on-retry (ADR-014 § 6) — no inline email from this handler; audit. Never grants account access (FR-I012, ADR-014)
- [ ] T133 [US19] Add check-in UI to `app/(dashboard)/dead-man-switch/page.tsx` — "Check In Now" through the re-auth gate, success state with reset timer, escalation warning banner in GRACE_PERIOD/ESCALATING/RELEASED with "Cancel escalation"
- [ ] T183 [P] [US19] Create `lib/observability/dms-health.ts` — evaluated by `GET /api/v1/health` (detailed mode) and by `run-jobs`: if the most recent SUCCEEDED `dms.scan` job (enqueued hourly by the T128 endpoint; `jobs.finished_at` written by the job runner) is older than 2× the scan interval, write CRITICAL audit `dms.job_health_failure`, alert Super Admins (email) and Sentry. Production redundancy trigger in T211. NFR-AVL-002
- [ ] T207 [US19] Create `app/(dashboard)/dead-man-switch/check-in/page.tsx` — landing page for check-in email links: requires sign-in (proxy) + reverification, one-click check-in, "This wasn't me" path to Security Center; handles already-checked-in/paused states
- [ ] T235 [US19] Create `tests/integration/dead-man-switch.test.ts` — with a controllable clock: configure (contacts must be owned beneficiaries; scope must be owned; plan-section keys validated), scan enqueues idempotently (re-run creates no duplicates), REMINDER_SENT → GRACE_PERIOD → ESCALATING → RELEASING → RELEASED with correct deadlines, invalid transitions raise `INVALID_TRANSITION`, `dms_check_in`/`dms_cancel_escalation` recover at every stage and revoke release tokens from RELEASED, release tokens carry exactly the release scope and nothing else, direct writes to `dead_man_switches` denied, health check flags a stalled scan and writes the CRITICAL audit row; **delivery policy (ADR-014 § 6)**: release enqueues exactly one `access.deliver` job per contact and sends nothing inline; a failed send followed by a retry revokes the undelivered token (`UNDELIVERED_REPLACED`) and mints exactly one replacement — at no time do two non-revoked DMS_RELEASE tokens exist for the same (switch, beneficiary) (partial unique index); a dead-lettered delivery writes CRITICAL `access.delivery_failed`; recovery from RELEASED leaves pending delivery jobs as no-ops; admin resend revokes + re-mints once and is audited (FR-I001–I012, NFR-AVL-002, Constitution VII, XVII)

**Checkpoint**: Full DMS lifecycle operational on the job table with scheduled scans, reverified check-ins, escalation, scoped release to beneficiary contacts, and health monitoring.

---

## Phase 19: User Story 11 — Emergency Access (Priority: P3)

**Goal**: Designated beneficiaries can request time-limited, scoped access with email-OTP verification, owner decision or configured timeout rule

**Independent Test**: Designate contact (email with request link) → request (public) → OTP → owner approves (reverified) → access via `/access` → expiry via housekeeping; repeat with AUTO_GRANT, DENY and WAIT rules

### Implementation for User Story 11

- [ ] T134 [P] [US11] Create `lib/validators/emergency-access.validators.ts` — `configureContactSchema` (`beneficiaryId`, `accessScope` (same shape as token scope), `onTimeout: WAIT|AUTO_GRANT|DENY` default WAIT, `timeoutHours 1–168` required unless WAIT, `requestExpiryHours` default 72, `accessDurationHours` default 72), `updateContactSchema`, `requestAccessSchema` (`configId`, `requesterEmail`), `verifyAccessSchema` (`requestId`, `code` length 6), `decisionSchema`
- [ ] T135 [P] [US11] Create `lib/services/emergency-access.service.ts` + repository — owner: `configureContact` (`ea_configure_contact()`; sends designation email with the personal request link `/emergency-access/request?c=<configId>`; sets `lastDesignationSentAt`), `updateContact`, `removeContact`, `resendDesignation` (rate-limited), `listContacts`, `listRequests`, `approve` (`ea_decide_request(APPROVE)` records APPROVED and enqueues the `access.deliver` job in the same transaction (outbox insert inside the function); the job issues the EMERGENCY_ACCESS token, sets ACTIVE and emails the link with reissue-on-retry — ADR-014 § 6), `resendAccess` (owner, reverified: enqueues a new `access.deliver` run `…:r{n}` (`n` per T097: existing job count for the same key prefix + 1, computed inside the enqueue transaction) that revokes the current token with `revokedReason = RESENT` and re-mints exactly one; audit `access.resend_requested`), `deny`, `revoke` (`ea_revoke()`); public (service client): `requestAccess(configId, email)` (`ea_request_access()` — email must match the beneficiary; 6-digit OTP hashed, 15-min expiry; owner notified; generic response), `verifyOtp(requestId, code)` (`ea_verify_otp()` — ≤ 3 attempts → FAILED), `getRequesterStatus`. State machine per data-model.md (Clarifications 2026-09-18)
- [ ] T136 [US11] Create `lib/jobs/handlers/ea-auto-decide.ts` — enqueued by housekeeping for VERIFIED requests past `timeout_hours` without an owner decision: `AUTO_GRANT` → AUTO_GRANTED and enqueue `access.deliver` (outbox insert inside `ea_transition()`; the token is issued and ACTIVE set by the delivery job — ADR-014 § 6; contact + owner notified), `DENY` → DENIED (notify both), `WAIT` → no action; all via `ea_transition()` and audited (FR-J006)
- [ ] T137 [US11] Create `lib/jobs/handlers/ea-expire.ts` — enqueued by housekeeping: PENDING/VERIFYING/VERIFIED requests past `request_expires_at` → EXPIRED; ACTIVE requests past `expires_at` → EXPIRED with token revoked; audit (FR-J007)
- [ ] T138 [US11] Create Route Handlers: owner `app/api/v1/emergency-access/contacts/route.ts` (GET, POST), `contacts/[id]/route.ts` (PATCH, DELETE), `contacts/[id]/resend/route.ts` (POST), `requests/route.ts` (GET), `requests/[id]/approve/route.ts` (POST, `reverification:'strict'`), `requests/[id]/resend-access/route.ts` (POST, `reverification:'strict'` — ADR-014 § 6), `requests/[id]/deny/route.ts`, `requests/[id]/revoke/route.ts`; public `request/route.ts`, `verify/route.ts`, `requests/[id]/status/route.ts` (`withApi({ auth:'public', rateLimit:'publicEmergency' })`). Granted access uses the shared `/access` endpoints (T100/T230)
- [ ] T140 [P] [US11] Create `app/(dashboard)/emergency-access/page.tsx` — contacts (beneficiary picker) with scope selector and timeout rule, resend designation, pending requests (approve through re-auth gate / deny), active access (revoke), event timeline
- [ ] T208 [US11] Create public pages `app/(public)/emergency-access/request/page.tsx` (prefilled `configId` from the link, email field), `verify/page.tsx` (OTP entry, attempts feedback), `status/page.tsx` (pending owner decision / approved with access link sent / denied / expired — generic wording); no sign-in required
- [ ] T236 [US11] Create `tests/integration/emergency-access.test.ts` — designation requires an owned non-INACTIVE beneficiary and owned scope; request with mismatched email → generic response, no OTP; OTP wrong ×3 → FAILED; expired OTP; owner approve records APPROVED and enqueues `access.deliver`; the delivery job issues exactly one EMERGENCY_ACCESS token scoped exactly to `accessScope`, sets ACTIVE, and the link is consumable via `/access/exchange`; a send failure followed by a retry revokes the undelivered token and re-mints exactly one replacement (`replacesTokenId`), audited; owner `resend-access` revokes and re-mints once (`RESENT`); AUTO_GRANT follows the same delivery path; deny; timeout rules AUTO_GRANT / DENY / WAIT with a test clock; request expiry → EXPIRED; active-access expiry revokes the token; owner revoke; contact cannot access out-of-scope resources (403); all events audited; direct writes to `emergency_access_*` denied (FR-J001–J010, Constitution VII, XVII)

**Checkpoint**: Emergency access with designation link, email-OTP verification, owner decision, configurable timeout rules, time-limited scoped access and expiry.

---

## Phase 20: User Story 12 — Video Legacy (Priority: P3)

**Goal**: Users can upload (resumable, direct-to-storage), validate, scan, assign and deliver video messages (upload-only baseline)

**Independent Test**: Create upload session → TUS upload 300 MB → complete → processing job (scan) → assign → delivery condition enforced; > 500 MB rejected

### Implementation for User Story 12

- [ ] T141 [P] [US12] Create `lib/services/video.service.ts` + repository — `createUploadSession(user, { title, mimeType MP4/WebM/MOV, sizeBytes ≤ 500 MB })` → resumable TUS target in `quarantine/{clerkUserId}/{uploadId}` (Clerk JWT + T218 storage policy), `completeUpload` (actual size ≤ 500 MB, container magic bytes, enqueue `video.process`), `lib/jobs/handlers/video-process.ts` (malware scan via T247 streaming, metadata probe, SCANNED_CLEAN → `promote_upload()` → `videos`, audit), `getStreamUrl` (authorize — owner by ownership, recipient only through a grant whose type satisfies the data-model § 11 delivery-condition strict mapping, evaluated on every access, mismatch → 422 `DELIVERY_CONDITION_MISMATCH` — + signed URL 15 min + audit — FR-K006–K008), `updateMetadata` (Class A allow-list), `delete` (`delete_video()`), `list`, `assignBeneficiary`/`unassignBeneficiary` (assignments, FR-K005). Upload-only (Clarifications 2026-09-18)
- [ ] T142 [US12] Create Route Handlers `app/api/v1/videos/route.ts`, `uploads/route.ts`, `uploads/[uploadId]/route.ts`, `uploads/[uploadId]/complete/route.ts`, `[id]/route.ts`, `[id]/stream/route.ts`, `[id]/assign/route.ts`, `[id]/assign/[beneficiaryId]/route.ts`
- [ ] T144 [P] [US12] Create `app/(dashboard)/video-legacy/page.tsx` — grid with thumbnails/placeholders, `tus-js-client` upload with progress and resume, processing status, metadata dialog (title, description, recipient, delivery condition), assignment, player modal using the signed stream URL

**Checkpoint**: Video upload, validation/scanning, assignment, and delivery-condition management complete.

---

## Phase 21: User Story 13 — AI Document Analysis (Priority: P3)

**Goal**: AI analyzes vault documents into a versioned DOCUMENT_ANALYSIS draft with confidence and selective confirmation

**Independent Test**: Select document → analyze (202) → poll → findings with confidence → confirm selected → records created; nothing persisted without confirmation; reject purges per retention

### Implementation for User Story 13

- [ ] T145 [P] [US13] Create `lib/services/ai/document-analysis.service.ts` + `lib/jobs/handlers/ai-analyze-document.ts` — `analyze(user, documentId)` (ownership; creates an `ai_drafts` row (kind DOCUMENT_ANALYSIS) via T233; enqueues job; returns 202 `{ draftId }`), job: download from private bucket (service client), text extraction (`unpdf`) / OCR hook (pluggable; Gemini vision acceptable) (FR-N003), `generateStructured` with the findings schema `{ summary, assets[], beneficiaries[], dates[], figures[] }`, validation + per-finding confidence (FR-N006), stores the encrypted AI version, updates `progress`; `getStatus`; `confirm(user, draftId, selected)` → `confirm_analysis_findings()` creates asset/beneficiary rows atomically, CONFIRMED, audit (FR-N007, FR-N008); `reject`. Document content never logged; `ai_interactions` stays sanitized
- [ ] T146 [US13] Create Route Handlers `app/api/v1/ai/document-analysis/analyses/route.ts` (POST, 202), `analyses/[draftId]/route.ts` (GET status/findings), `analyses/[draftId]/confirm/route.ts` (POST), `analyses/[draftId]/reject/route.ts` (POST) — `rateLimit:'ai'`
- [ ] T147 [P] [US13] Create `app/(dashboard)/ai/document-analysis/page.tsx` — document selector, analyze with progress indicator (NFR-PER-004), categorized findings with confidence bars, selection checkboxes, "Confirm Selected", reject, summary, AI disclaimer

**Checkpoint**: AI document analysis as a background job with persistent findings, confidence indicators and selective confirmation.

---

## Phase 22: User Story 15 — Platform Administration (Priority: P3)

**Goal**: Super Admin dashboard for user management, audit logs, analytics, and support

**Independent Test**: Regular user → /admin and /api/v1/admin → 403. Super Admin → manage users → audit logs → analytics → unlock/reset MFA (audited)

### Implementation for User Story 15

- [ ] T148 [P] [US15] Create `lib/services/admin.service.ts` — `listUsers(filters, pagination)`, `getUserById` (masked sensitive fields), `assignRole(admin, id, role)` (service-client update of `users.role` — the only write path for that column; audit — FR-P004), `unlockAccount(admin, id)` (Clerk Backend API unlock, audit — FR-P007), `resetUserMfa(admin, id)` (Clerk Backend API disable TOTP/backup codes, audit, notify user — FR-P007), `getAnalytics()` (registrations by period, active users from audit, storage usage from `documents`/`video_messages` sizes), `getPlatformAuditLogs(filters, pagination)`, `resendAccessToken(admin, tokenId)` (recovery path for DMS_RELEASE / EMERGENCY_ACCESS links whose delivery dead-lettered: enqueues `access.deliver …:r{n}` (`n` per T097: existing job count for the same key prefix + 1, computed inside the enqueue transaction) — revoke + exactly one replacement; audit `access.resend_requested` with the admin as actor — ADR-014 § 6). Service client + explicit `SUPER_ADMIN` check
- [ ] T149 [US15] Create Route Handlers `app/api/v1/admin/users/route.ts`, `users/[id]/route.ts`, `users/[id]/role/route.ts` (PATCH, `reverification:'strict'`), `users/[id]/unlock/route.ts`, `users/[id]/reset-mfa/route.ts` (`reverification:'strict'`), `analytics/route.ts`, `analytics/registrations/route.ts`, `analytics/storage/route.ts`, `access-tokens/[id]/resend/route.ts` (POST, `reverification:'strict'`), and `app/api/v1/audit-logs/admin/route.ts` — all `withApi({ auth:'admin' })` (FR-P012)
- [ ] T151 [P] [US15] Create `app/(admin)/admin/page.tsx` — user/active/storage cards, registrations chart, quick links; purple accents
- [ ] T152 [P] [US15] Create `app/(admin)/admin/users/page.tsx` — searchable table (name, email, role, status, last login), actions (assign role, unlock, reset MFA) through the re-auth gate, dialogs
- [ ] T153 [P] [US15] Create `app/(admin)/admin/audit-logs/page.tsx` — filterable platform audit table (actor, action, resource, outcome, date range), export
- [ ] T154 [US15] Create `app/(admin)/layout.tsx` — server layout: `requireRole(['SUPER_ADMIN'])` redirect for UX (API re-enforces), admin sidebar; no static prerendering

**Checkpoint**: Super Admin can manage users, view analytics, and access platform-wide audit logs; RBAC enforced server-side.

---

## Phase 23: Notifications System

**Purpose**: Notification endpoints, UI and event wiring (the service itself is T155 in Phase 2)

- [ ] T156 Create Route Handlers `app/api/v1/notifications/route.ts` (GET), `unread-count/route.ts`, `[id]/read/route.ts` (PATCH — Class A `readAt`), `read-all/route.ts` (POST)
- [ ] T158 [P] Create `components/layout/notification-bell.tsx` — unread badge, dropdown list, mark-as-read, "View All", 30 s polling, Framer Motion badge bounce
- [ ] T159 Create `app/(dashboard)/notifications/page.tsx` — list with type icons, timestamps, read/unread styling, mark-all-read, infinite scroll
- [ ] T160 Wire notification events across services — Clerk webhook handler (new device, MFA change, password change), beneficiary invitations and access links, DMS check-in/escalation/release, emergency access (designation, request, decision, grant, expiry), document shared, AI job completion; verify each event has a template (T039) and honours preferences
- [ ] T209 [P] Create `app/api/webhooks/email/route.ts` — `withApi({ auth:'webhook', verify })` — provider signature (`EMAIL_WEBHOOK_SECRET`) verified over the raw request body before parsing (T030; browser CSRF check not applied — authenticated per request), `record_webhook_event('EMAIL', …)` idempotency, map delivery events (delivered, bounced, complained) to `notifications.delivery_status` by `providerMessageId`, audit bounces for security-relevant emails; a bounce whose `providerMessageId` matches `access_tokens.delivery_provider_message_id` is audited as `access.delivery_bounced` (ADR-009, ADR-014 § 6)

**Checkpoint**: Notification system operational with email and in-app channels across all modules.

---

## Phase 24: User Audit Log Access

**Purpose**: Users can view their own audit trail

- [ ] T161 Create Route Handler `app/api/v1/audit-logs/route.ts` — GET with pagination + filters (action type, date range, resource type), scoped to the caller's own rows (service check + RLS SELECT-own)
- [ ] T163 Create `app/(dashboard)/settings/audit-log/page.tsx` — filterable timeline/table of the user's own actions, date range, action filter, expandable details

**Checkpoint**: Users can view their own activity history.

---

## Phase 25: Polish & Cross-Cutting Concerns

**Purpose**: UI refinement, performance, security hardening, operations, documentation

- [x] T164 [P] Create `components/shared/page-transition.tsx` — Framer Motion route transition wrapper (fade + slide) (UX-010)
- [x] T165 [P] Create `components/shared/skeleton-loader.tsx` — card/table/list/form skeletons (UX-012)
- [x] T166 [P] Create `components/shared/empty-state.tsx` — illustration, message, CTA (beneficiaries, assets, documents, notifications, plans)
- [x] T167 [P] Create `components/shared/confirmation-dialog.tsx` — destructive/authoritative confirmation (delete, finalize, revoke, disable)
- [x] T168 [P] Create `hooks/use-reduced-motion.ts` and apply to all Framer Motion and GSAP animations (UX-009, Constitution XIV)
- [x] T169 [P] Create `app/(marketing)/page.tsx` — landing: animated gradient hero, feature cards, security badges, CTAs (Sign up, Learn more), GSAP scroll animations, responsive
- [ ] T170 Responsive layout audit on all pages (1440 / 768 / 375 px); fix overflow/truncation (Constitution XIV)
- [ ] T171 [P] Audit all Route Handler error responses — no stack traces, database details, file paths, internal names; envelope shape consistent; `Cache-Control: private, no-store` present (Constitution X, XV)
- [ ] T172 [P] Audit all log statements and Sentry breadcrumbs — no passwords, tokens, keys, document content, access tokens/cookies, unnecessary PII (Constitution XVI)
- [ ] T173 Keyboard navigation support across interactive elements — tab order, focus styles, Enter/Escape on dialogs, arrow keys on lists (Constitution XIV)
- [ ] T174 Run `pnpm audit` and resolve high/critical vulnerabilities; add to CI
- [ ] T175 Update `docs/architecture/SYSTEM_ARCHITECTURE.md` (pre-implementation baseline exists — do **not** create a second `docs/SYSTEM_ARCHITECTURE.md`) — single-app architecture, request pipeline (incl. access-cookie mode), write-protection model, job flow, platform boundaries (Clerk/Supabase/Vercel/ClamAV), security layers, diagrams; finalize `docs/DEPLOYMENT.md`
- [ ] T176 Create `docs/API_SPECIFICATION.md` — full API documentation derived from contracts and implemented handlers, including access-cookie, internal webhooks/cron
- [ ] T177 Create `docs/RBAC.md` — roles, permission matrix, service-layer + RLS + column-grant + guarded-function authorization flow, reverification levels
- [ ] T178 Update `docs/security/SECURITY_ARCHITECTURE.md` into the implemented security reference (do **not** create a second `docs/SECURITY.md`) — security architecture, Clerk configuration, write-protection model, key management and rotation (T240), token/cookie model, threat model, T203 outcome
- [ ] T179 [P] Run quickstart.md validation scenarios end to end — all documented scenarios pass
- [ ] T180 Update `docs/BRAIN.md` and `docs/PROJECT_STATUS.md` with implemented state per phase (Constitution XVIII)
- [ ] T184 [P] Implement dark/light theme toggle in `components/layout/theme-toggle.tsx` — persist to `preferences.theme` via API with localStorage fallback, `data-theme` on `<html>`, default dark, respect `prefers-color-scheme` on first visit (UX-002)
- [ ] T185 Pre-production security review (NFR-SEC-002) — authentication (Clerk configuration: policy, verification, MFA, lockout, session lifetime, reverification), authorization (service checks, RLS policies, column grants, guarded functions per table — evidence from T215), cross-user isolation (ID manipulation), storage (bucket privacy, `storage.objects` policies, signed URL expiry, quarantine gating, production scanner active), tokens/OTPs/access cookies (hashing, expiry, scope, no tokens in paths/logs), webhooks/cron secrets, rate limiting (all layers), secrets management (Vercel env only, no `NEXT_PUBLIC_` secrets), headers/CSP, cache safety (no-store; no `use cache` on user data), error handling, OWASP Top 10, dependency vulnerabilities, ADR-013 activation decision. Document in `docs/SECURITY_REVIEW.md`
- [ ] T186 [P] Create `scripts/backup-database.sh` / `scripts/restore-database.sh` — `pg_dump` via the Supabase pooled connection string (from env, never committed) with compression, upload to a separate private backup bucket **with provider encryption at rest and access limited to the operations role**, retention (30 daily / 12 weekly / 12 monthly), restore verification to a scratch database; document Supabase automated backups + PITR (prod) as primary. NFR-DR-001
- [ ] T187 [P] Create `docs/DISASTER_RECOVERY.md` — backup schedule (Supabase + off-platform), retention, restore procedures (PITR and `pg_restore`), RTO/RPO targets, escalation contacts, quarterly restore drill, post-restore verification. NFR-DR-002
- [ ] T188 [P] Integrate Sentry via `@sentry/nextjs` — `instrumentation.ts`, `instrumentation-client.ts`, server/edge configs; DSN from env; release tagging + source maps in CI; PII scrubbing (`beforeSend`, strip `t` query params and cookies); capture in `withApi()` and the job runner; alert rules for error-rate spikes and `dms.job_health_failure`. NFR-OBS-002 (ADR-010)
- [ ] T189 Create user data export/deletion — `app/api/v1/users/me/export/route.ts` (GET, `reverification:'strict'`: profile, beneficiaries, assets with decrypted sensitive fields, document metadata, plans + versions, confirmed AI drafts, own audit rows → JSON download; audited), `app/api/v1/users/me/route.ts` DELETE (`reverification:'strict'`, `confirmed: true`: set `deletion_requested_at` via service client, revoke Clerk sessions via Backend API, pause DMS, revoke access tokens, audit), `cancel-deletion/route.ts` (POST); `lib/jobs/handlers/user-hard-delete.ts` after 30-day grace (enqueued by housekeeping): delete storage objects, anonymize/soft-delete rows, delete the Clerk user via Backend API, retain audit rows. NFR-CMP-001
- [ ] T191 [P] Create `scripts/load-test.ts` (k6) — 100+ concurrent users performing CRUD (asset create, dashboard fetch, document metadata) against a preview deployment; p95 < 500 ms for CRUD (SC-004, NFR-PER-002, NFR-SCL-002); summary report
- [ ] T211 Enable the production redundancy trigger — Supabase `pg_cron` + `pg_net` schedules calling `/api/internal/cron/run-jobs` and `dms-scan` with `CRON_SECRET` (stored in Vault/settings, not in SQL files); verify both triggers are idempotent together; document in `docs/DEPLOYMENT.md` (ADR-006, NFR-AVL-002)
- [ ] T234 [P] Create the remaining planned documentation — `docs/PRD.md`, `docs/FRD.md` (derived from spec.md), `docs/ROADMAP.md`, `docs/FEATURES.md` (status per module) per plan.md Documentation Plan; **update** the existing `docs/ui/DESIGN_SYSTEM.md` (UI/UX guidelines) and `docs/product/CHANGELOG.md` rather than creating `docs/UI_UX_GUIDELINES.md` / `docs/CHANGELOG.md`
- [ ] T237 [P] Automated accessibility testing — `@axe-core/playwright` across every route in `tests/e2e/a11y.spec.ts` (no serious/critical violations), contrast check against WCAG 2.1 AA tokens, reduced-motion verification, focus-order checks; plus a documented manual screen-reader pass (NVDA/VoiceOver) on the wizard, vault and access pages (NFR-ACC-001, SC-008, AC-UX1–UX4)
- [ ] T238 Create `.github/workflows/deploy.yml` — preview deployment per PR (Vercel), staging on merge to main (Supabase staging project), production behind a manual approval gate; gated `supabase db push` with migration dry-run diff; smoke tests after each deploy; documented and drilled rollback (revert deploy + down-migration policy) (Constitution XXI)
- [ ] T239 Production operations — external uptime monitor on `/api/v1/health`, Vercel log drains to a retained store with access control, Sentry alert routing (error-rate spikes, `dms.job_health_failure`, DEAD job count, scanner ERROR rate), on-call/escalation notes in `docs/DEPLOYMENT.md` (SC-010, NFR-OBS-002)
- [ ] T240 Encryption key rotation — `scripts/rotate-encryption-key.ts` (re-encrypt all `ENCRYPTED` columns and `ai_draft_versions.content` from `ENCRYPTION_KEY_PREVIOUS` to the active key in batches with progress and audit), dual-read window procedure, `ACCESS_COOKIE_KEY` rotation (invalidates access sessions), runbook in `docs/SECURITY.md` (Constitution IV)
- [ ] T241 Create `tests/e2e/*.spec.ts` (Playwright, Clerk testing tokens) — critical journeys: registration → onboarding; will → finalize (with acknowledgment); beneficiary → assign → token → `/access` exchange → download; upload → scan → share; DMS lifecycle with test clock; emergency access lifecycle; AI assistant; AI will → confirm → export; plus `tests/integration/authorization-matrix.test.ts` (role × resource × operation at service and RLS layers, token/cookie scopes, admin routes 403 for users) (Constitution XVII, Phase 12)
- [ ] T243 Create `docs/BUSINESS_RULES.md` — allocation rules (per resource), beneficiary lifecycle and removal cascade, finalization minimum + acknowledgment, DMS state machine and release scope, emergency-access verification/timeout rules, access-token/cookie rules, retention policy (Constitution XVIII)
- [ ] T245 Implement the retention/purge policy from data-model.md § Retention in housekeeping (T199) — `ai_drafts` REJECTED/SUPERSEDED purge (90 d), soft-deleted domain rows (30 d), access tokens (90 d after expiry), notifications (180 d), `ai_interactions` (12 months), `processed_webhook_events` (30 d); each purge audited in aggregate; audit-log retention remains an owner/legal decision

**Checkpoint**: All features polished, security reviewed, backups/DR documented, monitoring and CD in place, platform prerequisites verified, documentation complete, validation scenarios and test suites passing.

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies — can start immediately (scaffold exists)
- **Foundational (Phase 2)**: Depends on Setup incl. the T210 prerequisite verification (cron frequency, `maxDuration`, storage limits, PITR) — BLOCKS all user stories (schema T018, privileges/RLS T218, functions T019, pipeline T030, auth helpers T036, audit, storage, jobs T197, notifications T155, Clerk webhook T198, test suites T212–T217, CI gate T246)
- **US1 Registration (Phase 3)**: Depends on Foundational
- **US16 Login/MFA (Phase 4)**: Depends on US1
- **US2 Legacy Plan (Phase 5)**: Depends on US1; step 3 (T221) depends on US3, steps 4–6 (T222) on US4–6, step 9 (T223) and the plan-attachment handlers in T059 on US7/T227 — build steps 1, 2, 7, 8, 10, 11 and the core handlers first, embed 3–6 and 9 as those modules land
- **US3 Beneficiaries (Phase 6)**: Depends on US1
- **US17 Account Recovery (Phase 7)**: Depends on US16
- **US4 Financial Assets (Phase 8)**: Depends on US1 + T201; attachments panel depends on T227 (US7)
- **US5 / US6 (Phases 9–10)**: Depend on US4
- **US7 Document Vault (Phase 11)**: Depends on US1, storage (T029), jobs (T197), scanner (T181/T247)
- **US18 Assignments & Access (Phase 12)**: Depends on US3 + US4–6 + US7
- **US20 Final Review (Phase 13)**: Depends on US2 + US3 + US4–6 + US18
- **US8 AI Assistant (Phase 14)**: Depends on US1; T233 depends on T018/T019
- **US14 Security Center (Phase 15)**: Depends on US1 + US16
- **US9 AI Will Gen (Phase 16)**: Depends on US2 + US8 (T233)
- **US10 DMS Config (Phase 17)**: Depends on US3 + US7
- **US19 DMS Check-ins (Phase 18)**: Depends on US10 + jobs + notifications (T155, Phase 2) + access exchange (T230) + the `access.deliver` handler (T097)
- **US11 Emergency Access (Phase 19)**: Depends on US3 + US7 + housekeeping (T199) + access exchange (T230) + the `access.deliver` handler (T097)
- **US12 Video Legacy (Phase 20)**: Depends on US3, storage policies (T218), jobs, scanner (T247)
- **US13 AI Doc Analysis (Phase 21)**: Depends on US7 + US8 (T233) + jobs
- **US15 Admin (Phase 22)**: Depends on US1 (+ Clerk Backend API usage from US14)
- **Notifications (Phase 23)**: endpoints/UI depend on Phase 2 (T155); event wiring depends on the features it wires
- **Audit Access (Phase 24)**: Depends on Phase 2
- **Polish (Phase 25)**: Depends on all user stories

### User Story Dependencies

```
US1 (Registration/Onboarding) ──┬── US16 (Login/MFA/Idle timeout) ── US17 (Recovery)
                                ├── US2 (Legacy Plan) ──── US20 (Final Review)
                                ├── US3 (Beneficiaries) ─┬── US18 (Assignments + /access exchange)
                                │                        ├── US10 (DMS Config) ── US19 (DMS Check-ins)
                                │                        └── US11 (Emergency Access)
                                ├── US4 (Financial) ─┬── US5 (Physical)
                                │                    └── US6 (Digital)
                                ├── US7 (Document Vault + attachments + scanner) ─┬── US13 (AI Doc Analysis)
                                │                                                 └── US12 (Video Legacy)
                                ├── US8 (AI Assistant + drafts) ─── US9 (AI Will Gen)
                                ├── US14 (Security Center)
                                └── US15 (Admin)
```

### Parallel Opportunities

- **Phase 1**: T003, T005–T016, T192–T196, T202, T210 (all parallel after T001–T002)
- **Phase 2**: T020–T029, T032, T036, T155, T181, T219 (parallel after T018/T218/T019); T197–T199 after T028/T030; T212–T217 after T019; T242 after T019; T246 after T015/T016
- **Phase 3**: T034, T035, T039, T040, T041, T045, T049, T050 in parallel
- **After Phase 3**: US4–US6 ∥ US7 ∥ US8 ∥ US14

---

## Implementation Strategy

### MVP First (Phases 1–3 Only)

1. Complete Phase 1: Setup (scaffold normalization + platform checklists)
2. Complete Phase 2: Foundational (CRITICAL — blocks all; includes the write-protection model and its tests)
3. Complete Phase 3: User Story 1 (Clerk registration → onboarding → dashboard)
4. **STOP and VALIDATE**: sign up → verify → sign in → onboarding → dashboard; audit rows present; RLS + write-protection + pipeline suites green
5. Deploy a Vercel preview — this is the minimum viable slice

### Incremental Delivery

1. Setup + Foundational → foundation ready
2. US1 → **MVP deployed**
3. US16 + US2 (steps 1, 2, 7–11) + US3 → core value delivered
4. US4–6 + US7 (with attachments and production scanner) → asset management layer; embed wizard steps 3–7
5. US18 (assignments + `/access` exchange) + US20 → cross-entity integration
6. US8 (with draft persistence) + US14 → intelligence + security layer
7. US9–US13 → advanced features (jobs proven under DMS/EA/video/AI load)
8. US15 + Notifications + Polish/Operations → production-ready

### Parallel Team Strategy

1. Team completes Setup + Foundational together
2. Once Foundational is done:
   - Developer A: US1 → US16 → US14 → US15
   - Developer B: US2 → US20 → US9
   - Developer C: US3 → US4–6 → US18
   - Developer D: US7 → US12 → US13
   - Developer E: US8 → US10 → US19 → US11
3. Stories integrate independently

---

## Removed Tasks (2026-09-18 re-baseline)

Task IDs retired because their purpose no longer exists under ADR-001…016.
IDs are **not** reused. Requirement coverage moved as indicated.

| ID | Original purpose | Superseded by |
|----|------------------|---------------|
| T004 | Initialize Express.js project in `backend/` | ADR-001 — single Next.js app; T001/T002 |
| T031 | `backend/src/routes/v1/index.ts` router aggregator | File-based Route Handlers (`app/api/v1/**`) |
| T037 | Express auth controller (register/login/logout/verify/forgot/reset) | Clerk (T040, T041, T195) |
| T038 | Express auth routes with rate limiters | Clerk attack protection (T195) + `withApi` rate limits (T025) |
| T042 | Custom verify-email page | Clerk `<SignUp/>` verification step (T041, T195) |
| T043 | Custom forgot-password page | Clerk `<SignIn/>` forgot-password flow (T040, T195, T204) |
| T044 | Custom reset-password page | Clerk flow (T195, T204) |
| T052 | speakeasy MFA service | Clerk MFA (T056, T195) |
| T053 | MFA endpoints + `/re-authenticate` | Clerk MFA + reverification (T056, T201) |
| T054 | Two-step login with `mfaSessionToken` | Clerk second-factor flow |
| T055 | Custom MFA step component | Clerk `<SignIn/>` |
| T060 | `legacy-plans.routes.ts` | Route Handlers (T059) |
| T074 | `beneficiaries.routes.ts` | Route Handlers (T073) |
| T077 | Custom password-reset service methods | Clerk (T204) |
| T078 | Custom backup-code consumption | Clerk backup codes (T204) |
| T082 | `assets.routes.ts` | Route Handlers (T081) |
| T092 | Multer upload middleware | Direct-to-storage upload flow (T090, T205, T096) |
| T094 | `documents.routes.ts` | Route Handlers (T093) |
| T111 | `ai.routes.ts` | Route Handlers (T110) |
| T116 | `security.routes.ts` | Route Handlers (T115) |
| T126 | `dead-man-switch.routes.ts` | Route Handlers (T125, T130) |
| T132 | BullMQ queue configuration (Redis) | Postgres job table + Vercel Cron (T197, T193) — ADR-006 |
| T139 | `emergency-access.routes.ts` | Route Handlers (T138) |
| T143 | `video-legacy.routes.ts` + 500 MB Multer limit | Route Handlers (T142) + resumable direct upload (T141) |
| T150 | `admin.routes.ts` | Route Handlers (T149) |
| T157 | `notifications.routes.ts` | Route Handlers (T156) |
| T162 | `audit-logs.routes.ts` | Route Handlers (T161) |
| T190 | `user-data.routes.ts` | Route Handlers (T189) |

---

## Notes

- **Total active tasks: 219** — original IDs T001–T191 minus 28 removed (listed above), plus 21 added in r1 (T192–T212) and 35 added in r2 (T213–T247)
- Tasks T181–T191 were added on 2026-09-16 to resolve findings from `/speckit-analyze`; T192–T212 on 2026-09-18 r1 for the architecture re-baseline; T213–T247 on 2026-09-18 r2 for the post-analysis remediation (constitution XVII test coverage, write-protection model, unified access tokens, malware scanning, AI drafts, wizard completeness, documentation and operations)
- Moved in r2 without renumbering: T036 and T155 (Phase 3/23 → Phase 2); T084 rephrased (apply the gate defined in T201)
- `[P]` tasks = different files, no dependencies
- `[Story]` label maps task to specific user story for traceability
- Each user story should be independently completable and testable
- Commit after each task or logical group
- Stop at any checkpoint to validate story independently
- **Automated tests are mandatory** (constitution XVII): T212–T217 (foundation), T225, T226, T228, T229, T232, T235, T236, T241; the CI gate T246 blocks merges on failing security-tagged suites (NFR-SEC-003)
- FR-L010 (AI voice input) is SHOULD-level and deferred to the post-baseline roadmap; in-browser video recording is deferred (Clarifications 2026-09-18)
- SC-001 and SC-002 are UX validation metrics — verified via usability testing, not implementation tasks
- **Nothing in this file is implemented yet.** The only application code in the repository is the Next.js scaffold and a temporary Supabase connectivity probe (see `docs/PROJECT_STATUS.md`)
