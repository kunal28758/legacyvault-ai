# API Contracts: LegacyVault AI — Baseline Product

**Base URL**: `/api/v1`

**Common Headers**: `Content-Type: application/json`, `Authorization: session cookie`

**Common Response Format**:
```json
{
  "success": true|false,
  "data": { ... },
  "error": { "code": "ERROR_CODE", "message": "Human-readable message" },
  "meta": { "page": 1, "limit": 20, "total": 100 }
}
```

**Authentication**: httpOnly session cookie (all endpoints except public auth)

**Authorization**: Server-side RBAC middleware + resource ownership check

---

## Auth (`/api/v1/auth`)

| Method | Endpoint | Auth | Description |
|--------|----------|:----:|-------------|
| POST | `/auth/register` | ❌ | Register new user |
| POST | `/auth/login` | ❌ | Login with email/password |
| POST | `/auth/logout` | ✅ | Invalidate session |
| POST | `/auth/verify-email` | ❌ | Verify email with token |
| POST | `/auth/forgot-password` | ❌ | Request password reset |
| POST | `/auth/reset-password` | ❌ | Reset password with token |
| POST | `/auth/mfa/setup` | ✅ | Begin MFA setup (returns QR code) |
| POST | `/auth/mfa/verify` | ✅ | Verify MFA code and enable |
| POST | `/auth/mfa/disable` | ✅+re-auth | Disable MFA |
| POST | `/auth/mfa/validate` | partial | Validate MFA code during login |
| POST | `/auth/mfa/backup-codes` | ✅+re-auth | Generate new backup codes |
| POST | `/auth/re-authenticate` | ✅ | Re-authenticate for sensitive ops |

### Key Request/Response Shapes

**POST /auth/register**
```
Request:  { email, password, name }
Response: { user: { id, email, name }, message: "Verification email sent" }
Validations: email format, password strength (12+ chars, mixed), name required
Rate limit: 5/hour per IP
```

**POST /auth/login**
```
Request:  { email, password }
Response: { user: { id, email, name, role, mfaEnabled }, requiresMfa: boolean }
Side effects: Sets httpOnly session cookie, logs auth event
Rate limit: 5/15min per account, 20/15min per IP
```

---

## Users (`/api/v1/users`)

| Method | Endpoint | Auth | Description |
|--------|----------|:----:|-------------|
| GET | `/users/me` | ✅ | Get current user profile |
| PATCH | `/users/me` | ✅ | Update profile fields |
| PATCH | `/users/me/email` | ✅+re-auth | Change email address |
| PATCH | `/users/me/password` | ✅+re-auth | Change password |
| GET | `/users/me/preferences` | ✅ | Get user preferences |
| PATCH | `/users/me/preferences` | ✅ | Update preferences |
| GET | `/users/me/export` | ✅+re-auth | Export all user data as JSON |
| DELETE | `/users/me` | ✅+re-auth | Request account deletion (30-day grace period) |
| POST | `/users/me/cancel-deletion` | ✅ | Cancel pending account deletion |

---

## Beneficiaries (`/api/v1/beneficiaries`)

| Method | Endpoint | Auth | Description |
|--------|----------|:----:|-------------|
| GET | `/beneficiaries` | ✅ | List user's beneficiaries |
| POST | `/beneficiaries` | ✅ | Create beneficiary |
| GET | `/beneficiaries/:id` | ✅ | Get beneficiary details |
| PATCH | `/beneficiaries/:id` | ✅ | Update beneficiary |
| DELETE | `/beneficiaries/:id` | ✅ | Remove beneficiary (soft delete) |
| POST | `/beneficiaries/:id/invite` | ✅ | Send/resend invitation email |
| POST | `/beneficiaries/:id/tokens` | ✅ | Generate access token |
| DELETE | `/beneficiaries/:id/tokens/:tokenId` | ✅ | Revoke access token |

