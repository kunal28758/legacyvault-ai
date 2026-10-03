# Implementation Plan: LegacyVault AI — Baseline Product

**Branch**: `master` (feature branch `001-baseline-product-spec` to be created before implementation) | **Created**: 2026-09-16 | **Revised**: 2026-09-18 r4 | **Spec**: [spec.md](./spec.md)

**Input**: Baseline product specification from `specs/001-baseline-product-spec/spec.md`

> **Revision 2026-10-04 (ADR-017)** — Malware scanning was removed by owner
> decision: there is no ClamAV, no quarantine stage and no scan gate. Uploads
> go straight to the private `documents` / `videos` bucket and are promoted
> after size and magic-byte checks (`VALIDATED` → `promote_upload()`).
> FR-H016 / FR-Q011 are withdrawn. Scanner references below are historical.
>
> **Revision 2026-09-18** — Re-baselined to the single Next.js application
> architecture recorded in [`docs/ARCHITECTURE_DECISIONS.md`](../../docs/ARCHITECTURE_DECISIONS.md)
> (ADR-001 … ADR-013) and constitution **v2.0.1**. The two-project
> (`frontend/` + `backend/` Express/Prisma/S3/Redis) plan is superseded. All
> functional and security requirements in `spec.md` are unchanged; only the
> means of satisfying them changed.
>
> **r2 (2026-09-18, post-`/speckit-analyze`)** — write-protection model
> (ADR-004 r2), unified access tokens + cookie exchange (ADR-014), production
> malware scanning (ADR-015), AI draft persistence (ADR-016), spec
> clarifications session 2026-09-18, mandatory test tasks (constitution XVII),
> phase-ordering fixes. Entity count 24 → 29.

## Summary

LegacyVault AI is a security-first legal-tech SaaS platform enabling users to
securely organize, manage, protect, and transfer their digital and physical
legacy to authorized beneficiaries. The baseline release is individual-user
focused with two roles (User, Super Admin). Beneficiaries access resources via
secure, time-limited, scoped email tokens — no platform accounts required.

The implementation is **one Next.js 16 application** (App Router, React 19,
TypeScript 5): React Server/Client Components with Tailwind CSS, shadcn/ui,
Framer Motion and GSAP for the UI; **Next.js Route Handlers under
`app/api/v1/**`** for the versioned REST API; a strict server-side layering of
thin handlers → `lib/services` → `lib/repositories`. **Clerk** provides
authentication (sessions, MFA, reverification). **Supabase** provides managed
**PostgreSQL** (SQL migrations, RLS, transactional functions) and **private
object storage** (quarantine → promote upload flow, signed URLs). Background
work runs through a **PostgreSQL job table drained by Vercel Cron**. AI
features use an in-house provider abstraction over **OpenAI and Google
Gemini** with structured, validated outputs. Email goes through a provider
abstraction (Resend baseline); observability is **Sentry + structured
logging + health checks**; deployment is **Vercel + Supabase + Clerk**.

## Technical Context

**Language/Version**: TypeScript 5.x, Node.js 20 LTS runtime (Vercel), React 19.2, Next.js 16.3

**Primary Dependencies** (single `package.json`):
- UI: `next`, `react`, `react-dom`, `tailwindcss` v4, `shadcn/ui`,
  `framer-motion`, `gsap`, `@tanstack/react-query`, `zustand`,
  `react-hook-form`, `@hookform/resolvers`, `zod`
- Auth: `@clerk/nextjs`, `svix` (webhook verification)
- Data/storage: `@supabase/supabase-js` (typed via generated
  `lib/types/database.ts`), Supabase CLI (dev dependency) for migrations and
  type generation, `tus-js-client` (resumable video uploads)
- Security/files: Node `crypto` (AES-256-GCM), `file-type` (magic bytes),
  `unpdf` or equivalent (PDF text extraction), `@react-pdf/renderer`
- AI: `openai`, `@google/genai`
- Email: `resend`, `@react-email/components`
- Observability: `@sentry/nextjs`, `pino`
- Testing: `vitest`, `@testing-library/react`, `@playwright/test`,
  `@axe-core/playwright` (accessibility), `@clerk/testing` (E2E sessions),
  `jose` (local RLS test JWTs), `tsx` (scripts)

**Explicitly not used in the baseline** (constitution Technology Stack):
Express.js, Prisma, AWS S3/MinIO, Redis/BullMQ, Supabase Auth, MongoDB,
Multer, Nodemailer (may implement `EmailProvider` later), Winston, Puppeteer.

**Storage**: Supabase-managed PostgreSQL (17 on new projects; ≥16 required);
Supabase Storage private buckets `quarantine`, `documents`, `videos`.

**Testing**: Vitest (unit/integration incl. RLS/policy tests against a local
Supabase stack), Route Handler tests via `fetch` against `next dev`/`next
start` or direct handler invocation, Playwright (E2E), React Testing Library
(components).

**Target Platform**: Web application deployed to Vercel (serverless/fluid
functions); managed services: Supabase (database + storage), Clerk (identity).

**Project Type**: Single full-stack Next.js application (Option 1 — no
monorepo, no separate backend).

**Performance Goals**:
- Page load: <3s initial content
- API CRUD: <500ms response under normal load
- Document upload: up to 50 MB without timeout (direct-to-storage)
- Video upload: up to 500 MB without timeout (resumable direct-to-storage)
- Concurrent users: 1,000+ without degradation

**Constraints**:
- All sensitive data encrypted at rest (AES-256: application-level for
  sensitive fields, provider-managed for storage objects and database disks)
  and in transit (TLS 1.2+)
- Zero cross-user data exposure (service-layer authorization + RLS)
- AI, Clerk secret, Supabase secret and encryption keys server-side only
- No public buckets; downloads only via server-minted signed URLs
- Serverless limits: request bodies ≈4.5 MB (hence direct uploads), function
  `maxDuration` budgets (hence job-based long work), no shared in-memory state
- WCAG 2.1 AA compliance

**Platform prerequisites (verify in Phase 0, record in `docs/DEPLOYMENT.md`)**:
- Vercel plan supporting minute-level Cron and the `maxDuration` needed for
  job/AI handlers
