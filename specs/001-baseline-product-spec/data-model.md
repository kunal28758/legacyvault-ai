# Data Model: LegacyVault AI — Baseline Product

**Phase**: 1 — Design & Contracts | **Date**: 2025-09-16

**Purpose**: Define entities, fields, relationships, validation rules, and
state transitions for the baseline product.

---

## Entity Overview

| # | Entity | Description | Owner |
|---|--------|-------------|-------|
| 1 | User | Registered platform user | System |
| 2 | Beneficiary | Designated recipient of legacy information | User |
| 3 | FinancialAsset | Bank accounts, investments, insurance, retirement | User |
| 4 | PhysicalAsset | Real estate, vehicles, valuables, property, business | User |
| 5 | DigitalAsset | Crypto, online accounts, domains, subscriptions | User |
| 6 | Document | Uploaded file in the secure vault | User |
| 7 | DocumentVersion | Version history for documents | Document |
| 8 | Folder | Organizational container for documents | User |
| 9 | LegacyPlan | Structured will / legacy plan | User |
| 10 | LegacyPlanVersion | Finalized version snapshot | LegacyPlan |
| 11 | VideoMessage | Video legacy message | User |
| 12 | DeadManSwitch | Inactivity monitoring configuration | User |
| 13 | DeadManSwitchEvent | DMS state transition record | DeadManSwitch |
| 14 | EmergencyAccessConfig | Emergency contact configuration | User |
| 15 | EmergencyAccessRequest | Specific access request instance | EmergencyAccessConfig |
| 16 | BeneficiaryAssignment | Asset/document → beneficiary mapping | User |
| 17 | AuditLog | Immutable action record | System |
| 18 | AIInteraction | AI conversation/generation session record | User |
| 19 | Notification | System notification/alert | User |
| 20 | Session | Active user session | User |
| 21 | BeneficiaryAccessToken | Time-limited scoped access token | Beneficiary |

---

## Entity Definitions

### 1. User

| Field | Type | Constraints | Notes |
|-------|------|-------------|-------|
| id | UUID | PK, auto-generated | |
| email | String | UNIQUE, NOT NULL, indexed | Lowercase normalized |
| passwordHash | String | NOT NULL | bcrypt, cost ≥12 |
| name | String | NOT NULL | |
| dateOfBirth | Date | NULL | |
| phone | String | NULL | |
| address | JSONB | NULL | Structured address object |
| identificationDetails | String | NULL, ENCRYPTED | ID number, etc. |
| familyInfo | JSONB | NULL | Spouse, children, parents |
| role | Enum | NOT NULL, default: USER | USER, SUPER_ADMIN |
| emailVerified | Boolean | NOT NULL, default: false | |
| emailVerificationToken | String | NULL | Time-limited, single-use |
| emailVerificationExpiry | DateTime | NULL | |
| mfaEnabled | Boolean | NOT NULL, default: false | |
| mfaSecret | String | NULL, ENCRYPTED | TOTP secret |
| mfaBackupCodes | String[] | NULL, ENCRYPTED | Hashed backup codes |
| preferences | JSONB | NULL, default: {} | Language, currency, date format |
| notificationPreferences | JSONB | NULL, default: {} | Email, in-app, frequency |
| securityPreferences | JSONB | NULL, default: {} | Session timeout, alerts |
| passwordResetToken | String | NULL | |
| passwordResetExpiry | DateTime | NULL | |
| failedLoginAttempts | Int | NOT NULL, default: 0 | |
| lockedUntil | DateTime | NULL | Account lockout expiry |
| lastLoginAt | DateTime | NULL | |
| createdAt | DateTime | NOT NULL, auto | |
| updatedAt | DateTime | NOT NULL, auto | |
| deletedAt | DateTime | NULL | Soft delete |

**Indexes**: email (unique), role, createdAt, deletedAt

---

### 2. Beneficiary

