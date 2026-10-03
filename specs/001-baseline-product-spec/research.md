# Research: LegacyVault AI — Baseline Product

**Phase**: 0 — Outline & Research | **Created**: 2026-09-16 | **Revised**: 2026-09-18 r2

**Purpose**: Resolve all NEEDS CLARIFICATION items and document technology
decisions with rationale.

> **Revision 2026-10-04 (ADR-017)** — Malware scanning was removed by owner
> decision: there is no ClamAV, no quarantine stage and no scan gate. Uploads
> go straight to the private `documents` / `videos` bucket and are promoted
> after size and magic-byte checks (`VALIDATED` → `promote_upload()`).
> FR-H016 / FR-Q011 are withdrawn. Scanner references below are historical.
>
> **Revision 2026-09-18** — Decisions re-baselined to the single Next.js
> application architecture formally adopted in
> [`docs/ARCHITECTURE_DECISIONS.md`](../../docs/ARCHITECTURE_DECISIONS.md)
> (ADR-001 … ADR-016) and constitution v2.0.1. Decisions are numbered
> sequentially in ADR order; decisions 13–17 have no ADR of their own;
> decisions 18–20 (r2, post-analysis) map to ADR-014/015/016. Each
> decision has exactly one active definition; earlier choices appear only under
> **Superseded (history)** or **Alternatives Considered**. No functional or
> security requirement changed.

---

## Technical Context Resolution

All technical context items from the plan have been resolved. No NEEDS
CLARIFICATION markers remain. One verification item (Decision 4) is tracked as
task T203.

---

## Decision 1: Application Shape — Single Next.js 16 Application (ADR-001)

**Decision**: One Next.js 16 (App Router) + React + TypeScript application at
the repository root, with clear presentation/server-side separation. Versioned
REST API served by Route Handlers under `app/api/v1/**` through a shared
`withApi()` pipeline; business logic in `lib/services`, data access in
`lib/repositories`.

**Rationale**:
- The repository is already a root-level Next.js 16.3.5 application.
- Route Handlers run on the Node.js runtime and provide the full server API
  surface; a second deployable would duplicate auth, validation, logging and
  deployment work with no requirement behind it.
- Constitution VIII layering is preserved by module boundary (handlers →
  services → repositories) rather than by process boundary.
- Serverless deployment on Vercel scales horizontally (NFR-SCL-001).

**Alternatives Considered**:
- Two applications (Next.js UI + separate Node API service): rejected — no
  requirement needs it; doubles infrastructure.
- Next.js + tRPC/GraphQL: rejected; the specification mandates versioned REST.

**Superseded (history)**: the 2026-09-16 plan's `frontend/` + `backend/`
(Express.js) layout.

---

## Decision 2: Database — PostgreSQL on Supabase (ADR-002)

**Decision**: PostgreSQL remains the database technology. Supabase is the
managed PostgreSQL platform (new projects run PostgreSQL 17; the spec's "16+"
is met). MongoDB is not used.

**Rationale**:
- ACID transactions for plan finalization, beneficiary changes and Dead Man
  Switch transitions.
- JSONB for flexible metadata; constraints, partial unique indexes, CHECKs,
  foreign keys and Row Level Security are first-class.
- Managed backups, PITR, connection pooling and object storage in one project
  remove separate infrastructure decisions.

**Alternatives Considered**:
- MongoDB Atlas: rejected — weaker transactional guarantees and relational
  integrity for allocation constraints; explicit owner directive not to switch.
- Self-hosted PostgreSQL 16: viable; rejected in favour of a managed platform
  for backups/PITR/pooling without operational burden.

---

## Decision 3: Schema Management & Data Access — SQL Migrations, no ORM (ADR-002)

**Decision**: Schema owned by SQL migrations in `supabase/migrations/`
managed with the Supabase CLI. TypeScript types generated with
`supabase gen types` into `lib/types/database.ts`. Server-side data access via
typed `@supabase/supabase-js` clients. Multi-step atomic workflows implemented
as PostgreSQL functions invoked with `rpc()` (NFR-REL-001).

