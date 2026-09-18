# LegacyVault AI — Project Brain

> **Purpose**: Persistent high-level project context for all contributors and
> AI coding agents. This document is the runtime knowledge companion to the
> [constitution](../.specify/memory/constitution.md) (v2.0.1) and the
> [architecture decision records](./ARCHITECTURE_DECISIONS.md). It MUST NOT
> contradict either; when it does, the constitution and ADRs win.
>
> **Location**: `docs/BRAIN.md` (constitution XVIII). A pointer stub remains at
> the repository root.
>
> **Last Updated**: 2026-09-18 (r2, post-analysis remediation)
>
> **Status Legend**:
> ✅ Completed | 🔧 In Progress | 📋 Planned | ⬜ Not Started | 🔍 Needs Review | ⏸️ Deferred

---

## 1. Project Identity

| Field                  | Value                                                       |
|------------------------|-------------------------------------------------------------|
| **Project Name**       | LegacyVault AI                                              |
| **Product Category**   | AI-Powered Digital Legacy Platform                          |
| **Product Purpose**    | Enable users to securely organize, manage, protect, and transfer their digital and physical legacy to authorized beneficiaries |
| **Core Problem**       | Legacy planning is fragmented, insecure, legally ambiguous, and rarely digitized. Families lose access to assets, documents, and wishes when a loved one becomes incapacitated or passes away |
| **Target Users**       | Individuals planning their digital and physical legacy; families and beneficiaries receiving legacy information (via scoped tokens, no accounts); organizations (deferred to a multi-tenancy phase) |
| **Core Value Proposition** | A single, secure, AI-assisted platform that consolidates legacy planning — wills, assets, documents, beneficiaries, and final wishes — with intelligent automation, strong encryption, and legally informed (not legally binding) guidance |

---

## 2. Product Scope

All features listed below are **📋 Planned** unless otherwise indicated. No
application features have been implemented yet.

### Core Modules (Planned)

| Module                     | Description                                                                 | Status      |
|----------------------------|-----------------------------------------------------------------------------|-------------|
| Digital Will / Legacy Plan | Create, manage, and store structured legacy plans and will drafts           | 📋 Planned  |
| Beneficiary Management     | Add, edit, remove beneficiaries; assign allocations; define relationships   | 📋 Planned  |
| Financial Asset Management | Record and organize bank accounts, investments, insurance, retirement info  | 📋 Planned  |
| Physical Asset Management  | Record real estate, vehicles, valuables, and other physical property        | 📋 Planned  |
| Digital Asset Management   | Record online accounts, crypto wallets, digital subscriptions, domains      | 📋 Planned  |
| Secure Document Vault      | Upload (direct-to-storage), validate, scan, organize, permission-control documents | 📋 Planned |
| Dead Man Switch            | Automated inactivity detection and scoped conditional information release  | 📋 Planned  |
| Emergency Access           | Controlled emergency access for designated contacts with verification      | 📋 Planned  |
| Video Legacy               | Record/upload and store personal video messages for beneficiaries           | 📋 Planned  |
| AI Assistant               | Conversational AI to guide users through legacy planning workflows         | 📋 Planned  |
| AI Will Generator          | AI-assisted will and legacy document drafting with user confirmation        | 📋 Planned  |
| AI Document Analysis       | AI-powered analysis and summarization of uploaded documents                 | 📋 Planned  |
| Security Center            | Dashboard for security settings, sessions (Clerk-backed), activity logs    | 📋 Planned  |
| Admin Dashboard            | Super Admin management interfaces (Org Admin deferred)                     | 📋 Planned  |

---

## 3. Current Repository State

**Inspected on**: 2026-09-18
**Git status**: two commits — `fd11acc` (2026-09-16: `.specify/`, `specs/`,
`BRAIN.md`) and the baseline checkpoint **`4cac2d3`** (2026-09-18: constitution
v2.0.1, ADRs, Spec Kit artifacts, `docs/` layer, scaffold, configs). The r4
post-gate documentation remediation was committed as `affa27f`; the only
uncommitted change is the 2026-09-19 probe cleanup. Branch: `master`. `.agents/`, `.agents-backup/` and
`.env.local` are ignored.

### Actual Repository Structure

