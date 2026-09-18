# Security Architecture — LegacyVault AI

**Purpose**: Describe the security controls of the baseline, layer by layer,
and state for each whether it is **specified** (📐 defined in an authoritative
artifact), **planned** (📋 has a task) or **implemented** (✅ code exists and
is verified). It organizes decisions made in the constitution, the ADRs, the
spec and the data model; it does not add controls.

**Canonical sources**: constitution v2.0.1 (Principles I–VII, X–XII, XVI,
XVII, XXI); ADR-003, ADR-004 r2, ADR-005, ADR-007, ADR-013, ADR-014, ADR-015,
ADR-016; `spec.md` § Q Security Requirements and § R AI Safety;
`data-model.md` § Write-Protection Model; `contracts/api-contracts.md`
header. `docs/BRAIN.md` § 6 holds the one-page summary table.

**Status as of 2026-09-18: nothing in this document is ✅ implemented.**
The pre-production security review (NFR-SEC-002, task T185) and the
security-specific document scheduled by T178 (`docs/SECURITY.md`) will
record verified state later.

---

## 1. Principles that shape the design

- Defense in depth: no single control is the sole barrier (constitution I).
- Server-side enforcement for every protected operation; frontend and proxy
  guards are UX only (constitution III).
- Exactly one application authentication system (Clerk); authorization is
  never delegated (constitution III as amended).
- Least privilege for database roles and platform keys; secrets never in
  source or client bundles (constitution I, IV).
- Priority under conflict: Security → Integrity → Correctness → Legal-Tech
  Safety → … (constitution XXII).

## 2. Identity and sessions — 📐 specified, 📋 planned (ADR-003)

| Control | Provided by | Configuration / task |
|---|---|---|
| Email/password registration, policy ≥ 12 chars with upper/lower/number/special (FR-A001, A002) | Clerk | T195 |
| Mandatory email verification before sign-in (FR-A003, A004) | Clerk | T195 |
| MFA: TOTP + backup codes (FR-A006, A017) | Clerk | T056, T195 |
| Sessions: httpOnly/secure/SameSite cookie, 24 h inactivity lifetime, server-side revocation (FR-A007–A009, FR-Q006) | Clerk | T195, T114/T115 |
| Password reset with sign-out of other sessions (FR-A010, A011) | Clerk | T195, T204 |
| Lockout after 5 failed attempts for 30 min; bot protection (FR-A012, A013) | Clerk attack protection (+ Vercel WAF) | T195, T210 |
| Auth event logging (FR-A014) | Clerk webhooks → `audit_log` | T198; **T203 verifies failed-attempt coverage** (open item) |
| New-device / unusual-location notification (FR-A016) | `security.new-device-check` job (city/country/browser only) | T182 |
| Step-up reverification for sensitive operations (FR-A018) | Clerk reverification — `strict` (≤ 10 min) for sensitive reads/changes; `multi_factor` for Dead Man Switch check-in/cancel when MFA is enabled | T201; `withApi({ reverification })` |
| Idle-timeout preference (FR-B006) | application-enforced client sign-out within the platform lifetime | T220 |
| Role source of truth | `users.role` in PostgreSQL (never Clerk metadata) | T036, T148 |

## 3. Authorization — 📐 specified, 📋 planned (ADR-004 r2)

Three barriers, applied together:

1. **Service layer (authorization of record)** — `requireUser()` /
   `requireRole()` resolve the Clerk session to the app user and its role;
   every service method verifies ownership/role and audits the outcome
   (T036, all `lib/services`).
2. **PostgreSQL** —
   - **Privilege baseline**: `REVOKE ALL` on tables and functions from
     `anon`/`authenticated`, then explicit grants (T218).
   - **RLS on every table**, deny-by-default; user-owned rows keyed on the
     Clerk subject (`auth.jwt()->>'sub'` = `users.clerk_user_id`) via
     Supabase third-party auth.
   - **Write classes** (`data-model.md` § Write-Protection Model): Class A
     plain user data with **column allow-lists**; Class B invariant-bearing
     data writable only through guarded `SECURITY DEFINER` functions (auth
     prologue, `FOR UPDATE` ownership checks, typed inputs, no dynamic SQL,
     no identity-column writes, in-transaction audit row, `EXECUTE` limited
     to `authenticated`); Class C system tables reachable only by the
     service role. A `BEFORE UPDATE` trigger protects `users` identity
     columns even if a grant is mis-applied.
   - **Sensitive-field boundary (ADR-004 r4)**: the application-encrypted
     columns (`users.identificationDetails`, financial `accountNumber` /
     `policyNumber`, digital `credentials` / `recoveryInfo`) have **no**
     direct grant and are written only through `create_asset()` /
     `set_encrypted_fields()` (envelope-validated, audited); asset rows are
     created only through `create_asset()`. `audit_class_a_change()`
     triggers record every direct Class A change, so audit completeness does
     not depend on application code. RLS + grants are the second barrier —
     never the only one (`data-model.md` § Write-Protection Model 6).
