# Project Status — LegacyVault AI

**Snapshot date**: 2026-09-24
**Phase**: 3 — **Code complete for the whole non-AI product**, including the operator console. Every domain is backed by the real API, the real database and real storage; the demo layer has been deleted. AI is deliberately deferred. Nothing is production-*deployed*: T195/T196/T210 and the Sentry/Resend/ClamAV accounts remain unconfigured and unverified.
**Constitution**: v2.0.1 (amended 2026-09-18) · **Architecture**: ADR-001 … ADR-016 (ADR-004 r4, ADR-014 r4) · **Git checkpoint**: `4cac2d3`

> This file records what is *actually true* about the repository right now.
> It complements `docs/BRAIN.md` (context) and `docs/ARCHITECTURE_DECISIONS.md`
> (decisions). Update it at every phase checkpoint (task T180).

---

## 1. One-line summary

LegacyVault AI is a working product: one Next.js application with Clerk for
identity, Supabase PostgreSQL + private Storage for data and files, a Postgres
job table driven by Vercel Cron for everything time-based, and Resend for mail.
Legacy plans, beneficiaries, assets, documents, videos, the Dead Man's Switch,
emergency access, notifications and the beneficiary access portal are all
persisted through the versioned API, the service layer, guarded SQL functions
and RLS. **The demo workspace is gone** — `lib/demo/` no longer exists. The AI
assistant is deliberately deferred: no provider is connected, and the panel
says so and answers from the caller's own data with local rules. See § 2.

---

## 2. What exists