```
legacyvault-ai/
├── .agents/skills/                # 70 agent skills (Clerk, Supabase, Vercel, shadcn, GSAP, speckit-*, …) — gitignored
├── .agents-backup/skills/         # copies of the 10 speckit-* skills — gitignored
├── .specify/                      # Spec Kit v1.0.7 (agy integration, PowerShell scripts, templates)
│   └── memory/constitution.md     # ✅ v2.0.1 (amended 2026-09-18)
├── specs/001-baseline-product-spec/
│   ├── spec.md                    # ✅ FR text unchanged; Clarifications extended r2/r3; status "Baseline Complete — Implementation Pending"
│   ├── research.md · plan.md · tasks.md · data-model.md · quickstart.md · contracts/api-contracts.md   # ✅ revised 2026-09-18
│   └── checklists/requirements.md
├── docs/
│   ├── ARCHITECTURE_DECISIONS.md  # ✅ ADR-001 … ADR-016
│   ├── PROJECT_STATUS.md          # ✅ state snapshot
│   ├── BRAIN.md                   # ✅ this file
│   └── README.md + topic folders  # architecture/ database/ development/ integrations/ monitoring/ product/ security/ ui/ workflows/
├── app/                           # Next.js 16.3.5 scaffold (template page, root layout, globals.css); the temporary db-test probe was removed 2026-09-19
├── lib/supabase/{client,server}.ts   # scaffold-era Supabase clients (no importers) — replaced by lib/db/server.ts and deleted in T028
├── public/                        # template SVGs
├── BRAIN.md                       # pointer stub → docs/BRAIN.md
├── AGENTS.md · CLAUDE.md          # Next.js 16 agent guidance (auto-generated by `next dev`)
├── package.json                   # next 16.3.5, react 19.2.8, @supabase/ssr, @supabase/supabase-js, tailwind v4, pnpm
├── .env.local                     # Supabase URL + publishable key (gitignored; never committed)
└── next.config.ts · tsconfig.json · eslint.config.mjs · postcss.config.mjs
```

### What Actually Exists

| Item                                   | Type              | Status        |
|----------------------------------------|-------------------|---------------|
| `.specify/` infrastructure             | Configuration     | ✅ Completed  |
| Constitution v2.0.1                    | Governance doc    | ✅ Completed  |
| Spec Kit skills & templates            | Tooling           | ✅ Completed  |
| Baseline spec + plan + tasks (revised) | Specification     | ✅ Completed  |
| Architecture decision records          | Governance doc    | ✅ Completed  |
| Next.js 16 application at repo root    | Application shell | 🔧 Phase 1 setup done (landing page, layout, design tokens, shadcn/ui, API/query clients, proxy, env schema, tests); no feature pages |
| Supabase packages (scaffold clients)   | Scaffold          | 🔧 Exists until T028; probe removed 2026-09-19 |
| Application features                   | —                 | ⬜ Not started |
| Clerk integration                      | —                 | ⬜ Not started |
| Database schema / migrations           | SQL migrations    | ✅ 0001–0003 applied locally (T018/T218/T019); hosted push pending |
| Tests                                  | —                 | ⬜ Not started |
| CI/CD                                  | —                 | ⬜ Not started |
| Deployment (Vercel)                    | —                 | ⬜ Not started |

> **Important**: No application feature, migration, API handler, auth
> integration, job runner, or test exists (the temporary connectivity probe
> was removed on 2026-09-19). The repository contains governance,
> specification, and a bare scaffold.

---

## 4. Architecture

> **Status**: ✅ Decided (ADR-001 … ADR-016, 2026-09-18) — 📋 not yet built.

### Baseline Architecture in One Paragraph

One **Next.js 16 + TypeScript** application at the repository root (App
Router, React 19). UI = Server/Client Components with Tailwind v4, shadcn/ui,
Framer Motion, GSAP. API = **Route Handlers under `app/api/v1/**`** running a
shared `withApi()` pipeline (correlation id → Clerk auth → CSRF check → rate
limit → Zod validation → service call → envelope → safe errors). Business
logic lives in `lib/services`, data access in `lib/repositories`.
**Clerk** is the only authentication system. **Supabase** provides managed
**PostgreSQL** (SQL migrations, RLS on every table, transactional SQL
functions) and **private object storage** (quarantine → validate/scan →
promote; signed URLs). Background work = **PostgreSQL job table drained by
Vercel Cron** (+ `pg_cron` redundancy in production) — **no Redis/BullMQ**.
AI = in-house provider abstraction over **OpenAI + Gemini** with structured,
validated outputs and confirmation gates. Email = abstraction with **Resend**.
Observability = **Sentry + pino structured logs + health checks**. Deployed on
**Vercel** with Supabase and Clerk environments per stage.

### Directory Structure (target)

```
legacyvault-ai/
├── app/                      # routes: (marketing) (auth) (dashboard) (admin) (public) + api/v1, api/webhooks, api/internal/cron
├── components/               # ui, layout, forms, data-display, feedback, wizard, shared
├── hooks/ · stores/ · styles/ · emails/
├── lib/
│   ├── api/                  # with-api.ts pipeline, errors, validate, client, query-client
│   ├── auth/                 # requireUser, requireRole, reverification, ensureAppUser (Clerk)
│   ├── db/                   # Supabase server clients (user-scoped + service), generated types
│   ├── repositories/ · services/ · services/ai/
│   ├── ai/                   # provider interface, openai, gemini, factory, validation, prompts, schemas
│   ├── email/ · storage/ · jobs/ · security/ · audit/ · observability/ · config/ · validators/ · types/
├── supabase/                 # config.toml, migrations/*.sql, seed.sql
├── scripts/ · tests/{unit,integration,e2e} · docs/ · specs/ · .specify/
├── proxy.ts                  # clerkMiddleware + CSP nonce (Next 16 convention)
├── vercel.json               # cron schedules
└── next.config.ts · package.json · .env.example
```

