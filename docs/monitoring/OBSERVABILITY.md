# Observability — LegacyVault AI

**Purpose**: How the running system will be observed — logging, correlation,
error monitoring, health checks, metrics, alerting — and the privacy rules
that constrain all of it. It organizes decisions already made; it adds none.

**Canonical sources**: constitution v2.0.1 Principle XVI (Observability),
XII (Auditability), XXI; `spec.md` NFR-OBS-001–003, NFR-AVL-002, NFR-PRV-003,
FR-Q017, SC-010; ADR-010; `contracts/api-contracts.md` § Internal Endpoints;
tasks T022, T023, T030, T171, T172, T183, T188, T211, T239.

**Status**: 📐 specified / 📋 planned. **Nothing is implemented** as of
2026-09-18 (no logger, Sentry configuration or health endpoint exists).

---

## 1. Principles

- Structured, correlated, redacted logging; monitoring must never require
  access to raw user data (constitution XVI, NFR-PRV-003).
- Security-relevant events are **audit rows first** (tamper-resistant), alerts
  second (ADR-010).
- No passwords, tokens, cookies, encryption keys, access links, document
  content or unnecessary PII in logs, breadcrumbs or traces (FR-Q017,
  NFR-OBS-003).

## 2. Structured logging (T022)

- `pino` JSON logger (`lib/observability/logger.ts`), environment-aware
  level, emitted to stdout and collected by the platform (Vercel log drains
  in production — T239).
- **Redaction paths**: authorization, cookie, token, password, secret, key,
  document-content fields, the `t` query parameter, and `/access` /
  `/emergency-access` request paths (access tokens must never be logged —
  ADR-014).
- Every log line carries the request **correlation id** (§ 3); job handlers
  log with the job id and type.
- `console.log` is not used in application code (coding standards).

## 3. Correlation (T023, NFR-OBS-001)

`withApi()` generates a UUID correlation id per request (inbound
`X-Correlation-ID` honoured only from trusted internal calls), returns it in
the `X-Correlation-ID` response header and the `meta.correlationId` envelope
field, binds it to the logger, tags the Sentry scope, and passes it to audit
rows and guarded database functions (`p_correlation_id`) so an incident can be
traced across API, database and audit trail.

## 4. Error monitoring (T188, NFR-OBS-002)

- `@sentry/nextjs` for client, server and edge runtimes
  (`instrumentation.ts`, `instrumentation-client.ts`); DSN from
  `SENTRY_DSN` / `NEXT_PUBLIC_SENTRY_DSN`; release tagging and source-map
  upload from CI.
- Capture points: the `withApi()` error mapper and the job runner. Clients
  receive only the safe error envelope (FR-Q016).
- PII scrubbing in `beforeSend` (strip `t` query parameters and cookies);
  breadcrumbs sanitized (T172 audits this).

## 5. Health (T030, T183)

`GET /api/v1/health`:

- Public response: `{ status: "ok" | "degraded" }` only.
- Detailed response (with `CRON_SECRET` bearer or a Super Admin session):
  `{ status, database, storage, jobs: { lastRunAgeSeconds }, dmsScan }`.
- `dmsScan` is derived from the last successful `dms.scan` job
  (`jobs.finished_at`): if older than 2× the scan interval it reports
  `stale`, a CRITICAL audit row `dms.job_health_failure` is written, Super
  Admins are emailed and Sentry is alerted (NFR-AVL-002). The same check runs
  inside `run-jobs`.

## 6. Metrics and signals (ADR-010, T239)

| Signal | Source |
|---|---|
| Request latency / errors / throughput | Vercel Analytics & Speed Insights, Sentry performance |
| Job health | `jobs` table: queue depth, DEAD count, `finished_at` freshness, retry counts |
| DMS scheduler freshness | health check (§ 5) |
| Security metrics | `audit_log`: DENIED outcomes, rate-limit hits (429), failed reverifications, `access.*` events, `dms.job_health_failure` |
| Scanner health | `file.scan` / `video.process` ERROR rate |
| Email delivery | `notifications.deliveryStatus` via provider webhooks |
| Uptime | external monitor on `/api/v1/health` (T239; SC-010 measured in operation) |

## 7. Alerting and routing (T188, T239)

Alert rules planned in Sentry (error-rate spikes, `dms.job_health_failure`,
DEAD job count, scanner ERROR rate) with routing/escalation notes recorded in
`docs/DEPLOYMENT.md` when environments exist. Super Admin email
notifications for DMS health failures are sent through the notification
service.

## 8. Audit vs. logs

| | Audit log (`audit_log`) | Application logs |
|---|---|---|
| Purpose | forensic, legally significant record | operational debugging |
| Integrity | append-only, trigger-protected, backed up | best-effort, platform-retained |
| Content | actor, action, resource, outcome, redacted before/after, correlation id | structured events, redacted |
| Access | users see their own rows; Super Admin sees all | operators via log drains |
| Retention | indefinite in baseline (owner/legal decision pending) | per log-drain policy (T239) |

## 9. Verification

Pipeline tests assert the correlation header, `no-store` header, safe error
envelope and redaction behaviour (T214); log-content and error-response
audits run before production (T171, T172); the pre-production security review
checks monitoring configuration (T185).