| Area | State | Evidence |
|------|-------|----------|
| Governance | ✅ Constitution v2.0.1; ADR log (016 records); project brain | `.specify/memory/constitution.md`, `docs/ARCHITECTURE_DECISIONS.md`, `docs/BRAIN.md` |
| Specification | ✅ Complete and consistent with the ADRs; `/speckit-analyze` findings remediated 2026-09-18 r2 (write-protection model, unified access tokens, attachments, AI drafts, webhook idempotency, clarifications session 2026-09-18); targeted remediation r3 (H1-A, M1–M4, N1) and post-gate r4 (S1 sensitive-field boundary, C1 delivery policy) applied | `specs/001-baseline-product-spec/{spec,research,plan,tasks,data-model,quickstart}.md`, `contracts/api-contracts.md` |
| Task list | ✅ 219 active tasks, **0 complete**; 28 retired IDs listed; r1 added T192–T212, r2 added T213–T247 (incl. the constitution-XVII test suites); r4 moved T210 to Phase 1 (IDs unchanged) | `tasks.md` |
| Documentation layer | ✅ Organized explainer docs (documentation only — no code): index + architecture, development, product, security, database, integrations, monitoring, ui, workflows; each defers to its canonical Spec Kit source | `docs/README.md`, `docs/**` |
| Next.js application (Phase 1) | ✅ Scaffold normalized (T002): LegacyVault landing page, root layout with theme handling + Clerk-ready provider tree (T017), dark-first Tailwind v4 design tokens + glass/gradient/motion utilities (T010/T011), shadcn/ui core components (T012), typed API client + TanStack Query provider (T013/T014), `proxy.ts` protected-first with CSP nonce (T192), `vercel.json` crons (T193). No feature pages, no Route Handlers. | `app/`, `components/`, `styles/`, `lib/api/`, `lib/config/`, `proxy.ts`, `vercel.json` |
| Supabase wiring | 🔧 Packages installed; scaffold-era clients remain until T028; **temporary connectivity probe removed 2026-09-19** (`public.connection_test` confirmed absent via PostgREST `PGRST205`) | `package.json` (`@supabase/ssr`, `@supabase/supabase-js`), `lib/supabase/{client,server}.ts` (no importers) |
| Environment | 🔧 Zod env schema (`lib/config/env.schema.ts`, T007; production refuses `MALWARE_SCANNER_PROVIDER=noop`), `.env.example` (T008), `pnpm env:check`; `.env.local` still holds only the two Supabase public values (gitignored; never recorded) — `pnpm env:check` fails until the owner fills it | `lib/config/`, `.env.example` |
| Agent skills | ✅ 70 skills in `.agents/skills` (+ speckit backup) | `.agents/`, `.agents-backup/` |
| Clerk | 🔧 `@clerk/nextjs` installed; proxy/layout activate when keys exist; **dashboard checklist ⏳ pending manual verification** (`docs/DEPLOYMENT.md` § 5, T195) | `proxy.ts`, `app/layout.tsx` |
| Database schema / RLS / functions | ✅ **Migrations 0001–0003 applied on the local stack** (2026-09-19): 28 tables / 32 enums (T018); privilege baseline, RLS on all 28 tables (36 policies + 1 storage policy), column allow-lists, `protect_identity_columns`, append-only `audit_log`, `audit_class_a_change()` on 8 Class A tables (T218); 32 guarded + 11 system + 18 internal functions incl. `create_asset`, `set_encrypted_fields`, `delete_asset`, `resend_access_token`, `system_reissue_access_token`, DMS/EA transitions with outbox `access.deliver` jobs (T019). `lib/types/database.ts` generated. Verified by a 26-section security smoke script (rolled back) and an end-to-end PostgREST check with Clerk-shaped HS256 JWTs. Hosted projects: not yet pushed (T196/T238). | `supabase/migrations/`, `lib/types/database.ts` |
| Application UI | ✅ Public site, Clerk auth pages, the authenticated shell and every product page — **all backed by the real API**. Legacy-plan wizard with autosave, versions and finalization; beneficiaries with assignments, roles and access links; three asset classes with encrypted fields revealed only after re-verification; document vault with folders, upload, sharing and signed downloads; video legacy with delivery conditions; Dead Man's Switch with a release-scope picker; emergency access with contacts, decisions and resends; notifications; Security Center; settings with data export and account deletion. Public recipient pages: `/access` and the emergency request/verify flow. | `app/`, `components/`, `hooks/` |
| API `/api/v1` | ✅ **Complete for every shipped domain** — `withApi()` pipeline (correlation id → `no-store` → auth → CSRF → step-up verification → rate limit → Zod → handler → envelope → safe errors + DENIED/FAILURE audit) across users, legacy plans, beneficiaries, assignments, access tokens, the three asset classes, documents, folders, uploads, videos, the Dead Man's Switch, emergency access (owner **and** public), notifications, activity, the beneficiary access portal, internal cron and the Clerk webhook. Business logic in `lib/services`, data access in `lib/repositories`. | `app/api/v1/**`, `lib/api/**` |
| Auth → database identity | ✅ Clerk session → `public.users` via `ensureAppUser()` (T036) with the webhook (T198) as the primary sync path; `requireUser()` / `requireRole()` read the role from the database. Clerk issues `role: authenticated`; Supabase registers Clerk as a third-party issuer, so RLS applies to real sessions (verified end to end). | `lib/auth/**`, `app/api/webhooks/clerk` |
| Platform services | ✅ Two Supabase clients with documented call sites (T028), AES-256-GCM field encryption (T020), Postgres rate limiter (T025), append-only audit service (T027), pino logging with redaction (T022), security headers (T024), health probes | `lib/db/`, `lib/security/`, `lib/audit/`, `lib/observability/` |
| Jobs / cron / webhooks | ✅ `jobs` table + `claim_jobs()` runner with back-off and dead-lettering; handlers `access.deliver`, `notification.deliver`, `storage.remove-object`, `dms.scan`, `housekeeping`; Vercel Cron at `/api/internal/cron/{run-jobs,dms-scan,housekeeping}` behind `CRON_SECRET`; Clerk webhook (Svix) | `lib/jobs/**`, `app/api/internal/cron/**`, `vercel.json` |
| Storage buckets / policies | ✅ Three **private** buckets (`quarantine`, `documents`, `videos`, migration `0004`); no storage policy for `authenticated` — every read and write is a short-lived signed URL minted server-side; quarantine → size/magic-byte/scan → `promote_upload()` move | `supabase/migrations/0004_storage_buckets.sql`, `lib/storage/`, `lib/services/upload.service.ts` |
| Email | ✅ Resend + React Email templates (access link, DMS reminder, notification, emergency code, emergency designation) with provider-level idempotency keys; mail never contains vault contents and never blocks a state change | `lib/email/**` |
| Beneficiary access portal | ✅ `/access?t=…` exchanges the token for an encrypted `httpOnly; SameSite=Strict` cookie scoped to `/api/v1/access`; read-only resource, document-download, asset, video and plan-section endpoints re-check revocation, expiry, beneficiary status and delivery condition on every request; public emergency request/verify flow with hashed one-time codes | `app/(public)/**`, `app/api/v1/access/**`, `lib/services/access-portal.service.ts` |
| AI | ⏸️ **Deliberately deferred.** No provider is connected. The assistant panel is labelled "Not AI · local rules, no provider connected" and answers from the caller's real data; nothing it produces is written to an authoritative record | `lib/ai/preview-assistant.ts` |
| Operator console | ✅ **Built** (FR-P001–P012): `/admin` behind a server-side role check that answers 404 to everyone else; account search and detail (counts, protection state and audit shape — never vault contents), role assignment with self-change and last-operator refusals, Clerk unlock and MFA reset, platform analytics, the filtered platform audit trail, dead-lettered jobs and undelivered-link resend. Every action is audited with the operator as the actor, and other people's audit metadata is redacted to its structural keys before it is shown. | `app/(dashboard)/admin/`, `app/api/v1/admin/**`, `lib/services/admin.service.ts`, `lib/admin/audit-redaction.ts` |
| Sentry / logging | ✅ pino JSON logs with redaction and correlation ids; `instrumentation.ts` / `instrumentation-client.ts` initialise Sentry when a DSN is set and stay inert otherwise, with URLs, query strings and cookies stripped from every event; root `global-error` and `not-found` boundaries. **No Sentry project has been connected or verified from here.** | `lib/observability/`, `instrumentation*.ts`, `app/global-error.tsx` |
| First run and account settings | ✅ `/onboarding` gates the dashboard until it is completed and is the only caller of `POST /users/me/onboarding/complete`; the idle sign-out chosen in Settings is enforced in the browser (FR-A008); notification preferences are honoured by the delivery job; new-device sign-ins are detected in the queue and notified (FR-A016) | `app/(onboarding)/`, `hooks/use-idle-timeout.ts`, `lib/notifications/preferences.ts`, `lib/jobs/handlers/security-new-device.ts` |
| Tests / CI | ✅ Vitest (unit + integration) and Playwright (Chromium) with a Clerk-aware global setup. **151 unit + 93 integration (against the live local PostgreSQL stack) + 8 E2E all pass**, alongside `pnpm lint`, `tsc --noEmit`, `prettier --check` and `next build`. GitHub Actions runs all of it on every push and pull request (T016/T246); the E2E job prints a notice instead of a false green when Clerk keys are absent. | `vitest.config.mts`, `playwright.config.ts`, `tests/`, `.github/workflows/ci.yml` |
| Deployment | ⏳ **Not deployed.** The repository is deployment-ready — migrations, buckets, crons, env schema and the CI pipeline are all in place — but no hosted Clerk, Supabase, Resend, Sentry or ClamAV account has been configured or verified from here. | `docs/DEPLOYMENT.md` § 7, § 8 |

