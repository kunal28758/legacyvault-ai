# Quickstart Validation Guide: LegacyVault AI

**Purpose**: Runnable validation scenarios that prove the feature works
end-to-end. Use after each implementation phase to verify correctness.

---

> **Revised 2026-09-18** for the single Next.js application architecture
> (ADR-001…016): one app on port 3000, Clerk authentication, Supabase
> PostgreSQL/Storage via the Supabase CLI local stack, no Express/Prisma/
> Redis/MinIO.

## Prerequisites

- Node.js 20 LTS and pnpm installed
- Docker (for the Supabase CLI local stack) **or** a dedicated Supabase
  development project
- A Clerk **development** instance configured per task T195 (password policy,
  email verification, MFA, lockout, webhook)
- Environment variables configured (copy `.env.example` → `.env.local`;
  never commit `.env.local`)
- For webhook scenarios locally: a tunnel (e.g. `ngrok`) pointed at
  `/api/webhooks/clerk`, or run against a Vercel preview deployment

## Setup Commands

```bash
# Install
pnpm install

# Environment
cp .env.example .env.local        # Clerk keys, Supabase URL/keys, ENCRYPTION_KEY, CRON_SECRET, …

# Database (Supabase CLI local stack)
pnpm db:start                     # supabase start
pnpm db:reset                     # apply supabase/migrations + seed.sql
pnpm db:types                     # regenerate lib/types/database.ts

# Super Admin (promotes the Clerk user whose email = ADMIN_EMAIL)
pnpm tsx scripts/seed-admin.ts

# Run the app (UI + /api/v1 in one process)
pnpm dev                          # http://localhost:3000

# Background jobs locally (Vercel Cron does this in deployments)
curl -H "Authorization: Bearer $CRON_SECRET" http://localhost:3000/api/internal/cron/run-jobs
curl -H "Authorization: Bearer $CRON_SECRET" http://localhost:3000/api/internal/cron/dms-scan
```

---

## Validation Scenarios

### Phase 1: Authentication (Clerk)

**Scenario 1.1**: User Registration
```
1. Open http://localhost:3000/sign-up
2. Enter: name, email, password (12+ chars with complexity — Clerk policy)
3. Submit → expect verification-code/link step + verification email (Clerk)
4. Complete verification → expect redirect to onboarding
5. Verify: users row exists (clerk_user_id set), audit_log has user.registered,
   sign-in works; unverified accounts cannot sign in
```

**Scenario 1.2**: Login + MFA
```
1. Sign in with verified credentials → expect dashboard
2. Settings → Security → enable MFA (Clerk user profile)
3. Scan QR code with authenticator app
4. Enter verification code → expect MFA enabled; backup codes shown once
5. Sign out → sign in again → expect MFA prompt
6. Enter TOTP code → expect dashboard access
7. Verify: users.mfa_enabled mirrored true; audit_log has auth.mfa_changed
```

**Scenario 1.3**: Rate Limiting / Lockout
```
1. Attempt 6 failed sign-ins with wrong password
2. Expect: Clerk lockout message after the 5th attempt (30 min)
3. Use admin unlock (POST /api/v1/admin/users/:id/unlock) or wait
4. Verify: correct credentials work after lockout; audit rows per T203 outcome
```

**Scenario 1.4**: Sessions
```
1. Sign in from two browsers
2. Security Center → both sessions listed (browser, device, city/country)
3. Revoke the other session → it is signed out; audit_log has auth.session_revoked
```

