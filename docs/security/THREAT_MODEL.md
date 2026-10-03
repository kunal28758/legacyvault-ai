# Threat Model — LegacyVault AI

**Purpose**: Name the assets, actors and trust boundaries of the baseline and
map the threats already recognized by the project artifacts to the controls
that are **specified** for them. It is a reading aid for reviewers and for the
pre-production security review (NFR-SEC-002, task T185); it does not add
requirements or controls.

**Canonical sources**: constitution v2.0.1 (I–VII, XI, XII, XVI); `spec.md`
§ Edge Cases, § Q Security Requirements, § R AI Safety; `docs/BRAIN.md`
§ 15 Known Risks; ADR-003, ADR-004 r2, ADR-005, ADR-006, ADR-007, ADR-014,
ADR-016, ADR-017; `data-model.md` § Write-Protection Model.

**Status**: 📐 every control below is specified and 📋 planned;
**none is implemented** as of 2026-09-18. Residual-risk statements are
pre-implementation assessments, not verified outcomes.

---

## 1. Assets

| Asset | Sensitivity | Where it lives |
|---|---|---|
| Identity & credentials (passwords, MFA secrets) | Critical | Clerk only — never in the application database (ADR-003) |
| Legacy plans, will drafts, wishes, family and identification details | Critical / legally significant | PostgreSQL (`legacy_plans`, versions, `ai_drafts` — content encrypted, `users.identificationDetails` encrypted) |
| Financial / digital asset records incl. account numbers, credentials, recovery info | Critical | PostgreSQL, sensitive fields application-encrypted |
| Documents and videos | Critical | Supabase Storage private buckets, provider-encrypted at rest |
| Beneficiary and contact PII | High | PostgreSQL |
| Access tokens, OTPs, access cookies | Critical (bearer secrets) | Hash-only in PostgreSQL; cookie encrypted with `ACCESS_COOKIE_KEY` |
| Audit log | Legally significant / integrity-critical | PostgreSQL, append-only |
| Platform secrets (Clerk, Supabase secret key, encryption keys, AI keys, cron secret) | Critical | Vercel environment configuration only |

## 2. Actors

| Actor | Trust | Notes |
|---|---|---|
| Account owner (User) | Authenticated, self-scoped | Clerk session; may hold the Super Admin role |
| Super Admin | Authenticated, platform-scoped | Role in `users.role`; admin actions reverified and audited |
| External recipient (beneficiary / trusted contact / emergency contact) | Unauthenticated identity; scoped bearer | No account; access token exchanged for an access cookie (ADR-014) |
| Anonymous internet | Untrusted | Public pages, emergency-access request/verify, health |
| Platform services (Clerk, Supabase, Vercel, Resend, Sentry, AI providers) | Trusted for their function; keys server-only | Reached only through server-side adapters |
| Internal automation (Vercel Cron, `pg_cron`, webhooks) | Authenticated by shared secrets / signatures | `CRON_SECRET`, Svix / provider signatures |
| Compromised or buggy application code path | Assumed possible | Motivates the database write-protection model (ADR-004 r2) |

## 3. Trust boundaries

1. Browser ⇄ Next.js application (Clerk session cookie or access cookie; CSRF
   origin check; CSP; `no-store`).
2. Next.js ⇄ PostgreSQL (user-scoped client under RLS + column grants vs.
   service client on system paths only).
3. Next.js ⇄ Supabase Storage (signed URLs; validate → promote; storage RLS).
4. Next.js ⇄ Clerk / AI providers / Resend (server-only keys;
   provider abstraction; no document content in logs).
5. Internet ⇄ internal endpoints (cron secret, webhook signatures,
   idempotency records).
6. Owner ⇄ external recipient (token scope, delivery conditions, release
   scope, emergency verification and decision).

## 4. Threats and specified controls