---

## 3. Git state

- Branch: `master` (environment reports the intended main branch as `main` —
  owner decision pending; the plan expects a `001-baseline-product-spec`
  feature branch for implementation).
- Commits: 2 — `fd11acc chore: initialize LegacyVault AI specification`
  (2026-09-16: `.specify/`, `specs/`, root `BRAIN.md`, `.gitignore`) and
  **`4cac2d3 chore: establish LegacyVault AI baseline`** (2026-09-18 20:16
  +05:30; 54 files changed; 73 tracked files: constitution v2.0.1, ADR-001…016,
  Spec Kit artifacts through r3, the `docs/` layer, the Next.js scaffold and
  configs, `README.md`, `AGENTS.md`, `CLAUDE.md`). `.agents/`,
  `.agents-backup/` and `.env.local` are ignored and not tracked.
- Working tree at the checkpoint: **clean** (final read-only gate ran against
  `4cac2d3`). The r4 remediation described in § 7 was committed as
  **`affa27f docs(spec): complete r4 post-gate remediation`**. The probe
  cleanup of 2026-09-19 (§ 7) is the only uncommitted change at the time of
  writing.

### ⚠️ Repository hygiene items (tracked as T009)

1. `create-next-app` overwrote `.gitignore` on 2026-09-17; on 2026-09-18
   (00:32) it was restored to the tracked version plus `node_modules/` and
   `.next/`. As of 01:10 the file ignores `.agents/`, `.agents-backup/`,
   `.env`, `.env.*`, `!.env.example`, `node_modules/`, `.next/` — verified
   with `git check-ignore`. **Still missing** the Next.js/tooling entries
   (`next-env.d.ts`, `*.tsbuildinfo`, `coverage/`, `/out/`, `.vercel`,
   `*.pem`, `*.log`). `next-env.d.ts` is **tracked** since `4cac2d3`; T009
   completes the file and must also `git rm --cached next-env.d.ts`.