**Expected API Responses**: See [auth mapping](./contracts/api-contracts.md#auth--provided-by-clerk-adr-003) and [security](./contracts/api-contracts.md#security-apiv1security)

---

### Phase 3: Legacy Plan

**Scenario 3.1**: Create and Finalize Plan
```
1. Log in → navigate to Legacy Plan
2. Create new plan → expect draft with step 1 (Personal Details)
3. Fill Personal Details → Next → expect auto-save
4. Progress through all steps (some can be skipped)
5. Navigate back to completed step → verify data preserved
6. Reach Review step → verify all data displayed
7. Click Finalize → expect confirmation modal listing any incomplete sections;
   without Personal Details the modal refuses (PERSONAL_DETAILS_REQUIRED)
8. Tick the acknowledgment (if sections are incomplete) and confirm → expect
   plan status: FINALIZED; step 11 confirmation screen shown
9. Verify: version 1 appears in version history with acknowledgedIncomplete
   and the incomplete-section list recorded
```

**Scenario 3.2**: Concurrent Edit Detection
```
1. Open plan in two browser tabs
2. Edit in tab 1 and save
3. Edit in tab 2 and save → expect conflict error (409)
```

**Expected API Responses**: See [legacy-plans contracts](./contracts/api-contracts.md#legacy-plans-apiv1legacy-plans)

---

### Phase 4: Beneficiaries & Assets

**Scenario 4.1**: Beneficiary Lifecycle
```
1. Add beneficiary (name, email, relationship) → status PENDING
2. Attempt duplicate email → expect rejection (409)
3. Assign beneficiary to a financial asset with 50% allocation
4. Assign another beneficiary with 60% to the same asset → expect 422
   ALLOCATION_EXCEEDED with remaining 50% (per-resource rule)
5. Assign with 50% → expect success (total: 100%)
6. Deactivate the beneficiary → expect existing tokens revoked and new
   assignments refused; reactivate
7. Remove a beneficiary with assignments → expect cascade (assignments
   deleted, tokens revoked, DMS/EA links removed) and audit rows per step
8. Attempt a direct INSERT into beneficiary_assignments with the user-scoped
   client → expect permission denied (write-protection model)
9. View audit trail → verify all changes logged
```

**Scenario 4.2**: Encrypted Asset Fields
```
1. Add a digital asset with credentials
2. View asset → expect credentials masked (••••••)
3. Click "reveal" → expect re-authentication prompt
4. Re-authenticate → expect plaintext visible
5. View audit log → expect credential view logged
```

**Expected API Responses**: See [beneficiaries](./contracts/api-contracts.md#beneficiaries-apiv1beneficiaries) and [assets](./contracts/api-contracts.md#assets-apiv1assets) contracts

---

### Phase 5: Document Vault

**Scenario 5.1**: Upload and Permission (direct-to-storage, two-step)
```
1. Upload a valid PDF (< 50 MB) → POST /documents/uploads returns a signed URL;
   browser PUTs the file; POST …/complete → expect PROMOTED, document listed
2. Upload an .exe renamed to .pdf → complete step rejects (FILE_TYPE_MISMATCH,
   magic bytes); object never leaves `quarantine`
3. Declare a 60 MB file → POST /documents/uploads rejects (FILE_TOO_LARGE);
   also verify a 60 MB object uploaded against a session declared smaller is
   rejected at complete
4. Share document with a beneficiary
5. Issue a DIRECT_SHARE access token → beneficiary receives /access?t=… link
6. Open the link → page exchanges the token (POST /access/exchange), strips it
   from the URL, sets the access cookie → document visible → download via
   signed URL (15 min); beneficiary status becomes ACTIVE
7. Request a document outside the scope → expect 403
8. Revoke the token (or wait for expiry) → next request with the cookie is
   denied
9. Verify: audit_log has document.uploaded / access.exchanged /
   document.downloaded rows; no public bucket URL and no token ever appears in
   a request path or log line
```

**Expected API Responses**: See [documents contracts](./contracts/api-contracts.md#documents-apiv1documents)

---

### Phase 6: Dead Man Switch

**Scenario 6.1**: Configuration and Check-in
```
1. Configure DMS: 30-day inactivity, 7-day check-in, pick an existing
   beneficiary as trusted contact, select 2 documents + 1 plan section for release
2. Verify: status shows ACTIVE, next check-in date displayed
3. Simulate check-in notification → respond with identity verification
4. Verify: timer reset, event logged
```

**Scenario 6.2**: Escalation and Recovery
```
1. Simulate missed check-in (advance the test clock; call dms-scan, then
   run-jobs twice: first runs the dms.scan job, second runs the transition job)
2. Verify: reminder sent (job dms.send-checkin SUCCEEDED, idempotent on re-run)
3. Simulate missed reminder → verify grace period
4. Simulate grace period expiry → verify escalation started (trusted contact notified)
5. User returns and verifies identity (reverification) → verify escalation cancelled
6. Verify: all events logged in DMS event history and audit_log
```

**Scenario 6.3**: Scheduler Health
```
1. Prevent the hourly `dms.scan` job from succeeding for > 2× its interval
   (test clock; e.g. stop calling dms-scan or leave the job unclaimed)
2. Call /api/v1/health → expect dmsScan: "stale"; audit_log has
   dms.job_health_failure; Super Admin alert sent
```

**Expected API Responses**: See [dead-man-switch contracts](./contracts/api-contracts.md#dead-man-switch-apiv1dead-man-switch)

---

### Phase 7: Emergency Access

**Scenario 7.1**: Full Request Lifecycle
```
1. Designate an existing beneficiary as emergency contact with access to 2
   documents and one plan section, rule WAIT → contact receives the
   designation email with their request link
2. (As emergency contact) Open the request link → submit email → receive OTP
   (a mismatched email gets the same generic response and no OTP)
3. Submit OTP → expect verified (3 wrong codes → FAILED)
4. (As owner) Pending request notification → approve (reverification)
5. (As emergency contact) Receive access link → exchange → expect the 2
   documents and the plan section visible (latest finalized version)
6. Attempt to access other resources → expect 403
7. Wait for access expiry (housekeeping) → expect automatic revocation and
   audit entries
```

**Scenario 7.2**: Timeout Rules
```
1. Repeat 7.1 with rule AUTO_GRANT (timeout 1 h) and no owner action → expect
   AUTO_GRANTED → ACTIVE, both parties notified
2. Repeat with rule DENY → expect DENIED after the timeout
3. Repeat with rule WAIT and no action → expect EXPIRED after
   requestExpiryHours
```

**Expected API Responses**: See [emergency-access contracts](./contracts/api-contracts.md#emergency-access-apiv1emergency-access)

---

### Phase 8: AI Features

**Scenario 8.1**: AI Assistant
```
1. Open AI Assistant → send "What should I include in my legacy plan?"
2. Expect: helpful guidance + legal disclaimer visible
3. Verify: AI does not claim to be a lawyer
```

**Scenario 8.2**: AI Will Generator
```
1. Ensure legacy plan has beneficiaries and assets
2. Request will draft generation
3. Review draft → verify AI-generated labels visible
4. Edit a section → regenerate → verify updated draft
5. Confirm draft → verify persisted with version history
6. Export as PDF → verify download works
```

**Scenario 8.3**: Provider Outage
```
1. Disable AI provider (set invalid API key)
2. Attempt AI assistant → expect graceful error message
3. Verify: all non-AI features continue working
```

**Expected API Responses**: See [ai contracts](./contracts/api-contracts.md#ai-apiv1ai)

---

### Phase 10: Security Center & Admin

**Scenario 10.1**: Security Center
```
1. Log in from two different browsers
2. Open Security Center → verify both sessions visible
3. Revoke the other session → verify it's terminated
4. View login history → verify entries present
```

**Scenario 10.2**: Admin Access Control
```
1. Log in as regular user → attempt /admin routes → expect 403
2. Log in as Super Admin → access /admin → expect dashboard
3. Search users → view user details
4. Unlock a locked account → verify account unlocked
5. Verify: admin action logged in audit trail
```

**Expected API Responses**: See [security](./contracts/api-contracts.md#security-apiv1security) and [admin](./contracts/api-contracts.md#admin-apiv1admin) contracts

---

### Phase 12: Cross-Cutting Security

**Scenario 12.1**: Cross-User Data Isolation
```
1. Create two user accounts (User A, User B)
2. User A creates documents and assets
3. Log in as User B → attempt to access User A's resources by ID
4. Expect: 403 Forbidden for all attempts (service layer)
5. Repeat with a direct user-scoped Supabase query as User B → expect zero rows (RLS)
6. Verify: access attempt logged in audit trail
```

**Scenario 12.2**: Error Response Safety
```
1. Send malformed requests to various endpoints
2. Verify: no stack traces, no DB details, no file paths in responses
3. All errors follow standard error response format
4. Every /api/v1 response carries Cache-Control: private, no-store
```

**Scenario 12.3**: Write-Protection Model
```
1. With the user-scoped client, attempt UPDATE users SET role='SUPER_ADMIN'
   (and mfa_enabled=true) on your own row → expect permission denied
2. Attempt UPDATE legacy_plans SET status='FINALIZED' directly → denied;
   finalize via the API → succeeds through finalize_legacy_plan()
3. Attempt UPDATE documents SET scan_status='CLEAN' → denied
4. Call a guarded function for another user's resource → expect 403
   (FORBIDDEN) and no existence leak
5. Verify each successful guarded call wrote exactly one audit_log row
```

---

## Health Check

```bash
# Application health (same process serves UI and API)
curl http://localhost:3000/api/v1/health
# Expected: { "status": "ok", "database": "connected", "storage": "connected",
#             "jobs": { "lastRunAgeSeconds": <n> }, "dmsScan": "fresh" }
```
