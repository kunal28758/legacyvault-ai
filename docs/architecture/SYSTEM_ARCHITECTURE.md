# System Architecture — LegacyVault AI

**Purpose**: Explain how the baseline system is put together so that
contributors and agents share one mental model. It organizes decisions that
are made elsewhere; it does not make new ones.

**Canonical sources**: [`ARCHITECTURE_DECISIONS.md`](../ARCHITECTURE_DECISIONS.md)
(ADR-001 … ADR-016), `specs/001-baseline-product-spec/plan.md` (§ Technical
Context, § Project Structure, § Request pipeline, § Background processing),
`data-model.md`, `contracts/api-contracts.md`, constitution v2.0.1
(Principle VIII, Technology Stack).

**Status**: 📐 Specified. As of 2026-09-18 **nothing described here is
implemented**; the repository contains a Next.js 16.3.5 scaffold, two
scaffold-era Supabase client files and a temporary connectivity probe, all of
which are replaced by tasks T002/T028. Pre-implementation baseline for the
document scheduled by task T175.

---

## 1. Shape of the system

One **Next.js 16 (App Router) + React 19 + TypeScript** application at the
repository root (ADR-001). There is no separate backend service, no
`frontend/`/`backend/` split, and no monorepo tooling. Presentation and
server-side business logic are separated by **module boundary**:

```
app/            React Server/Client Components, layouts, Route Handlers
components/     UI (shadcn/ui primitives, layout, forms, wizard, shared)
lib/api/        withApi() request pipeline, errors, validation, clients
lib/auth/       Clerk helpers: requireUser, requireRole, reverification, ensureAppUser
lib/services/   business logic (the only place business rules live)
lib/repositories/ data access (typed supabase-js, rpc() to guarded functions)
lib/{ai,email,storage,jobs,security,audit,observability,config,validators,types}
supabase/       SQL migrations (schema, privileges/RLS, functions), seed
```

The full target tree is in `plan.md` § Project Structure. Managed platform
services are reached only through server-side adapter modules (constitution
VIII).

## 2. Platform boundaries

| Concern | Platform / component | ADR |
|---|---|---|
| Hosting, serverless functions, cron, edge WAF | Vercel | 011, 006, 007 |
| Identity, sessions, MFA, reverification, webhooks | Clerk (sole authentication system) | 003 |
| Relational data, RLS, transactional functions | Supabase-managed PostgreSQL (SQL migrations, no ORM) | 002, 004 |
| Private object storage, signed URLs | Supabase Storage (`quarantine`, `documents`, `videos`) | 005 |
| Background work | PostgreSQL `jobs` table drained by Vercel Cron (+ `pg_cron` redundancy in production); no Redis/BullMQ | 006 |
| AI | OpenAI and Google Gemini behind the in-house `AIProvider` interface | 008, 016 |
| Email | `EmailProvider` abstraction; Resend baseline | 009 |
| Monitoring | Sentry, structured JSON logs (pino), health endpoint | 010 |
| Malware scanning | ClamAV behind `MalwareScanner` (production mandatory) | 015 |

Superseded and **not** part of the baseline (historical only — see
`research.md` "Superseded (history)"): Express.js, Prisma, AWS S3/MinIO,
Redis/BullMQ, Supabase Auth, MongoDB, Multer, Nodemailer, Winston, Puppeteer.

## 3. Request path (`/api/v1`)

Every public API is a Route Handler under `app/api/v1/**` wrapped by
`withApi()` (`plan.md` § Request pipeline; contract header in
`api-contracts.md`):

```
correlation id → Cache-Control: private, no-store → authentication
  (Clerk session | access cookie | cron secret | webhook signature | public)
→ role check (users.role in PostgreSQL) → optional reverification
→ CSRF origin check (mutations) → rate limit (Postgres counters)
→ Zod validation → handler → service → repository → PostgreSQL / Storage / Clerk API
→ { success, data, meta } | safe error envelope (+ Sentry, DENIED/FAILURE audit)
```