**Rationale**:
- RLS policies, triggers (append-only audit log), partial indexes and
  transactional functions are SQL-native; a second schema DSL would be a
  second source of truth.
- Generated types keep queries type-safe without an ORM runtime.
- `supabase-js` has no client-side transactions; Postgres functions guarantee
  atomicity.

**Alternatives Considered**:
- Prisma: type-safe and mature; rejected to avoid dual schema ownership and
  because its migration model sits awkwardly beside RLS policies and SQL
  functions.
- Drizzle: viable; not adopted for the baseline (fewer moving parts). Candidate
  if raw query ergonomics become a measured problem.
- Knex / TypeORM: rejected (weaker typing / maintainability).

**Superseded (history)**: Prisma ORM with `schema.prisma` and
`prisma migrate` (2026-09-16 plan).

---

## Decision 4: Authentication — Clerk (ADR-003)

**Decision**: Clerk (`@clerk/nextjs`) is the sole application authentication
provider: email/password with policy (12+ chars, complexity), mandatory email
verification, TOTP MFA + backup codes, httpOnly/secure/SameSite session cookies
with 24-hour inactivity lifetime, password reset with sign-out of other
sessions, account lockout (5 attempts / 30 min) and bot protection,
multi-device session list/revocation, step-up reverification. Supabase Auth is
not used. Authorization, role (`users.role`), audit logging and profile data
remain in this application's database and server code (constitution III).

**Rationale**:
- Authentication is the highest-risk component to hand-build for a
  security-first product; a dedicated provider covers FR-A001–A018 with
  audited implementations.
- Clerk's Next.js integration (`proxy.ts` + `clerkMiddleware`, server
  `auth()`, reverification API, Backend API for sessions) maps directly onto
  the Security Center and re-authentication requirements.

**Alternatives Considered**:
- Hand-rolled sessions + password hashing + TOTP library: rejected — largest
  security surface, slowest to deliver.
- Supabase Auth: capable; rejected to have exactly one identity provider with
  first-class reverification and session-device APIs in Next.js.

**Open verification (T203)**: Clerk webhooks do not emit *failed* sign-in
attempts; FR-A014 requires logging them. Verify coverage in Phase 1 and, if
needed, implement a custom sign-in flow that reports failures to a
server-validated security-events endpoint.

**Superseded (history)**: server-side session store, bcrypt password hashing,
speakeasy TOTP, custom verification/reset tokens and lockout counters
(2026-09-16 plan, former Decisions 4 and 5).

---

## Decision 5: Authorization — Service Layer + RLS + Guarded Writes (ADR-004 r2)

**Decision**: Primary authorization in the service layer (explicit ownership
and role checks on every operation, audited). Secondary, in the database:
(1) RLS enabled on every table, `anon` has nothing, Clerk configured as a
Supabase third-party auth provider so policies compare `auth.jwt()->>'sub'`
with `users.clerk_user_id`; (2) a **privilege baseline** that revokes
Supabase's default table/function grants from `anon`/`authenticated`;
(3) **three table classes** — *A* plain user data with direct writes limited
to a column allow-list, *B* guarded tables with no direct write grants whose
mutations run only through `SECURITY DEFINER` functions (auth prologue,
`FOR UPDATE` ownership checks, invariant enforcement, in-transaction audit,
`SET search_path = ''`, typed inputs, `EXECUTE` limited to `authenticated`),
*C* system tables reachable only by the service role. Two server-only
clients remain: user-scoped (publishable key + Clerk token) and service
(secret key) for system paths that perform their own checks.

**Rationale**: Constitution I (defense-in-depth), III, VII, FR-Q001/Q002/
Q014, SC-005. Row-level policies alone allowed a user to change their own
`role`/mirrored flags or to bypass function-enforced invariants (allocation
sum, finalization, scan status, state machines); column grants + guarded
functions close that gap without a second service.