| Field | Type | Constraints | Notes |
|-------|------|-------------|-------|
| id | UUID | PK | |
| userId | UUID | FK → User, NOT NULL, indexed | Owner |
| name | String | NOT NULL | |
| relationship | String | NOT NULL | e.g., spouse, child, sibling |
| email | String | NOT NULL | |
| phone | String | NULL | |
| status | Enum | NOT NULL, default: ACTIVE | ACTIVE, PENDING, INACTIVE |
| isEmergencyBeneficiary | Boolean | NOT NULL, default: false | |
| notes | Text | NULL | |
| createdAt | DateTime | NOT NULL, auto | |
| updatedAt | DateTime | NOT NULL, auto | |
| deletedAt | DateTime | NULL | Soft delete |

**Indexes**: userId + email (unique compound), userId, status
**Constraint**: No duplicate email per user (FR-D003)

---

### 3. FinancialAsset

| Field | Type | Constraints | Notes |
|-------|------|-------------|-------|
| id | UUID | PK | |
| userId | UUID | FK → User, NOT NULL, indexed | |
| name | String | NOT NULL | |
| category | Enum | NOT NULL | BANK_ACCOUNT, FIXED_DEPOSIT, MUTUAL_FUND, STOCK, INSURANCE, RETIREMENT |
| institution | String | NULL | Bank/provider name |
| accountNumber | String | NULL, ENCRYPTED | AES-256-GCM |
| policyNumber | String | NULL, ENCRYPTED | For insurance |
| estimatedValue | Decimal | NULL | |
| currency | String | NOT NULL, default: "USD" | ISO 4217 |
| notes | Text | NULL | |
| metadata | JSONB | NULL | Category-specific fields |
| createdAt | DateTime | NOT NULL, auto | |
| updatedAt | DateTime | NOT NULL, auto | |
| deletedAt | DateTime | NULL | |

**Indexes**: userId, category, deletedAt

---

### 4. PhysicalAsset

| Field | Type | Constraints | Notes |
|-------|------|-------------|-------|
| id | UUID | PK | |
| userId | UUID | FK → User, NOT NULL, indexed | |
| name | String | NOT NULL | |
| category | Enum | NOT NULL | REAL_ESTATE, VEHICLE, GOLD_JEWELRY, PERSONAL_PROPERTY, BUSINESS_ASSET |
| description | Text | NULL | |
| location | String | NULL | |
| estimatedValue | Decimal | NULL | |
| currency | String | NOT NULL, default: "USD" | |
| ownershipDetails | Text | NULL | |
| notes | Text | NULL | |
| metadata | JSONB | NULL | |
| createdAt | DateTime | NOT NULL, auto | |
| updatedAt | DateTime | NOT NULL, auto | |
| deletedAt | DateTime | NULL | |

**Indexes**: userId, category, deletedAt

---

### 5. DigitalAsset

| Field | Type | Constraints | Notes |
|-------|------|-------------|-------|
| id | UUID | PK | |
| userId | UUID | FK → User, NOT NULL, indexed | |
| name | String | NOT NULL | |
| category | Enum | NOT NULL | CRYPTO_WALLET, ONLINE_ACCOUNT, DOMAIN, SUBSCRIPTION, SOCIAL_MEDIA, OTHER |
| platform | String | NULL | Service/platform name |
| username | String | NULL | |
| credentials | String | NULL, ENCRYPTED | Login credentials |
| recoveryInfo | String | NULL, ENCRYPTED | Recovery keys/phrases |
| estimatedValue | Decimal | NULL | |
| currency | String | NOT NULL, default: "USD" | |
| notes | Text | NULL | |
| metadata | JSONB | NULL | |
| createdAt | DateTime | NOT NULL, auto | |
| updatedAt | DateTime | NOT NULL, auto | |
| deletedAt | DateTime | NULL | |

**Indexes**: userId, category, deletedAt

---

### 6. Document

| Field | Type | Constraints | Notes |
|-------|------|-------------|-------|
| id | UUID | PK | |
| userId | UUID | FK → User, NOT NULL, indexed | |
| folderId | UUID | FK → Folder, NULL | Root if NULL |
| name | String | NOT NULL | Original filename |
| mimeType | String | NOT NULL | Validated MIME type |
| sizeBytes | BigInt | NOT NULL | |
| storageKey | String | NOT NULL | Encrypted file reference in object storage |
| encryptionKeyId | String | NOT NULL | Reference to encryption key used |
| currentVersionId | UUID | FK → DocumentVersion, NULL | Points to latest version |
| metadata | JSONB | NULL | Custom metadata |
| createdAt | DateTime | NOT NULL, auto | |
| updatedAt | DateTime | NOT NULL, auto | |
| deletedAt | DateTime | NULL | |