| # | Threat | Source | Specified controls | Verification |
|---|---|---|---|---|
| T1 | Credential stuffing / brute force / weak passwords | spec FR-A002, A012, A013 | Clerk password policy, lockout 5/30 min, bot protection; Vercel WAF | T195, T203 |
| T2 | Session theft / fixation | constitution III | Clerk httpOnly/secure/SameSite cookies, 24 h lifetime, revocation, reverification for sensitive ops | T195, T201, T214 |
| T3 | Cross-user data access (IDOR) via API ids | spec edge case, FR-Q014, SC-005 | service ownership checks + RLS on every table + write classes; 403 without existence leak; audit of denied attempts | T212, T215, T228, T241 |
| T4 | Self privilege escalation or invariant bypass by direct writes (role, `mfa_enabled`, allocation sum, plan status, scan status, state machines); unaudited or unencrypted self-scoped writes through PostgREST with the user's own Clerk token | ADR-004 r2/r4 (analysis finding S1; final-gate finding S1) | privilege baseline, column allow-lists limited to plain fields, `ENCRYPTED` columns function-only (`create_asset()`, `set_encrypted_fields()` with envelope validation), guarded `SECURITY DEFINER` functions, `protect_identity_columns` trigger, `audit_class_a_change()` triggers on every Class A table | T215, T229, T235, T236 |
| T5 | Bearer token leakage through URLs, logs, history | ADR-014 (finding S2) | one-time exchange → encrypted httpOnly path-scoped cookie; log redaction of `/access` paths and `t` param; per-request revocation check | T214, T228 |
| T6 | Scope creep of external access (beneficiary sees more than assigned; emergency contact exceeds scope; release exposes unselected data) | FR-D011, H011–H014, I012, J008 | scope validated as subset of owned resources at issue time (DIRECT_SHARE additionally ⊆ the beneficiary's current assignments; video delivery-condition ↔ grant-type strict mapping); enforcement on every request; release/emergency scopes fixed by owner configuration | T228, T235, T236 |
| T7 | Emergency-access abuse (impersonating a contact, OTP guessing, spamming the owner) | FR-J003, edge cases | request link per contact, email must match, OTP 6 digits / 15 min / 3 attempts, generic responses, per-IP and per-config rate limits, owner notification, WAIT/AUTO_GRANT/DENY rules | T236 |
| T8 | Dead Man Switch false trigger or unauthorized cancellation | FR-I005, I007, I008, spec edge case | multi-step escalation with configurable delays, reverified check-in/cancel at every stage (incl. after release, revoking tokens), scan health check + redundant trigger | T235, T183 |
| T9 | Malicious or spoofed uploads (extension spoofing, oversize, malware, corruption) | FR-H002, H003, Q010 | declared + actual validation, magic bytes, size checks at three points (declaration, bucket limit, completion), bucket MIME allow-list, nothing reachable until promoted, downloads only as signed attachments. **Residual risk accepted (ADR-017):** no malware scanning — a file of an allowed type can still carry malicious content (FR-H016 / FR-Q011 not met) | T216, T228 |
| T10 | Public bucket / direct object access | FR-H005, Q005 | private buckets, storage RLS, server-minted 15-minute signed URLs, audited access | T228 |
| T11 | Injection (SQL/command), XSS, CSRF | constitution XI, FR-Q007 | parameterized `supabase-js`/typed functions, no dynamic SQL in guarded functions, Zod validation, CSP nonce, origin check on mutations, SameSite cookies | T214, T215 |
| T12 | Information leakage in errors, logs, caches | FR-Q016, Q017, constitution XV, XVI | safe error envelope, pino redaction, Sentry PII scrubbing, `Cache-Control: private, no-store`, no prerendering of user data | T171, T172, T214 |
| T13 | Secrets exposure | constitution I, XIX | `.env*` ignored, Vercel env, `server-only`, no `NEXT_PUBLIC_` secrets, dependency scanning | T007, T008, T009, T174 |
| T14 | Audit tampering | constitution XII, FR-Q012 | append-only trigger, no update/delete grants, in-transaction audit rows, off-platform backups | T215, T186 |
| T15 | Webhook / cron forgery or replay | ADR-006, ADR-003 | Svix and provider signature verification, `CRON_SECRET`, `processed_webhook_events` idempotency, endpoints excluded from Clerk protection but self-authenticating | T198, T199, T209 |
| T16 | AI hallucination presented as fact; AI mutating legal records; provider outage | constitution V, VI; FR-R003–R010 | structured outputs + validation, confidence indicators, mandatory disclaimer, explicit confirm endpoints, no auto-persistence, sanitized interaction records, provider fallback / graceful degradation | T232 |
| T17 | Disclosure of private documents to third parties (AI providers) | constitution II | server-side calls only; no scanning service receives files (ADR-017); document content never logged | T145 |
| T18 | Data loss / corruption | constitution VII, NFR-DR-001/002 | transactional guarded functions, optimistic locking, Supabase backups + PITR, off-platform `pg_dump`, restore drills | T186, T187, T225 |
| T19 | Scheduler outage causing missed or false escalations | NFR-AVL-002 | DMS scan freshness check → CRITICAL audit + alert; `pg_cron` + `pg_net` redundant trigger | T183, T211, T239 |
| T21 | Access-link delivery failure (token issued, email never delivered; naive retries minting unlimited valid tokens; lost release/emergency links) | final-gate finding C1 (ADR-014 § 6) | `access.deliver` job with deterministic per-contact idempotency; reissue-on-retry (revoke undelivered token + exactly one replacement); partial unique indexes; audited owner/admin resend; dead-letter → CRITICAL audit + alert; plaintext never persisted | T229, T235, T236 |
| T20 | Identity-provider dependency / configuration drift | BRAIN § 15 | configuration checklist recorded per environment (T195), profile/role/audit data kept in the platform DB, revisit triggers in ADR-003 | T203, T210 |

## 5. Residual risks acknowledged by the artifacts (pre-implementation)

- **Application-layer file encryption is deferred (ADR-013)**: a compromise of
  storage credentials would expose object bodies; mitigated by secret
  scoping, private buckets, RLS and monitoring; revisited at T185.
- **Failed sign-in attempt logging (FR-A014)** depends on Clerk event
  coverage — verification T203; fallback design exists (custom sign-in
  reporting).
- **Token-scoped paths use the service client**: RLS is not a second barrier
  there; authorization is the token scope check plus tests (T228, T241).
- **Signed download URLs are bearer URLs for 15 minutes**; mitigated by short
  expiry, no logging, and audited issuance.
- **Audit-log retention** is indefinite pending an owner/legal decision.
- **Owner-initiated direct writes to plain Class A columns** remain possible
  by design (the browser holds a Clerk token that Supabase accepts); they
  cannot reach sensitive/encrypted columns, statuses or invariants and are
  recorded by the `audit_class_a_change()` trigger (ADR-004 r4).

## 6. Out of scope for this model

Physical security of end-user devices, compromise of the identity provider or
cloud platforms themselves, legal validity of generated documents (explicitly
out of scope in `spec.md` § Out of Scope), and multi-tenant threats (deferred
with multi-tenancy).