- Supabase plan supporting a global file-size limit ≥ 500 MB and PITR (prod)
- Clerk production instance with MFA, attack protection, reverification and
  the Supabase third-party-auth integration enabled

**Scale/Scope**:
- 14 core modules, 20 user stories, 150+ functional requirements
- ~60+ pages/views
- ~80+ API endpoints across 14 domains (+ internal webhooks/cron)
- 29 database entities = 28 tables (24 domain + 4 operational); Session is externalized to Clerk

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-checked 2026-09-18 against
constitution v2.0.1.*

| # | Principle | Gate Status | Evidence |
|---|-----------|:-----------:|----------|
| I | Security First | ✅ PASS | Server-side authz in services + RLS, secrets in Vercel env only, defense-in-depth, audit logging, Svix/CRON secret verification on internal endpoints |
| II | Privacy & Data Protection | ✅ PASS | Encryption at rest/transit, data minimization (city/country only for device detection), no cross-user exposure, no prod data in lower environments |
| III | Authentication & Authorization | ✅ PASS | Clerk = single auth system (MFA, sessions, reverification); role/ownership checks in our service layer on every operation (amended III) |
| IV | Encryption & Secure Storage | ✅ PASS | AES-256-GCM app fields; provider AES-256 for objects; private buckets; 15-min signed URLs; keys in env, never hard-coded; ADR-013 documents optional envelope encryption |
| V | Legal-Tech Safety | ✅ PASS | AI disclaimers, confirmation endpoints before persistence, no claims of legal validity |
| VI | AI Safety & Reliability | ✅ PASS | In-house provider abstraction (OpenAI/Gemini), server-only keys, structured outputs validated with Zod, hallucination/uncertainty flags, confirmation gates, outage fallback |
| VII | Data Integrity | ✅ PASS | Guarded `SECURITY DEFINER` functions for every invariant-bearing write (finalize/allocate/attach/tokens/DMS/EA/AI confirm), column allow-lists for plain writes, CHECK + partial unique constraints, DMS recovery at every stage, append-only audit trigger (ADR-004 r2) |
| VIII | Architecture | ✅ PASS | Single Next.js application with clear presentation/server-side separation; thin Route Handlers → services → repositories; versioned REST API. |
| IX | Code Quality | ✅ PASS | TypeScript strict throughout, generated DB types, consistent `lib/*` structure, dependencies justified in ADRs |
| X | Validation & Error Handling | ✅ PASS | Zod on every handler via `withApi()`, centralized safe error envelope, no stack-trace leaks |
| XI | API & Web Security | ✅ PASS | CSRF origin check, three-layer rate limiting, magic-byte + size + malware gating before promotion, security headers + nonce CSP |
| XII | Auditability | ✅ PASS | Append-only `audit_log` with actor/action/resource/outcome/correlation id; webhook-sourced auth events |
| XIII | UI/UX | ✅ PASS | Dark-first, glassmorphism, Framer Motion + GSAP, explicit state communication |
| XIV | Accessibility | ✅ PASS | WCAG 2.1 AA, keyboard nav, semantic HTML, responsive layouts, reduced-motion |
| XV | Performance | ✅ PASS | Server Components for data, lazy loading, indexed queries, direct-to-storage uploads, no sensitive data in shared caches |
| XVI | Observability | ✅ PASS | Structured JSON logs with correlation IDs, Sentry with PII scrubbing, health checks, no sensitive data in logs |
| XVII | Testing | ✅ PASS | Executable test tasks: T212/T215 (RLS + guarded functions), T213 (encryption/key version), T214 (auth/authz pipeline), T225 (plan), T226 (beneficiary lifecycle), T228 (document permissions), T229 (allocation), T232 (AI validation/fallback), T235 (DMS), T236 (emergency access), T241 (E2E + authorization matrix); CI gate T246 blocks on security tests (NFR-SEC-003) |
| XVIII | Documentation | ✅ PASS | `docs/BRAIN.md`, `docs/ARCHITECTURE_DECISIONS.md`, `docs/PROJECT_STATUS.md`, planned docs; implemented vs. planned clearly separated |
| XIX | Git & Change Management | ✅ PASS | No secrets in repo (`.env*` ignored), focused commits; `.gitignore` completion tracked in T009 |
| XX | Development Workflow | ✅ PASS | Full SDD lifecycle followed; architecture drift resolved before implementation |
| XXI | Production Readiness | ✅ PASS | HTTPS by platform, Vercel env secrets, Supabase backups + PITR, secure headers, WAF rate limiting, monitoring, environment isolation |
| XXII | Decision Priority | ✅ PASS | Security → Privacy → Integrity → Correctness → Safety → Maintainability → Accessibility → Performance → Polish |

**Result**: All 22 gates pass under constitution v2.0.1. No violations to
justify. One follow-up verification item (T203, FR-A014 failed-attempt event
coverage) is tracked as a task, not a gate exception.

## Project Structure

### Documentation (this feature)

```text
specs/001-baseline-product-spec/
├── spec.md              # Finalized specification (unchanged 2026-09-18)
├── plan.md              # This file
├── research.md          # Phase 0 output (revised 2026-09-18)
├── data-model.md        # Phase 1 output (revised 2026-09-18)
├── quickstart.md        # Phase 1 output (revised 2026-09-18)
├── contracts/
│   └── api-contracts.md # Phase 1 output (revised 2026-09-18)
├── checklists/
│   └── requirements.md
└── tasks.md             # Phase 2 output (revised 2026-09-18)

docs/
├── ARCHITECTURE_DECISIONS.md   # ADR-001 … ADR-016 (authoritative)
├── PROJECT_STATUS.md           # Current state snapshot
├── BRAIN.md                    # Project knowledge (moved from repo root)
└── README.md + topic folders     # architecture/ database/ development/ integrations/ monitoring/ product/ security/ ui/ workflows/ (docs/README.md is the index)
```

### Source Code (repository root — single Next.js application)