**Indexes**: userId, folderId, deletedAt

---

### 7. DocumentVersion

| Field | Type | Constraints | Notes |
|-------|------|-------------|-------|
| id | UUID | PK | |
| documentId | UUID | FK → Document, NOT NULL, indexed | |
| versionNumber | Int | NOT NULL | Auto-incremented per document |
| storageKey | String | NOT NULL | |
| sizeBytes | BigInt | NOT NULL | |
| uploadedBy | UUID | FK → User, NOT NULL | |
| createdAt | DateTime | NOT NULL, auto | |

**Indexes**: documentId + versionNumber (unique compound)

---

### 8. Folder

| Field | Type | Constraints | Notes |
|-------|------|-------------|-------|
| id | UUID | PK | |
| userId | UUID | FK → User, NOT NULL, indexed | |
| parentId | UUID | FK → Folder, NULL | NULL = root level |
| name | String | NOT NULL | |
| createdAt | DateTime | NOT NULL, auto | |
| updatedAt | DateTime | NOT NULL, auto | |
| deletedAt | DateTime | NULL | |

**Indexes**: userId + parentId + name (unique compound), userId

---

### 9. LegacyPlan

| Field | Type | Constraints | Notes |
|-------|------|-------------|-------|
| id | UUID | PK | |
| userId | UUID | FK → User, NOT NULL, indexed | |
| status | Enum | NOT NULL, default: DRAFT | DRAFT, FINALIZED |
| currentStep | Int | NOT NULL, default: 1 | Current wizard step |
| stepsData | JSONB | NOT NULL, default: {} | All step data |
| completionStatus | JSONB | NOT NULL, default: {} | Per-step completion flags |
| version | Int | NOT NULL, default: 1 | |
| finalizedAt | DateTime | NULL | |
| confirmedBy | UUID | FK → User, NULL | User who confirmed finalization |
| lockVersion | Int | NOT NULL, default: 0 | Optimistic locking |
| createdAt | DateTime | NOT NULL, auto | |
| updatedAt | DateTime | NOT NULL, auto | |
| deletedAt | DateTime | NULL | |

**Indexes**: userId + status (to enforce max 1 active draft), userId
**Constraint**: At most one DRAFT plan per user (FR-C010)

---

### 10. LegacyPlanVersion

| Field | Type | Constraints | Notes |
|-------|------|-------------|-------|
| id | UUID | PK | |
| legacyPlanId | UUID | FK → LegacyPlan, NOT NULL, indexed | |
| versionNumber | Int | NOT NULL | |
| snapshotData | JSONB | NOT NULL | Complete plan data at finalization |
| finalizedAt | DateTime | NOT NULL | |
| createdAt | DateTime | NOT NULL, auto | |

**Indexes**: legacyPlanId + versionNumber (unique compound)

---

### 11. VideoMessage

| Field | Type | Constraints | Notes |
|-------|------|-------------|-------|
| id | UUID | PK | |
| userId | UUID | FK → User, NOT NULL, indexed | |
| title | String | NOT NULL | |
| description | Text | NULL | |
| storageKey | String | NOT NULL | Encrypted file reference |
| encryptionKeyId | String | NOT NULL | |
| mimeType | String | NOT NULL | |
| sizeBytes | BigInt | NOT NULL | |
| deliveryCondition | Enum | NOT NULL | IMMEDIATE, DEAD_MAN_SWITCH, EMERGENCY_ACCESS |
| metadata | JSONB | NULL | |
| createdAt | DateTime | NOT NULL, auto | |
| updatedAt | DateTime | NOT NULL, auto | |
| deletedAt | DateTime | NULL | |

**Indexes**: userId, deliveryCondition

---

### 12. DeadManSwitch