Authentication modes: Clerk session (users/admins), **access cookie**
(external recipients after a one-time token exchange — ADR-014), `CRON_SECRET`
bearer (internal cron), webhook signature verified over the raw body (Clerk /
Svix and email-provider webhooks), public (health, emergency-access
request/verify, access exchange). Server Components read through the same services (never via
HTTP to the app's own handlers).

## 4. Data path and write protection

- Reads use the **user-scoped** Supabase client (publishable key + Clerk
  session token) so RLS applies; system paths use the **service** client
  (server-only secret key).
- Writes follow the three-class model in `data-model.md` § Write-Protection
  Model (ADR-004 r2/r4): Class A plain user data via column allow-lists
  (never encrypted columns; every direct change trigger-audited); Class B
  invariant-bearing data — including asset creation, sensitive fields and
  deletion — only through guarded `SECURITY DEFINER` functions; Class C
  system tables via the service role only.
- Multi-step, all-or-nothing workflows (plan finalization, assignments, DMS
  and emergency-access transitions, AI draft confirmation, job claiming) are
  PostgreSQL functions invoked with `rpc()` so they run in one transaction.

See [`../database/DATABASE_ARCHITECTURE.md`](../database/DATABASE_ARCHITECTURE.md).

## 5. Files

Uploads never pass through the application server (Vercel request-body
limits): the server issues a **signed upload URL** (documents, ≤ 50 MB) or a
**resumable TUS target** (videos, ≤ 500 MB) into the private `quarantine`
bucket; the browser uploads directly; a `complete` step verifies actual size
and magic bytes, runs the malware scan, and `promote_upload()` moves the
object to `documents`/`videos` and creates metadata rows. Downloads and
previews use server-minted **signed URLs (15 minutes)** after authorization
(ADR-005). Files are encrypted at rest by the storage provider (ADR-005 §4;
application-layer envelope encryption is deferred — ADR-013).

## 6. Background processing

```
Service ──enqueue──▶ jobs (PostgreSQL, same transaction where atomic)
Vercel Cron ─▶ /api/internal/cron/run-jobs    every 5 min  (claim_jobs FOR UPDATE SKIP LOCKED)
Vercel Cron ─▶ /api/internal/cron/dms-scan    hourly       (enqueue one dms.scan job → handler enqueues DMS transition jobs)
Vercel Cron ─▶ /api/internal/cron/housekeeping daily       (expiry sweeps, purges, retention)
pg_cron + pg_net (production) ─▶ same endpoints (redundant trigger)
health check ─▶ last successful dms.scan ≤ 2× interval, else CRITICAL audit + alert
```

Handlers are idempotent; unknown job types stay QUEUED (never DEAD) so later
phases can register handlers (ADR-006, `data-model.md` §22).

## 7. External recipients (beneficiaries, trusted contacts, emergency contacts)

All external recipients are `Beneficiary` records. Access of any kind
(direct share, Dead Man Switch release, emergency grant) is an `access_tokens`
row. The recipient's emailed link carries the token once; the public
`/access` page exchanges it (`POST /api/v1/access/exchange`) for an encrypted,
httpOnly, path-scoped cookie, and every `/api/v1/access/*` request re-checks
revocation, expiry and beneficiary status (ADR-014). Emergency-access
requesters verify by email OTP before the owner (or the configured timeout
rule) decides.

## 8. Cross-cutting rules

- Business logic lives in `lib/services` — never in handlers, Server
  Components, Server Actions or UI (constitution VIII).
- Server-only modules import `server-only`; only `NEXT_PUBLIC_*` variables
  reach the browser (constitution I).
- Every response is `Cache-Control: private, no-store`; user-data route groups
  are never statically prerendered or `use cache`d (ADR-001, constitution XV).
- Every security-relevant operation is audited with actor, action, resource,
  outcome and correlation id (constitution XII).
- Next.js 16 conventions apply (`proxy.ts` replaces `middleware.ts`); read
  `node_modules/next/dist/docs/` before framework code (`AGENTS.md`).

## 9. Environments and deployment

Vercel previews per pull request, staging on the main branch, production
behind manual approval; Supabase projects and Clerk instances per environment;
gated `supabase db push` for migrations; GitHub Actions CI with blocking test
gate (ADR-011, T016/T238/T246). Details and prerequisites:
[`../development/ENVIRONMENT_MATRIX.md`](../development/ENVIRONMENT_MATRIX.md).

## 10. Open items affecting architecture

Tracked in [`../PROJECT_STATUS.md`](../PROJECT_STATUS.md) § 5: ClamAV hosting
location (ADR-015), platform tiers (Vercel cron/`maxDuration`, Supabase file
limit/PITR, Clerk session features), Clerk failed-sign-in event coverage
(T203), audit-log retention schedule.