Full tree and phase plan: `specs/001-baseline-product-spec/plan.md`.

### Technology Stack (Decided)

| Layer                 | Technology                                                            | ADR | Status |
|-----------------------|-----------------------------------------------------------------------|-----|--------|
| Application           | Next.js 16 (App Router), React 19, TypeScript 5 — single app          | 001 | ✅ Decided |
| UI                    | Tailwind CSS v4, shadcn/ui, Framer Motion, GSAP, TanStack Query, Zustand, react-hook-form | 001 | ✅ Decided |
| API                   | Route Handlers, versioned REST `/api/v1`, JSON envelope, `withApi()`  | 001 | ✅ Decided |
| Validation            | Zod (server mandatory; shared with forms)                             | 001 | ✅ Decided |
| Authentication        | Clerk (sessions, MFA TOTP + backup codes, lockout, reverification, webhooks) | 003 | ✅ Decided |
| Authorization         | Service-layer checks (primary) + PostgreSQL RLS keyed on Clerk subject (secondary) | 004 | ✅ Decided |
| Write protection      | Privilege baseline (`REVOKE ALL` from anon/authenticated) + Class A column allow-lists + Class B guarded `SECURITY DEFINER` functions + Class C service-only tables | 004 r2 | ✅ Decided |
| External access       | All recipients are Beneficiary records; one `access_tokens` entity (DIRECT_SHARE / DMS_RELEASE / EMERGENCY_ACCESS); token exchanged once for an encrypted httpOnly access cookie — never in URL paths | 014 | ✅ Decided |
| Malware scanning      | ClamAV (`clamd` INSTREAM) behind `MalwareScanner`; production refuses `noop`; scan gates promotion | 015 | ✅ Decided (hosting: owner) |
| AI drafts             | `ai_drafts` + immutable `ai_draft_versions` (encrypted content); `ai_interactions` stays sanitized | 016 | ✅ Decided |
| Database              | PostgreSQL on Supabase; SQL migrations via Supabase CLI; no ORM       | 002 | ✅ Decided |
| Object storage        | Supabase Storage private buckets; two-step direct upload; signed URLs | 005 | ✅ Decided |
| Background processing | PostgreSQL `jobs` table + Vercel Cron; `pg_cron` redundancy           | 006 | ✅ Decided |
| Rate limiting         | Clerk attack protection + Vercel WAF + Postgres-backed app limiter    | 007 | ✅ Decided |
| AI                    | OpenAI + Gemini behind in-house `AIProvider`; structured outputs      | 008 | ✅ Decided |
| Email                 | `EmailProvider` abstraction; Resend + React Email                     | 009 | ✅ Decided |
| Monitoring            | Sentry, pino JSON logs + correlation IDs, `/api/v1/health`, metrics   | 010 | ✅ Decided |
| Deployment            | Vercel + Supabase + Clerk; GitHub Actions CI; gated migrations        | 011 | ✅ Decided |
| Field encryption      | AES-256-GCM (Node crypto), key in server env                          | —   | ✅ Decided |
| File-body encryption  | Provider AES-256 at rest (baseline); app envelope encryption           | 013 | ⏸️ Deferred |
| **Not used**          | Express.js, Prisma, S3/MinIO, Redis/BullMQ, Supabase Auth, MongoDB, Multer, Puppeteer | — | ❌ Excluded |

### Request Pipeline (replaces Express middleware)

```
Route Handler → withApi({ auth, reverification?, rateLimit?, schema? })
  → correlation id → Clerk auth() → ensureAppUser → role check
  → CSRF origin check (mutations) → rate limit → Zod validation
  → service (business logic) → repository → PostgreSQL / Storage / Clerk API
  → { success, data, meta } | safe error envelope (+ Sentry)
```

- Business logic MUST live in `lib/services`, never in handlers, Server
  Components or Server Actions (constitution VIII).
- Server Components call services directly (no HTTP round-trip to own API).

---

## 5. Data Architecture

> **Status**: ✅ Decided — see `specs/001-baseline-product-spec/data-model.md`
> (revised 2026-09-18) and ADR-002/004.

| Decision                     | Status        | Notes                                    |
|------------------------------|---------------|------------------------------------------|
| Primary database engine      | ✅ Decided    | PostgreSQL (Supabase-managed; 17 on new projects) |
| Schema management            | ✅ Decided    | SQL migrations in `supabase/migrations/`, Supabase CLI; generated TS types |
| Data access                  | ✅ Decided    | typed `supabase-js`; transactional workflows as SQL functions via `rpc()` |
| Row Level Security           | ✅ Decided    | enabled on every table; policies on `auth.jwt()->>'sub'` = `clerk_user_id` |
| File storage provider        | ✅ Decided    | Supabase Storage, private buckets `quarantine`/`documents`/`videos` |
| Background job store         | ✅ Decided    | `jobs` table (SKIP LOCKED claiming)      |
| Cache layer                  | ✅ Decided    | none for baseline (no Redis)             |
| Search engine                | ⬜ Undecided  | If needed for document search            |