| Field | Type | Constraints | Notes |
|-------|------|-------------|-------|
| id | UUID | PK | |
| userId | UUID | FK → User, UNIQUE, NOT NULL | One DMS per user |
| status | Enum | NOT NULL, default: INACTIVE | See state machine below |
| inactivityPeriodDays | Int | NOT NULL | |
| checkInFrequencyDays | Int | NOT NULL | |
| escalationDelayHours | Int | NOT NULL, default: 24 | Between escalation steps |
| trustedContacts | JSONB | NOT NULL, default: [] | Contact details |
| releaseScope | JSONB | NOT NULL, default: {} | Selected document/asset/plan IDs |
| escalationRules | JSONB | NOT NULL, default: {} | Custom escalation config |
| lastCheckInAt | DateTime | NULL | |
| nextCheckInAt | DateTime | NULL | |
| currentEscalationStep | Int | NOT NULL, default: 0 | |
| pausedAt | DateTime | NULL | |
| createdAt | DateTime | NOT NULL, auto | |
| updatedAt | DateTime | NOT NULL, auto | |

**Indexes**: userId (unique), status, nextCheckInAt

**State Machine**:
```
INACTIVE → ACTIVE        (user enables DMS)
ACTIVE → REMINDER_SENT   (scheduled check-in notification sent)
REMINDER_SENT → ACTIVE   (user checks in successfully)
REMINDER_SENT → GRACE_PERIOD (check-in window expires without response)
GRACE_PERIOD → ACTIVE    (user checks in during grace period)
GRACE_PERIOD → ESCALATING (grace period expires)
ESCALATING → ACTIVE      (user verifies identity and cancels)
ESCALATING → RELEASING   (all escalation steps exhausted)
RELEASING → RELEASED     (conditional release executed)
RELEASED → ACTIVE        (user recovers, verifies identity)
ANY → PAUSED             (user pauses DMS)
PAUSED → ACTIVE          (user resumes DMS)
ANY → INACTIVE           (user disables DMS)
```

---

### 13. DeadManSwitchEvent

| Field | Type | Constraints | Notes |
|-------|------|-------------|-------|
| id | UUID | PK | |
| deadManSwitchId | UUID | FK → DeadManSwitch, NOT NULL, indexed | |
| eventType | Enum | NOT NULL | CHECK_IN, MISSED_CHECK_IN, ESCALATION_STEP, RECOVERY, RELEASE, PAUSE, RESUME, CONFIG_CHANGE |
| previousState | String | NOT NULL | |
| newState | String | NOT NULL | |
| metadata | JSONB | NULL | Additional event data |
| createdAt | DateTime | NOT NULL, auto | |

**Indexes**: deadManSwitchId, eventType, createdAt

---

### 14. EmergencyAccessConfig

| Field | Type | Constraints | Notes |
|-------|------|-------------|-------|
| id | UUID | PK | |
| userId | UUID | FK → User, NOT NULL, indexed | |
| contactName | String | NOT NULL | |
| contactEmail | String | NOT NULL | |
| contactPhone | String | NULL | |
| accessScope | JSONB | NOT NULL | Document/asset/plan IDs authorized |
| verificationMethod | Enum | NOT NULL, default: EMAIL_OTP | EMAIL_OTP, MFA |
| autoGrantTimeoutHours | Int | NULL | Hours before auto-grant if owner unreachable |
| status | Enum | NOT NULL, default: ACTIVE | ACTIVE, INACTIVE |
| createdAt | DateTime | NOT NULL, auto | |
| updatedAt | DateTime | NOT NULL, auto | |
| deletedAt | DateTime | NULL | |

**Indexes**: userId, status

---

### 15. EmergencyAccessRequest

| Field | Type | Constraints | Notes |
|-------|------|-------------|-------|
| id | UUID | PK | |
| configId | UUID | FK → EmergencyAccessConfig, NOT NULL | |
| requesterEmail | String | NOT NULL | |
| status | Enum | NOT NULL, default: PENDING | See state machine below |
| verificationCode | String | NULL, ENCRYPTED | OTP code |
| verificationExpiry | DateTime | NULL | |
| verificationAttempts | Int | NOT NULL, default: 0 | |
| grantedAt | DateTime | NULL | |
| expiresAt | DateTime | NULL | Access expiration |
| revokedAt | DateTime | NULL | |
| revokedBy | String | NULL | "OWNER", "SYSTEM", "EXPIRY" |
| createdAt | DateTime | NOT NULL, auto | |
| updatedAt | DateTime | NOT NULL, auto | |