### Key Validations
- Email uniqueness per user (409 Conflict on duplicate)
- Confirmation required for authoritative changes (require `confirmed: true` in body)
- All changes logged to audit trail

---

## Assets (`/api/v1/assets`)

| Method | Endpoint | Auth | Description |
|--------|----------|:----:|-------------|
| **Financial** | | | |
| GET | `/assets/financial` | ✅ | List financial assets |
| POST | `/assets/financial` | ✅ | Create financial asset |
| GET | `/assets/financial/:id` | ✅ | Get financial asset |
| PATCH | `/assets/financial/:id` | ✅ | Update financial asset |
| DELETE | `/assets/financial/:id` | ✅ | Delete financial asset |
| GET | `/assets/financial/:id/decrypt` | ✅+re-auth | View decrypted sensitive fields |
| **Physical** | | | |
| GET | `/assets/physical` | ✅ | List physical assets |
| POST | `/assets/physical` | ✅ | Create physical asset |
| GET | `/assets/physical/:id` | ✅ | Get physical asset |
| PATCH | `/assets/physical/:id` | ✅ | Update physical asset |
| DELETE | `/assets/physical/:id` | ✅ | Delete physical asset |
| **Digital** | | | |
| GET | `/assets/digital` | ✅ | List digital assets |
| POST | `/assets/digital` | ✅ | Create digital asset |
| GET | `/assets/digital/:id` | ✅ | Get digital asset |
| PATCH | `/assets/digital/:id` | ✅ | Update digital asset |
| DELETE | `/assets/digital/:id` | ✅ | Delete digital asset |
| GET | `/assets/digital/:id/decrypt` | ✅+re-auth | View decrypted credentials |
| **Assignments** | | | |
| POST | `/assets/:type/:id/assign` | ✅ | Assign beneficiary to asset |
| DELETE | `/assets/:type/:id/assign/:assignmentId` | ✅ | Remove assignment |
| GET | `/assets/:type/:id/assignments` | ✅ | List assignments for asset |

### Key Validations
- Allocation percentages ≤ 100% per asset (422 on violation)
- Encrypted fields masked in standard GET; `/decrypt` requires re-auth
- Resource ownership enforced (403 for non-owner access)

---

## Documents (`/api/v1/documents`)

| Method | Endpoint | Auth | Description |
|--------|----------|:----:|-------------|
| GET | `/documents` | ✅ | List documents (with folder filter) |
| POST | `/documents/upload` | ✅ | Upload document (multipart/form-data) |
| GET | `/documents/:id` | ✅ | Get document metadata |
| GET | `/documents/:id/download` | ✅ | Get signed download URL |
| GET | `/documents/:id/preview` | ✅ | Get preview data (PDF/image) |
| PATCH | `/documents/:id` | ✅ | Update metadata |
| DELETE | `/documents/:id` | ✅ | Delete document (soft) |
| POST | `/documents/:id/versions` | ✅ | Upload new version |
| GET | `/documents/:id/versions` | ✅ | List version history |
| POST | `/documents/:id/share` | ✅ | Share with beneficiary |
| DELETE | `/documents/:id/share/:beneficiaryId` | ✅ | Revoke beneficiary access |
| **Folders** | | | |
| GET | `/documents/folders` | ✅ | List folders |
| POST | `/documents/folders` | ✅ | Create folder |
| PATCH | `/documents/folders/:id` | ✅ | Rename/move folder |
| DELETE | `/documents/folders/:id` | ✅ | Delete folder |

### Key Validations
- File type whitelist (PDF, images, text, office docs)
- Extension + MIME type + magic byte verification
- Size ≤ 50 MB
- Signed download URLs expire in 15 minutes

---

## Legacy Plans (`/api/v1/legacy-plans`)

