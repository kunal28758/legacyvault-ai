# Integrations — LegacyVault AI

**Purpose**: The external services the baseline depends on — what each one
is responsible for, the server-side adapter that isolates it (constitution
VIII), the configuration it needs (names only), inbound traffic it sends us,
and how the application behaves when it is unavailable.

**Canonical sources**: ADR-003 (Clerk), ADR-002/004/005 (Supabase), ADR-006/
007/011 (Vercel), ADR-008/016 (AI providers), ADR-009 (Resend), ADR-010
(Sentry); `contracts/api-contracts.md` § Internal
Endpoints; tasks T007, T028, T029, T039, T104–T107, T188, T195, T196, T198,
T209, T247.

**Status**: 📐 specified / 📋 planned. As of 2026-09-18 **no adapter exists**
and no service is configured; the scaffold's temporary Supabase connectivity
probe was removed on 2026-09-19 (its client files go with T028). No credential values appear here.

---

## Summary

| Service | Role | Adapter (planned) | ADR |
|---|---|---|---|
| Clerk | Sole application authentication provider | `lib/auth/*`, `proxy.ts`, `app/api/webhooks/clerk` | 003 |
| Supabase PostgreSQL | Database, RLS, transactional functions | `lib/db/server.ts`, `lib/repositories/*`, `supabase/migrations` | 002, 004 |
| Supabase Storage | Private object storage, signed URLs | `lib/storage/storage.service.ts` | 005 |
| Vercel | Hosting, Route Handlers, Cron, WAF, environment configuration | `vercel.json`, route segment config | 006, 007, 011 |
| OpenAI / Google Gemini | AI generation with structured outputs | `lib/ai/provider.ts`, `lib/ai/providers/{openai,gemini}.ts`, `lib/ai/factory.ts` | 008, 016 |
| Resend | Transactional email (application emails) | `lib/email/provider.ts`, `lib/email/providers/resend.ts`, `app/api/webhooks/email` | 009 |
| Sentry | Error monitoring, alerting, performance | `@sentry/nextjs` instrumentation, `withApi()`, job runner | 010 |

Superseded / not integrated (historical only): ClamAV (removed 2026-10-04,
ADR-017), Supabase Auth, AWS S3/MinIO,
Redis/BullMQ, Nodemailer SMTP (may implement `EmailProvider` later).

---

## Clerk (ADR-003)

- **Owns**: sign-up/sign-in, password policy, email verification, MFA (TOTP +
  backup codes), sessions (httpOnly cookie, 24 h inactivity lifetime,
  revocation), password reset, attack protection (lockout, bot detection),
  step-up reverification, per-session device data.
- **Application keeps**: `users` profile and **role**, all authorization,
  audit, external-recipient tokens (never Clerk identities).
- **Server-side use**: `auth()` in `withApi()`/layouts; Backend API for
  session list/revoke (Security Center) and admin unlock / MFA reset.
- **Inbound**: Svix-signed webhooks at `POST /api/webhooks/clerk`
  (`user.created|updated|deleted`, `session.created|ended|removed|revoked`)
  → `users` sync, audit rows, new-device job; idempotent via
  `processed_webhook_events`.
- **Supabase link**: Clerk is configured as Supabase's third-party auth
  provider so RLS policies can read the Clerk subject (T195, T196).
- **Configuration (names)**: `CLERK_SECRET_KEY`, `CLERK_WEBHOOK_SIGNING_SECRET`,
  `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`; dashboard settings per T195.
- **Unavailable**: sign-in and reverification fail closed; existing sessions
  continue until Clerk validation fails; no data is exposed.
- **Open**: T203 verifies failed-sign-in event coverage; plan-feature
  availability (inactivity timeout, token customization) verified in T210.

## Supabase — PostgreSQL and Storage (ADR-002, 004, 005)

- **Owns**: managed PostgreSQL (backups, PITR), RLS, storage buckets, signed
  upload/download URLs, resumable (TUS) uploads.
- **Server-side use**: two clients — user-scoped (publishable key + Clerk
  token; RLS applies) and service (secret key; system paths only); SQL
  migrations via the Supabase CLI; `pg_cron` + `pg_net` as the production
  redundant cron trigger (T211).
- **Storage buckets**: `documents`, `videos` — private; upload straight to
  the destination bucket → size/type check → promote (ADR-005, ADR-017). The
  retired `quarantine` bucket is kept, private and unused.