**State Machine**:
```
PENDING → VERIFYING       (requester initiates verification)
VERIFYING → VERIFIED      (verification passed)
VERIFYING → FAILED        (verification failed after max attempts)
VERIFIED → APPROVED       (owner approves)
VERIFIED → DENIED         (owner denies)
VERIFIED → AUTO_GRANTED   (owner unreachable, timeout reached)
APPROVED → ACTIVE         (access granted, timer started)
AUTO_GRANTED → ACTIVE     (access granted via auto-grant)
ACTIVE → EXPIRED          (time limit reached)
ACTIVE → REVOKED          (owner revokes)
```

**Indexes**: configId, status, expiresAt

---

### 16. BeneficiaryAssignment

| Field | Type | Constraints | Notes |
|-------|------|-------------|-------|
| id | UUID | PK | |
| userId | UUID | FK → User, NOT NULL | |
| beneficiaryId | UUID | FK → Beneficiary, NOT NULL | |
| resourceType | Enum | NOT NULL | FINANCIAL_ASSET, PHYSICAL_ASSET, DIGITAL_ASSET, DOCUMENT, VIDEO_MESSAGE |
| resourceId | UUID | NOT NULL | Polymorphic FK |
| allocationPercentage | Decimal | NULL, CHECK(0–100) | |
| createdAt | DateTime | NOT NULL, auto | |
| updatedAt | DateTime | NOT NULL, auto | |

**Indexes**: beneficiaryId + resourceType + resourceId (unique compound),
userId, resourceType + resourceId
**Constraint**: Sum of allocationPercentage per resourceType+resourceId ≤ 100

---

### 17. AuditLog

| Field | Type | Constraints | Notes |
|-------|------|-------------|-------|
| id | UUID | PK | |
| actorId | UUID | NULL | NULL for system actions |
| actorRole | String | NULL | Role at time of action |
| action | String | NOT NULL | e.g., "user.login", "document.upload" |
| resourceType | String | NOT NULL | Entity type affected |
| resourceId | UUID | NULL | Entity ID affected |
| outcome | Enum | NOT NULL | SUCCESS, FAILURE, DENIED |
| metadata | JSONB | NULL | Previous/new values, request details |
| ipAddress | String | NULL | |
| userAgent | String | NULL | |
| correlationId | String | NULL | Request correlation ID |
| createdAt | DateTime | NOT NULL, auto | Immutable timestamp |

**Indexes**: actorId, action, resourceType + resourceId, createdAt, correlationId
**Note**: Append-only table. No UPDATE or DELETE operations permitted.

---

### 18. AIInteraction

| Field | Type | Constraints | Notes |
|-------|------|-------------|-------|
| id | UUID | PK | |
| userId | UUID | FK → User, NOT NULL, indexed | |
| sessionType | Enum | NOT NULL | ASSISTANT, WILL_GENERATOR, DOCUMENT_ANALYSIS |
| provider | String | NOT NULL | "openai", "gemini" |
| inputSummary | Text | NULL | Sanitized summary (no raw PII) |
| outputSummary | Text | NULL | Sanitized summary |
| confirmationStatus | Enum | NULL | PENDING, CONFIRMED, REJECTED |
| tokenCount | Int | NULL | Tokens used |
| costEstimate | Decimal | NULL | Estimated cost |
| metadata | JSONB | NULL | |
| createdAt | DateTime | NOT NULL, auto | |

**Indexes**: userId, sessionType, createdAt

---

### 19. Notification