| Method | Endpoint | Auth | Description |
|--------|----------|:----:|-------------|
| GET | `/legacy-plans` | ✅ | List user's plans (draft + finalized) |
| POST | `/legacy-plans` | ✅ | Create new draft plan |
| GET | `/legacy-plans/:id` | ✅ | Get plan with all step data |
| PATCH | `/legacy-plans/:id/steps/:step` | ✅ | Auto-save step data |
| POST | `/legacy-plans/:id/review` | ✅ | Get review summary with completeness |
| POST | `/legacy-plans/:id/finalize` | ✅ | Finalize plan (requires `confirmed: true`) |
| GET | `/legacy-plans/:id/versions` | ✅ | List version history |
| GET | `/legacy-plans/:id/versions/:versionId` | ✅ | Get specific version |
| POST | `/legacy-plans/:id/new-draft` | ✅ | Create new draft from finalized plan |

### Key Validations
- Max 1 draft per user (409 on second draft attempt)
- Finalization requires `confirmed: true` (400 without)
- Optimistic locking via `lockVersion` field (409 on conflict)
- Step validation before progression (422 with field errors)

---

## Dead Man Switch (`/api/v1/dead-man-switch`)

| Method | Endpoint | Auth | Description |
|--------|----------|:----:|-------------|
| GET | `/dead-man-switch` | ✅ | Get current DMS config and status |
| POST | `/dead-man-switch` | ✅ | Create/configure DMS |
| PATCH | `/dead-man-switch` | ✅ | Update DMS configuration |
| POST | `/dead-man-switch/check-in` | ✅+verify | Respond to check-in |
| POST | `/dead-man-switch/pause` | ✅ | Pause DMS |
| POST | `/dead-man-switch/resume` | ✅ | Resume DMS |
| POST | `/dead-man-switch/cancel-escalation` | ✅+verify | Cancel active escalation |
| DELETE | `/dead-man-switch` | ✅+re-auth | Disable DMS |
| GET | `/dead-man-switch/events` | ✅ | List DMS event history |

### Key Validations
- Check-in requires identity verification (password/MFA)
- Release scope must reference valid, owned resources
- Escalation cancellation requires identity verification

---

## Emergency Access (`/api/v1/emergency-access`)

| Method | Endpoint | Auth | Description |
|--------|----------|:----:|-------------|
| GET | `/emergency-access/contacts` | ✅ | List emergency contacts |
| POST | `/emergency-access/contacts` | ✅ | Add emergency contact |
| PATCH | `/emergency-access/contacts/:id` | ✅ | Update contact |
| DELETE | `/emergency-access/contacts/:id` | ✅ | Remove contact |
| **Public request endpoints** | | | |
| POST | `/emergency-access/request` | ❌ | Initiate emergency access request |
| POST | `/emergency-access/verify` | ❌ | Verify identity (OTP) |
| **Owner endpoints** | | | |
| GET | `/emergency-access/requests` | ✅ | List pending requests |
| POST | `/emergency-access/requests/:id/approve` | ✅ | Approve request |
| POST | `/emergency-access/requests/:id/deny` | ✅ | Deny request |
| POST | `/emergency-access/requests/:id/revoke` | ✅ | Revoke active access |
| **Access endpoints (token-based)** | | | |
| GET | `/emergency-access/session/:token` | token | Access granted resources |

---

## Video Legacy (`/api/v1/videos`)

| Method | Endpoint | Auth | Description |
|--------|----------|:----:|-------------|
| GET | `/videos` | ✅ | List video messages |
| POST | `/videos/upload` | ✅ | Upload video (multipart, chunked) |
| GET | `/videos/:id` | ✅ | Get video metadata |
| PATCH | `/videos/:id` | ✅ | Update metadata |
| DELETE | `/videos/:id` | ✅ | Delete video |
| POST | `/videos/:id/assign` | ✅ | Assign to beneficiary |
| DELETE | `/videos/:id/assign/:beneficiaryId` | ✅ | Remove assignment |