2. `.env.local` **is** ignored (`.env.*` rule) — verified. It must never be
   committed; its values are not copied into any document.

---

## 4. Architecture at a glance (decided, not built)

| Concern | Baseline decision | ADR |
|---------|-------------------|-----|
| App | Next.js 16 + TS, App Router, Route Handlers for `/api/v1`, services layer | 001 |
| Auth | Clerk only (sessions, MFA, lockout, reverification, webhooks) | 003 |
| Authorization | Service-layer checks + RLS keyed on Clerk subject | 004 |
| Database | PostgreSQL on Supabase; SQL migrations; no ORM; transactional SQL functions | 002 |
| Storage | Supabase Storage private buckets; quarantine → validate/scan → promote; signed URLs; 50 MB / 500 MB | 005 |
| Jobs | Postgres `jobs` table + Vercel Cron (+ `pg_cron` redundancy); no Redis/BullMQ | 006 |
| Rate limiting | Clerk + Vercel WAF + Postgres limiter | 007 |
| AI | OpenAI + Gemini behind `AIProvider`; structured outputs; confirmation gates | 008 |
| Email | Abstraction; Resend + React Email | 009 |
| Monitoring | Sentry, pino JSON logs + correlation ids, health checks | 010 |
| Deployment | Vercel + Supabase + Clerk; GitHub Actions; gated migrations; backups + PITR | 011 |
| Deferred | App-layer envelope encryption of file bodies | 013 |
| Write protection | Privilege baseline + column allow-lists + guarded `SECURITY DEFINER` functions | 004 r2 |
| External access | Beneficiary = every recipient; one `access_tokens` entity; token exchanged once for an httpOnly cookie | 014 |
| Malware scanning | ClamAV in production; `noop` refused at start-up | 015 |
| AI drafts | `ai_drafts` + encrypted versions; sanitized `ai_interactions` | 016 |

---

## 5. Open items requiring an owner decision or verification

| # | Item | Why it matters | Where tracked |
|---|------|----------------|---------------|
| 1 | Default branch (`master` vs `main`) and creating the feature branch | CI/deploy configuration; plan references | this file |
| 2 | Vercel plan tier | Minute-level cron and `maxDuration` are required for the job runner / DMS scan (ADR-006) | T210 (Phase 1 since r4), T202 |
| 3 | Supabase plan tier | ≥ 500 MB file-size limit (videos) and PITR (production) | T196, T210 (Phase 1 since r4) |
| 4 | Clerk event coverage for FR-A014 (failed sign-in attempts) | Determines whether a custom sign-in capture endpoint is needed | T203 |
| 5 | Clerk/Supabase/Resend/Sentry accounts and dev instances | Blocks Phase 0 completion | T195, T196, T202 |
| 6 | `ADMIN_EMAIL` for the first Super Admin | Seed script | T033 |
| 7 | **ClamAV hosting** (container platform such as Fly.io/Render/Railway, or a VM in the Supabase region) | Production malware scanning is mandatory (FR-H016); the app refuses to start in production without it | ADR-015, T247, T210 |
| 8 | **Audit-log retention schedule** (legal/compliance) | Baseline keeps audit rows indefinitely; a formal schedule needs a legal decision | data-model § Retention, T245 |
| 9 | Clerk plan features (inactivity timeout, session-token customization, reverification) | FR-A008 / FR-A018 depend on them | T195, T210 |

