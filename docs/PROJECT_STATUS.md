# Project Status — LegacyVault AI

**Snapshot date**: 2026-09-30
**Phase**: 3 — **Code complete, including AI** (awaiting provider keys). Every domain is backed by the real API, the real database and real storage. See the 2026-09-30 change-log entry. Nothing is production-*deployed*: T195/T196/T210 and the Sentry/Resend accounts remain unconfigured and unverified. Malware scanning was removed on 2026-10-04 (ADR-017).
**Constitution**: v3.0.0 (amended 2026-10-04) · **Architecture**: ADR-001 … ADR-017 (ADR-004 r4, ADR-014 r4) · **Git checkpoint**: `4cac2d3`

> This file records what is *actually true* about the repository right now.
> It complements `docs/BRAIN.md` (context) and `docs/ARCHITECTURE_DECISIONS.md`
> (decisions). Update it at every phase checkpoint (task T180).

---

## 1. One-line summary

LegacyVault AI is a working product: one Next.js application with Clerk for
identity, Supabase PostgreSQL + private Storage for data and files, a Postgres
job table driven by protected cron routes for everything time-based (called by `pg_cron` + `pg_net` from the database once migration 0010 is live; GitHub Actions today), and Brevo for mail (Resend fallback).
Legacy plans, beneficiaries, assets, documents, videos, the Dead Man's Switch,
emergency access, notifications and the beneficiary access portal are all
persisted through the versioned API, the service layer, guarded SQL functions
and RLS. **The demo workspace is gone** — `lib/demo/` no longer exists. AI runs
behind the provider interface and is **connected to Gemini in development**
(free-tier key, 20 requests/day); the assistant accepts document and photo
attachments through the vault's secure upload pipeline. Without a key every AI
surface reports "not configured" while the rest of the product works. See § 2.

---

## 2. What exists