**Test strategy**: policy/function tests mint HS256 JWTs with the local
Supabase JWT secret carrying Clerk-shaped claims (`sub`, `role:
authenticated`); end-to-end tests use a Clerk development instance with
`@clerk/testing` tokens (ADR-004 r2 §7).

**Alternatives Considered**: service-role only (single barrier — rejected);
RLS only (no column/invariant protection — rejected, finding S1);
triggers-only enforcement (harder to audit and to grant selectively —
rejected as the primary mechanism; kept as belt-and-braces on `users`).

---

## Decision 6: Object Storage — Supabase Storage, private buckets (ADR-005)

**Decision**: Supabase Storage with private buckets `quarantine`, `documents`,
`videos`. Two-step upload: the server issues a signed upload URL (documents)
or a resumable TUS target (videos) into `quarantine`; the browser uploads
directly; the server `complete` step validates (actual size, magic bytes,
malware scan) and promotes to the destination bucket. Downloads only via
server-minted signed URLs (15-minute default). Provider-managed AES-256
encryption at rest; application-layer envelope encryption of file bodies is
deferred (ADR-013). Limits: 50 MB documents (FR-H002), 500 MB videos
(FR-K002).

**Rationale**:
- Vercel serverless request bodies are limited (≈4.5 MB); large files cannot
  pass through Route Handlers. Next.js guidance is to upload user files from
  the browser directly to a storage service.
- Private-by-default buckets, signed URLs and RLS on `storage.objects`
  satisfy FR-H005/H009 and FR-Q005 with one platform and credential set.

**Alternatives Considered**:
- AWS S3 + MinIO for local development: viable and the S3 API is universal;
  rejected to avoid a second platform and credential set (Supabase Storage is
  S3-backed and exposes an S3-compatible protocol if portability is needed).
- Local filesystem: not viable on serverless.

**Platform prerequisite**: Supabase project file-size limit ≥ 500 MB (Pro
plan feature) before Video Legacy work.

**Superseded (history)**: S3/MinIO, multipart upload through the API
(Multer), server-side encryption of file bytes before upload (2026-09-16
plan).

---

## Decision 7: Background Jobs — PostgreSQL Job Table + Vercel Cron (ADR-006)

**Decision**: Durable `jobs` table in PostgreSQL; a runner claims work with
`FOR UPDATE SKIP LOCKED` from a `CRON_SECRET`-protected Route Handler; Vercel
Cron triggers `run-jobs` (every 5 min), `dms-scan` (hourly), `housekeeping`
(daily). Handlers are idempotent with exponential backoff and dead-lettering.
A DMS scan-freshness health check plus a Supabase `pg_cron`/`pg_net`
redundant trigger in production protect NFR-AVL-002. **No Redis/BullMQ in the
baseline.**

**Rationale**:
- DMS timers are hour/day granularity; notifications need retry, not
  sub-second latency; AI/video/malware processing fits within function
  duration budgets when run as discrete jobs.
- No new infrastructure or credentials; enqueue can happen in the same
  transaction as the domain change (outbox pattern).

**Alternatives Considered**:
- Redis + BullMQ worker: rejected for baseline — requires a long-lived worker
  and a second data store without a requirement demanding it.
- Upstash QStash: first candidate if the revisit triggers in ADR-006 fire.
- `node-cron`: no persistence/retry; rejected.
- `pg-boss`: reasonable; a hand-rolled table with SKIP LOCKED is smaller and
  sufficient at baseline scale.

**Revisit triggers** (ADR-006): > ~1,000 due jobs per drain, < 1-minute
latency needs, job steps exceeding function duration limits, need for
transcoding.

**Superseded (history)**: Redis-backed BullMQ queues and workers (2026-09-16
plan).

---

## Decision 8: Rate Limiting without Redis (ADR-007)