### Data Domains (29 entities)

Users (profile + role for a Clerk identity), Beneficiaries (the single record
type for every external recipient), Financial / Physical / Digital Assets,
Documents + Versions, Folders, **Document Attachments**, Legacy Plans +
Versions, Video Messages, Dead Man Switch + **Contacts** + Events, Emergency
Access Configs + Requests, Beneficiary Assignments, **Access Tokens**, Audit
Log (append-only), AI Interactions (sanitized), **AI Drafts + Versions**,
Notifications, **Jobs**, **Upload Sessions**, **Rate Limit Buckets**,
**Processed Webhook Events**. **Sessions are externalized to Clerk** (no
table). Every table has a write class (A/B/C) — see `data-model.md`
§ Write-Protection Model.

### Storage Requirements (from Constitution)

- Sensitive database fields: application AES-256-GCM (key in server env).
- Storage objects and database disks: provider-managed AES-256 at rest.
- Data in transit: TLS 1.2+ (platform).
- Files: private buckets only; server-minted signed URLs (15 min default).
- Encryption keys managed separately from the data they protect.

---

## 6. Security Model

> **Status**: 📋 Planned — derived from the constitution and ADRs. Nothing implemented.

| Category                  | Requirement                                                          | Mechanism (baseline)                                  | Constitution |
|---------------------------|----------------------------------------------------------------------|-------------------------------------------------------|--------------|
| Authentication            | Strong authentication, MFA                                           | Clerk: email/password policy, verification, TOTP + backup codes | III |
| Session Management        | Secure tokens, expiry, rotation, revocation                          | Clerk sessions (httpOnly/secure/SameSite, 24 h), Backend API revocation | III |
| Re-authentication         | Step-up for sensitive ops                                            | Clerk reverification (`strict` / `multi_factor`)      | III |
| Authorization             | Server-side on every protected resource                              | `requireUser`/`requireRole` + service ownership checks; RLS + column grants + guarded functions as second barrier (ADR-004 r2) | I, III |
| Invariant protection      | No self-role escalation, no direct allocation/status/scan tampering | Class B tables have no direct write grants; `SECURITY DEFINER` functions with auth prologue, `FOR UPDATE` ownership, in-transaction audit | I, VII |
| External access tokens    | Bearer secrets never in URLs or logs                                 | One-time exchange → encrypted httpOnly cookie (`Path=/api/v1/access`, 30-min sliding); per-request revocation check (ADR-014) | I, XI |
| RBAC                      | Super Admin, User (Org Admin / Team Manager deferred)                | `users.role` in PostgreSQL (source of truth)          | III |
| Encryption at Rest        | AES-256 or equivalent                                                | App AES-256-GCM fields; provider AES-256 objects/disks | IV |
| Encryption in Transit     | TLS 1.2+                                                             | Vercel / Supabase / Clerk TLS                          | IV |
| Key Management            | Keys separate, never hard-coded                                      | Vercel env (server-only), versioned `keyId`           | IV |
| File Storage              | Private, signed URLs, no public buckets                              | Supabase private buckets; quarantine → promote; storage RLS | IV |
| Input Validation          | Server-side schema validation                                        | Zod in `withApi()` (422 field errors)                 | X |
| API Security              | Injection, XSS, CSRF, IDOR, brute force                              | Parameterized queries, CSP nonce, Origin check, ownership checks, Clerk lockout | XI |
| Rate Limiting             | Auth, sensitive ops, public APIs                                     | Clerk + Vercel WAF + Postgres limiter                  | XI |
| File Upload Security      | Type, size, extension, magic bytes, malware scanning                 | Declared + actual checks; `file-type`; ClamAV scan gates promotion (`SCANNED_CLEAN`); production refuses `noop` (ADR-015) | XI |
| Audit Logging             | Tamper-resistant logs                                                | Append-only `audit_log` + trigger; webhook-sourced auth events | XII |
| Secrets Management        | No secrets in code/commits                                           | `.env*` ignored; Vercel env; no `NEXT_PUBLIC_` secrets | I, IV |
| Privacy                   | Minimization, no cross-user exposure, no prod data in dev            | City/country only for device detection; RLS; env isolation | II |
| Error Handling            | No internal details to clients                                       | `ApiError` envelope; full detail only in logs/Sentry   | X |
| Observability             | Structured logging without sensitive data                            | pino redaction; correlation ids                        | XVI |
| Secure Headers            | HSTS, CSP, X-Frame-Options                                           | `next.config.ts` headers + nonce CSP in `proxy.ts`    | XXI |
| Internal endpoints        | Webhooks / cron authenticated                                        | Svix signatures; `CRON_SECRET` bearer                  | I |

