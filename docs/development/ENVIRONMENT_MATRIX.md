# Environment Matrix — LegacyVault AI

**Purpose**: Which environments exist (or will exist), which services each
one uses, which tools are required, and which **categories** of configuration
they need. Configuration is listed by **variable name only** — this document
never contains values, keys, tokens, passwords or connection strings.

**Canonical sources**: ADR-011 (deployment), ADR-006 (cron), ADR-015 (malware
scanning), `plan.md` § Technical Context and § Phase 13, tasks T007 (env
schema), T015/T016 (test/CI), T193 (cron), T194–T196 (Supabase/Clerk
checklists), T202 (`docs/DEPLOYMENT.md`), T210 (prerequisites), T238 (CD).

**Status**: 📋 Planned. As of 2026-09-19 only a local `.env.local` from the
scaffold exists (its probe has been removed) (it is git-ignored and its contents are not
recorded anywhere). No CI, preview, staging or production environment has
been created. The operational runbook (`docs/DEPLOYMENT.md`, T202) will be
written when environments are provisioned.

---

## 1. Environments

| Environment | Purpose | Application | Database / Storage | Identity | Jobs trigger | Data policy |
|---|---|---|---|---|---|---|
| **Local development** | Day-to-day work | `pnpm dev` at `http://localhost:3000` (UI + `/api/v1` in one process) | Supabase CLI local stack (Docker) **or** a dedicated Supabase development project | Clerk **development** instance | Manual `curl` to `/api/internal/cron/*` with `CRON_SECRET` | Synthetic data only |
| **CI (GitHub Actions)** | Lint, type-check, unit + integration tests, build, migration dry-run | Ephemeral | Supabase CLI local stack | Local HS256 test JWTs with Clerk-shaped claims for RLS/policy tests (ADR-004 r2 §7) | Not scheduled; job runner exercised by tests | Fixtures only |
| **Preview (per pull request)** | Review deployments, E2E smoke | Vercel preview deployment | Supabase **staging** project | Clerk development instance (`@clerk/testing` for E2E) | Vercel Cron (preview schedules as configured) | Synthetic data only |
| **Staging** | Pre-production validation | Vercel deployment from the main branch | Supabase staging project | Clerk development instance | Vercel Cron | No production data (constitution II, NFR-PRV-002) |
| **Production** | Live service | Vercel production deployment behind manual approval | Supabase production project (PITR enabled) | Clerk **production** instance | Vercel Cron **plus** Supabase `pg_cron` + `pg_net` redundant trigger (T211) | Real data; backups + DR (NFR-DR-001/002) |

Additional production service: a **ClamAV (`clamd`) endpoint** reachable from
Vercel functions over TLS (ADR-015). Hosting location is an open owner
decision (`docs/PROJECT_STATUS.md` § 5).

## 2. Required services per environment

| Service | Local | CI | Preview / Staging | Production | Decision |
|---|:-:|:-:|:-:|:-:|---|
| Vercel (hosting, cron, WAF) | — | — | ✓ | ✓ | ADR-011, ADR-007 |
| Supabase PostgreSQL | local stack / dev project | local stack | staging project | production project | ADR-002 |
| Supabase Storage (private buckets `quarantine`, `documents`, `videos`) | ✓ | ✓ (tests) | ✓ | ✓ | ADR-005 |
| Clerk | dev instance | test JWTs (RLS) / dev instance (E2E) | dev instance | production instance | ADR-003 |
| Resend (email) | console transport or Resend test mode | console transport | ✓ | ✓ | ADR-009 |
| Sentry | optional | — | ✓ | ✓ | ADR-010 |
| OpenAI / Google Gemini | ✓ (dev keys) | mocked | ✓ | ✓ | ADR-008 |
| ClamAV | `noop` scanner allowed | `noop` allowed | recommended | **mandatory** (start-up refuses `noop`) | ADR-015 |

## 3. Tools