**Decision**: Clerk attack protection (auth) + Vercel WAF rules (edge, per IP)
+ Postgres-backed application limiter in `withApi()` with per-route policies
(default 100/15 min per user; sensitive 5/15 min; AI 20/hour; public
emergency-access 5/hour per IP; token access 60/15 min per token). An Upstash
Redis store may replace the Postgres store behind the same interface only if
measured overhead or volume requires it (new ADR).

---

## Decision 9: AI Provider Integration Strategy (ADR-008)

**Decision**: In-house `AIProvider` interface (`generateText`,
`generateStructured<T>(zodSchema)`, `stream`) with OpenAI (`openai` SDK) and
Google Gemini (`@google/genai`) implementations; factory with
environment-selected default and outage fallback; versioned prompt templates;
Zod-validated structured outputs; validation service for completeness,
unsupported claims, fabricated references and confidence indicators;
server-only keys; explicit user confirmation before any authoritative
persistence. Assistant chat streams from a Route Handler; document analysis
runs as a job. Draft and finding persistence/versioning is Decision 20
(ADR-016); `ai_interactions` stays a sanitized usage record.

**Rationale**: Constitution VI, FR-R001–R010. Structured outputs reduce parsing
brittleness and make validation deterministic.

**Alternatives Considered**:
- LangChain: abstraction overhead; rejected.
- Vercel AI SDK: strong fit on this stack; not adopted for the baseline so the
  thin interface stays ours — it MAY be used behind `AIProvider` later.

---

## Decision 10: Email — Provider Abstraction, Resend Baseline (ADR-009)

**Decision**: `EmailProvider` interface with a Resend implementation and
React Email templates; console transport in development. Delivery events via
webhook update notification status; retries run through the job table. Clerk
sends its own verification/reset emails.

**Rationale**: Provider-agnostic; Resend is serverless-friendly and provides
delivery webhooks; React templates keep one component skill set.

**Alternatives Considered**: Nodemailer + SMTP (implementable behind the same
interface), Postmark, SES.

---

## Decision 11: Observability (ADR-010)

**Decision**: `@sentry/nextjs` with PII scrubbing; `pino` structured JSON logs
with redaction and per-request correlation id (`X-Correlation-ID`, also on
audit rows); `GET /api/v1/health` (database, storage, job heartbeat, DMS scan
freshness); Vercel Analytics/Speed Insights; security metrics from
`audit_log`.