- **Configuration (names)**: `SUPABASE_URL`, `SUPABASE_SECRET_KEY`,
  `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`; project
  settings per T196 (file-size limit ≥ 500 MB, PITR, buckets, third-party
  auth).
- **Unavailable**: requests fail with safe errors (no internal details);
  health endpoint reports degraded; jobs retry with backoff.

## Vercel (ADR-006, 007, 011)

- **Owns**: hosting of the single Next.js application, serverless/fluid
  functions, environment variables per environment, Cron
  (`/api/internal/cron/run-jobs` every 5 min, `dms-scan` hourly,
  `housekeeping` daily), WAF rate-limit rules on public paths, preview
  deployments.
- **Constraints that shaped the design**: request-body limit → direct-to-
  storage uploads; function duration budgets → job-based long work
  (`maxDuration` per route).
- **Configuration**: `vercel.json` (T193), `CRON_SECRET` shared with the cron
  endpoints, WAF rules (T210), plan-tier prerequisites (T210).

## OpenAI and Google Gemini (ADR-008, 016)

- **Owns**: text generation and structured outputs for the assistant, will
  generator and document analysis; Gemini vision is an acceptable OCR path.
- **Application keeps**: the in-house `AIProvider` interface
  (`generateText`, `generateStructured<T>` with Zod validation, `stream`),
  provider factory with outage fallback, validation service (unsupported
  claims, fabricated references, confidence), versioned prompts/schemas,
  sanitized `ai_interactions`, encrypted `ai_drafts`, explicit confirmation
  before persistence.
- **Configuration (names)**: `OPENAI_API_KEY`, `GEMINI_API_KEY`,
  `AI_DEFAULT_PROVIDER`, optional `OPENAI_MODEL` / `GEMINI_MODEL` — server-only
  (FR-L009, FR-R002). Either key alone is enough; with both, the other provider
  is the outage fallback. Implemented in `lib/ai/` (2026-09-30).
- **Unavailable**: fallback to the secondary provider; if both fail,
  `503 AI_UNAVAILABLE` and all non-AI workflows continue (FR-R010).
- **Data handling**: prompts contain only what the feature needs; document
  content is never logged; provider calls originate only from Route Handlers
  or job handlers.

## Resend (ADR-009)

- **Owns**: delivery of application emails (beneficiary invitations and
  access links, Dead Man Switch check-ins/escalations/releases, emergency-
  access designation/OTP/decisions, document shares, security alerts) using
  React Email templates. Clerk sends its own verification/reset emails.
- **Application keeps**: `EmailProvider` interface (console transport in
  development; Nodemailer/SES could implement it later), retry via the
  `notification.deliver` job, delivery status on `notifications`.
- **Inbound**: provider-signed delivery webhooks at `POST /api/webhooks/email`
  (delivered / bounced / complained) → `notifications.deliveryStatus`,
  idempotent.
- **Configuration (names)**: `RESEND_API_KEY`, `EMAIL_FROM`,
  `EMAIL_WEBHOOK_SECRET`.
- **Unavailable**: emails are retried with backoff by the job runner; failures
  are logged and never block user workflows (plan Phase 11).

## Sentry (ADR-010)

- **Owns**: error capture (client, server, edge), release tagging, source
  maps, performance data, alert rules.
- **Application keeps**: PII scrubbing (`beforeSend`, `beforeSendTransaction`, `beforeBreadcrumb`: URL queries and fragments, where `t` access secrets travel
  and cookies stripped), correlation id as a tag, capture points in
  `withApi()` and the job runner, alert routing (error-rate spikes,
  `dms.job_health_failure`, DEAD job count — T239).
- **Configuration (names)**: `SENTRY_DSN`, `NEXT_PUBLIC_SENTRY_DSN`.
- **Unavailable**: monitoring degrades; the application keeps serving.

---

## Cross-cutting rules for every integration

- Reached only through the adapter module named above; business logic never
  imports a provider SDK directly (constitution VIII).
- Secrets are server-only environment variables validated at start-up
  (T007); none is `NEXT_PUBLIC_` except the publishable/DSN values the
  providers designate as public.
- Inbound endpoints (webhooks, cron) authenticate themselves (signatures,
  `CRON_SECRET`), are idempotent, and are excluded from Clerk route
  protection in `proxy.ts` (T192, T198, T199, T209).
- Provider outages degrade gracefully and are visible in the health endpoint
  and Sentry; they never expose internal details to clients.