```text
legacyvault-ai/
├── app/                                   # Next.js App Router
│   ├── layout.tsx                         # Root layout: ClerkProvider, fonts, providers, metadata
│   ├── globals.css                        # Tailwind v4 @theme tokens (dark-first), glass/gradient utilities
│   ├── (marketing)/page.tsx               # Landing page
│   ├── (auth)/
│   │   ├── layout.tsx                     # Redirect signed-in users; auth shell
│   │   ├── sign-in/[[...sign-in]]/page.tsx  # Clerk <SignIn/> (themed)
│   │   └── sign-up/[[...sign-up]]/page.tsx  # Clerk <SignUp/> (themed)
│   ├── (dashboard)/                       # Protected (Clerk) route group
│   │   ├── layout.tsx                     # auth.protect() + ensureAppUser + shell
│   │   ├── dashboard/
│   │   ├── onboarding/
│   │   ├── legacy-plan/                   # Create Will stepper (+ steps/, versions/)
│   │   ├── beneficiaries/                 # list + [id]
│   │   ├── assets/                        # overview + financial/ physical/ digital/
│   │   ├── documents/                     # Secure Document Vault
│   │   ├── dead-man-switch/               # config/status + check-in/
│   │   ├── emergency-access/
│   │   ├── video-legacy/
│   │   ├── ai/                            # assistant/ will-generator/ document-analysis/
│   │   ├── security-center/
│   │   ├── notifications/
│   │   └── settings/                      # profile, security (Clerk UserProfile), audit-log
│   ├── (admin)/
│   │   ├── layout.tsx                     # requireRole(SUPER_ADMIN) (UX) — API re-enforces
│   │   └── admin/                         # dashboard, users/, audit-logs/, analytics/
│   ├── (public)/
│   │   ├── access/                        # /access?t=<token> → exchange → cookie; resources UI (no account)
│   │   └── emergency-access/              # request/, verify/, status/
│   └── api/
│       ├── v1/                            # Versioned REST — Route Handlers (thin)
│       │   ├── health/route.ts
│       │   ├── users/me/...
│       │   ├── beneficiaries/...
│       │   ├── assets/{financial,physical,digital}/...
│       │   ├── documents/{uploads,folders,[id]}/...
│       │   ├── legacy-plans/...
│       │   ├── dead-man-switch/...
│       │   ├── emergency-access/...
│       │   ├── videos/...
│       │   ├── ai/{assistant,will-generator,document-analysis}/...
│       │   ├── notifications/...
│       │   ├── security/...
│       │   ├── audit-logs/...
│       │   ├── admin/...
│       │   └── access/{exchange,resources,documents,assets,videos,plan-sections,logout}/...   # access-cookie scoped (ADR-014)
│       ├── webhooks/
│       │   ├── clerk/route.ts             # Svix-verified Clerk events
│       │   └── email/route.ts             # Delivery events
│       └── internal/cron/
│           ├── run-jobs/route.ts          # CRON_SECRET — drain job table
│           ├── dms-scan/route.ts          # CRON_SECRET — enqueue one dms.scan job
│           └── housekeeping/route.ts      # CRON_SECRET — sweeps and cleanup
├── components/
│   ├── ui/                                # shadcn/ui primitives
│   ├── layout/                            # Shell, sidebar, header, notification bell, theme toggle
│   ├── forms/                             # Reusable form components, re-auth gate (Clerk reverification)
│   ├── data-display/                      # Tables, cards, lists
│   ├── feedback/                          # Alerts, toasts, dialogs, confirmations
│   ├── wizard/                            # Stepper/wizard system (Create Will)
│   └── shared/                            # Logos, badges, AI disclaimer, file upload, empty states
├── hooks/                                 # use-current-user, use-reduced-motion, …
├── stores/                                # Zustand (UI/wizard state only)
├── styles/                                # Design tokens, motion presets
├── emails/                                # React Email templates
├── lib/
│   ├── api/                               # with-api.ts (pipeline), errors.ts, validate.ts, response.ts, client.ts, query-client.ts
│   ├── auth/                              # require-user.ts, require-role.ts, reverification.ts, ensure-app-user.ts
│   ├── db/                                # server.ts (createUserClient / createServiceClient), sql helpers
│   ├── repositories/                      # Data access per entity (typed supabase-js, rpc calls)
│   ├── services/                          # Business logic per domain (+ services/ai/)
│   ├── ai/                                # provider.ts, providers/{openai,gemini}.ts, factory.ts, validation.ts, prompts/, schemas/
│   ├── email/                             # provider.ts, providers/{resend,console}.ts, send-template.ts
│   ├── storage/                           # storage.service.ts (signed URLs, promote, range read), upload-session.ts
│   ├── jobs/                              # runner.ts, registry.ts, handlers/*.ts, enqueue.ts
│   ├── security/                          # encryption.ts, file-validation.ts, malware-scanner.ts, rate-limit.ts, tokens.ts
│   ├── audit/                             # audit.service.ts (append-only)
│   ├── observability/                     # logger.ts (pino), sentry.ts, health.ts
│   ├── config/                            # env.ts (Zod-validated, server-only), constants.ts
│   ├── validators/                        # Zod schemas per domain (shared with forms)
│   └── types/                             # database.ts (generated), api.ts, domain.ts
├── supabase/
│   ├── config.toml                        # Supabase CLI (local stack)
│   ├── migrations/*.sql                   # Schema, RLS policies, triggers, functions
│   └── seed.sql                           # Non-secret reference data
├── scripts/                               # seed-admin.ts, backup-database.sh, restore-database.sh, load-test.ts
├── tests/
│   ├── unit/
│   ├── integration/                       # services, RLS/policies, jobs (local Supabase)
│   └── e2e/                               # Playwright critical journeys
├── docs/                                  # Project documentation (see Documentation Plan)
├── specs/                                 # Feature specifications (exists)
├── .specify/                              # Spec Kit infrastructure (exists)
├── .github/workflows/ci.yml
├── proxy.ts                               # clerkMiddleware(), CSP nonce (Next 16 file convention)
├── instrumentation.ts / instrumentation-client.ts   # Sentry
├── vercel.json                            # Cron schedules
├── next.config.ts                         # Security headers, images, experimental flags as needed
├── tsconfig.json · eslint.config.mjs · postcss.config.mjs · package.json
├── .env.example                           # All variables, no values
└── .gitignore                             # ignores .env*, .next/, .agents/, .agents-backup/
```