**Alternatives Considered**: Winston with file transports (rejected — no
persistent filesystem on serverless; pino's JSON + redaction fits log drains).

---

## Decision 12: Deployment & Environments (ADR-011)

**Decision**: Vercel (preview per PR, production from main) + Supabase
projects per environment + Clerk dev/prod instances; GitHub Actions CI; gated
`supabase db push` for migrations; Supabase backups + PITR (prod) plus
`pg_dump` off-platform copies; security headers from `next.config.ts` and
nonce CSP in `proxy.ts`; Vercel WAF.

**Platform prerequisites (verify in Phase 0, T210)**: Vercel plan with
minute-level cron and adequate `maxDuration`; Supabase plan with ≥ 500 MB
file limit and PITR.

**Superseded (history)**: Docker/docker-compose for application services and
self-managed database/queue/storage containers; a local Supabase CLI stack
replaces them for development.

---

## Decision 13: Field-Level Encryption — Application-Level AES-256-GCM

**Decision**: `lib/security/encryption.ts` (Node.js `crypto`, AES-256-GCM,
per-record IV + auth tag, versioned `keyId`) for sensitive database fields
(identification details, account/policy numbers, credentials, recovery info,
OTP codes). Key from server-only environment configuration, separate from
data (FR-Q018). Encrypted columns are applied explicitly in repositories.
Application-layer encryption of *file bodies* is deferred (ADR-013).

**Alternatives Considered**: pgcrypto (key management harder), cloud KMS per
operation (latency/lock-in), transparent disk encryption alone (no
application-level key control — already provided by the platform as a second
layer).

---

## Decision 14: Schema Validation — Zod

**Decision**: Zod for server-side request validation (applied by `withApi()`
to body/params/query, 422 with field errors) and client forms
(react-hook-form + `@hookform/resolvers`).

**Alternatives Considered**: Joi (no type inference), Yup (less
TypeScript-native), AJV (more setup).

---

## Decision 15: Frontend State Management — Zustand

**Decision**: Zustand for UI and wizard state. Authentication state is owned
by Clerk's hooks (`useUser`, `useAuth`), not a store.

**Alternatives Considered**: Redux Toolkit (boilerplate), Jotai (less
conventional for larger state), Context API (re-render cost).

---

## Decision 16: API Data Fetching — TanStack Query

**Decision**: TanStack Query for client-side server state. Server Components
fetch through the service layer directly, not via HTTP calls to the
application's own Route Handlers.

**Alternatives Considered**: SWR (fewer mutation features), plain fetch
(boilerplate).

---

## Decision 17: PDF Generation — @react-pdf/renderer

**Decision**: `@react-pdf/renderer` in a Node-runtime Route Handler for will
draft export (FR-M012).

**Alternatives Considered**: jsPDF (limited layout), headless-browser
rendering (fragile in serverless functions), LaTeX (system dependencies).

---

## Decision 18: Recipients and Access Tokens — One Beneficiary Model (ADR-014)

**Decision**: Every external recipient (beneficiary, Dead Man Switch trusted
contact, emergency contact) is a `Beneficiary` record; DMS contacts link via
`dead_man_switch_contacts`, emergency contacts via
`emergency_access_configs.beneficiary_id`. All scoped access uses one
`access_tokens` entity (`grant_type` DIRECT_SHARE | DMS_RELEASE |
EMERGENCY_ACCESS, hash-only). Recipients exchange the emailed token once
(`POST /api/v1/access/exchange`) for a short-lived encrypted httpOnly cookie;
tokens never appear in request paths. Plan sections are accessible through
the same mechanism (`/access/plan-sections/:section`, latest finalized
version only).

**Rationale**: The r1 model could not issue release/emergency tokens
(mandatory beneficiary FK vs JSON contacts), stored no emergency token, and
put bearer secrets in URLs (findings I1, I3, S2, I7).

**Alternatives Considered**: separate contact entities (rejected —
duplicated identity, same FK problem); token in URL fragment (rejected);
access-session table (unnecessary for baseline).

---

## Decision 19: Production Malware Scanning — ClamAV (ADR-015)

**Decision**: `ClamAvScanner` (clamd `INSTREAM` over a TLS private endpoint)
behind the `MalwareScanner` interface; scans run in `file.scan` /
`video.process` jobs on quarantine objects; promotion requires
`SCANNED_CLEAN`; production start-up fails if the provider is `noop`.

**Rationale**: FR-H016/FR-Q011 mandate production scanning; third-party
multi-engine APIs would disclose private legal documents (constitution II).

**Open**: hosting location for the ClamAV service (owner input —
PROJECT_STATUS).

---

## Decision 20: AI Draft Persistence (ADR-016)

**Decision**: `ai_drafts` + immutable `ai_draft_versions` (content
application-encrypted; per-section confidence unencrypted; `created_by AI |
USER`) hold will drafts and document-analysis findings through DRAFT →
PENDING_CONFIRMATION → CONFIRMED | REJECTED | SUPERSEDED. `ai_interactions`
remains sanitized and links to the draft. Confirmation is a guarded function
(`confirm_ai_draft` / `confirm_analysis_findings`).

**Rationale**: FR-M006–M011 and FR-N001–N008 need review/edit/regenerate/
version/confirm; the sanitized interaction record cannot hold content
(finding I4).

---

## Unresolved Items

No unresolved NEEDS CLARIFICATION items remain. One **verification item** is
tracked as an implementation task rather than a clarification:

- **T203** — confirm Clerk event coverage for FR-A014 (failed sign-in
  attempts) and implement app-side capture if required.