### Security Architecture (Planned)

```
Client Request
  ├── TLS (platform)
  ├── Vercel WAF rate limits (edge)
  ├── proxy.ts: clerkMiddleware route protection (UX layer) + CSP nonce
  ├── Route Handler → withApi()
  │     ├── correlation id
  │     ├── Clerk auth() → app user → role (DB)
  │     ├── reverification (if required)
  │     ├── CSRF origin check (mutations)
  │     ├── Postgres rate limiter
  │     └── Zod validation
  ├── Service (authorization of record, business rules, encryption)
  ├── Repository → PostgreSQL (RLS second barrier) / Storage (private, signed URLs)
  ├── Audit Logger (actor, action, resource, outcome, correlation id)
  └── Error Handler (safe envelope) + Sentry
```

---

## 7. AI Architecture

> **Status**: ✅ Decided (ADR-008) — 📋 not built.

```
AIProvider (lib/ai/provider.ts): generateText · generateStructured<T>(zod) · stream
  ├── OpenAI provider   (openai SDK, structured outputs)
  └── Gemini provider   (@google/genai, responseSchema)
Factory: AI_DEFAULT_PROVIDER + outage fallback
Validation: completeness, unsupported claims, fabricated references, confidence
Prompts: versioned templates · Schemas: Zod output schemas
```

- All AI calls originate server-side (Route Handlers or job handlers); keys
  are server-only.
- Assistant streams from a Route Handler; document analysis runs as a job with
  persisted progress.
- Every response carries the legal disclaimer; nothing AI-generated becomes
  authoritative without an explicit confirmation endpoint.

| Feature                  | Status      |
|--------------------------|-------------|
| AI Assistant             | 📋 Planned  |
| AI Will Generator (+ PDF export via @react-pdf/renderer) | 📋 Planned |
| Document Analysis (job-based; OCR hook) | 📋 Planned |
| Recommendations / Validation | 📋 Planned |
| Voice input (FR-L010)    | ⏸️ Deferred |

---

## 8. Core Business Rules

> **Status**: 📋 Planned — unchanged from the specification. Enforcement points
> updated for the new architecture.

- **Beneficiaries**: the single record type for beneficiaries, trusted
  contacts and emergency contacts; no duplicate email per user; lifecycle
  PENDING → ACTIVE (first access-link use) ⇄ INACTIVE (owner; tokens
  revoked); removal cascades (assignments, tokens, DMS/EA links) via
  `remove_beneficiary()`; Σ allocation **per resource** ≤ 100 % enforced only
  inside `assign_beneficiary()` (no direct writes); authoritative changes
  require `confirmed: true`; all changes audited (Clarifications 2026-09-18).
- **Assets**: owned by the creating user; sensitive fields app-encrypted;
  plaintext view requires Clerk reverification and is audited.
- **Documents**: permissions enforced server-side (owner / access-cookie
  scope); uploads pass declared + actual validation and malware scanning
  before promotion; documents attach to assets and to the plan through
  `document_attachments`; access via 15-minute signed URLs; audited.
- **Legacy plan finalization**: Personal Details must be complete; any other
  incomplete section may be acknowledged (`acknowledgedIncomplete` + list
  recorded in the version snapshot); plan sections released to recipients
  always come from the latest finalized version.
- **Dead Man Switch**: data-driven schedule (`next_check_in_at`), hourly scan
  enqueues idempotent jobs; escalation reminder → secondary → trusted contact
  → release of **user-selected resources only**; recovery at every stage with
  reverification; health check + redundant trigger; all transitions audited.
- **Emergency Access**: contact = beneficiary with a config; designation
  email carries the personal request link; email-OTP verification (3
  attempts, 15 min); owner approve/deny with reverification; timeout rule per
  contact — WAIT (default, request expires after 72 h), AUTO_GRANT, DENY;
  time-limited scoped access via the shared access-token/cookie mechanism;
  owner revocation; audited.
- **User Confirmation**: AI drafts, findings and beneficiary designations are
  never persisted as authoritative without explicit confirmation.
- **Auditability**: authentication events (via Clerk webhooks), document
  access, permission changes, beneficiary changes, emergency access, DMS
  events, AI confirmations, admin actions — all with actor, timestamp,
  action, resource, outcome, correlation id.

---

## 9. UI/UX System

> **Status**: 📋 Planned — unchanged (constitution XIII/XIV). Tailwind v4 is
> CSS-first: tokens live in `app/globals.css` `@theme`, not a
> `tailwind.config.ts`.

Dark-first with light mode; glassmorphism and restrained gradients;
blue/purple/cyan accents; Framer Motion + GSAP with `prefers-reduced-motion`
respected; WCAG 2.1 AA; responsive desktop/tablet/mobile; shadcn/ui
foundation; explicit loading/error/success states.

---

## 10. Roles and Permissions

> **Status**: ✅ Decided model — 📋 not implemented.