**Structure Decision**: Single application (ADR-001). Presentation and server
logic are separated by *module boundary* (`app/` + `components/` vs.
`lib/services` + `lib/repositories`) rather than by deployable. No `src/`
directory (matches the existing scaffold). No monorepo tooling.

### Request pipeline (`withApi()`)

```
Route Handler (app/api/v1/**/route.ts)
  └── withApi({ auth: 'user' | 'admin' | 'access-cookie' | 'public' | 'cron' | 'webhook',
                reverification?: 'strict' | 'multi_factor',
                rateLimit?: policy, schema?: { body, query, params } })
        ├── correlation id (generate, log-bind, X-Correlation-ID, Sentry tag)
        ├── Cache-Control: private, no-store on every response (constitution XV)
        ├── authentication: Clerk auth() → ensureAppUser() → role check
        │                   | access-cookie: decrypt → access_tokens revoked/expiry + beneficiary status re-check
        ├── CSRF: Origin / Sec-Fetch-Site same-origin check for POST/PATCH/PUT/DELETE
        │         (cookie/ambient modes public|user|admin|access-cookie; cron|webhook authenticate per request instead)
        ├── rate limit (Postgres bucket) → 429 + Retry-After
        ├── Zod validation → 422 with field errors
        ├── handler(ctx) → service call(s) → repository → PostgreSQL / Storage / Clerk API
        ├── response envelope { success, data, meta }
        └── error mapping → { success:false, error:{code,message} } (no internals), Sentry capture
```

### Background processing (ADR-006)

```
Service ──enqueue(job)──▶ jobs table (Postgres, same transaction where atomic)
Vercel Cron ──▶ /api/internal/cron/run-jobs (every 5 min) ──claim_jobs()──▶ handlers (idempotent, backoff, dead-letter)
Vercel Cron ──▶ /api/internal/cron/dms-scan (hourly) ──▶ enqueue one dms.scan job ──▶ handler enqueues dms.* transition jobs
Vercel Cron ──▶ /api/internal/cron/housekeeping (daily) ──▶ expiry/cleanup/retry sweeps
Supabase pg_cron + pg_net (prod) ──▶ same endpoints (redundant trigger)
Health check ──▶ last successful dms.scan ≤ 2× interval else CRITICAL audit + alert
```

---

## Development Phases

### Phase 0 — Foundation

**Purpose**: Normalize the existing root scaffold, configure tooling and the
three platforms (Vercel, Supabase, Clerk), and establish the design system.

**Dependencies**: None (first phase). The Next.js 16 scaffold already exists
at the repository root (2026-09-17); this phase finishes it rather than
re-creating it.

**Major Modules**:
- Normalize the scaffold: remove template page content, set metadata, confirm
  `next.config.ts`, read the Next.js 16 docs in `node_modules/next/dist/docs/`
  (proxy, route handlers, `after`, `maxDuration`, CSP)
- Install dependencies per Technical Context; remove `@supabase/ssr` (not
  needed — Supabase Auth is not used)
- Complete `.gitignore` (`.agents/`, `.env*`, `!.env.example`, `.next/` are
  already ignored; add `next-env.d.ts`, `*.tsbuildinfo`, `coverage/`, `.vercel`,
  logs); create `.env.example`
- `lib/config/env.ts` — Zod-validated environment (server-only vs
  `NEXT_PUBLIC_`), fail fast on missing variables
- Tailwind v4 `@theme` tokens (dark-first, blue/purple/cyan), glassmorphism and
  gradient utilities, shadcn/ui init, Geist/Inter typography
- `proxy.ts` with `clerkMiddleware()` (protected-first; public: `/`,
  `/sign-in`, `/sign-up`, `/access/*`, `/emergency-access/*`,
  `/api/webhooks/*`, `/api/internal/cron/*`, `/api/v1/health`,
  `/api/v1/access/*`, `/api/v1/emergency-access/{request,verify}`) and CSP
  nonce injection
- `next.config.ts` security headers (HSTS, X-Frame-Options DENY, nosniff,
  Referrer-Policy, Permissions-Policy denying camera/microphone/geolocation —
  the baseline is upload-only for video)
- Supabase CLI init (`supabase/config.toml`), local stack instructions,
  `pnpm db:*` scripts; Supabase project checklist (Clerk third-party auth
  enabled, private buckets, file-size limit ≥ 500 MB, backups/PITR)
- Clerk application checklist (password policy, verification required, MFA
  TOTP + backup codes, 24 h session lifetime, lockout 5/30 min, bot
  protection, reverification, webhook endpoint + signing secret, Supabase
  integration) for dev and prod instances
- Vitest + React Testing Library + Playwright configuration
- `.github/workflows/ci.yml` (install → lint → type-check → test → build →
  migration dry-run), `vercel.json` cron definitions
- `docs/DEPLOYMENT.md` started (environment matrix, prerequisites, env vars)

**Security Considerations**:
- `.env*` ignored from day one; only `NEXT_PUBLIC_*` variables reach the
  client; `server-only` guard on `lib/config/env.ts`
- Verify platform prerequisites (cron frequency, `maxDuration`, storage limit)
  before depending on them

**Testing Requirements**:
- Vitest running with at least one passing smoke test; Playwright smoke test
  against `next dev`; CI green

**Completion Criteria**:
- App builds and starts; Clerk sign-in/sign-up pages render; local Supabase
  stack reachable; design tokens configured; CI passing;
  `docs/DEPLOYMENT.md` lists prerequisites with verification status

---

### Phase 1 — Authentication & Security Foundation

**Purpose**: Wire Clerk authentication end to end, establish the API request
pipeline, RBAC helpers, audit logging and security middleware equivalents.

**Dependencies**: Phase 0

**Major Modules**:
- Clerk sign-in / sign-up / user-profile pages (themed; FR-A001–A011, A017)
- `app/api/webhooks/clerk` — Svix verification; `user.*`/`session.*` →
  `users` upsert, audit rows (FR-A014), `security.new-device-check` job
  (FR-A016); idempotent