3. **Two server-only clients** — user-scoped (publishable key + Clerk token;
   RLS and grants apply — the same Clerk token is usable by the browser
   against PostgREST, which is why the grants above are the boundary) for user
   operations; service client (secret key)
   only for webhooks, cron/jobs, audit writes, admin, token/OTP flows and
   upload promotion (T028).

Roles in the baseline: **User**, **Super Admin** (spec § Roles and Access).
External recipients are not roles; they hold scoped access tokens (§ 5).
Organization Admin / Team Manager are deferred (spec Clarifications
2026-09-16).

Verification: RLS suite T212, write-protection suite T215 (incl. the r4
sensitive-field and trigger assertions), authorization matrix T241.

## 4. Request-pipeline controls — 📐 specified, 📋 planned

All applied by `withApi()` (T030) to every Route Handler:

| Control | Detail | Requirement |
|---|---|---|
| CSRF | `Origin` / `Sec-Fetch-Site` same-origin check on POST/PATCH/PUT/DELETE in the cookie/ambient modes (`public`, `user`, `admin`, `access-cookie`); Clerk and access cookies are SameSite. `cron`/`webhook` carry no cookies and authenticate every request (`CRON_SECRET` / raw-body signature) | FR-Q007, constitution XI |
| Rate limiting (ADR-007) | Clerk attack protection (auth) + Vercel WAF per-IP rules (public paths) + Postgres-backed application limiter with named policies (`default` 100/15 min, `sensitive` 5/15 min, `ai` 20/h, `publicEmergency` 5/h per IP and 3/h per config, `accessExchange` 10/15 min per IP, `tokenAccess` 60/15 min per session); 429 + `Retry-After` | FR-Q008 |
| Input validation | Zod on body/query/params; 422 field errors; raw input never echoed | FR-Q009, constitution X |
| Error safety | `ApiError` envelope; no stack traces, DB details, file paths or internal ids; full detail only server-side/Sentry | FR-Q016 |
| Security headers | HSTS, `X-Frame-Options: DENY`, `nosniff`, `Referrer-Policy`, `Permissions-Policy` (camera/microphone/geolocation denied), nonce-based CSP from `proxy.ts` | FR-Q015, constitution XXI (T024, T192) |
| Cache safety | `Cache-Control: private, no-store` on every response; user-data route groups never prerendered or `use cache`d | constitution XV (ADR-001) |
| Correlation | `X-Correlation-ID` on every response, bound to logs, Sentry and audit rows | NFR-OBS-001 (T023) |

## 5. External recipient access — 📐 specified, 📋 planned (ADR-014)

- Every beneficiary, trusted contact and emergency contact is a `Beneficiary`
  record; every grant is an `access_tokens` row (`grant_type` DIRECT_SHARE /
  DMS_RELEASE / EMERGENCY_ACCESS), stored as a SHA-256 hash, scoped to
  explicit resources, time-limited (≤ 30 days for direct shares).
- The emailed link carries the token **once**; the public `/access` page
  exchanges it (`POST /api/v1/access/exchange`) for an encrypted httpOnly
  cookie (`SameSite=Strict`, `Path=/api/v1/access`, 30-minute sliding TTL ≤
  token expiry) and strips it from the URL. Tokens never appear in request
  paths or logs; every request re-checks revocation, expiry and beneficiary
  status; every access is audited (T230, T100, T101, T022).
- Emergency requesters verify by **email OTP** (6 digits, 15-minute expiry,
  3 attempts) before the owner decides or the configured timeout rule
  (WAIT / AUTO_GRANT / DENY) applies (FR-J003, J006; T135, T136).
- Plan sections are released only from the **latest finalized** plan version
  (T231).
- **Delivery policy (ADR-014 § 6)**: DMS_RELEASE and EMERGENCY_ACCESS links
  are sent by the `access.deliver` job with a deterministic per-contact
  idempotency key; a retry after a failed send revokes the undelivered token
  (`UNDELIVERED_REPLACED`) and mints exactly one replacement; partial unique
  indexes keep one live token per (switch, beneficiary) / per request;
  dead-letter → CRITICAL `access.delivery_failed` + alert; audited resend
  paths for the owner and Super Admin. Plaintext is never persisted (T097,
  T131, T135, T148).

## 6. Files — 📐 specified, 📋 planned (ADR-005, ADR-015)

- Private buckets only; no public URLs (FR-H005, FR-Q005).
- Two-step direct-to-storage upload into `quarantine`; the `complete` step
  checks actual size (50 MB / 500 MB), magic bytes and the **malware scan**
  before `promote_upload()` moves the object (FR-H002, H003, H016, FR-Q010,
  Q011; T032, T090, T141, T181).
- Production scanner is **ClamAV**; the application refuses to start in
  production with the `noop` scanner (ADR-015; T007, T247). INFECTED objects
  never leave quarantine.
- Downloads and previews only via server-minted signed URLs (15 minutes)
  after authorization; every access audited (FR-H009, H015).
- `storage.objects` RLS: no client reads; writes only into the caller's
  `quarantine/<clerk sub>/` prefix for resumable uploads (T218).