| Role         | Scope          | Source of truth | Key Permissions |
|--------------|----------------|-----------------|-----------------|
| Super Admin  | Platform-wide  | `users.role`    | User management, role assignment, platform audit logs, analytics, support ops (Clerk Backend API) |
| User         | Self-scoped    | `users.role`    | Own legacy data, beneficiaries, assets, documents, settings |
| Beneficiary (any recipient) | Access-cookie scoped | `access_tokens` (grant type DIRECT_SHARE / DMS_RELEASE / EMERGENCY_ACCESS) | Read-only access to the token's scope (documents, assets, videos, plan sections); no account |
| Org Admin / Team Manager | — | — | ⏸️ Deferred (multi-tenancy) |

- Authorization is enforced in the service layer on every operation and
  mirrored by RLS; proxy/layout guards are UX only.
- Reverification levels: `strict` for sensitive reads/changes; `multi_factor`
  for DMS check-in/cancel when MFA is enabled.

---

## 11. Documentation Map

| Document                          | Purpose                                        | Status        |
|-----------------------------------|-------------------------------------------------|---------------|
| `docs/BRAIN.md`                   | High-level project context (this file)          | ✅ Current    |
| `docs/ARCHITECTURE_DECISIONS.md`  | ADR log — authoritative for architecture        | ✅ Current    |
| `docs/PROJECT_STATUS.md`          | Implementation state snapshot                   | ✅ Current    |
| `.specify/memory/constitution.md` | Engineering constitution v2.0.1                 | ✅ Current    |
| `specs/001-baseline-product-spec/*` | Spec, research, plan, tasks, data model, contracts, quickstart | ✅ Current |
| `docs/README.md`                  | Documentation map; topic explainers under `docs/{architecture,development,product,security,database,integrations,monitoring,ui,workflows}/` (2026-09-18) | ✅ Current |
| `docs/DEPLOYMENT.md`              | Environments, prerequisites, env vars, runbooks | ⬜ Not Started (T202; `docs/development/ENVIRONMENT_MATRIX.md` holds the pre-implementation matrix) |
| `docs/SECURITY.md`                | Security architecture, Clerk/RLS config, T203 outcome | ⬜ Not Started |
| `docs/SECURITY_REVIEW.md`         | Pre-production security review                  | ⬜ Not Started |
| `docs/DISASTER_RECOVERY.md`       | Backup/restore runbook                          | ⬜ Not Started |
| `docs/SUPPORT_RUNBOOK.md`         | Account recovery support process                | ⬜ Not Started |
| `docs/PRD.md`, `FRD.md`, `DATABASE_SCHEMA.md`, `API_SPECIFICATION.md`, `UI_UX_GUIDELINES.md`, `FEATURES.md`, `BUSINESS_RULES.md`, `RBAC.md`, `AI_MODULE.md`, `ROADMAP.md` | Per plan.md Documentation Plan | ⬜ Not Started |
| `docs/architecture/SYSTEM_ARCHITECTURE.md`, `docs/product/CHANGELOG.md` | Pre-implementation baselines for the documents scheduled by T175 / T234 (tasks still name the flat `docs/…` paths — see `docs/README.md` path notes) | 🔧 Baseline |

---

## 12. Development Workflow

All significant features MUST follow Spec-Driven Development (constitution XX):

```
Constitution → Specification → Clarification → Plan → Checklist
→ Tasks → Analysis → Implementation → Convergence
```

| Stage          | Tool / Command          | Output                               |
|----------------|-------------------------|--------------------------------------|
| Constitution   | `/speckit-constitution` | `.specify/memory/constitution.md`    |
| Specification  | `/speckit-specify`      | `specs/<feature>/spec.md`            |
| Clarification  | `/speckit-clarify`      | Updated spec                         |
| Plan           | `/speckit-plan`         | `specs/<feature>/plan.md`            |
| Checklist      | `/speckit-checklist`    | `specs/<feature>/checklists/*.md`    |
| Tasks          | `/speckit-tasks`        | `specs/<feature>/tasks.md`           |
| Analysis       | `/speckit-analyze`      | Cross-artifact consistency report    |
| Implementation | `/speckit-implement`    | Application source code              |
| Convergence    | `/speckit-converge`     | Validation against specification     |

Architecture changes additionally require an ADR in
`docs/ARCHITECTURE_DECISIONS.md` **before** implementation (constitution VIII).

---

## 13. Current Status