- `lib/auth`: `requireUser()` (Clerk `auth()` → app user, lazy
  `ensureAppUser()`), `requireRole()`, `requireReverification()` (FR-A018,
  FR-Q001, FR-Q002)
- `lib/api/with-api.ts` pipeline: correlation id, auth, CSRF origin check
  (FR-Q007), Postgres rate limiter (FR-Q008), Zod validation (FR-Q009),
  envelope, safe error mapping (FR-Q016)
- `lib/audit/audit.service.ts` (append-only) and `audit_log` trigger
- `lib/observability/logger.ts` (pino, redaction) and Sentry setup
- Idle-timeout preference (`securityPreferences.idleTimeoutMinutes`, client-
  enforced sign-out within the platform lifetime — FR-B006, T220)
- (Security Center session list/revocation via Clerk Backend API — FR-A015 —
  is delivered in Phase 10 / US14, tasks T114–T115)
- **T203 verification**: Clerk event coverage for FR-A014 (failed sign-in
  attempts); implement `POST /security/events` capture only if required
- Frontend: `(auth)` layout, `(dashboard)` layout with `auth.protect()`,
  sidebar/header shell, onboarding page

**Security Considerations**:
- Webhook and cron endpoints verify their own credentials and are excluded
  from Clerk protection in `proxy.ts`
- Role is read from PostgreSQL on every protected operation, never trusted
  from client state
- Reverification level `strict` (≤10 min) for sensitive endpoints;
  `multi_factor` for Dead Man Switch check-in/cancel when MFA is enabled

**Testing Requirements**:
- Unit: `withApi()` pipeline (auth outcomes, CSRF rejection, rate limit, Zod
  422 shape), role helpers, audit service
- Integration: webhook handler idempotency and audit rows; `ensureAppUser()`
- E2E: sign-up → verify → sign-in → dashboard; MFA enrol → sign-in with
  TOTP; session revoke from Security Center

**Completion Criteria**:
- Users can register, verify email, sign in, enable MFA, sign out; sessions
  visible and revocable; auth events present in `audit_log`; protected API
  returns 401/403 correctly; T203 outcome documented

---

### Phase 2 — Core Database & User Profile API

**Purpose**: Implement the complete schema as SQL migrations with RLS,
foundational services and the job runner.

**Dependencies**: Phase 1

**Major Modules**:
- `supabase/migrations/0001_init.sql` (T018): all 28 tables (29 entities;
  `Session` is externalized to Clerk) from `data-model.md` (snake_case), enums, FKs with `ON DELETE`, CHECK constraints,
  unique and partial-unique indexes (`NULLS NOT DISTINCT` for folders),
  `updated_at` triggers, soft-delete columns
- `0002_rls_and_privileges.sql` (T218): privilege baseline (`REVOKE ALL` from
  `anon`/`authenticated` + default privileges), RLS enabled everywhere,
  `SELECT` own-row policies, Class A `INSERT`/`UPDATE` policies with **column
  allow-lists** (never the encrypted columns; asset tables UPDATE-only),
  `audit_class_a_change()` triggers on the Class A tables (ADR-004 r4),
  `protect_identity_columns` trigger on `users`, append-only
  trigger on `audit_log`, `storage.objects` policies
- `0003_functions.sql` (T019): guarded `SECURITY DEFINER` functions per the
  catalog in `data-model.md` § Write-Protection Model 5 (plan
  create/save/finalize/new-draft, assign/unassign, beneficiary status/removal
  cascade, attach/detach document, issue/revoke/resend token, asset
  create/sensitive-fields/delete, delete document/video, DMS owner
  transitions, EA configure/decide/revoke, AI draft update/confirm)
  and system functions (`promote_upload`, `dms_transition`,
  `ea_request_access`, `ea_verify_otp`, `ea_transition`,
  `system_issue_access_token`, `system_reissue_access_token`,
  `system_mark_token_delivered`, `claim_jobs`, `rate_limit_hit`,
  `record_webhook_event`) with `EXECUTE` grants per role
- Notification service + `notification.deliver` job handler (T155) so every
  later phase can send notifications without stubs
- `lib/db/server.ts` (user-scoped + service clients), generated types
- `lib/security/encryption.ts` (AES-256-GCM), `file-validation.ts`,
  `malware-scanner.ts` (NoOp dev + factory)
- `lib/storage/storage.service.ts` (signed upload/download URLs, range read,
  promote, remove) and bucket policies migration
- `lib/jobs` runner + `run-jobs`/`housekeeping` cron handlers; `vercel.json`
- User profile CRUD (FR-B001–B007), preferences; pagination helpers;
  `GET /api/v1/health`
- Seed script: promote a Clerk user (by `ADMIN_EMAIL`) to `SUPER_ADMIN`

**Security Considerations**:
- Service client only in server modules; never imported by client components
  (`server-only`)
- Encrypted columns handled explicitly in repositories; keys from env only
- Migration review checklist: every table has RLS + policies, every FK has an
  index, every enum/CHECK matches `data-model.md`, every Class B table has
  **no** direct write grant, every guarded function follows the nine
  mandatory rules, `EXECUTE` is revoked from `PUBLIC`/`anon`
- RLS/guarded-function tests (T212/T215) mint HS256 JWTs with the local
  Supabase JWT secret and Clerk-shaped claims (ADR-004 r2 §7)
- `docs/DATABASE_SCHEMA.md` (T242) written from the applied migrations

**Testing Requirements**:
- Unit: encryption round-trip, file validation (type/size/magic bytes), rate
  limiter, job claim/backoff logic
- Integration (local Supabase): RLS cross-user denial per table, transactional
  function behaviour (lock version conflict, allocation overflow), job runner
  idempotency
- API: user endpoints, validation error responses

**Completion Criteria**:
- All entities and policies exist; profile management functional; encryption
  and storage utilities working; job runner draining a test job on schedule;
  structured logging operational; health endpoint green

---

### Phase 3 — Legacy Plan / Create Will

**Purpose**: Implement the multi-step Create Will wizard — the core product
feature.

**Dependencies**: Phase 2