| Area | State | Evidence |
|------|-------|----------|
| Governance | ✅ Constitution v3.0.0; ADR log (017 records); project brain | `.specify/memory/constitution.md`, `docs/ARCHITECTURE_DECISIONS.md`, `docs/BRAIN.md` |
| Specification | ✅ Complete and consistent with the ADRs; `/speckit-analyze` findings remediated 2026-09-18 r2 (write-protection model, unified access tokens, attachments, AI drafts, webhook idempotency, clarifications session 2026-09-18); targeted remediation r3 (H1-A, M1–M4, N1) and post-gate r4 (S1 sensitive-field boundary, C1 delivery policy) applied | `specs/001-baseline-product-spec/{spec,research,plan,tasks,data-model,quickstart}.md`, `contracts/api-contracts.md` |
| Task list | ✅ 219 active tasks, **0 complete**; 28 retired IDs listed; r1 added T192–T212, r2 added T213–T247 (incl. the constitution-XVII test suites); r4 moved T210 to Phase 1 (IDs unchanged) | `tasks.md` |
| Documentation layer | ✅ Organized explainer docs (documentation only — no code): index + architecture, development, product, security, database, integrations, monitoring, ui, workflows; each defers to its canonical Spec Kit source | `docs/README.md`, `docs/**` |
| Next.js application (Phase 1) | ✅ Scaffold normalized (T002): LegacyVault landing page, root layout with theme handling + Clerk-ready provider tree (T017), dark-first Tailwind v4 design tokens + glass/gradient/motion utilities (T010/T011), shadcn/ui core components (T012), typed API client + TanStack Query provider (T013/T014), `proxy.ts` protected-first with CSP nonce (T192), `vercel.json` crons (T193). No feature pages, no Route Handlers. | `app/`, `components/`, `styles/`, `lib/api/`, `lib/config/`, `proxy.ts`, `vercel.json` |
| Supabase wiring | 🔧 Packages installed; scaffold-era clients remain until T028; **temporary connectivity probe removed 2026-09-19** (`public.connection_test` confirmed absent via PostgREST `PGRST205`) | `package.json` (`@supabase/ssr`, `@supabase/supabase-js`), `lib/supabase/{client,server}.ts` (no importers) |
| Environment | 🔧 Zod env schema (`lib/config/env.schema.ts`, T007), `.env.example` (T008), `pnpm env:check`; `.env.local` still holds only the two Supabase public values (gitignored; never recorded) — `pnpm env:check` fails until the owner fills it | `lib/config/`, `.env.example` |
| Agent skills | ✅ 70 skills in `.agents/skills` (+ speckit backup) | `.agents/`, `.agents-backup/` |
| Clerk | 🔧 `@clerk/nextjs` installed; proxy/layout activate when keys exist; **dashboard checklist ⏳ pending manual verification** (`docs/DEPLOYMENT.md` § 5, T195) | `proxy.ts`, `app/layout.tsx` |
| Database schema / RLS / functions | ✅ **Migrations 0001–0003 applied on the local stack** (2026-09-19): 28 tables / 32 enums (T018); privilege baseline, RLS on all 28 tables (36 policies + 1 storage policy), column allow-lists, `protect_identity_columns`, append-only `audit_log`, `audit_class_a_change()` on 8 Class A tables (T218); 32 guarded + 11 system + 18 internal functions incl. `create_asset`, `set_encrypted_fields`, `delete_asset`, `resend_access_token`, `system_reissue_access_token`, DMS/EA transitions with outbox `access.deliver` jobs (T019). `lib/types/database.ts` generated. Verified by a 26-section security smoke script (rolled back) and an end-to-end PostgREST check with Clerk-shaped HS256 JWTs. Hosted projects: not yet pushed (T196/T238). | `supabase/migrations/`, `lib/types/database.ts` |
| Application UI | ✅ Public site, Clerk auth pages, the authenticated shell and every product page — **all backed by the real API**. Legacy-plan wizard with autosave, versions and finalization; beneficiaries with assignments, roles and access links; three asset classes with encrypted fields revealed only after re-verification; document vault with folders, upload, sharing and signed downloads; video legacy with delivery conditions; Dead Man's Switch with a release-scope picker; emergency access with contacts, decisions and resends; notifications; Security Center; settings with data export and account deletion. Public recipient pages: `/access` and the emergency request/verify flow. | `app/`, `components/`, `hooks/` |
| API `/api/v1` | ✅ **Complete for every shipped domain** — `withApi()` pipeline (correlation id → `no-store` → auth → CSRF → step-up verification → rate limit → Zod → handler → envelope → safe errors + DENIED/FAILURE audit) across users, legacy plans, beneficiaries, assignments, access tokens, the three asset classes, documents, folders, uploads, videos, the Dead Man's Switch, emergency access (owner **and** public), notifications, activity, the beneficiary access portal, internal cron and the Clerk webhook. Business logic in `lib/services`, data access in `lib/repositories`. | `app/api/v1/**`, `lib/api/**` |
| Auth → database identity | ✅ Clerk session → `public.users` via `ensureAppUser()` (T036) with the webhook (T198) as the primary sync path; `requireUser()` / `requireRole()` read the role from the database. Clerk issues `role: authenticated`; Supabase registers Clerk as a third-party issuer, so RLS applies to real sessions (verified end to end). | `lib/auth/**`, `app/api/webhooks/clerk` |
| Platform services | ✅ Two Supabase clients with documented call sites (T028), AES-256-GCM field encryption (T020), Postgres rate limiter (T025), append-only audit service (T027), pino logging with redaction (T022), security headers (T024), health probes | `lib/db/`, `lib/security/`, `lib/audit/`, `lib/observability/` |
| Jobs / cron / webhooks | ✅ `jobs` table + `claim_jobs()` runner with back-off and dead-lettering; handlers `access.deliver`, `notification.deliver`, `storage.remove-object`, `dms.scan`, `housekeeping`; Vercel Cron at `/api/internal/cron/{run-jobs,dms-scan,housekeeping}` behind `CRON_SECRET`; Clerk webhook (Svix) | `lib/jobs/**`, `app/api/internal/cron/**`, `vercel.json` |
| Storage buckets / policies | ✅ **Private** buckets `documents` and `videos` (migration `0004`; the retired `quarantine` bucket is kept, unused); no storage policy for `authenticated` — every read and write is a short-lived signed URL minted server-side; upload straight to the destination bucket → size/magic-byte check → `promote_upload()` (no malware scan, ADR-017, migration `0006`) | `supabase/migrations/0004_storage_buckets.sql`, `lib/storage/`, `lib/services/upload.service.ts` |
| Email | ✅ Brevo (verified sender for every email; Resend fallback) + React Email templates (access link, DMS reminder, notification, emergency code, emergency designation) with provider-level idempotency keys; mail never contains vault contents and never blocks a state change | `lib/email/**` |
| Beneficiary access portal | ✅ `/access#t=…` (secret in the fragment, never sent to a server; legacy `?t=` redirected) exchanges the token for an encrypted `httpOnly; SameSite=Strict` cookie scoped to `/api/v1/access`; read-only resource, document-download, asset, video and plan-section endpoints re-check revocation, expiry, beneficiary status and delivery condition on every request; public emergency request/verify flow with hashed one-time codes | `app/(public)/**`, `app/api/v1/access/**`, `lib/services/access-portal.service.ts` |
| AI | ✅ **Connected (development) to Gemini `gemini-3.8-flash`** and verified through the real assistant UI → API → provider path for text. Provider interface with a configurable fallback chain (ADR-008): Gemini primary; OpenRouter (`:free` models only unless explicitly allowed), Groq, Cerebras and Hugging Face through one OpenAI-compatible adapter, used **only** when named in `AI_PROVIDER_ORDER`; each request skips providers that cannot read its files or are not approved for vault documents (`AI_DOCUMENT_PROVIDERS`), and fails over only on outage, timeout or spent quota (per-minute vs daily read from each vendor's 429). Transient Gemini 503s are retried with bounded backoff; failures are logged as provider/model/duration/outcome + `upstream` status/reason/quota, never vendor text. Assistant **file attachments** (PDF, Word, Excel, PowerPoint, text, CSV, images) go through the vault's upload pipeline (quarantine → type check → ClamAV → private storage) and are re-checked through RLS before any model sees them. Document intelligence unchanged. **Live-verified (synthetic prompts, real route):** Gemini → Groq failover on Gemini's spent daily quota, and Hugging Face `openai/gpt-oss-120b:fastest` answering. **Not yet verified live:** attachment analysis through Gemini (free-tier quota of 20 requests/day spent; documents go only to approved providers) and OpenRouter/Cerebras (no keys). **The development Gemini key is free tier — Google's terms say not to send it sensitive or personal information.** Production needs a billing-enabled key (DEPLOYMENT.md § 7a). | `lib/ai/`, `lib/services/ai/`, `app/api/v1/ai/**`, `components/ai/` |
| Operator console | ✅ **Built** (FR-P001–P012): `/admin` behind a server-side role check that answers 404 to everyone else; account search and detail (counts, protection state and audit shape — never vault contents), role assignment with self-change and last-operator refusals, Clerk unlock and MFA reset, platform analytics, the filtered platform audit trail, dead-lettered jobs and undelivered-link resend. Every action is audited with the operator as the actor, and other people's audit metadata is redacted to its structural keys before it is shown. | `app/(dashboard)/admin/`, `app/api/v1/admin/**`, `lib/services/admin.service.ts`, `lib/admin/audit-redaction.ts` |
| Sentry / logging | ✅ pino JSON logs with redaction and correlation ids; `instrumentation.ts` / `instrumentation-client.ts` initialise Sentry when a DSN is set and stay inert otherwise, with URLs, query strings and cookies stripped from every event; root `global-error` and `not-found` boundaries. **No Sentry project has been connected or verified from here.** | `lib/observability/`, `instrumentation*.ts`, `app/global-error.tsx` |
| First run and account settings | ✅ `/onboarding` gates the dashboard until it is completed and is the only caller of `POST /users/me/onboarding/complete`; the idle sign-out chosen in Settings is enforced in the browser (FR-A008); notification preferences are honoured by the delivery job; new-device sign-ins are detected in the queue and notified (FR-A016). Settings → Security opens Clerk's account portal for two-factor and password (Clerk owns enrolment/verification); the UI shows Clerk's live MFA state and `POST /users/me/refresh` re-syncs the mirror the dashboard reads. **Enrolment requires the Clerk instance to have Multi-factor enabled** — currently off on the development instance (DEPLOYMENT.md § 5 row 4). | `app/(dashboard)/settings/_components/settings-view.tsx`, `app/api/v1/users/me/refresh/`, `hooks/use-idle-timeout.ts`, `lib/jobs/handlers/security-new-device.ts` |
| Tests / CI | 🔧 Vitest (unit, security, integration) and Playwright (Chromium) with a Clerk-aware global setup. As of 2026-10-02: **306 unit + 9 security + 129 integration** pass (live local PostgreSQL, Storage; ClamAV until 2026-10-04) — two pre-existing UI-render tests (dashboard, wizard autosave) exceed the 5 s default timeout on this machine and pass with a longer one; they fail identically on the untouched `d7d193c`. `pnpm lint`, `tsc --noEmit`, `prettier --check`, `next build` (65/65) and `pnpm audit` (no known vulnerabilities after Next.js 16.3.6) pass. **E2E: all 11 regression journeys pass**; the AI text journey passes live via Groq and via Hugging Face. 2026-10-04 (scanner removed): **304 unit + security and 136 integration** pass. | `vitest.config.mts`, `playwright.config.ts`, `tests/`, `.github/workflows/ci.yml` |
| Deployment | ✅ **Live, released 2026-10-16:** production is the Vercel project `legacyvault-ai-uh7s` running `3a02fcd` (deployment `dpl_2MdiqH72UVYTwjWJPWftjM9Jgw1v`, READY), with Supabase `zlgmthrdoxyfkldeaxyl` at migration **0014** and the shared Clerk development instance `needed-turkey-5633` (self-deletion off). Scheduler healthy (Vault cron secret in place, 200s). Free tier: no PITR, no Sentry DSN; the pre-release backup has no off-disk copy. | `docs/release-readiness-final.md` § 0, `docs/DEPLOYMENT.md` § 7d-2 |

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
| Storage | Supabase Storage private buckets; upload → validate → promote; signed URLs; 50 MB / 500 MB | 005, 017 |
| Jobs | Postgres `jobs` table + Vercel Cron (+ `pg_cron` redundancy); no Redis/BullMQ | 006 |
| Rate limiting | Clerk + Vercel WAF + Postgres limiter | 007 |
| AI | OpenAI + Gemini behind `AIProvider`; structured outputs; confirmation gates | 008 |
| Email | Abstraction; Brevo (Resend fallback) + React Email | 009 |
| Monitoring | Sentry, pino JSON logs + correlation ids, health checks | 010 |
| Deployment | Vercel + Supabase + Clerk; GitHub Actions; gated migrations; backups + PITR | 011 |
| Deferred | App-layer envelope encryption of file bodies | 013 |
| Write protection | Privilege baseline + column allow-lists + guarded `SECURITY DEFINER` functions | 004 r2 |
| External access | Beneficiary = every recipient; one `access_tokens` entity; token exchanged per visit for a 30-minute httpOnly cookie; reusable until expiry or revocation | 014 |
| Malware scanning | None — removed by owner decision (supersedes ADR-015) | 017 |
| AI drafts | `ai_drafts` + encrypted versions; sanitized `ai_interactions` | 016 |

---

## 5. Open items requiring an owner decision or verification

| # | Item | Why it matters | Where tracked |
|---|------|----------------|---------------|
| 1 | Default branch (`master` vs `main`) and creating the feature branch | CI/deploy configuration; plan references | this file |
| 2 | Vercel plan tier | Production runs on Hobby, which Vercel limits to non-commercial personal use — Pro is needed before a commercial launch. (Cron no longer depends on it: schedules run in the database, migration 0010.) | DEPLOYMENT.md § 7c, § 7e |
| 3 | Supabase plan tier | ≥ 500 MB file-size limit (videos) and PITR (production) | T196, T210 (Phase 1 since r4) |
| 4 | Clerk event coverage for FR-A014 (failed sign-in attempts) | Determines whether a custom sign-in capture endpoint is needed | T203 |
| 5 | Clerk **production** instance (production currently uses the development instance, `pk_test_`), Sentry project and region (no DSN in the production client bundle as of 2026-10-08) | Launch blockers | T195, T202 |
| 6 | `ADMIN_EMAIL` for the first Super Admin | Seed script | T033 |
| 7 | ~~ClamAV hosting~~ — closed 2026-10-04: malware scanning removed; FR-H016 / FR-Q011 not met by owner decision | — | ADR-017 |
| 8 | **Audit-log retention schedule** (legal/compliance) | Baseline keeps audit rows indefinitely; a formal schedule needs a legal decision | data-model § Retention, T245 |
| 9 | Clerk plan features (inactivity timeout, session-token customization, reverification) | FR-A008 / FR-A018 depend on them | T195, T210 |

---

## 6. Next steps (in order)

1. **Production rollout (2026-10-08 state).** Production is at migration 0009;
   0010 (database scheduler, emergency gate) and 0011 (one live share link)
   wait on the approvals in DEPLOYMENT.md § 7e, after the reviewed duplicate
   share-link cleanup (`scripts/share-links/`). Then: a Clerk production
   instance, a Vercel plan allowing commercial use, `AI_DOCUMENT_PROVIDERS`
   set only to providers whose terms allow vault documents (production sends
   documents to none until then), and a Sentry project.
2. *(Removed 2026-10-04 — no scanner host is needed; ADR-017.)*
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
| 2026-10-04 | **Malware scanning removed** (ADR-017, constitution 3.0.0): ClamAV client, scanner env variables, scanner status probe and quarantine stage deleted; uploads go straight to the private `documents` / `videos` bucket, are checked for size and type, and are recorded `NOT_SCANNED`. Migration `0006` (forward-only, no data deleted). |
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
| 2026-09-30 | **Final completion pass**: audit of the readiness pass below; fixed timing-unsafe comparison of the cron bearer secret (cron routes and the health operator check now use a constant-time compare); untouched Create Will steps now report the field's own message instead of Zod's generic "expected string, received undefined"; `pnpm env:check` no longer reports unset AI/Sentry/no-op scanner as configured, and `--all` evaluates the production rules and lists every gap in one run. Added verification: scanner hang fails closed within its deadline, INSTREAM framing, oversize-after-upload, invalid declared type, expiry with quarantine cleanup, audit rows, wizard save-failure → Retry, unsaved-changes guard, skip persistence, mandatory-step validation. |
| 2026-09-30 | **Production-readiness pass**: upload/scan hang fixed and bounded end to end (retryable scanner failures, atomic completion); Create Will autosave made server-confirmed with retry, unsaved-changes guard, Save & continue, persisted Skip for now, server-side draft validation, real document attachments; separate `read`/`autosave` rate-limit budgets; AI implemented (ADR-008/016) — assistant and document intelligence; live system status; new 3D vault-shield hero; components grouped by feature, browser API client in `lib/client/`, every server module marked `server-only` and checked by `tests/security/`; debug route, local-rules assistant, scaffold assets and five unused dependencies removed; `docs/ARCHITECTURE.md`. Checks at the time: 222 unit+security, 111 integration, lint, typecheck, format, build. |
| 2026-10-01 | **MFA/2FA fix + final pass**: Settings → Security "Enable" (and "Manage", password, and "Manage with Clerk") were stubs that only showed a toast — now they open Clerk's account portal (`openUserProfile()`), the two-factor badge shows Clerk's live `twoFactorEnabled`, and `POST /users/me/refresh` (new; `ensureAppUserFromSession({ force: true })`) re-syncs the `users.mfa_enabled` mirror the dashboard/Security Center read. Verified: 3 unit tests (live-state wins, button opens the portal, mirror re-syncs) and an E2E test that the portal opens against the real Clerk dev instance. **Second root cause (config, not code):** the dev instance has Multi-factor disabled (`authenticator_app.enabled=false`), so enrolment is impossible until it is enabled in the Clerk Dashboard (no Backend API; DEPLOYMENT.md § 5 row 4). Gate: 226 unit + 9 security + 115 integration, lint, typecheck, prettier, build (65/65), E2E 11/11 (one worker). |
| 2026-10-02 | **AI reliability, attachments and provider fallback** (uncommitted): root cause of "The AI service is temporarily unavailable" verified in the real UI and server logs — `gemini-3.8-flash` answered bursts of 503 UNAVAILABLE ("high demand") and the Gemini adapter made one attempt (3 of 8 real messages failed; 6 of 6 after the fix), compounded by the development key's free-tier quota of 20 requests/day (429 RESOURCE_EXHAUSTED, `GenerateRequestsPerDayPerProjectPerModel-FreeTier`). Fixes: SDK retry of 408/5xx with bounded backoff (429 not retried); errors classified by `upstream` status/reason/quota without vendor text; a spent daily quota and a stream cut off mid-answer get honest messages. New: assistant attachments through the existing secure upload pipeline; OpenAI-compatible fallback adapter (OpenRouter/Groq/Cerebras/Hugging Face) with verified per-model capabilities, explicit opt-in order, document-approval list and paid-model guard. Follow-up the same day: chain-wide time budget; Groq and Hugging Face verified live; Next.js 16.3.5 → 16.3.6 for GHSA-vcvr-r3jv-pc5j (critical RCE in `next/og`, not used here); hosted Supabase and Vercel steps documented (DEPLOYMENT.md § 7b) — neither is set up yet. Live attachment analysis remains unverified (Gemini quota). |
| 2026-10-14 | **Account deletion + landing redesign** (uncommitted, not deployed): immediate permanent deletion (`POST /users/me/delete-now`, `strict_mfa`, typed phrase) and a real hard delete for both paths (migration 0012 `begin_account_deletion()` + `user.hard-delete` job: storage → Clerk → rows; audit log kept); scheduled deletion previously only soft-deleted after 30 days; `requireUser()` now refuses deleted accounts; `document_versions.uploaded_by` cascade blocker fixed; review fixes: no access-link delivery for a deleted owner, chunked version lookup for large accounts; landing hero is a static original illustration (three.js removed), colour roles rebalanced, FAQ added. Release audit: purge prefix guard, new-device skip for deleted accounts, daily requeue of stalled purges, read-only preflight (`docs/release/ACCOUNT_DELETION_READINESS.md`). Tests: integration 225 passed + 1 opt-in scale test skipped (passed separately; serial), unit+security 572/572 (serial), smoke E2E 3/3, axe clean on public pages. |
| 2026-10-15 | **Release readiness — current status** (uncommitted, not deployed; one report: `docs/release-readiness-final.md`; one rollout: `docs/DEPLOYMENT.md` § 7d-2): **READY FOR OWNER APPROVAL**. Engineering work is complete and verified locally; the release waits only on owner actions and approvals. Several passes on this day; the latest supersedes the earlier verdicts. Done and tested locally: Clerk `user.deleted` closes the account (`p_purge => false`); at-least-once webhooks that fail closed without a secret; no email to an owner whose deletion has begun; recovery of jobs a dead runner left `RUNNING`; migrations 0013 (no personal values in new audit rows) and 0014 (`scheduler_status()`); health signals decided by the pure `assessHealth()`; an alert step in the production-jobs workflow; an 11-count read-only preflight including migration prerequisites; a hardened `scripts/backup/backup-verify.sh` (encrypted, staged, completeness-checked, network-isolated restore); Next.js 16.3.8 and scoped dependency overrides. Tests: unit+security 615/615, integration 237 + 1 opt-in skipped, typecheck/lint/format/build pass, bundle scan clean, public E2E 3/3, release sequence rehearsed on a disposable stack with 0 drift. Production, read-only 09:30–10:27 UTC: `9fad7df`, migration 0011, preflight deletion counts 0 and prerequisites met, no stuck jobs, Vault cron secret missing, no Clerk webhook, `delete_self` on, the duplicate Vercel project Git-connected to `master` and exposing all 25 variables to Preview; one unpatchable dependency advisory (`braces`). |
| 2026-10-16 | **Release completion pass** (committed locally on `release/account-deletion-export`, not pushed or deployed; report: `docs/release-readiness-final.md`): Excel and CSV export now covers the whole schema (26 sheets: AI analyses decrypted, check-in history, emergency requests, access links without hashes, attachments, AI usage, retained deleted rows) and reads every list in pages (PostgREST's 1,000-row cap had cut long lists silently); export card accessibility; `shadcn` moved to devDependencies (`pnpm audit --prod` 0; `braces` remains in dev tooling, no patch exists). Tests on the final tree: unit+security 653/653, integration 239 + 1 opt-in (run separately: pass), typecheck/lint/format/build pass, bundle scan clean, E2E 4/4 including a signed-in export with an existing test user against the local database. Production, read-only: duplicate Vercel project deleted and Vault cron secret added by the owner (scheduler 13 × 200); `9fad7df` redeployed; migration 0011; preflight 17:53Z all deletion counts 0. Blocked on: a production backup PASS (owner, interactive) and Clerk `delete_self` off; then migrations 0012–0014 and the release. |
| 2026-10-16 | **Released to production — COMPLETE.** Backup PASS 20:13:42 UTC (same physical disk only; owner accepted). Migrations 0012, 0013, 0014 applied one at a time 21:02–21:04 UTC, each verified (definitions = local, privileges as designed, data untouched; catalog drift 0). `master` fast-forwarded and pushed (`9fad7df..3a02fcd`); deployment `dpl_2MdiqH72UVYTwjWJPWftjM9Jgw1v` READY on the exact commit. Live on production with a disposable test account: export (Excel 26 sheets, CSV 26 files), delete-now phrase gating, schedule + cancel, delete-now `DELETED` → Clerk user gone, row purged, audit kept, backstop purge job succeeded. CI fixed (`d22f6b8`, `APP_URL`), all jobs green. |