| Area                        | Status        | Notes                                      |
|-----------------------------|---------------|--------------------------------------------|
| Repository initialized      | ✅ Completed  | 4 commits (`fd11acc`, `4cac2d3`, `affa27f`, `e87cb9a`); Phase 1 batch uncommitted |
| Spec Kit initialized        | ✅ Completed  | `.specify/`                                |
| Agent skills installed      | ✅ Completed  | `.agents/skills` (70), gitignored                    |
| Constitution                | ✅ v2.0.1     | amended 2026-09-18 (ADR-012; 2.0.1 wording patch) |
| Baseline specification      | ✅ Completed  | FR text unchanged; Clarifications r2/r3; plan/tasks/data-model/contracts at r4 |
| Architecture decisions      | ✅ Completed  | ADR-001 … ADR-016 (ADR-004 r4, ADR-014 r4) |
| Next.js application shell   | 🔧 Phase 1    | root, v16.3.5; T001–T017, T192–T194 done; Phase 2 not started |
| Clerk integration           | 🔧 Prepared   | `@clerk/nextjs` + proxy/layout wiring; dashboard checklist ⏳ (T195) |
| Database schema / RLS       | ✅ Local      | 28 tables, RLS + allow-lists, 32 guarded / 11 system functions (0001–0003) |
| API (`/api/v1`)             | ⬜ Not Started | no Route Handlers (probe removed 2026-09-19) |
| Job runner / cron           | ⬜ Not Started |                                            |
| Storage flow                | ⬜ Not Started |                                            |
| AI integration              | ⬜ Not Started |                                            |
| UI/UX design system         | 🔧 Foundation | dark-first tokens, glass/gradient/motion utilities, shadcn/ui core (T010–T012) |
| Testing infrastructure      | 🔧 Exists     | Vitest unit/integration, Playwright, JWT/DB helpers, smoke tests (T015) |
| CI/CD                       | ⬜ Not Started |                                            |
| Deployment                  | ⬜ Not Started |                                            |

---

## 14. Important Decisions

### Confirmed Decisions (see ADRs for rationale)

| Decision                       | Choice                                                        | Source |
|--------------------------------|---------------------------------------------------------------|--------|
| Application shape              | Single Next.js 16 app; Route Handlers for `/api/v1`           | ADR-001, Constitution VIII |
| Authentication                 | Clerk (sole auth system); Supabase Auth not used              | ADR-003, Constitution III |
| Authorization                  | Service layer primary + RLS secondary; role in DB             | ADR-004 |
| Write protection               | Column allow-lists (plain fields only) + guarded `SECURITY DEFINER` functions; encrypted columns function-only; Class A audit triggers | ADR-004 r4 |
| External access               | Beneficiary = every recipient; one `access_tokens` entity; cookie exchange | ADR-014 |
| Malware scanning              | ClamAV in production; `noop` refused                          | ADR-015 |
| AI draft persistence          | `ai_drafts` + versions (encrypted); sanitized `ai_interactions` | ADR-016 |
| Database                       | PostgreSQL on Supabase; SQL migrations; no ORM               | ADR-002 |
| Object storage                 | Supabase Storage; two-step direct upload; signed URLs        | ADR-005 |
| Background processing          | Postgres job table + Vercel Cron (+ pg_cron); no Redis/BullMQ | ADR-006 |
| Rate limiting                  | Clerk + Vercel WAF + Postgres limiter                         | ADR-007 |
| AI                             | OpenAI + Gemini behind in-house abstraction; structured outputs | ADR-008, Constitution VI |
| Email                          | Abstraction; Resend baseline                                  | ADR-009 |
| Monitoring                     | Sentry + pino + health checks                                 | ADR-010 |
| Deployment                     | Vercel + Supabase + Clerk; GitHub Actions                     | ADR-011 |
| Field encryption               | AES-256-GCM, key in server env                                | research D13 |
| File-body encryption           | Provider AES-256 (baseline); app envelope deferred            | ADR-013 |
| Multi-tenancy                  | Deferred                                                      | spec clarifications |
| Visual system                  | Dark-first, glassmorphism, blue/purple/cyan                   | Constitution XIII |
| Decision priority              | Security → Integrity → Correctness → Legal-Tech Safety → Maintainability → Accessibility → Performance → Polish | Constitution XXII |

### Pending / Open Items

| Item                                              | Status        | Tracked in |
|---------------------------------------------------|---------------|------------|
| FR-A014 failed sign-in event coverage with Clerk  | 🔍 Verify     | T203 |
| Vercel / Supabase plan prerequisites (cron, `maxDuration`, 500 MB files, PITR) | 🔍 Verify | T210 (Phase 1) |
| Default branch naming (`master` vs `main`) and feature branch | ⬜ Owner decision | PROJECT_STATUS |
| `.gitignore` missing Next.js entries (`next-env.d.ts`, `*.tsbuildinfo`, `coverage/`, …); `next-env.d.ts` is tracked since `4cac2d3` and must be un-tracked | ⬜ Pending | T009 |
| Search engine for document search                 | ⬜ Undecided   | — |
| ClamAV hosting location (container platform or VM near Supabase region) | ⬜ Owner decision | ADR-015, PROJECT_STATUS |
| Audit-log retention schedule (legal)              | ⬜ Owner decision | data-model § Retention |

---

## 15. Known Risks