**Major Modules**:
- Legacy Plan Route Handlers per contract (create, get, auto-save step,
  documents, review, finalize, versions, new-draft)
- `lib/services/legacy-plan.service.ts` calling the guarded functions
  (`create_legacy_plan`, `save_plan_step` with optimistic locking,
  `finalize_legacy_plan` with `acknowledgeIncomplete` — Personal Details
  always required, `create_plan_draft`) (FR-C001–C012, US20 scenario 2)
- Frontend wizard system (provider, stepper, step wrapper) and **all eleven
  steps**: Personal Details, Family, Beneficiaries (embedded module, T221),
  Financial/Physical/Digital Assets (embedded modules, T222), Witness,
  Special Wishes, Document Attachments (T223), Review, Confirmation (T224);
  finalize dialog lists incomplete sections and requires acknowledgment

**Security Considerations**:
- Plan data accessible only to the owner (service check + RLS)
- Finalization irreversible without a new draft; versions never deleted
- Auto-save never promotes invalid data to FINALIZED

**Testing Requirements**:
- Unit: step validation, completeness computation
- Integration: full wizard flow; concurrent-edit conflict (409)
- Component tests: stepper navigation and validation display

**Completion Criteria**: As before — create, progress, auto-save, review,
finalize with confirmation, version history read-only.

---

### Phase 4 — Beneficiaries & Assets

**Purpose**: Beneficiary management and all three asset categories.

**Dependencies**: Phase 3

**Major Modules**:
- Beneficiary CRUD with duplicate detection, lifecycle
  (`set_beneficiary_status`), removal cascade (`remove_beneficiary`),
  confirmation flag, audit (FR-D001–D011); invitation emails via
  `EmailService`. Beneficiaries are the single recipient model (ADR-014)
- Assignments via `assign_beneficiary()` enforcing Σ allocation ≤ 100 % per
  resource (FR-D004–D006, Clarifications 2026-09-18); DIRECT_SHARE access
  tokens via `issue_access_token()` (hash-only, scoped, ≤ 30 days — FR-D011)
- Access-cookie exchange (`POST /access/exchange`, `lib/security/
  access-session.ts`) and `/access/*` resource endpoints incl. plan sections
  (ADR-014, T230/T231)
- Financial / Physical / Digital assets created through `create_asset()`,
  encrypted fields written only through `set_encrypted_fields()` (ADR-004 r4),
  masked responses, `/decrypt` endpoints gated by Clerk reverification with audit of
  credential views (FR-E*, FR-F*, FR-G*)
- Public `/access` page (exchange, resource list, downloads, plan sections)
- Frontend pages, forms, re-auth gate component (Clerk reverification)
- Tests: beneficiary lifecycle/cascade (T226), allocation invariants (T229);
  `docs/BUSINESS_RULES.md` (T243)

**Security Considerations**:
- Encrypted fields: account/policy numbers, credentials, recovery info
- Reverification required for plaintext views; every view audited
- Allocation constraints enforced in the database function (never trust
  client)
- Token endpoints use the service client with token-scope authorization and
  per-token/IP rate limits

**Testing Requirements**:
- Unit: allocation logic, token generation/hashing, masking
- Integration: beneficiary lifecycle, assignments, token scope enforcement,
  cross-user asset access denial
- API: CRUD, decrypt gate (403 without reverification)

**Completion Criteria**: As before.

---

### Phase 5 — Secure Document Vault

**Purpose**: Direct-to-storage encrypted document storage with validation,
folders, permissions, versioning and audited access.

**Dependencies**: Phase 2 (storage, jobs), Phase 4 (beneficiary sharing)

**Major Modules**:
- Two-step upload (`POST /documents/uploads` → signed URL to `quarantine`;
  `…/complete` → actual size ≤ 50 MB, magic bytes, malware scan, promote to
  `documents`, metadata rows, audit) (FR-H001–H005, H016)
- Folders (FR-H006), metadata (FR-H007), preview URLs (FR-H008), 15-minute
  signed downloads (FR-H009), versioning (FR-H010), permissions
  owner/beneficiary/emergency (FR-H011–H014), access logging (FR-H015),
  soft delete + object removal job with audit retention (FR-H017)
- Document attachments to assets and the legacy plan
  (`attach_document`/`detach_document`, `/assets/:type/:id/documents`,
  `/legacy-plans/:id/documents` — FR-E004, F003, G002; T227)
- Production malware scanner `ClamAvScanner` (ADR-015, T247); production
  start-up refuses `noop`
- Housekeeping: stale quarantine/expired upload sessions
- Frontend vault UI with drag-and-drop upload (signed URL PUT with progress)
- Tests: document permissions, upload rejections, scan gating (T228)

**Security Considerations**:
- Private buckets; provider AES-256 at rest; `storage.objects` RLS denies
  direct client reads; downloads only via server-minted signed URLs
- Infected/invalid files never leave quarantine; clear error reasons
- Optional application-layer envelope encryption designed in ADR-013
  (deferred)

**Testing Requirements**:
- Unit: validation, upload-session state machine
- Integration: upload → complete → download pipeline; extension-spoof
  rejection; oversize rejection; permission enforcement; version history
- Security: URL manipulation, cross-user access, expired signed URL

**Completion Criteria**: As before, with uploads succeeding for files up to
50 MB via direct-to-storage.

---

### Phase 6 — Dead Man Switch

**Purpose**: DMS state machine with check-ins, escalation, scoped conditional
release and recovery — on the job table.

**Dependencies**: Phase 4, Phase 5

**Major Modules**:
- DMS configuration API and service (FR-I001, I010–I012): trusted contacts
  are beneficiaries (`dead_man_switch_contacts`, ADR-014); owner transitions
  via `dms_configure/pause/resume/disable/check_in/cancel_escalation`, job
  transitions via `dms_transition()`
- `dms-scan` cron (hourly) enqueues one idempotent `dms.scan` job
  (`dms.scan:{YYYY-MM-DDTHH}`; its SUCCEEDED `finished_at` is the health-check
  heartbeat) whose handler enqueues idempotent per-switch jobs:
  `dms.send-checkin`, `dms.advance` (REMINDER_SENT → GRACE_PERIOD →
  ESCALATING → RELEASING), `dms.release` (DMS_RELEASE access tokens for the
  linked beneficiaries scoped exactly to `releaseScope`, incl. plan sections
  — FR-I012; delivered by per-contact `access.deliver` jobs with
  reissue-on-retry — ADR-014 § 6)
