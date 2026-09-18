# Architecture Decision Records — LegacyVault AI

> **Purpose**: The authoritative log of architecture decisions for LegacyVault
> AI. Every other artifact (constitution technology stack, `docs/BRAIN.md`,
> `specs/*/research.md`, `plan.md`, `tasks.md`, `data-model.md`, API contracts)
> MUST agree with the *Accepted* records below. When they disagree, this file
> and the constitution win; fix the other artifact.
>
> **Format**: Each record has Context → Decision → Requirements preserved →
> Consequences → Alternatives considered → Revisit triggers.
>
> **Status legend**: ✅ Accepted · 🔧 Proposed · ⏸️ Deferred · ❌ Superseded

| ADR | Title | Status | Date |
|-----|-------|--------|------|
| [ADR-001](#adr-001--single-nextjs-application-no-separate-express-backend) | Single Next.js application (no separate Express backend) | ✅ Accepted | 2026-09-18 |
| [ADR-002](#adr-002--supabase-managed-postgresql-with-sql-migrations-no-prisma) | Supabase-managed PostgreSQL with SQL migrations (no Prisma) | ✅ Accepted | 2026-09-18 |
| [ADR-003](#adr-003--clerk-as-the-sole-application-authentication-provider) | Clerk as the sole application authentication provider | ✅ Accepted | 2026-09-18 |
| [ADR-004](#adr-004--authorization-model-service-layer-first-rls-as-defense-in-depth) | Authorization model: service layer first, RLS as defense-in-depth | ✅ Accepted | 2026-09-18 |
| [ADR-005](#adr-005--supabase-storage-for-private-documents-and-videos) | Supabase Storage for private documents and videos | ✅ Accepted | 2026-09-18 |
| [ADR-006](#adr-006--background-processing-without-redisbullmq) | Background processing without Redis/BullMQ | ✅ Accepted | 2026-09-18 |
| [ADR-007](#adr-007--rate-limiting-without-redis) | Rate limiting without Redis | ✅ Accepted | 2026-09-18 |
| [ADR-008](#adr-008--ai-provider-abstraction-retained-openai--gemini) | AI provider abstraction retained (OpenAI + Gemini) | ✅ Accepted | 2026-09-18 |
| [ADR-009](#adr-009--email-abstraction-with-resend-as-baseline-provider) | Email abstraction with Resend as baseline provider | ✅ Accepted | 2026-09-18 |
| [ADR-010](#adr-010--observability-sentry--structured-logging--health-checks) | Observability: Sentry + structured logging + health checks | ✅ Accepted | 2026-09-18 |
| [ADR-011](#adr-011--deployment-vercel--supabase--clerk) | Deployment: Vercel + Supabase + Clerk | ✅ Accepted | 2026-09-18 |
| [ADR-012](#adr-012--constitution-amendment-100--200) | Constitution amendment 1.0.0 → 2.0.0 | ✅ Accepted | 2026-09-18 |
| [ADR-013](#adr-013--application-layer-encryption-of-file-bodies) | Application-layer encryption of file bodies | ⏸️ Deferred | 2026-09-18 |
| [ADR-014](#adr-014--unified-access-token-model-and-cookie-exchange) | Unified access-token model and cookie exchange | ✅ Accepted | 2026-09-18 |
| [ADR-015](#adr-015--production-malware-scanning) | Production malware scanning | ✅ Accepted (hosting: owner input) | 2026-09-18 |
| [ADR-016](#adr-016--ai-draft-persistence-and-versioning) | AI draft persistence and versioning | ✅ Accepted | 2026-09-18 |

> **Revision r2 (2026-09-18, post-`/speckit-analyze`)**: ADR-002 §6 and
> ADR-004 revised (write-protection model, RLS test strategy); ADR-001 gains a
> cache-safety rule; ADR-014/015/016 added.

---

## Background: why these records exist

The baseline specification (`specs/001-baseline-product-spec/`, 2026-09-16)
planned a two-project layout — `frontend/` (Next.js) and `backend/` (Express +
Prisma + PostgreSQL + Redis/BullMQ + S3). On 2026-09-17 the repository was
instead scaffolded as a **single Next.js 16 application at the repository
root** with Supabase packages installed, and the installed agent skills
(`.agents/skills/`: Clerk, Supabase, Vercel, Resend, Sentry, shadcn, GSAP …)
pointed at a different stack. No artifact recorded that pivot.

On 2026-09-18 the project owner directed that the architecture drift be
resolved *before* implementation by formally adopting the single-application
architecture described below. These ADRs are that formal record. Nothing in
them removes or weakens a functional or security requirement in `spec.md`;
they change **how** requirements are satisfied, not **whether**.

---

## ADR-001 — Single Next.js application (no separate Express backend)

**Status**: ✅ Accepted — 2026-09-18

### Context
The constitution (v1.0.0, Principle VIII) and `plan.md` mandated a separate
Express.js API server. The actual repository is one Next.js 16.3.5 application
(App Router, React 19, TypeScript 5). Next.js Route Handlers already provide a
Node.js server runtime for versioned REST APIs, and the platform's deployment
target (Vercel, ADR-011) runs them as serverless functions. Maintaining two
deployables would double the auth, logging, validation and deployment surface
for no requirement-driven benefit.

### Decision
1. LegacyVault AI is **one Next.js 16 + TypeScript application at the
   repository root**. There is no `frontend/` or `backend/` directory and no
   separate Express service in the baseline (v1).
2. Public APIs are **Next.js Route Handlers under `app/api/v1/**`** —
   versioned REST, JSON envelope per `contracts/api-contracts.md`.
3. Server-side layering is preserved and enforced by convention:
   `Route Handler (thin: correlation id → auth → CSRF check → rate limit →
   Zod validation → response envelope)` → `lib/services/*` (business logic)
   → `lib/repositories/*` (data access) → PostgreSQL. Route Handlers, Server
   Components and Server Actions MUST NOT contain business logic.
4. A shared wrapper (`lib/api/with-api.ts`) applies the cross-cutting pipeline
   to every handler so behaviour is uniform (replaces Express middleware).
5. Server Components read data through the same service layer (never through
   their own HTTP round-trip to Route Handlers). Server Actions MAY be used for
   form mutations but MUST delegate to services and MUST NOT be the only
   interface for anything the API contract exposes.
6. `proxy.ts` (Next 16's renamed `middleware.ts`) hosts `clerkMiddleware()`
   route protection and CSP nonce injection. Proxy checks are UX/defense
   layers only; authorization is re-checked in services (constitution III).

### Requirements preserved
Constitution VIII (layered architecture, versioned REST, no business logic in
UI/handlers), X (server-side validation, centralized safe errors), XI, XV,
NFR-SCL-001 (serverless functions scale horizontally), all FR-* unchanged.

### Consequences
- One `package.json`, one CI pipeline, one deployment.
- Serverless constraints apply and drive ADR-005 (request body limit → direct
  browser-to-storage uploads) and ADR-006 (no long-lived worker process).
- `AGENTS.md` warning applies: Next.js 16 differs from older training data —
  read `node_modules/next/dist/docs/` before writing framework code.
- **Cache safety (constitution XV, r2)**: every `/api/v1/*` response and
  every signed-URL response sets `Cache-Control: private, no-store`; route
  groups that render user data (`(dashboard)`, `(admin)`, `(public)/access`,
  `(public)/emergency-access`) MUST NOT use `use cache`/static prerendering;
  the pre-production review (T185) verifies no user data is served from a
  shared cache.

### Alternatives considered
- Keep Express in `backend/`: rejected (duplicate infrastructure, no
  requirement needs it).
- Next.js + separate worker service from day one: rejected for baseline; see
  ADR-006 revisit triggers.

### Revisit triggers
A concrete requirement for long-lived processes (WebSockets, streaming media
transcoding, >15-minute jobs) or a non-Vercel host that cannot run Next.js
server features.

---

## ADR-002 — Supabase-managed PostgreSQL with SQL migrations (no Prisma)

**Status**: ✅ Accepted — 2026-09-18

### Context
PostgreSQL was already decided (research Decision 2) for ACID, JSONB, rich
indexing and constraints. Prisma was chosen as ORM. The repository now targets
Supabase, whose value is the managed Postgres itself (backups, PITR,
connection pooling, RLS tooling, Storage in the same project). MongoDB Atlas
was explicitly ruled out by the owner.

### Decision
1. **PostgreSQL remains the database technology.** Supabase is the managed
   PostgreSQL platform (new Supabase projects run PostgreSQL 17, satisfying the
   spec's "16+"). **MongoDB is not used.**
2. **Schema is owned by plain SQL migrations** in `supabase/migrations/*.sql`
   managed with the Supabase CLI (`supabase migration new`, `supabase db
   push`). Prisma is **not** used; there is no `schema.prisma`.
3. TypeScript types are generated from the live schema (`supabase gen types
   typescript`) into `lib/types/database.ts` and committed.
4. Data access from server code uses `@supabase/supabase-js` typed clients
   (see ADR-004 for which client when). No browser-side database access in the
   baseline.
5. **Relational integrity is mandatory**: UUID primary keys, foreign keys with
   explicit `ON DELETE` behaviour, CHECK constraints (e.g. allocation 0–100),
   unique and partial-unique indexes (one DRAFT plan per user), indexes per
   `data-model.md`.
6. **Transactions and guarded writes** (r2): multi-statement, all-or-nothing
   workflows (plan create/save/finalize, beneficiary assignment and removal,
   document attachment, token issue/revoke, Dead Man Switch and emergency-
   access transitions, AI draft confirmation, job claiming) are implemented
   as **PostgreSQL functions** invoked via `rpc()` so they run in one
   transaction (NFR-REL-001). Functions callable by `authenticated` that
   write invariant-bearing data are **`SECURITY DEFINER`** — the documented
   reason being that direct write grants on those tables are revoked
   (ADR-004 r2) — and MUST follow the mandatory rules in `data-model.md`
   § Write-Protection Model 3 (`SET search_path = ''`, auth prologue,
   `FOR UPDATE` ownership checks, typed parameters, no dynamic SQL, no
   identity-column writes, in-transaction audit row, `EXECUTE` granted only
   to `authenticated`). System functions used only by the service role stay
   `SECURITY INVOKER` with `EXECUTE` granted to `service_role` only.
7. **Row Level Security is enabled on every table** (ADR-004).
8. Application-level field encryption (AES-256-GCM, research Decision 13) is
   unchanged; the key lives in server-only environment configuration.
9. Column names are `snake_case` in SQL; `data-model.md` keeps logical
   `camelCase` names for readability.

### Requirements preserved
Constitution IV, VII, XVIII; FR-Q003, FR-Q018, NFR-REL-001, NFR-DR-001/002
(Supabase automated backups + PITR, plus `scripts/backup-database.sh`).

### Consequences
- Hand-written SQL replaces Prisma's generated migrations; reviewers must
  check constraints and indexes explicitly (checklist in `plan.md` Phase 2).
- Supabase's pooled connection string is used for any direct connections
  (backup scripts, load tests).

### Alternatives considered
- Prisma on Supabase Postgres: viable, rejected to avoid a second schema
  source of truth and because RLS/policies/functions are SQL-native anyway.
- Drizzle: viable; not adopted for the baseline (fewer moving parts). May be
  reconsidered if typed query ergonomics become a measured productivity issue.
- MongoDB Atlas: **rejected** (weak relational integrity for allocation and
  cross-entity constraints; owner directive).

### Revisit triggers
Measured developer friction with raw `supabase-js` queries in complex joins;
need for multi-region Postgres.

---

## ADR-003 — Clerk as the sole application authentication provider

**Status**: ✅ Accepted — 2026-09-18

### Context
The plan hand-rolled sessions, bcrypt, TOTP (speakeasy), lockout, email
verification and password reset. Supabase also ships an auth product. Running
two authentication systems would violate least-astonishment and double the
attack surface.

### Decision
1. **Clerk** (`@clerk/nextjs`) is the application's identity and
   authentication provider. **Supabase Auth is not used**; Supabase is the
   database + storage platform.
2. Clerk-owned capabilities (configured in the Clerk dashboard per
   environment, recorded in `docs/DEPLOYMENT.md`):
   - Email/password sign-up and sign-in; password policy ≥12 chars with
     upper/lower/number/special (FR-A001, FR-A002, FR-A005)
   - Mandatory email verification before sign-in (FR-A003, FR-A004)
   - MFA: TOTP authenticator app + backup codes (FR-A006, FR-A017)
   - Sessions: httpOnly, secure, SameSite cookies; 24-hour inactivity
     lifetime; server-side revocation; multi-device session list with
     browser/device/city/country (FR-A007–A009, FR-A015, FR-Q006)
   - Password reset with sign-out of other sessions (FR-A010, FR-A011)
   - Attack protection: account lockout after 5 failed attempts for 30
     minutes, bot detection (FR-A012, FR-A013)
   - Step-up **reverification** for sensitive operations (FR-A018, FR-B007,
     FR-G004, FR-I003, FR-I008, FR-O005)
3. App-owned responsibilities (this codebase):
   - `users` table keyed by internal UUID with `clerk_user_id UNIQUE`;
     profile, preferences and **role** (`USER` | `SUPER_ADMIN`) live here.
     **Role source of truth is the database**; server code checks it on every
     protected operation (constitution III, FR-P012).
   - Clerk **webhooks** (Svix-signed) at `app/api/webhooks/clerk/route.ts`
     sync `user.*` and `session.*` events → upsert `users`, write audit-log
     auth events (FR-A014), trigger new-device/unusual-location detection
     (FR-A016). Idempotent by `svix-id`.
   - Lazy, idempotent `ensureAppUser()` on first authenticated request as a
     fallback for webhook delay.
   - Security Center session list/revocation, admin unlock and MFA reset are
     app endpoints that call the Clerk Backend API inside our service layer
     so ownership checks and audit logging remain ours (FR-O002/O003,
     FR-P007).
   - Beneficiary token access and emergency-contact OTP flows are **not**
     Clerk identities; they remain app-owned, token/OTP based (FR-D011,
     FR-J003).
4. **Open verification item** (tracked as task T203): Clerk webhooks cover
   session and user events but do not emit failed sign-in attempts. FR-A014
   requires logging failed attempts. If Clerk's event coverage is
   insufficient, implement a custom sign-in flow that reports failures to a
   server-validated security-events endpoint. The requirement is not
   weakened; the mechanism is verified in Phase 1.

### Requirements preserved
All FR-A*, FR-O001–O009, FR-Q001/Q002/Q006/Q008, constitution III.
Constitution III is amended (ADR-012) to state explicitly that delegating
authentication to a managed identity provider is permitted while
authorization stays in this platform's server code.

### Consequences
- Credential fields (`passwordHash`, `mfaSecret`, verification/reset tokens,
  `failedLoginAttempts`, `lockedUntil`) are removed from the `users` table;
  the `Session` entity is externalized to Clerk (`data-model.md`).
- `/api/v1/auth/*` credential endpoints are removed from the contract; the
  contract documents the Clerk mapping instead (`api-contracts.md`).
- Vendor dependency for identity; mitigated by keeping all authorization,
  audit and profile data in our database and by Clerk's export APIs.

### Alternatives considered
- Supabase Auth: capable, rejected to keep a single identity provider with
  first-class Next.js reverification and session-device APIs.
- Hand-rolled auth (original plan): rejected — highest-risk component to
  build in-house for a security-first product.

### Revisit triggers
Regulatory data-residency needs Clerk cannot meet; pricing at scale; a
verified gap in FR-A014 coverage that cannot be closed (T203).

---

## ADR-004 — Authorization model: service layer first, RLS as defense-in-depth

**Status**: ✅ Accepted (r2) — 2026-09-18

### Context
Constitution I requires defense-in-depth ("no single control may be the sole
barrier") and III requires server-side authorization for every protected
resource. Supabase offers Row Level Security; Clerk session tokens can be
presented to Supabase as a third-party JWT.

### Decision
1. **Primary control — service layer**: every service method receives the
   authenticated app user (from `requireUser()`), verifies ownership/role
   explicitly, and logs the outcome. This is the authorization of record.
2. **Secondary control — RLS**: RLS is enabled on **all** tables with
   deny-by-default. Supabase is configured with **Clerk as a third-party auth
   provider**; policies for user-owned rows compare
   `auth.jwt()->>'sub'` to `users.clerk_user_id` (Clerk subjects are not
   UUIDs, so `auth.uid()` is not used).
3. **Two server-only clients** (`lib/db/server.ts`):
   - `createUserClient()` — publishable key + the current Clerk session token
     as `accessToken`; used for user-scoped operations so RLS enforces the
     second barrier.
   - `createServiceClient()` — Supabase **secret** key (server-only env var,
     never `NEXT_PUBLIC_`); bypasses RLS; used only for system operations:
     webhooks, cron/job handlers, audit writes, admin operations, and
     token-based beneficiary/emergency access where no Clerk session exists.
     Every service-client code path performs its own explicit authorization.
4. The publishable key is never granted data access by policy (anon role has
   no policies), so a leaked publishable key exposes nothing.
5. Storage buckets follow the same model (ADR-005).
6. **Write-protection model (r2 — analysis finding S1).** Row-level policies
   cannot stop a user from changing *which columns* of their own row or from
   bypassing invariants that live in functions. The baseline therefore uses
   one consistent model, specified in `data-model.md` § Write-Protection
   Model and enforced by migration T218 + functions T019:
   - **Privilege baseline**: `REVOKE ALL` on all tables and functions from
     `anon`/`authenticated` (Supabase grants them by default) plus
     `ALTER DEFAULT PRIVILEGES`; grants are then added explicitly.
   - **Class A (plain user data)**: RLS `SELECT` own rows; direct
     `INSERT`/`UPDATE` on own rows restricted to a **column allow-list**
     (`GRANT UPDATE (col, …)`). Protected columns (`users.role`, mirrored
     Clerk fields, `status`/`scan_status`, lifecycle timestamps) have no
     grant, and a `BEFORE UPDATE` trigger on `users` re-checks the JWT role.
   - **Class B (guarded)**: RLS `SELECT` own rows; **no direct write
     grants**; every mutation goes through a `SECURITY DEFINER` function
     that performs the auth prologue, `FOR UPDATE` ownership checks, the
     invariant (Σ allocation ≤ 100, state-machine guard, one DRAFT, scope ⊆
     owned resources, lock version), and writes the audit row in the same
     transaction. Applies to plans, assignments, attachments, access tokens,
     Dead Man Switch, emergency access, AI drafts, asset/document/video lifecycle
     (`delete_asset()`, `delete_document()`, `delete_video()`).
   - **Class C (system)**: `service_role` only (jobs, rate limits, webhook
     events, audit inserts, upload promotion), with `SELECT` own rows where
     the UI needs it.
   This prevents self-role escalation, mirrored-flag tampering, direct
   assignment writes, status/finalization/scan-status tampering and
   unauthorized state transitions even if a service bug sends a raw write
   through the user-scoped client.
7. **RLS/policy test strategy (r2 — finding S5)**: policy and
   guarded-function tests run against the local Supabase stack and mint
   HS256 JWTs with the local project's JWT secret carrying Clerk-shaped
   claims (`sub = user_test_a`, `role = authenticated`) — RLS depends only
   on claims, not on Clerk's signature. End-to-end tests against preview
   deployments use a Clerk development instance with `@clerk/testing`
   testing tokens for real sessions. Both are wired in T015/T212/T215.

### Requirements preserved
Constitution I, III, VII; FR-Q001, FR-Q002, FR-Q014, FR-H012, FR-P012; SC-005.

### Consequences
- Policies must be written and tested per table (Phase 2 checklist,
  Phase 12 authorization matrix).
- RLS policies that call functions must be written for performance per the
  Supabase RLS guidance (wrap `auth.jwt()` in `(select …)`).

### Alternatives considered
- Service-role only (no RLS): rejected — single barrier.
- RLS only: rejected — constitution requires explicit server authorization
  and audit at the service layer.

---

## ADR-005 — Supabase Storage for private documents and videos

**Status**: ✅ Accepted — 2026-09-18

### Context
The plan required S3 with server-side encryption before upload and Multer
multipart uploads through the API. On Vercel, serverless request bodies are
limited (≈4.5 MB), so 50 MB documents and 500 MB videos cannot be proxied
through Route Handlers; the Next.js backend-for-frontend guide recommends
uploading user files from the browser directly to a storage service.

### Decision
1. **Supabase Storage**, private buckets only: `quarantine` (untrusted
   inbound), `documents`, `videos`. No public buckets (FR-H005, FR-Q005).
2. **Two-step upload contract** (see `api-contracts.md`):
   - `POST /api/v1/documents/uploads` (or `/videos/uploads`) — server
     validates *declared* name/MIME/size against the whitelist and limits
     (**50 MB documents, 500 MB videos** — FR-H002, FR-K002), records an
     `upload_sessions` row and returns a **signed upload URL** (documents) or
     a **resumable TUS upload target** (videos) into
     `quarantine/{clerk_user_id}/{upload_id}`.
   - Browser uploads directly to Storage.
   - `POST …/uploads/{uploadId}/complete` — server verifies the object
     exists, checks *actual* size, reads the leading bytes for **magic-byte
     verification**, runs the **malware-scanner abstraction** (inline for
     small files, as a job for large ones), then **promotes** the object to
     `documents`/`videos` and creates the metadata rows + audit entries.
     Failed validation/scan leaves the object in quarantine for deletion and
     produces an audit event and a clear user-facing error (FR-H003, FR-H016,
     FR-Q010, FR-Q011).
3. **Downloads/previews**: never direct bucket URLs. The server authorizes
   (owner / shared beneficiary token / active emergency access), then mints a
   **signed download URL with 15-minute expiry** (configurable) and logs the
   access (FR-H009, FR-H015).
4. **Encryption at rest**: Supabase Storage encrypts objects at rest with
   AES-256 (provider-managed keys held separately from the data), satisfying
   FR-H004, FR-K003, FR-Q003 and constitution IV. Application-layer envelope
   encryption of file bodies is **deferred** with a documented design
   (ADR-013). Sensitive *database fields* remain application-encrypted.
5. **Storage policies**: `storage.objects` RLS denies direct client access
   except owner-prefixed writes to `quarantine` (needed for resumable TUS
   uploads authenticated with the Clerk JWT); all other access is server-side.
6. **Platform prerequisite**: the Supabase project's global file-size limit
   must be raised to ≥ 500 MB (Pro plan feature) before video upload work;
   the free tier caps files at 50 MB. Tracked in Phase 0/13 tasks.
7. Metadata (name, type, size, upload date, last modified, uploader,
   versions, folder, custom JSONB) lives in Postgres (FR-H007, FR-H010).
8. Housekeeping deletes stale quarantine objects and expired upload sessions.

### Requirements preserved
FR-H001–H017, FR-K001–K008, FR-Q005, FR-Q010, FR-Q011, constitution IV & XI.

### Consequences
- New `upload_sessions` entity; `documents.encryption_mode` column records
  `PROVIDER_SSE` (baseline) or `APP_ENVELOPE` (future, ADR-013).
- Client needs `tus-js-client` for videos; progress and resume come for free.

### Alternatives considered
- AWS S3 + MinIO (original): viable; rejected to keep one managed platform,
  one set of credentials and policies (defense-in-depth via RLS on storage).
- Proxying uploads through Route Handlers: infeasible on Vercel body limits.

### Revisit triggers
Need for media transcoding/streaming (would add a media service), regulatory
requirement for customer-managed keys (activate ADR-013).

---

## ADR-006 — Background processing without Redis/BullMQ

**Status**: ✅ Accepted — 2026-09-18

### Context
The plan introduced Redis + BullMQ for Dead Man Switch timers, notification
retries and AI jobs. The owner directed that Redis/BullMQ not be added merely
because the old plan mentioned it, and that the simplest reliable design be
used. The workloads are: scheduled DMS scans (hourly granularity), escalation
timers (hours/days), notification delivery with retry, AI document analysis
(seconds to a few minutes), video validation/scanning, malware scanning,
housekeeping sweeps. None needs sub-second latency or a long-lived process.

### Decision
1. **Durable job table in PostgreSQL** (`jobs`: type, payload JSONB, status
   `QUEUED|RUNNING|SUCCEEDED|FAILED|DEAD`, `run_at`, `attempts`,
   `max_attempts`, `locked_at/locked_by`, `last_error`, `idempotency_key
   UNIQUE`, `finished_at`). Services enqueue jobs — inside the same Postgres
   function/transaction as the domain change where atomicity matters (outbox
   pattern).
2. **Job runner** (`lib/jobs/runner.ts`) exposed as a cron-protected Route
   Handler `app/api/internal/cron/run-jobs`: claims due jobs with
   `SELECT … FOR UPDATE SKIP LOCKED`, executes registered handlers within the
   function's `maxDuration` budget, applies exponential backoff, dead-letters
   after `max_attempts`, records `finished_at`. Handlers MUST be idempotent.
3. **Scheduling triggers — Vercel Cron** (`vercel.json`):
   - `run-jobs` every 5 minutes (drain queue)
   - `dms-scan` hourly — the endpoint only enqueues **one** idempotent
     `dms.scan` job (`idempotency_key = dms.scan:{YYYY-MM-DDTHH}`, so a
     concurrent redundant trigger cannot create a duplicate hourly scan); the
     `dms.scan` handler finds switches whose `next_check_in_at`/escalation
     deadlines have passed, enqueues per-switch idempotent transition jobs and
     completes — the runner records its `finished_at`
   - `housekeeping` daily (token expiry, emergency-access expiry/auto-grant
     sweeps, notification retry sweep, quarantine cleanup, deletion
     grace-period processing, prune old succeeded jobs)
   Endpoints require `Authorization: Bearer $CRON_SECRET`.
4. **Availability safeguard for the Dead Man Switch (NFR-AVL-002)**: a health
   check verifies that the most recent SUCCEEDED `dms.scan` job
   (`jobs.finished_at` — the only scheduler heartbeat) completed within 2× its
   interval; failure writes a CRITICAL audit event and alerts the Super Admin
   (email + Sentry). Production additionally enables **Supabase `pg_cron` +
   `pg_net`** to call the same idempotent endpoints as a redundant trigger, so
   a Vercel cron outage cannot silently stall escalations.
5. **Long-running work** (AI analysis of large documents, video scanning)
   runs as jobs with explicit `maxDuration`; progress is persisted so the UI
   can poll (NFR-PER-004).
6. **Redis/BullMQ (or Upstash QStash) is NOT adopted.** It will be
   introduced only when one of the revisit triggers below is met and recorded
   as a new ADR.

### Requirements preserved
FR-I002–I009, FR-J006–J007, NFR-REL-001, NFR-REL-002, NFR-AVL-002,
notification retry (spec edge cases), constitution VII.

### Consequences
- Platform prerequisite: Vercel plan with minute-level cron and adequate
  function duration (Hobby tier crons are daily and imprecise). Verified in
  Phase 0; `pg_cron` redundancy is plan-independent.
- No Redis credentials, no worker deployment.

### Alternatives considered
- Redis + BullMQ worker: rejected for baseline (new infrastructure, no
  serverless-native worker, no requirement demanding it).
- Upstash QStash: reasonable serverless queue; rejected for baseline to keep a
  single data platform; first candidate if triggers fire.
- Vercel Queues/Workflows: beta at time of writing; not relied upon.

### Revisit triggers
Any of: sustained job throughput beyond what a 5-minute drain can clear
(> ~1,000 jobs per run), user-facing jobs needing < 1-minute latency, job
steps that exceed the platform's function duration limit, or a need for a
long-lived worker (e.g. video transcoding).

---

## ADR-007 — Rate limiting without Redis

**Status**: ✅ Accepted — 2026-09-18

### Decision
Three layers, none requiring Redis:
1. **Clerk attack protection** for sign-in/sign-up/reset (per-account
   lockout, bot detection) — FR-A012, FR-A013.
2. **Vercel Firewall / WAF rate-limit rules** at the edge for per-IP limits
   on public and sensitive paths (`/api/v1/emergency-access/request|verify`,
   `/api/v1/access/*`, `/api/v1/ai/*`).
3. **Application limiter** `lib/security/rate-limit.ts` — Postgres-backed
   fixed-window counters (`rate_limits` table, atomic upsert function) keyed
   by user/IP/token + route policy; applied by `withApi()`; returns 429 with
   `Retry-After`. Policies: default 100/15 min; sensitive ops 5/15 min;
   AI 20/hour per user; public emergency-access 5/hour per IP; token access
   60/15 min per token.

### Requirements preserved
FR-Q008, constitution XI, API Security Requirements in spec.

### Revisit triggers
Measured limiter overhead > 20 ms p95 or auth-endpoint volume that the
Postgres counter cannot absorb → swap the store for Upstash Redis behind the
same interface (new ADR).

---

## ADR-008 — AI provider abstraction retained (OpenAI + Gemini)

**Status**: ✅ Accepted — 2026-09-18

### Decision
1. In-house `AIProvider` interface in `lib/ai/provider.ts` with
   `generateText`, `generateStructured<T>(zodSchema)` (provider structured
   outputs / JSON schema, validated with Zod on receipt) and `stream`.
   Implementations: `lib/ai/providers/openai.ts` (`openai` SDK) and
   `lib/ai/providers/gemini.ts` (`@google/genai`). Factory selects by
   `AI_DEFAULT_PROVIDER` with fallback on outage (FR-R001, FR-R010).
2. API keys are server-only environment variables; all calls originate from
   Route Handlers or job handlers (FR-L009, FR-R002).
3. `lib/ai/validation.ts` performs completeness checks, unsupported-claim /
   fabricated-reference heuristics, and produces confidence indicators
   (FR-R003–R005). Every response carries the legal disclaimer (FR-L007,
   FR-R009). AI never mutates authoritative records; persistence requires an
   explicit user confirmation endpoint (FR-M010, FR-N007/N008, FR-R006/R007).
4. Prompts are versioned templates in `lib/ai/prompts/`; output schemas in
   `lib/ai/schemas/`; token/cost usage stored on `ai_interactions`.
5. Assistant chat streams from a Route Handler; document analysis runs as a
   job (ADR-006) with persisted progress. PDF text extraction uses a
   serverless-friendly library (e.g. `unpdf`); OCR is a pluggable hook (a
   Gemini vision path is an acceptable implementation).
6. PDF export of confirmed drafts uses `@react-pdf/renderer` in a Node
   runtime Route Handler. Puppeteer is not used (Chromium in serverless is
   fragile).

### Alternatives considered
Vercel AI SDK: good fit for streaming/structured output on this stack; not
adopted for the baseline to keep the thin in-house interface. It MAY be used
*behind* `AIProvider` later without changing callers.

---

## ADR-009 — Email abstraction with Resend as baseline provider

**Status**: ✅ Accepted — 2026-09-18

### Decision
`lib/email/` defines `EmailProvider` (`send(message)`), templates built with
React Email in `emails/`, and a `sendTemplate()` facade. Baseline provider:
**Resend** (Vercel-friendly, webhook delivery events). Development provider:
console/log transport. Alternatives (Nodemailer SMTP, SES) implement the same
interface. Delivery events (`app/api/webhooks/email`) update
`notifications.delivery_status`; retries run through the job table (ADR-006).
Clerk sends its own verification/reset emails; branding is configured in
Clerk. Email bodies never include plaintext sensitive data (constitution II).

---

## ADR-010 — Observability: Sentry + structured logging + health checks

**Status**: ✅ Accepted — 2026-09-18

### Decision
- **Sentry** via `@sentry/nextjs` (client, server, edge) with PII scrubbing,
  release tagging and source maps from CI; errors captured centrally in
  `withApi()` and the job runner (NFR-OBS-002).
- **Structured JSON logging** (`pino`) with redaction of secrets/tokens/PII,
  a per-request **correlation id** generated in `withApi()`, returned as
  `X-Correlation-ID`, attached to Sentry scope and to audit rows
  (NFR-OBS-001, FR-Q017).
- **Health check** `GET /api/v1/health`: database ping, storage reachability,
  job-runner heartbeat age, DMS scan freshness.
- **Metrics**: Vercel Analytics/Speed Insights, Sentry performance, and
  security metrics derived from `audit_log` (failed authorization attempts,
  rate-limit hits, DMS health failures) with alert rules.
- **Security events** are audit-log rows first (tamper-resistant, append-only
  trigger) and Sentry alerts second.

---

## ADR-011 — Deployment: Vercel + Supabase + Clerk

**Status**: ✅ Accepted — 2026-09-18

### Decision
- **Vercel** hosts the Next.js app: Preview deployments per pull request,
  Production from the main branch, environment variables managed in Vercel
  (no secrets in the repository — constitution I, XIX, XXI).
- **Environments**: development (local Next.js + Supabase CLI local stack or
  a dedicated dev project + Clerk development instance), staging (Vercel
  preview/staging + Supabase staging project + Clerk development instance),
  production (Vercel production + Supabase production project + Clerk
  production instance). No production data in lower environments
  (constitution II, NFR-PRV-002).
- **CI (GitHub Actions)**: install → lint → type-check → unit/integration
  tests → build → migration dry-run; Playwright E2E against preview
  deployments for critical journeys; dependency audit.
- **Migrations** are applied with `supabase db push` in a gated deploy step
  (manual approval for production).
- **Security**: TLS by platform; HSTS/CSP/X-Frame-Options/nosniff/
  Referrer-Policy/Permissions-Policy from `next.config.ts` + nonce CSP in
  `proxy.ts`; Vercel WAF rate limits (ADR-007).
- **Backups / DR**: Supabase automated daily backups; **PITR add-on enabled
  for production**; `scripts/backup-database.sh` (`pg_dump` through the
  pooled connection) for off-platform copies to a separate private bucket;
  restore runbook in `docs/DISASTER_RECOVERY.md` (NFR-DR-001/002).
- **Platform prerequisites to verify in Phase 0**: Vercel plan supports
  minute-level cron and required `maxDuration`; Supabase plan supports a
  ≥ 500 MB file-size limit and PITR.

---

## ADR-012 — Constitution amendment 1.0.0 → 2.0.0

**Status**: ✅ Accepted — 2026-09-18

### Proposal (constitution Governance → Amendment Procedure, step 1)
Amend Principle VIII and the Technology Stack section to replace the mandated
separate Express.js backend with the single Next.js application architecture
(ADR-001), and amend Principle III to state that delegating authentication to
a managed identity provider is permitted while authorization remains enforced
by this platform's server code (ADR-003). Add the platform services adopted
in ADR-002/005/006/009/010/011 to the Technology Stack table.

### Impact review (step 2)
- Existing code: none affected (no application features implemented).
- Security posture: unchanged or improved — all security principles (I–VII,
  X–XII, XVI, XVII, XXI) are untouched; authentication moves to a dedicated
  provider; RLS adds a second authorization barrier.
- Dependent workflows: `plan.md`, `tasks.md`, `research.md`,
  `data-model.md`, `api-contracts.md`, `quickstart.md`, `docs/BRAIN.md`
  updated in the same change.

### Version bump (step 3)
Removing Express.js from a principle is a **removal/redefinition** → MAJOR →
**2.0.0**.

### Date (step 4)
`LAST_AMENDED_DATE` = 2026-09-18. The ratification date is corrected from
`2025-09-16` to `2026-09-16` (typo; the repository's initial commit is dated
2026-09-16).

### Follow-up patch
**2.0.1** (same day, PATCH): Principle IX wording "all frontend and backend
code" → "all application code (presentation and server-side)". No
requirement changed; recorded in the constitution's sync-impact report.

---

## ADR-013 — Application-layer encryption of file bodies

**Status**: ⏸️ Deferred — 2026-09-18

### Context
Baseline file bodies are protected by private buckets, server-side
authorization, short-lived signed URLs, storage RLS and provider-managed
AES-256 encryption at rest (ADR-005). An additional application-layer
envelope encryption (per-object data key wrapped by an app master key) would
protect file bodies even against compromise of the storage platform
credentials.

### Design (ready to activate)
Encrypt in the `complete` step (server streams quarantine object → AES-256-GCM
→ `documents` bucket); serve via an app-signed, time-limited download route
that decrypts and streams; record `encryption_mode = 'APP_ENVELOPE'` and
`encryption_key_id`. Constraints: feasible for ≤ 50 MB documents within
serverless limits; **not** feasible for 500 MB videos in a serverless
function (would require a worker — see ADR-006 triggers).

### Why deferred
Provider encryption already satisfies constitution IV and FR-H004/K003; the
design trades signed-URL previews and serverless simplicity for protection
against a storage-credential compromise that is already mitigated by secret
scoping and monitoring.

### Activation triggers
Customer-managed-key requirement, threat-model review outcome at NFR-SEC-002,
or regulatory demand.

---

## ADR-014 — Unified access-token model and cookie exchange

**Status**: ✅ Accepted — 2026-09-18 (analysis findings I1, I3, S2, I7)

### Context
The r1 model had `BeneficiaryAccessToken` with a mandatory beneficiary FK
while Dead Man Switch trusted contacts were free-form JSON and emergency
grants had no stored token at all, so `dms.release` and emergency-access
sessions could not be implemented. Tokens also travelled in URL paths
(`/access/:token`), exposing bearer secrets to platform logs and browser
history.

### Decision
1. **Every external recipient is a Beneficiary record** (Clarifications
   2026-09-18). Dead Man Switch trusted contacts are linked through
   `dead_man_switch_contacts`; emergency contacts through
   `emergency_access_configs.beneficiary_id`. There is no separate contact
   entity and no JSON contact list; "emergency beneficiary" is derived.
2. **One `access_tokens` entity** for all grants with `grant_type ∈
   {DIRECT_SHARE, DMS_RELEASE, EMERGENCY_ACCESS}`, `beneficiary_id NOT NULL`,
   conditional FKs to the switch or the emergency request, hash-only storage,
   scope JSONB (`documents`, `assets`, `videos`, `planSections`) validated as
   a subset of the owner's resources (and of the configured release/access
   scope for system grants). Direct-share tokens are issued by the owner
   through `issue_access_token()`; release and emergency tokens by the
   service role through `system_issue_access_token()`.
3. **Cookie exchange instead of tokens in paths.** The emailed link is
   `/access?t=<token>`. The public page immediately calls
   `POST /api/v1/access/exchange` with the token in the body, strips it from
   the URL, and receives a stateless access cookie — `{ tokenId, exp }`
   encrypted with a dedicated server key (`ACCESS_COOKIE_KEY`), `httpOnly;
   Secure; SameSite=Strict; Path=/api/v1/access`, 30-minute sliding TTL never
   exceeding the token's expiry. All `/api/v1/access/*` resource endpoints
   authenticate by that cookie and re-check `revoked_at`/`expires_at` and the
   beneficiary's status on every request. Plaintext tokens never appear in
   request paths, logs, or responses; `/access` paths are additionally
   redacted in logging.
4. **Plan-section access** is part of the same mechanism:
   `GET /api/v1/access/plan-sections/:section` renders a read-only section of
   the owner's latest finalized plan version; section keys are the plan's
   section vocabulary (`data-model.md` §9).
5. First successful exchange sets `access_tokens.used_at` and moves a PENDING
   beneficiary to ACTIVE; every access is audited with the beneficiary as
   actor.

### Requirements preserved
FR-D007, FR-D010, FR-D011, FR-H011–H015, FR-I005, FR-I012, FR-J001, FR-J003,
FR-J007–J010, FR-K005–K008; constitution I, III, VII, XII.

### Consequences
- `data-model.md` §21 renamed to `AccessToken`; new §25
  `DeadManSwitchContact`; `EmergencyAccessConfig` gains `beneficiary_id` and
  loses free-text contact fields; `EmergencyAccessRequest` gains
  `access_token_id`.
- The `/emergency-access/session/:token` endpoint is removed; emergency
  contacts use the shared `/access` endpoints.
- A new server secret (`ACCESS_COOKIE_KEY`) joins the environment schema.

### Alternatives considered
- Separate contact entities per feature: rejected (three ways to describe the
  same person; token FK problem remains).
- Token in URL fragment only: rejected (still ends up in client storage;
  cookie exchange is simpler and testable).
- Server-side access-session table: not needed for the baseline; the
  encrypted cookie plus per-request revocation check is sufficient and
  stateless. Revisit if per-device revocation of a single access session is
  required.

---

## ADR-015 — Production malware scanning

**Status**: ✅ Accepted — 2026-09-18 (finding S4). **Hosting choice requires
owner input** (see Consequences).

### Context
FR-H016 / FR-Q011 require malware-scanning hooks for production
file-processing workflows. The abstraction (`MalwareScanner`, T181) had no
production implementation decided; shipping with `NoOpScanner` would violate
the requirement. Sending users' private legal documents to third-party
multi-engine scanning services conflicts with constitution II (data
minimization / no unnecessary disclosure).

### Decision
1. Production scanner = **ClamAV** (`clamd`) accessed by the scanning job over
   the `INSTREAM` protocol through a TLS-terminated private endpoint, wrapped
   as `ClamAvScanner` behind the existing `MalwareScanner` interface.
   Signature updates via `freshclam` on the scanner host.
2. The scan runs in the `file.scan` / `video.process` jobs on the quarantine
   object (streamed, never written to the function filesystem). Objects reach
   `documents`/`videos` only after `SCANNED_CLEAN` (`promote_upload()` enforces
   it); INFECTED objects are deleted and audited; ERROR results retry with
   backoff and never promote.
3. `lib/config/env.ts` **refuses to start in production** when
   `MALWARE_SCANNER_PROVIDER` is `noop` or the ClamAV endpoint is missing.
4. Scan results are recorded on `upload_sessions.status`,
   `documents.scan_status` / `video_messages.scan_status` and the audit log.

### Consequences
- One small always-on service outside Vercel (ClamAV container). **Owner
  decision**: where it runs (a container platform such as Fly.io / Render /
  Railway, or a VM in the Supabase region). Tracked in
  `docs/PROJECT_STATUS.md`.
- Files up to 500 MB stream through the job; the job's `maxDuration` must be
  sized for the largest video (verify in T210).

### Alternatives considered
- Cloud multi-engine APIs: rejected for privacy of legal documents unless a
  data-processing agreement is in place (may be reconsidered by ADR revision).
- Provider-native scanning: not available for Supabase Storage at time of
  writing.

---

## ADR-016 — AI draft persistence and versioning

**Status**: ✅ Accepted — 2026-09-18 (finding I4)

### Context
FR-M006–M011 and FR-N001–N008 require drafts and findings to be reviewed,
edited, regenerated, versioned and only then confirmed. The r1 model kept a
single `AIInteraction` record whose summaries are explicitly sanitized (no raw
PII), so it could not hold draft text or findings, and no version history
existed.

### Decision
1. Two entities: **`ai_drafts`** (kind `WILL_DRAFT` | `DOCUMENT_ANALYSIS`,
   status `DRAFT → PENDING_CONFIRMATION → CONFIRMED | REJECTED | SUPERSEDED`,
   links to the plan or source document, current/confirmed version pointers)
   and **`ai_draft_versions`** (immutable; `created_by AI | USER`;
   `content` JSONB **application-encrypted** because it can contain PII;
   per-section confidence separately, unencrypted; provider/model/prompt
   version; link to the `ai_interactions` usage record).
2. **`ai_interactions` remains sanitized** (no content) and gains a `draft_id`
   link; it is the audit/cost record, not the store of record. AI-assistant
   conversation turns are **session-scoped and client-held** (max 20 prior
   turns sent with each message) and are never persisted; there is no
   conversation or message entity (Clarifications 2026-09-18).
3. Writes: AI-generated versions are created by the service layer (service
   client) after validation; user edits go through `update_ai_draft()`
   (new USER version); confirmation through `confirm_ai_draft()` (will) or
   `confirm_analysis_findings()` (creates asset/beneficiary rows from the
   selected findings atomically). Both are guarded functions (ADR-004 r2)
   and require the explicit confirm endpoint (FR-M010, FR-N007/N008).
4. A confirmed will draft is the authoritative AI document; it is referenced
   in the next legacy-plan finalize snapshot and is the source for PDF
   export. Confirming a new version supersedes the previous confirmed one
   (history retained).
5. Retention: REJECTED/SUPERSEDED drafts and their versions are purged after
   90 days; CONFIRMED drafts live as long as the plan/account.

### Requirements preserved
FR-M001–M014, FR-N001–N008, FR-R006–R007, constitution V, VI, XII, XVI.

### Alternatives considered
- Store drafts inside `legacy_plans.steps_data`: rejected (no versioning,
  mixes AI output with user-entered data).
- Store findings on `ai_interactions.metadata`: rejected (violates the
  sanitized-record rule).