- Encryption at rest by the storage provider (AES-256); application-layer
  envelope encryption deferred with a ready design (ADR-013).

## 7. Data protection — see [`ENCRYPTION.md`](./ENCRYPTION.md)

Application AES-256-GCM for sensitive fields and AI draft content; provider
encryption for disks and objects; TLS 1.2+ in transit; keys in server
environment configuration only; rotation procedure planned (T240).
Secrets: `.env*` git-ignored, Vercel environment variables, `server-only`
modules, no `NEXT_PUBLIC_` secrets (constitution I, XIX, XXI).
Logging: pino redaction of tokens, cookies, keys, document content and
access paths; Sentry PII scrubbing (constitution XVI; T022, T188).

## 8. Audit — 📐 specified, 📋 planned (constitution XII)

- `audit_log` is append-only: no update/delete grants and a trigger that
  raises for every role; rows carry actor, role, action, resource, outcome,
  metadata (redacted before/after), IP, user agent, correlation id.
- Written by guarded functions (SUCCESS, in the same transaction) and by the
  audit service (Class A/C writes, DENIED/FAILURE outcomes).
- Covered events: authentication (via Clerk webhooks), document access and
  changes, permission changes, beneficiary changes, emergency access, Dead
  Man Switch events, AI confirmations, admin actions, external-recipient
  access (FR-A014, D009, E005, F004, G005, H015, I009, J009, K008, P011).
- Retention of audit rows is indefinite in the baseline; a formal schedule is
  an owner/legal decision (`data-model.md` § Retention).

## 9. Internal endpoints and background work — 📐 specified, 📋 planned

- Cron endpoints require `Authorization: Bearer $CRON_SECRET`; webhooks
  verify provider signatures (Svix for Clerk, provider signature for email)
  and are idempotent via `processed_webhook_events` (T197–T199, T209).
- Job handlers are idempotent; DMS scan freshness is health-checked and a
  redundant `pg_cron` trigger runs in production (ADR-006; T183, T211).
- The public health endpoint returns only `{ status }`; details require the
  cron secret or a Super Admin session (T030).

## 10. Legal-tech and AI safety — 📐 specified, 📋 planned (constitution V, VI; ADR-008, ADR-016)

Provider keys server-only; structured outputs validated with Zod; validation
service flags unsupported claims, fabricated references and low confidence;
every AI response carries the legal disclaimer; nothing AI-generated becomes
authoritative without the explicit confirm endpoint; drafts and findings are
stored encrypted in `ai_drafts`/`ai_draft_versions` while `ai_interactions`
stays sanitized; provider outage degrades gracefully (T104–T109, T119, T145,
T232, T233).

## 11. Dead Man Switch and Emergency Access safeguards — 📐 specified

Multi-step escalation, identity-verified (reverified) check-in and recovery
at every stage including after release, release scoped exactly to
user-selected resources, never account access, scan health monitoring
(FR-I003, I005, I007, I008, I012; NFR-AVL-002); emergency access requires
OTP verification, owner notification/decision or configured timeout rule,
time-limited scoped access, owner revocation, full audit (FR-J003–J010).
Flows: [`../workflows/DEAD_MAN_SWITCH_WORKFLOW.md`](../workflows/DEAD_MAN_SWITCH_WORKFLOW.md),
[`../workflows/BENEFICIARY_WORKFLOW.md`](../workflows/BENEFICIARY_WORKFLOW.md) § 6.

## 12. Operations — 📋 planned

Backups: Supabase automated backups + PITR (production) and off-platform
`pg_dump` copies to an encrypted, access-restricted bucket; restore drills
and DR runbook (NFR-DR-001/002; T186, T187). Monitoring and alerting:
[`../monitoring/OBSERVABILITY.md`](../monitoring/OBSERVABILITY.md).
Dependency scanning in CI (T174); pre-production security review covering
OWASP Top 10, cross-user isolation, storage privacy, tokens/cookies,
secrets, headers/CSP, cache safety and the ADR-013 activation decision
(T185); security-tagged tests block merges (T246); security regressions block
release (NFR-SEC-003).

## 13. Status summary

| Area | Specified | Planned (tasks) | Implemented |
|---|:-:|:-:|:-:|
| Identity & sessions (Clerk) | ✔ | ✔ | — |
| Authorization (service + RLS + write classes) | ✔ | ✔ | — |
| Request pipeline controls | ✔ | ✔ | — |
| External recipient access (tokens/cookie/OTP) | ✔ | ✔ | — |
| Files (quarantine, scan, signed URLs) | ✔ | ✔ | — |
| Encryption & secrets | ✔ | ✔ | — |
| Audit | ✔ | ✔ | — |
| Internal endpoints & jobs | ✔ | ✔ | — |
| AI safety | ✔ | ✔ | — |
| Backups / DR / monitoring / review | ✔ | ✔ | — |

Open items with security impact: T203 (Clerk failed-attempt events), ClamAV
hosting (ADR-015), platform tiers (T210), audit retention schedule — tracked
in `docs/PROJECT_STATUS.md` § 5.