| Field | Type | Constraints | Notes |
|-------|------|-------------|-------|
| id | UUID | PK | |
| userId | UUID | FK → User, NOT NULL, indexed | |
| type | String | NOT NULL | e.g., "auth.new_device", "dms.checkin" |
| title | String | NOT NULL | |
| content | Text | NOT NULL | |
| channel | Enum | NOT NULL | EMAIL, IN_APP, BOTH |
| deliveryStatus | Enum | NOT NULL, default: PENDING | PENDING, SENT, DELIVERED, FAILED |
| readAt | DateTime | NULL | For in-app notifications |
| retryCount | Int | NOT NULL, default: 0 | |
| lastRetryAt | DateTime | NULL | |
| metadata | JSONB | NULL | |
| createdAt | DateTime | NOT NULL, auto | |

**Indexes**: userId + readAt (for unread count), type, deliveryStatus, createdAt

---

### 20. Session

| Field | Type | Constraints | Notes |
|-------|------|-------------|-------|
| id | UUID | PK | Session ID (maps to cookie) |
| userId | UUID | FK → User, NOT NULL, indexed | |
| tokenHash | String | NOT NULL | Hashed session token |
| deviceInfo | String | NULL | User agent parsed |
| ipAddress | String | NULL | |
| location | String | NULL | Approximate geolocation |
| lastActiveAt | DateTime | NOT NULL | |
| expiresAt | DateTime | NOT NULL | |
| createdAt | DateTime | NOT NULL, auto | |

**Indexes**: userId, tokenHash, expiresAt
**Note**: Expired sessions cleaned up by background job.

---

### 21. BeneficiaryAccessToken

| Field | Type | Constraints | Notes |
|-------|------|-------------|-------|
| id | UUID | PK | |
| beneficiaryId | UUID | FK → Beneficiary, NOT NULL | |
| tokenHash | String | NOT NULL, UNIQUE | Hashed access token |
| scope | JSONB | NOT NULL | Resource IDs and types accessible |
| expiresAt | DateTime | NOT NULL | |
| revokedAt | DateTime | NULL | |
| usedAt | DateTime | NULL | First use timestamp |
| createdAt | DateTime | NOT NULL, auto | |

**Indexes**: tokenHash (unique), beneficiaryId, expiresAt

---

## Relationship Diagram

```
User (1) ──── (N) Beneficiary
User (1) ──── (N) FinancialAsset
User (1) ──── (N) PhysicalAsset
User (1) ──── (N) DigitalAsset
User (1) ──── (N) Document
User (1) ──── (N) Folder
User (1) ──── (N) LegacyPlan
User (1) ──── (N) VideoMessage
User (1) ──── (1) DeadManSwitch
User (1) ──── (N) EmergencyAccessConfig
User (1) ──── (N) Session
User (1) ──── (N) Notification
User (1) ──── (N) AIInteraction
User (1) ──── (N) AuditLog (as actor)

Beneficiary (1) ──── (N) BeneficiaryAssignment
Beneficiary (1) ──── (N) BeneficiaryAccessToken

Document (1) ──── (N) DocumentVersion
Document (N) ──── (1) Folder

LegacyPlan (1) ──── (N) LegacyPlanVersion

DeadManSwitch (1) ──── (N) DeadManSwitchEvent

EmergencyAccessConfig (1) ──── (N) EmergencyAccessRequest

BeneficiaryAssignment ──── polymorphic FK to:
  FinancialAsset | PhysicalAsset | DigitalAsset | Document | VideoMessage
```

---

## Validation Rules (from spec)

| Rule | Entities | Implementation |
|------|----------|----------------|
| Allocation ≤ 100% per resource | BeneficiaryAssignment | DB CHECK + service-level validation |
| One DRAFT plan per user | LegacyPlan | Unique partial index on userId WHERE status = 'DRAFT' |
| No duplicate beneficiary email per user | Beneficiary | Unique compound index on userId + email |
| Password strength (12+ chars, mixed) | User | Zod validator + service-level check |
| File size ≤ 50 MB (docs) | Document | Multer limit + Zod validator |
| File size ≤ 500 MB (videos) | VideoMessage | Multer limit + Zod validator |
| Session expiry enforcement | Session | TTL-based cleanup + middleware check |
| Verification token single-use | User | NULL after use |
| Audit log append-only | AuditLog | No UPDATE/DELETE in repository; DB trigger or policy |