### Key Validations
- Format: MP4, WebM, MOV only
- Size ≤ 500 MB (chunked upload)

---

## AI (`/api/v1/ai`)

| Method | Endpoint | Auth | Description |
|--------|----------|:----:|-------------|
| POST | `/ai/assistant/message` | ✅ | Send message to AI assistant |
| GET | `/ai/assistant/history` | ✅ | Get conversation history |
| POST | `/ai/will-generator/generate` | ✅ | Generate will draft |
| PATCH | `/ai/will-generator/:id/edit` | ✅ | Edit AI-generated draft |
| POST | `/ai/will-generator/:id/regenerate` | ✅ | Regenerate draft |
| POST | `/ai/will-generator/:id/confirm` | ✅ | Confirm and persist draft |
| GET | `/ai/will-generator/:id/export` | ✅ | Export as PDF |
| POST | `/ai/document-analysis/analyze` | ✅ | Analyze a vault document |
| POST | `/ai/document-analysis/:id/confirm` | ✅ | Confirm detected findings |

### Key Constraints
- All requests server-side to AI providers
- Responses include confidence indicators
- Confirmation required before persistence (`confirmed: true`)
- Legal disclaimers included in all responses
- Rate limited (cost control)

---

## Notifications (`/api/v1/notifications`)

| Method | Endpoint | Auth | Description |
|--------|----------|:----:|-------------|
| GET | `/notifications` | ✅ | List notifications (paginated) |
| GET | `/notifications/unread-count` | ✅ | Get unread count |
| PATCH | `/notifications/:id/read` | ✅ | Mark as read |
| POST | `/notifications/read-all` | ✅ | Mark all as read |

---

## Security (`/api/v1/security`)

| Method | Endpoint | Auth | Description |
|--------|----------|:----:|-------------|
| GET | `/security/sessions` | ✅ | List active sessions |
| DELETE | `/security/sessions/:id` | ✅ | Revoke session |
| GET | `/security/login-history` | ✅ | Login history |
| GET | `/security/audit-history` | ✅ | Security-related audit events |
| GET | `/security/status` | ✅ | Security score/indicators |

---

## Audit Logs (`/api/v1/audit-logs`)

| Method | Endpoint | Auth | Description |
|--------|----------|:----:|-------------|
| GET | `/audit-logs` | ✅ | User's own audit log (filtered) |
| GET | `/audit-logs/admin` | ✅ Super Admin | Platform-wide audit logs |

---

## Admin (`/api/v1/admin`)

| Method | Endpoint | Auth | Description |
|--------|----------|:----:|-------------|
| GET | `/admin/users` | ✅ Super Admin | List/search all users |
| GET | `/admin/users/:id` | ✅ Super Admin | Get user details |
| PATCH | `/admin/users/:id/role` | ✅ Super Admin | Assign role |
| POST | `/admin/users/:id/unlock` | ✅ Super Admin | Unlock account |
| POST | `/admin/users/:id/reset-mfa` | ✅ Super Admin | Reset user's MFA |
| GET | `/admin/analytics` | ✅ Super Admin | System analytics |
| GET | `/admin/analytics/registrations` | ✅ Super Admin | Registration stats |
| GET | `/admin/analytics/storage` | ✅ Super Admin | Storage usage |

---

## Beneficiary Access (Token-Based)

| Method | Endpoint | Auth | Description |
|--------|----------|:----:|-------------|
| GET | `/access/:token` | token | Validate token and list accessible resources |
| GET | `/access/:token/documents/:id` | token | View shared document |
| GET | `/access/:token/documents/:id/download` | token | Download shared document |
| GET | `/access/:token/assets/:type/:id` | token | View assigned asset |
| GET | `/access/:token/videos/:id` | token | View assigned video |

### Key Constraints
- Token validated server-side (hash comparison)
- Scoped to specific resources listed in token
- Time-limited (automatic expiry)
- All access logged to audit trail
- No write operations permitted