- Tests: state-machine guards, scan idempotency, deadline math, scoped
  release, recovery, health stall (T235)
- Check-in and escalation cancellation with Clerk reverification
  (`multi_factor` when MFA enabled) (FR-I003, I007, I008)
- Health check for scan freshness → CRITICAL audit + Super Admin alert
  (NFR-AVL-002); `pg_cron` redundancy documented for production
- Frontend: configuration UI, status dashboard, check-in landing page for
  email links

**Security Considerations**:
- Release never grants account access; only user-selected resources
- Identity verification required for check-in and recovery
- Jobs idempotent (`idempotency_key = dms:{id}:{deadline}`), retry-safe
- All transitions logged (`dead_man_switch_events` + `audit_log`)

**Testing Requirements**:
- Unit: state machine guards, deadline math, scope validation
- Integration: configure → check-in → miss → escalate → release with a
  controllable clock; recovery at each stage; scan-freshness failure alert
- Security: unauthorized cancellation, scope bypass

**Completion Criteria**: As before, with jobs proven to run on schedule and
the health check firing on a simulated stall.

---

### Phase 7 — Emergency Access

**Purpose**: Emergency contact configuration, request workflow with OTP
verification, owner approval, auto-grant timeout, scoped time-limited access.

**Dependencies**: Phase 4, Phase 5

**Major Modules**:
- Contact designation for an existing beneficiary with designation email +
  personal request link (FR-J001, Clarifications 2026-09-18); public
  request/verify endpoints (email OTP, rate-limited per IP and per config)
  (FR-J002, J003); owner notification and approve/deny with reverification
  (FR-J004, J005; approval and auto-grant enqueue `access.deliver` — ADR-014
  § 6); timeout rules WAIT / AUTO_GRANT / DENY and request expiry
  via `ea.auto-decide` / `ea.expire` jobs (FR-J006, J007); EMERGENCY_ACCESS
  tokens consumed through the shared `/access` endpoints (FR-J008);
  revocation (FR-J010); audit (FR-J009)
- Frontend: owner configuration page; public request/verify/status pages
- Tests: full lifecycle incl. attempts limit, all timeout rules, scope
  enforcement, expiry (T236)

**Security Considerations**: multi-step verification, OTP hashed + expiring +
attempt-limited, scope never exceeds owner authorization, owner always
notified, every event audited.

**Testing Requirements**: unit (OTP, scope, expiry), integration (full
lifecycle incl. auto-grant and expiry via jobs), security (scope bypass,
expired access, brute-force OTP).

---

### Phase 8 — AI Features

**Purpose**: Provider abstraction, assistant, will generator, document
analysis — server-side, validated, confirmation-gated.

**Dependencies**: Phase 3, Phase 5

**Major Modules**:
- `lib/ai`: provider interface, OpenAI + Gemini providers, factory with
  fallback (FR-R001, R010), validation service (FR-R003–R005), versioned
  prompts and Zod output schemas (structured outputs), usage tracking
- Assistant (streaming Route Handler, disclaimer in every response,
  session-scoped client-held history — max 20 turns sent with each message,
  never persisted; `GET /ai/assistant/interactions` returns sanitized
  metadata only) (FR-L001–L009)
- AI draft persistence (`ai_drafts` / `ai_draft_versions`,
  `lib/services/ai/draft.service.ts`, encrypted content, sanitized
  `ai_interactions` — ADR-016, T233)
- Will Generator (NL input extraction, structured draft, edit → USER version,
  regenerate, consistency validation, `confirm_ai_draft()`, PDF export of the
  confirmed version via `@react-pdf/renderer`) (FR-M001–M014)
- Document Analysis as a job (`ai.analyze-document`: download from private
  bucket, text extraction, OCR hook, structured findings with confidence
  stored as a DOCUMENT_ANALYSIS draft), status polling, selective
  confirmation via `confirm_analysis_findings()` (FR-N001–N008)
- Tests: validation heuristics, provider fallback, schema failures,
  disclaimer presence (T232); `docs/AI_MODULE.md` (T244)
- Frontend chat, generator, analysis UIs with AI-generated labels and
  disclaimers

**Security Considerations**: keys server-only; document content never logged;
AI never mutates authoritative records; rate limits on AI endpoints; graceful
degradation.

**Testing Requirements**: provider abstraction and fallback, schema
validation failures, hallucination/uncertainty flagging, confirmation gates,
outage simulation.

---

### Phase 9 — Video Legacy

**Purpose**: Resumable video upload to private storage, validation and
scanning as a job, assignment and delivery conditions.

**Dependencies**: Phase 4, Phase 5, Phase 6

**Major Modules**:
- `POST /videos/uploads` → TUS resumable target in `quarantine`;
  `…/complete` → size ≤ 500 MB + container check → `video.process` job
  (scan, metadata) → promote to `videos` (FR-K001–K003)
- Metadata, beneficiary assignment, delivery conditions, expiring access,
  audited playback URLs (FR-K004–K008)
- Frontend upload with progress/resume (`tus-js-client`), player modal

**Security Considerations**: private bucket, owner-prefixed quarantine write
policy only, delivery-condition enforcement server-side, no direct URLs.

**Platform prerequisite**: Supabase file-size limit ≥ 500 MB verified.

---

### Phase 10 — Security Center & Administration

**Purpose**: Security Center dashboard and Super Admin interfaces.

**Dependencies**: Phase 1, Phase 2

**Major Modules**:
- Security Center: status/score, Clerk-backed session list and revocation,
  login history and security audit history from `audit_log`, alerts,
  password/MFA management through Clerk's user profile (FR-O001–O009)
- Admin: user search/management, role assignment (DB), platform audit logs,
  analytics (registrations, active users, storage usage), support operations
  via Clerk Backend API (unlock, MFA reset) — all `SUPER_ADMIN` +
  reverification for role/MFA changes, audited (FR-P001–P007, P011, P012)