| Risk                               | Severity | Mitigation Strategy                                   |
|------------------------------------|----------|-------------------------------------------------------|
| Legal validity concerns            | High     | Disclaim AI output as informational; require confirmation; recommend professional review |
| Sensitive data exposure            | Critical | Service-layer authz + RLS, app field encryption, private buckets, audit, env isolation |
| AI hallucination in legal context  | High     | Structured outputs, validation heuristics, confidence indicators, mandatory confirmation |
| Unauthorized beneficiary access    | Critical | Hash-only tokens exchanged once for an httpOnly cookie (never in URLs/logs), scope enforcement, expiry + per-request revocation check, rate limits, audit |
| Privilege escalation via direct DB writes | Critical | Column allow-lists, guarded functions, `protect_identity_columns` trigger, write-protection test suite (T215) |
| Unauthorized document access       | Critical | Server authorization, storage RLS, 15-min signed URLs, quarantine gating |
| Dead Man Switch false trigger      | High     | Multi-step escalation, reverified recovery, idempotent jobs |
| Dead Man Switch scheduler outage   | High     | Health check on scan freshness → CRITICAL audit + alert; `pg_cron` redundant trigger |
| Emergency access abuse             | High     | OTP + attempts limit, owner approval/notification, scoped time-limited tokens |
| Insecure file uploads              | High     | Declared + actual validation, magic bytes, ClamAV scan gating promotion; production start-up refuses a no-op scanner |
| Serverless limits (body size, duration) | Medium | Direct-to-storage uploads; job-based long work; `maxDuration`; documented triggers for a worker (ADR-006) |
| Identity-provider dependency       | Medium   | Authorization/audit/profile data stay in our DB; Clerk export APIs; ADR-003 revisit triggers |
| Secrets leakage                    | Critical | `.env*` ignored, Vercel env, server-only modules, no `NEXT_PUBLIC_` secrets |
| Data loss                          | Critical | Supabase backups + PITR, off-platform `pg_dump`, restore drills |
| Regulatory compliance              | Medium   | Data minimization, export/deletion endpoints, privacy-by-design |

---

## 16. Roadmap

> **Status**: 📋 Proposed — phases per `plan.md`.

### Phase 0: Foundation (Current)

- [x] Initialize repository and Spec Kit
- [x] Ratify constitution (v1.0.0) and amend to v2.0.x
- [x] Baseline specification, plan, tasks
- [x] Resolve architecture drift; record ADR-001 … ADR-013
- [x] Post-analysis remediation: ADR-004 r2, ADR-014–016, spec clarifications, mandatory test tasks (T213–T247)
- [ ] Normalize the Next.js scaffold; complete `.gitignore`
- [ ] Configure Clerk, Supabase, Vercel environments; verify prerequisites
- [ ] Design tokens, tooling, CI

### Phase 1–2: Auth & Core Infrastructure
- [ ] Clerk integration, webhooks, `withApi()` pipeline, RBAC helpers, audit
- [ ] SQL migrations with RLS + functions, storage wrapper, job runner, health

### Phase 3–5: Core Features
- [ ] Legacy plan wizard; beneficiaries; assets; document vault

### Phase 6–9: Advanced Features
- [ ] Dead Man Switch; emergency access; AI features; video legacy

### Phase 10–13: Operations & Launch
- [ ] Security Center, admin, notifications, polish, testing/hardening, deployment, DR

---

## 17. AI Agent Rules

All AI coding agents working on this repository MUST:

1. **Read governance first**: the [constitution](../.specify/memory/constitution.md)
   (v2.0.1), [`docs/ARCHITECTURE_DECISIONS.md`](./ARCHITECTURE_DECISIONS.md),
   and this file before significant work.
2. **Read the Next.js 16 docs** in `node_modules/next/dist/docs/` before
   writing framework-facing code (`AGENTS.md`). Note `proxy.ts` replaces
   `middleware.ts`.
3. **Inspect before modifying**: examine the actual repository state; do not
   assume `frontend/`/`backend/` or any superseded component exists.
4. **Follow the specification and ADRs**: no feature work without the approved
   spec/plan/tasks; no Express, Prisma, S3, Redis/BullMQ, Supabase Auth or
   MongoDB without a new ADR citing a concrete requirement.
5. **Keep business logic in services**: never in Route Handlers, Server
   Components, Server Actions or UI components.
6. **Never invent implementation status**: mark tasks complete only when the
   code exists and is verified.
7. **Protect secrets**: never read values from `.env.local` into documents,
   commits, logs or prompts; only `NEXT_PUBLIC_*` variables reach the client.
8. **Preserve security boundaries**: authorization in services + RLS; every
   invariant-bearing write goes through a guarded function (never a direct
   write to a Class B table); signed URLs only; access tokens never in URL
   paths; reverification for sensitive operations; audit everything
   security-relevant.
9. **Update documentation** (`docs/BRAIN.md`, `docs/PROJECT_STATUS.md`, ADRs)
   when architecture, rules, contracts or schema change.
10. **Respect the decision hierarchy** (constitution XXII) and **mark
    uncertainty** explicitly.

---

*This document is a living reference. Update it as the project evolves.
Last verified against repository state: 2026-09-18.*
