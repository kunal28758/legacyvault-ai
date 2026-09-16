# Quickstart Validation Guide: LegacyVault AI

**Purpose**: Runnable validation scenarios that prove the feature works
end-to-end. Use after each implementation phase to verify correctness.

---

## Prerequisites

- Node.js 20 LTS installed
- PostgreSQL 16+ running (local or Docker)
- Redis running (local or Docker, optional for dev — PostgreSQL sessions used)
- S3-compatible storage (MinIO for local dev)
- Environment variables configured (copy `.env.example` → `.env`)

## Setup Commands

```bash
# Clone and install
cd "LegacyVault AI"

# Backend setup
cd backend
npm install
cp .env.example .env       # Configure database URL, secrets, storage
npx prisma migrate dev     # Run database migrations
npx prisma db seed         # Seed Super Admin account
npm run dev                # Start backend on http://localhost:3001

# Frontend setup (new terminal)
cd frontend
npm install
cp .env.example .env.local # Configure API URL
npm run dev                # Start frontend on http://localhost:3000
```

---

## Validation Scenarios

### Phase 1: Authentication

**Scenario 1.1**: User Registration
```
1. Open http://localhost:3000/register
2. Enter: name, email, password (12+ chars with complexity)
3. Submit → expect success message + verification email
4. Check email → click verification link
5. Verify: account is now verified, can log in
```

**Scenario 1.2**: Login + MFA
```
1. Log in with verified credentials → expect dashboard
2. Navigate to Security Center → enable MFA
3. Scan QR code with authenticator app
4. Enter verification code → expect MFA enabled
5. Log out → log in again → expect MFA prompt
6. Enter TOTP code → expect dashboard access
```

**Scenario 1.3**: Rate Limiting
```
1. Attempt 6 failed logins with wrong password
2. Expect: account locked message after 5th attempt
3. Wait or use admin unlock
4. Verify: correct credentials work after lockout expires
```

**Expected API Responses**: See [auth contracts](./contracts/api-contracts.md#auth-apiv1auth)

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
7. Click Finalize → expect confirmation modal
8. Confirm → expect plan status: FINALIZED
9. Verify: version 1 appears in version history
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
1. Add beneficiary (name, email, relationship)
2. Attempt duplicate email → expect rejection (409)
3. Assign beneficiary to a financial asset with 50% allocation
4. Assign another beneficiary with 60% → expect rejection (422)
5. Assign with 50% → expect success (total: 100%)
6. View audit trail → verify all changes logged
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

**Scenario 5.1**: Upload and Permission
```
1. Upload a valid PDF (< 50 MB) → expect success
2. Upload an .exe renamed to .pdf → expect rejection (magic byte mismatch)
3. Upload a 60 MB file → expect rejection (size exceeded)
4. Share document with a beneficiary
5. Generate beneficiary access token
6. Access document via token URL → expect document visible
7. Wait for token expiry → expect access denied
```

**Expected API Responses**: See [documents contracts](./contracts/api-contracts.md#documents-apiv1documents)

---

### Phase 6: Dead Man Switch

**Scenario 6.1**: Configuration and Check-in
```
1. Configure DMS: 30-day inactivity, 7-day check-in, select 2 documents for release
2. Verify: status shows ACTIVE, next check-in date displayed
3. Simulate check-in notification → respond with identity verification
4. Verify: timer reset, event logged
```

**Scenario 6.2**: Escalation and Recovery
```
1. Simulate missed check-in (advance time in test)
2. Verify: reminder sent
3. Simulate missed reminder → verify grace period
4. Simulate grace period expiry → verify escalation started
5. User returns and verifies identity → verify escalation cancelled
6. Verify: all events logged in DMS event history
```

**Expected API Responses**: See [dead-man-switch contracts](./contracts/api-contracts.md#dead-man-switch-apiv1dead-man-switch)

---

### Phase 7: Emergency Access

**Scenario 7.1**: Full Request Lifecycle
```
1. Configure emergency contact with access to 2 documents
2. (As emergency contact) Request access → receive OTP email
3. Submit OTP → expect verified
4. (As owner) View pending requests → approve
5. (As emergency contact) Access granted resources → expect 2 documents visible
6. Attempt to access other documents → expect 403
7. Wait for expiry → expect automatic revocation
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
4. Expect: 403 Forbidden for all attempts
5. Verify: access attempt logged in audit trail
```

**Scenario 12.2**: Error Response Safety
```
1. Send malformed requests to various endpoints
2. Verify: no stack traces, no DB details, no file paths in responses
3. All errors follow standard error response format
```

---

## Health Check

```bash
# Backend health
curl http://localhost:3001/api/v1/health
# Expected: { "status": "ok", "database": "connected", "storage": "connected" }
```