---

### Phase 11 — Notifications & UI Polish

**Purpose**: Notification system and UI/UX polish.

**Dependencies**: Phases 1–10

**Major Modules**:
- `NotificationService` (in-app rows + `notification.deliver` job → Email
  provider with retry/backoff; delivery webhook updates status)
- Events wired from all modules (auth via Clerk webhooks, beneficiary
  invitations, DMS reminders/escalations, emergency access, document sharing,
  conditional release)
- UI polish pass (dark-first refinement, glass/gradients, page transitions,
  GSAP sequences, micro-interactions, skeletons, empty/error/success states,
  reduced-motion, responsive audit, theme toggle)

---

### Phase 12 — Testing & Hardening

**Purpose**: Comprehensive testing, security hardening, performance.

**Dependencies**: Phases 0–11

**Major Modules**:
- Authorization matrix (role × resource × operation) at both service and RLS
  layers; cross-user isolation; token security; upload attack vectors;
  rate-limit effectiveness; CSRF check; webhook/cron secret handling; RLS
  policy review; bucket privacy review
- E2E journeys (registration → onboarding; will → finalize; beneficiary →
  assign → token; upload → share; DMS lifecycle; emergency access lifecycle;
  AI assistant; AI will → confirm)
- Performance: p95 API latency under load (k6 against preview), query plans
  and indexes, bundle analysis, lazy loading
- Accessibility audit: automated axe + contrast in Playwright (T237) plus
  manual screen-reader pass; error-response leak audit; log-content audit
- E2E critical journeys and the authorization matrix as executable tests
  (T241); CI gate blocks merges on failing security tests (T246)
- Pre-production security review (NFR-SEC-002) documented in
  `docs/SECURITY_REVIEW.md`; ADR-013 activation decision recorded

---

### Phase 13 — Deployment & Production Readiness

**Purpose**: Production environments, CI/CD gates, monitoring, backups.

**Dependencies**: Phase 12

**Major Modules**:
- Environments: Vercel (preview/production) + Supabase (staging/prod
  projects) + Clerk (dev/prod instances); env vars in Vercel; secret rotation
  procedure
- CI/CD (T238): build → lint → type-check → test → security scan → migration
  dry-run → deploy; preview per PR, staging on main, production behind manual
  approval; gated `supabase db push`; rollback procedure and drill
- Production security: HTTPS (platform), headers/CSP verified, Vercel WAF
  rate-limit rules, dependency scanning
- Backups/DR: Supabase daily backups + PITR (prod), `pg_dump` off-platform
  copies, restore drill, `docs/DISASTER_RECOVERY.md`
- Monitoring (T239): Sentry alert rules and routing, Vercel log drains with
  retention, external uptime monitor on `/api/v1/health`, DMS scan freshness
  alert, `pg_cron` redundant trigger enabled (T211)
- Key management (T240): `ENCRYPTION_KEY_PREVIOUS` dual-read window,
  `scripts/rotate-encryption-key.ts`, rotation runbook
- ClamAV scanner hosting provisioned per ADR-015 (owner decision)
- Documentation finalization: `docs/DEPLOYMENT.md`, API spec, runbooks

---

## Documentation Plan

| Document | Create During | Description |
|----------|:------------:|-------------|
| `docs/BRAIN.md` | ✅ Exists (moved 2026-09-18) | Project knowledge — update incrementally |
| `docs/ARCHITECTURE_DECISIONS.md` | ✅ Exists | ADR log (authoritative for architecture) |
| `docs/PROJECT_STATUS.md` | ✅ Exists | Current implementation state snapshot |
| `docs/DEPLOYMENT.md` | Phase 0 → 13 | Environments, prerequisites, env vars, migration deploy, cron, WAF, runbooks |
| `docs/PRD.md` | Phase 0 | Product requirements (derived from spec.md) |
| `docs/FRD.md` | Phase 0 | Functional requirements (derived from spec.md) |
| `docs/architecture/SYSTEM_ARCHITECTURE.md` | ✅ Exists (pre-implementation baseline) → update T175 | Architecture overview, request pipeline, job flow, diagrams |
| `docs/ui/DESIGN_SYSTEM.md` | ✅ Exists → update T234 (no separate `UI_UX_GUIDELINES.md`) | Design system, components, patterns |
| `docs/ROADMAP.md` | Phase 0 | Release roadmap and phasing |
| `docs/product/CHANGELOG.md` | ✅ Exists → update per phase (T234) | Change log |
| `docs/RBAC.md` | Phase 1 | Roles, permission matrix, service + RLS authorization flow |
| `docs/security/SECURITY_ARCHITECTURE.md` (+ `THREAT_MODEL.md`, `ENCRYPTION.md`) | ✅ Exists → update T178 (no separate `SECURITY.md`) | Security architecture, Clerk configuration, RLS model, threat model, T203 outcome |
| `docs/SUPPORT_RUNBOOK.md` | Phase 7 (US17) | Account-recovery support process for lost password + MFA device |
| `docs/DATABASE_SCHEMA.md` | Phase 2 (T242) | Entities, relationships, indexes, policies, grants, functions |
| `docs/API_SPECIFICATION.md` | Phase 2 | Full endpoint documentation |
| `docs/BUSINESS_RULES.md` | Phase 4 (T243) | Allocation rules, beneficiary lifecycle, finalization, DMS/EA rules, access scope |
| `docs/FEATURES.md` | Phase 3+ | Feature documentation (incremental) |
| `docs/AI_MODULE.md` | Phase 8 (T244) | AI architecture, prompts, schemas, validation, draft persistence |
| `docs/SECURITY_REVIEW.md` | Phase 12 | Pre-production security review findings |
| `docs/DISASTER_RECOVERY.md` | Phase 13 | Backup schedule, restore procedure, RTO/RPO |

## Complexity Tracking

No constitution violations detected under v2.0.1. No complexity
justifications required. Decisions that intentionally *avoid* complexity
(single application, no ORM, no separate queue infrastructure) and their
revisit triggers are recorded in ADR-001, ADR-002, ADR-006 and ADR-007.