| Tool | Version / note | Source |
|---|---|---|
| Node.js | 20 LTS | `plan.md` Technical Context |
| pnpm | `packageManager` in `package.json` (11.x) | `package.json` |
| Next.js / React / TypeScript | 16.3.x / 19.2.x / 5.x | `package.json`, `plan.md` |
| Supabase CLI | migrations, local stack, type generation | ADR-002, T194 |
| Docker | required for the Supabase local stack | quickstart Prerequisites |
| Vitest, React Testing Library, Playwright (+ `@axe-core/playwright`, `@clerk/testing`) | tests | T015, T237, T241 |
| k6 | load testing against preview | T191 |
| GitHub Actions | CI/CD | T016, T238 |
| Tunnel (e.g. `ngrok`) | local webhook testing | quickstart Prerequisites |

## 4. Configuration categories (names only — never values)

Defined and validated by `lib/config/env.ts` (T007); templated without values
in `.env.example` (T008). Server variables are readable only in server code;
`NEXT_PUBLIC_*` variables reach the browser; **no secret may be
`NEXT_PUBLIC_`**.

| Category | Variables (names) | Scope |
|---|---|---|
| Identity (Clerk) | `CLERK_SECRET_KEY`, `CLERK_WEBHOOK_SIGNING_SECRET` · public `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | server · public |
| Database / storage (Supabase) | `SUPABASE_URL`, `SUPABASE_SECRET_KEY` · public `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | server · public |
| Application encryption | `ENCRYPTION_KEY` (active), `ENCRYPTION_KEY_PREVIOUS` (rotation window), `ACCESS_COOKIE_KEY` | server |
| AI providers | `OPENAI_API_KEY`, `GEMINI_API_KEY`, `AI_DEFAULT_PROVIDER` | server |
| Email | `RESEND_API_KEY`, `EMAIL_FROM`, `EMAIL_WEBHOOK_SECRET` | server |
| Monitoring | `SENTRY_DSN` · public `NEXT_PUBLIC_SENTRY_DSN` | server · public |
| Background jobs | `CRON_SECRET` | server (also configured in Vercel Cron and, for production, in Supabase Vault for `pg_cron`) |
| Malware scanning | `MALWARE_SCANNER_PROVIDER` (`noop` \| `clamav`), `CLAMAV_HOST`, `CLAMAV_PORT`, `CLAMAV_TLS` | server |
| Application | `APP_URL`, `ADMIN_EMAIL` (first Super Admin seed), `NODE_ENV` | server |

Where they live: local `.env.local` (git-ignored), Vercel project environment
variables per environment (preview/staging/production), GitHub Actions
secrets for CI. Never in the repository, never in documentation.

## 5. Platform-level configuration (recorded, not code)

| Platform | Configuration | Task |
|---|---|---|
| Clerk | password policy (12+, upper/lower/number/special), email verification required, MFA TOTP + backup codes, 24 h inactivity session lifetime, lockout 5 attempts / 30 min, bot protection, reverification, Supabase third-party-auth integration, webhook endpoint and events | T195 |
| Supabase | Clerk as third-party auth provider; private buckets; global file-size limit ≥ 500 MB; backups; PITR (production); `pg_cron`/`pg_net` available | T196 |
| Vercel | cron schedules (`vercel.json`: run-jobs every 5 min, dms-scan hourly, housekeeping daily), `maxDuration` per route, WAF rate-limit rules for public paths | T193, T210 |

## 6. Platform prerequisites to verify before relying on them (T210)

- Vercel plan supports minute-level cron and the `maxDuration` needed for job,
  AI and scan handlers (largest video scan).
- Supabase plan supports a ≥ 500 MB file-size limit and PITR (production).
- Clerk plan supports inactivity timeout, session-token customization and
  reverification.
- ClamAV endpoint reachable from Vercel functions.

## 7. Deployment expectations (ADR-011, T238)

CI: install → lint → type-check → unit + integration tests → build →
`supabase db lint` / migration dry-run, with the security-tagged test suites
blocking (T246). CD: preview per pull request; staging on merge to main;
production behind a manual approval gate; migrations applied with a gated
`supabase db push`; smoke tests after each deploy; documented and drilled
rollback. Backups: Supabase automated backups + PITR for production plus
off-platform `pg_dump` copies to an encrypted private bucket (T186, T187).