---

## 6. Next steps (in order)

1. **Hosted accounts (T195/T196/T210).** Clerk production instance, Supabase
   project with the four migrations applied and the three private buckets
   created, Resend domain, Sentry DSN, and a Vercel plan whose cron schedule
   supports the five-minute job runner.
2. **ClamAV (T247).** `MALWARE_SCANNER_PROVIDER=noop` is refused in production
   by design, so a scanner host is a hard prerequisite for going live.
3. **AI (ADR-008, ADR-016).** The assistant, will generator and document
   analysis, behind the provider abstraction and the confirmation gates.
4. **Admin console (`/admin/*`).** User search, role changes, unlock, MFA
   reset, analytics and the dead-letter resend path.
5. **CI (T016).** Run lint, typecheck, unit, integration and E2E on every
   push; gate migrations on review.

---

## 7. Change log for this file

| Date | Change |
|------|--------|
| 2026-09-18 | Created. Architecture drift resolved (ADR-001…013, constitution 2.0.0); spec artifacts re-baselined; no implementation. |
| 2026-09-18 | Final document-only consistency cleanup: constitution 2.0.1 (Principle IX wording), research renumbered 1–17 in ADR order, duplicate upload row merged in API contracts, 2025→2026 metadata dates in spec/checklist, checklist path fixed. Still no implementation. |
| 2026-09-18 r2 | `/speckit-analyze` remediation: ADR-004 r2 (write-protection model), ADR-014 (unified access tokens + cookie exchange), ADR-015 (ClamAV), ADR-016 (AI drafts); data-model r2 (29 entities, function catalog, retention); API contracts r2; spec Clarifications session 2026-09-18 (8 entries); plan r2; tasks r2 (T213–T247, T036/T155 moved to Phase 2); research Decisions 18–20; quickstart scenarios 4.1/5.1/7.1/7.2/12.3. Still no implementation. |
| 2026-09-18 (docs pass) | Documentation organization pass: `docs/README.md` index and topic explainers created; BRAIN § 11 and this file updated minimally; no Spec Kit artifact, ADR, constitution text or application file changed. Still no implementation. |
| 2026-09-18 r3 | Targeted remediation of the final-analysis findings H1-A (session-scoped client-held assistant history, `GET /ai/assistant/interactions`), M1 (`webhook` auth mode, CSRF scope), M2 (`delete_asset()`), M3 (`dms.scan` job heartbeat), M4 (strict video delivery-condition mapping), N1 (DIRECT_SHARE scope ⊆ assignments); 219/0/28 tasks and 29 entities unchanged. Still no implementation. |
| 2026-09-18 | **Baseline committed as `4cac2d3`** (`chore: establish LegacyVault AI baseline`). Final read-only specification gate on the checkpoint: 0 BLOCKER, 0 HIGH, 4 MEDIUM (S1 direct-write boundary, C1 access-link delivery, T210 ordering, stale status docs), 10 LOW, 10 INFO. |
| 2026-09-18 r4 | Post-gate remediation (committed as `affa27f`): ADR-004 § 8 sensitive-field boundary + `audit_class_a_change()` triggers (`create_asset()`, `set_encrypted_fields()`); ADR-014 § 6 access-link delivery policy (`access.deliver`, reissue-on-retry, `resend_access_token()`, audited owner/admin resend); T210 moved to Phase 1; `webhook` added to auth-mode enumerations; VideoMessage class A + B/C; 28-table wording; spec status; ADR r3/r4 revision notes; quickstart health example; documentation paths (T175/T178/T234, plan Documentation Plan); this file, BRAIN and CHANGELOG refreshed for `4cac2d3`. Still no implementation. |
| 2026-09-19 | **Probe cleanup** (committed as `e87cb9a`): deleted the temporary connectivity probe `app/api/db-test/route.ts` (and the now-empty `app/api/`); `public.connection_test` confirmed absent (PostgREST `PGRST205`), nothing to drop. `lib/supabase/{client,server}.ts` and `@supabase/ssr` deliberately left for T028 per T002. No task marked complete; no feature implemented. |
| 2026-09-19 | **Phase 1 setup batch** (uncommitted): T001 skeleton, T002 scaffold normalized (landing page, metadata), T003/T005 dependencies (see CHANGELOG), T006 scripts/Prettier/ESLint, T007 env schema, T008 `.env.example`, T009 `.gitignore` (+ `next-env.d.ts` un-tracked), T010/T011 design foundation, T012 shadcn/ui (sonner replaces the deprecated toast), T013/T014 API + query clients, T015 Vitest/Playwright + helpers + smoke tests, T017 root layout, T192 `proxy.ts`, T193 `vercel.json`, T194 Supabase CLI init + `db:*` scripts, T202 `docs/DEPLOYMENT.md`. T195/T196/T210 documented with ⏳ pending manual verification — no external dashboard was configured. Checks: typecheck, lint, format, unit, integration, E2E, production build all pass. |
| 2026-09-19 | **Website batch** (`feat: build LegacyVault AI application experience`): complete public site and authenticated application UI on a labelled demo workspace; `three` + `@react-three/fiber` added for the procedural hero (lazy, WebGL/reduced-motion fallbacks); 9 shadcn primitives added (label, textarea, select, switch, checkbox, separator, alert, radio-group, scroll-area); `viz-1..3` categorical chart tokens validated for CVD; landing page moved to `app/(marketing)/page.tsx`; next-themes now receives the CSP nonce. 14 pure-UI tasks marked complete (T040/T041/T045/T047/T049/T050/T062/T063/T164–T169); page tasks with API wiring stay open. Remaining blockers for a live demo: Clerk keys (T195) and, for real persistence, T028/T030/T036 + services. |
| 2026-09-19 | **Phase 2 database foundation** (T018 `0001_init.sql`, T218 `0002_rls_and_privileges.sql`, T019 `0003_functions.sql`): schema, RLS/privileges, guarded + system functions applied with `supabase start` (Docker Desktop started for it); `pnpm db:types` regenerated `lib/types/database.ts`; smoke-tested live (RLS isolation, column grants on encrypted columns, asset creation function-only, `delete_asset` atomic, DIRECT_SHARE scope ⊆ assignments, live-token uniqueness, reissue-on-retry, DMS release outbox jobs, EA lifecycle, append-only audit). No application service code, T020+ not started. |
| 2026-09-24 | **Real platform batch** (`feat: complete real legacyvault platform`): documents + private storage, the lean Dead Man's Switch with the job queue, emergency access (owner and public), access delivery and the beneficiary portal, video legacy, notifications and email; the demo layer deleted in full; data export and account deletion; the step-up re-authentication gate; release/emergency scope pickers; cron routes moved to the contracted `/api/internal/cron/*` paths and a daily `housekeeping` sweep added. AI remains deliberately deferred. |
| 2026-09-24 | **Non-AI completion pass** (`chore: complete non-ai production readiness`): the operator console (FR-P001–P012) with audit-metadata redaction; first-run onboarding; idle sign-out enforcement; notification preferences honoured; new-device detection; the email delivery webhook; Sentry wiring plus root error and not-found boundaries; `maxDuration` on the long-running handlers; the CI workflow; `docs/database/DATABASE_SCHEMA.md`. Four defects found by the audit were fixed — see the change log entry in the repository history. AI remains deliberately deferred. |
