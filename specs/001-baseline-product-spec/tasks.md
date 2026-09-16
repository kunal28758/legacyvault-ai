# Tasks: LegacyVault AI — Baseline Product

**Feature**: `specs/001-baseline-product-spec` | **Generated**: 2025-09-16

**Spec**: [spec.md](./spec.md) | **Plan**: [plan.md](./plan.md) | **Data Model**: [data-model.md](./data-model.md) | **Contracts**: [contracts/api-contracts.md](./contracts/api-contracts.md)

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Project initialization, tooling, and repository structure

- [ ] T001 Create top-level project structure with `frontend/`, `backend/`, `docs/`, `scripts/`, `.github/workflows/` directories per plan.md project structure
- [ ] T002 Initialize Next.js 14+ TypeScript project in `frontend/` with App Router (`npx -y create-next-app@latest ./` with TypeScript, Tailwind CSS, ESLint, App Router options)
- [ ] T003 [P] Install frontend dependencies: `shadcn/ui`, `framer-motion`, `gsap`, `zustand`, `@tanstack/react-query`, `zod`, `@react-pdf/renderer` in `frontend/package.json`
- [ ] T004 [P] Initialize Express.js TypeScript project in `backend/` with `package.json`, `tsconfig.json`, and configure `ts-node-dev` for development
- [ ] T005 [P] Install backend dependencies: `express`, `@types/express`, `prisma`, `@prisma/client`, `zod`, `bcrypt`, `jose`, `multer`, `speakeasy`, `qrcode`, `nodemailer`, `winston`, `helmet`, `cors`, `express-rate-limit`, `bullmq`, `ioredis`, `@aws-sdk/client-s3`, `@aws-sdk/s3-request-presigner`, `uuid` in `backend/package.json`
- [ ] T006 [P] Configure ESLint and Prettier for both `frontend/` and `backend/` with shared TypeScript rules
- [ ] T007 [P] Create `backend/src/config/env.ts` — environment variable loading with validation using Zod (DATABASE_URL, REDIS_URL, SESSION_SECRET, ENCRYPTION_KEY, S3_BUCKET, S3_ENDPOINT, S3_ACCESS_KEY, S3_SECRET_KEY, AI_OPENAI_KEY, AI_GEMINI_KEY, SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, APP_URL, NODE_ENV, PORT). All secrets from env vars only (Constitution I)
- [ ] T008 [P] Create `.env.example` at project root with all required environment variables (no actual secrets — Constitution I, XIX)
- [ ] T009 [P] Update `.gitignore` for Node.js projects: `node_modules/`, `.env`, `.env.local`, `dist/`, `.next/`, `prisma/*.db`, `coverage/`, `*.log`
- [ ] T010 [P] Configure Tailwind CSS design system in `frontend/tailwind.config.ts` — dark-first theme with blue/purple/cyan accent palette, glassmorphism utilities, custom spacing scale, typography (Inter/Outfit from Google Fonts). Constitution XIII: dark-first, glassmorphism, blue/purple/cyan accents
- [ ] T011 [P] Create `frontend/src/styles/globals.css` with CSS variables for dark/light themes, glassmorphism classes, gradient utilities, animation base classes (Constitution XIII, XIV)
- [ ] T012 [P] Initialize shadcn/ui in `frontend/` — configure with dark theme, import base components (Button, Input, Card, Dialog, Sheet, Tabs, Table, Badge, Avatar, Dropdown, Toast, Skeleton, Tooltip)
- [ ] T013 [P] Create `frontend/src/lib/api-client.ts` — typed API client wrapping fetch with base URL `/api/v1`, credentials: 'include' for cookies, JSON headers, centralized error handling, response type parsing
- [ ] T014 [P] Create `frontend/src/lib/query-client.ts` — TanStack Query client configuration with default staleTime, retry, and error handling
- [ ] T015 [P] Set up Vitest configuration for both `frontend/` (`vitest.config.ts`) and `backend/` (`vitest.config.ts`) with TypeScript support
- [ ] T016 [P] Create `.github/workflows/ci.yml` — GitHub Actions CI pipeline: install → lint → type-check → test (both frontend and backend)
- [ ] T017 Create `frontend/src/app/layout.tsx` — root layout with dark theme, Google Fonts (Inter, Outfit), QueryClientProvider, metadata (title: "LegacyVault AI", description, favicon)

**Checkpoint**: Both projects build and start successfully. CI pipeline configured.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Core infrastructure that MUST be complete before ANY user story

**⚠️ CRITICAL**: No user story work can begin until this phase is complete

- [ ] T018 Create Prisma schema in `backend/prisma/schema.prisma` — define all 21 entities from data-model.md: User (email UNIQUE, role Enum USER/SUPER_ADMIN, mfaEnabled default false, failedLoginAttempts default 0, deletedAt nullable), Session, AuditLog (append-only), Beneficiary (userId+email unique compound), FinancialAsset, PhysicalAsset, DigitalAsset, Document, DocumentVersion, Folder (userId+parentId+name unique compound), LegacyPlan (status Enum DRAFT/FINALIZED, lockVersion default 0), LegacyPlanVersion, VideoMessage (deliveryCondition Enum IMMEDIATE/DEAD_MAN_SWITCH/EMERGENCY_ACCESS), DeadManSwitch (userId UNIQUE, status Enum per state machine), DeadManSwitchEvent, EmergencyAccessConfig, EmergencyAccessRequest (status Enum per state machine), BeneficiaryAssignment (beneficiaryId+resourceType+resourceId unique compound, allocationPercentage CHECK 0-100), AIInteraction, Notification, BeneficiaryAccessToken (tokenHash UNIQUE). Include all indexes, constraints, enums, and relationships from data-model.md
- [ ] T019 Run `npx prisma migrate dev --name init` to create initial migration in `backend/prisma/migrations/`
- [ ] T020 [P] Create `backend/src/utils/encryption.ts` — AES-256-GCM encryption/decryption utility using Node.js crypto. Functions: `encrypt(plaintext, key): { ciphertext, iv, authTag }`, `decrypt(ciphertext, iv, authTag, key): plaintext`. Key from ENCRYPTION_KEY env var. Constitution IV: AES-256, keys not hardcoded
- [ ] T021 [P] Create `backend/src/middleware/error-handler.ts` — centralized Express error handler. Return `{ success: false, error: { code, message } }`. MUST NOT leak stack traces, DB details, or file paths (Constitution X). Log full error server-side with Winston
- [ ] T022 [P] Create `backend/src/config/logger.ts` — Winston structured logger with correlation ID support, JSON format, console transport (dev), file transport (prod). MUST NOT log passwords, tokens, encryption keys, or sensitive PII (Constitution XVI)
- [ ] T023 [P] Create `backend/src/middleware/correlation-id.ts` — Express middleware generating UUID correlation ID per request, attaching to `req` and response header `X-Correlation-ID`. Pass to logger context (NFR-OBS-001)
- [ ] T024 [P] Create `backend/src/middleware/security-headers.ts` — Helmet configuration with HSTS, CSP (script-src 'self'), X-Frame-Options DENY, X-Content-Type-Options nosniff, Referrer-Policy strict-origin-when-cross-origin (Constitution XI, XXI)
- [ ] T025 [P] Create `backend/src/middleware/rate-limiter.ts` — express-rate-limit configuration. Export factory function `createRateLimiter(windowMs, max, keyGenerator?)`. Default: 100 req/15min. Auth endpoints: 5 req/15min per account + 20 req/15min per IP (FR-A013, Constitution XI)
- [ ] T026 [P] Create `backend/src/middleware/validate.ts` — Express middleware accepting a Zod schema, validating `req.body`/`req.params`/`req.query`. Return 422 with field-level errors on failure. Constitution X: server-side validation mandatory
- [ ] T027 [P] Create `backend/src/services/audit.service.ts` — AuditLog service: `log(actorId, actorRole, action, resourceType, resourceId, outcome, metadata?, ipAddress?, userAgent?, correlationId?)`. Insert into AuditLog table. Append-only — no update/delete methods. Constitution XII: actor, timestamp, action, resource, outcome
- [ ] T028 [P] Create `backend/src/config/database.ts` — Prisma client singleton with connection pooling, logging configuration, and graceful shutdown handler
- [ ] T029 [P] Create `backend/src/config/storage.ts` — S3 client configuration using `@aws-sdk/client-s3`. Connect to S3_ENDPOINT with S3_ACCESS_KEY/S3_SECRET_KEY. Export functions: `uploadFile`, `getSignedDownloadUrl(key, expiresIn=900)`, `deleteFile`. All buckets private (Constitution IV)
- [ ] T030 Create `backend/src/app.ts` — Express app setup: CORS (credentials: true, origin from APP_URL), JSON body parser (limit: '50mb'), cookie parser, security headers middleware, correlation ID middleware, rate limiter, API versioned router mount at `/api/v1`, error handler middleware, health check at `/api/v1/health`
- [ ] T031 Create `backend/src/routes/v1/index.ts` — v1 router aggregating all domain route files. Mount each domain under its path (e.g., `/auth`, `/users`, `/beneficiaries`, etc.)
- [ ] T032 [P] Create `backend/src/utils/file-validation.ts` — File validation utility: `validateFile(buffer, filename, maxSizeBytes)`. Check: file extension against whitelist, MIME type against whitelist, magic bytes verification (PDF: %PDF, JPEG: FFD8FF, PNG: 89504E47, etc.), size limit. Return `{ valid: boolean, error?: string }`. Constitution XI: type, size, extension, magic bytes
- [ ] T033 Create seed script `backend/prisma/seed.ts` — Create Super Admin user with seeded credentials from env vars (ADMIN_EMAIL, ADMIN_PASSWORD). Hash password with bcrypt cost ≥12. Set role: SUPER_ADMIN, emailVerified: true
- [ ] T181 [P] Create `backend/src/utils/malware-scanner.ts` — Pluggable malware-scanning interface: `MalwareScanner` interface with `scan(buffer: Buffer, filename: string): Promise<{ safe: boolean, threat?: string }>`. Export `NoOpScanner` class (development — always returns safe with warning log) and `MalwareScannerFactory` that reads `MALWARE_SCANNER_PROVIDER` env var to select implementation. Production implementations (e.g., ClamAV, cloud API) are injectable via the factory. Files failing scan MUST be quarantined (not stored in user-accessible storage), and scan results MUST be logged to audit trail. FR-H016, FR-Q011

**Checkpoint**: Foundation ready — database schema created, core middleware operational, utilities available. User story implementation can now begin.

---

## Phase 3: User Story 1 — Secure Registration and Onboarding (Priority: P1) 🏁 MVP

**Goal**: Users can register, verify email, and access the platform

**Independent Test**: Register → verify email → log in → see onboarding/dashboard

### Implementation for User Story 1

- [ ] T034 [P] [US1] Create `backend/src/validators/auth.validators.ts` — Zod schemas: `registerSchema` (email: string.email, password: string.min(12).regex for uppercase+lowercase+number+special, name: string.min(1).max(100)), `loginSchema` (email, password), `verifyEmailSchema` (token: string), `forgotPasswordSchema` (email), `resetPasswordSchema` (token, newPassword)
- [ ] T035 [P] [US1] Create `backend/src/services/auth.service.ts` — AuthService class with methods: `register(email, password, name)` → hash password (bcrypt cost≥12), create User, generate email verification token (crypto.randomBytes(32).toString('hex')), set expiry 24h, send verification email, log audit event. `verifyEmail(token)` → validate token not expired, mark emailVerified=true, null out token, log audit. `login(email, password)` → find user, check emailVerified, check lockedUntil, compare password, reset failedLoginAttempts on success, increment+check lockout on failure (5 attempts → 30min lock per FR-A012), create Session, log audit. `logout(sessionId)` → delete session, log audit
- [ ] T036 [P] [US1] Create `backend/src/middleware/auth.middleware.ts` — `authenticate` middleware: extract session token from httpOnly cookie, look up Session by tokenHash, verify not expired, attach user to `req.user`. `requireRole(roles[])` middleware: check `req.user.role` against allowed roles, return 403 if denied. `requireReAuth` middleware: check session re-auth timestamp within 5 minutes. Constitution III: server-side enforcement
- [ ] T037 [US1] Create `backend/src/controllers/auth.controller.ts` — Express handlers for: POST `/register`, POST `/login`, POST `/logout`, POST `/verify-email`, POST `/forgot-password`, POST `/reset-password`. Each handler: validate input → call service → format response → handle errors. Set httpOnly secure sameSite=strict cookie on login
- [ ] T038 [US1] Create `backend/src/routes/v1/auth.routes.ts` — Mount auth controller handlers with appropriate rate limiters (auth endpoints: 5/15min per account per FR-A013)
- [ ] T039 [P] [US1] Create `backend/src/services/email.service.ts` — EmailService using Nodemailer with configurable transport (SMTP from env vars). Methods: `sendVerificationEmail(to, token, name)`, `sendPasswordResetEmail(to, token, name)`, `sendGenericEmail(to, subject, htmlContent)`. Templates render with sanitized data. Constitution II: no sensitive data in plaintext email bodies
- [ ] T040 [P] [US1] Create `frontend/src/app/(auth)/login/page.tsx` — Login page with email/password form, shadcn/ui Input + Button, client-side validation (Zod), error display, link to register and forgot-password. Dark theme with glassmorphism card, gradient background, Framer Motion fade-in animation. Constitution XIII
- [ ] T041 [P] [US1] Create `frontend/src/app/(auth)/register/page.tsx` — Registration page with name/email/password/confirm-password form, password strength indicator, terms checkbox, shadcn/ui components, Framer Motion animations. Dark theme glassmorphism card
- [ ] T042 [P] [US1] Create `frontend/src/app/(auth)/verify-email/page.tsx` — Email verification page: extract token from URL, call API, show success/error state with appropriate messaging and redirect to login
- [ ] T043 [P] [US1] Create `frontend/src/app/(auth)/forgot-password/page.tsx` — Forgot password form (email input), success state ("check your email"), error handling
- [ ] T044 [P] [US1] Create `frontend/src/app/(auth)/reset-password/page.tsx` — Password reset form (new password + confirm), token from URL, success redirect to login
- [ ] T045 [P] [US1] Create `frontend/src/components/layout/auth-layout.tsx` — Shared auth page layout with centered card, logo, gradient background, glass effect container
- [ ] T046 [US1] Create `frontend/src/hooks/use-auth.ts` — `useAuth()` hook: manages auth state via Zustand store, provides `login`, `logout`, `register` mutations via TanStack Query, `user` object, `isAuthenticated` boolean, `isLoading` state
- [ ] T047 [US1] Create `frontend/src/app/(auth)/layout.tsx` — Auth route group layout: redirect authenticated users to dashboard, render auth-layout for unauthenticated users
- [ ] T048 [US1] Create `frontend/src/app/(dashboard)/layout.tsx` — Dashboard route group layout: redirect unauthenticated users to login, render sidebar + header shell for authenticated users
- [ ] T049 [P] [US1] Create `frontend/src/components/layout/sidebar.tsx` — Dashboard sidebar navigation with links to all modules (Dashboard, Legacy Plan, Beneficiaries, Assets, Documents, Dead Man Switch, Emergency Access, Video Legacy, AI, Security Center, Settings). Active state highlighting, collapsible on mobile, dark theme with glassmorphism. Framer Motion slide animation
- [ ] T050 [P] [US1] Create `frontend/src/components/layout/header.tsx` — Dashboard header with user avatar/name dropdown (profile, settings, logout), notification bell with unread count badge, search (future), breadcrumb
- [ ] T051 [US1] Create `frontend/src/app/(dashboard)/dashboard/page.tsx` — Main dashboard page with welcome message, quick-action cards (Create Plan, Add Beneficiary, Upload Document), recent activity feed, security status summary. Skeleton loading states. Dark theme with gradient cards, Framer Motion staggered card animations

**Checkpoint**: Users can register, verify email, log in, and see the dashboard. Auth is server-side enforced.

---

## Phase 4: User Story 16 — Account Login and Session Security (Priority: P1)

**Goal**: Secure login with MFA, session management, and account lockout

**Independent Test**: Login → enable MFA → logout → login with MFA → verify sessions

### Implementation for User Story 16

- [ ] T052 [US16] Create `backend/src/services/mfa.service.ts` — MFAService: `generateSecret()` → TOTP secret via speakeasy, return secret + QR code URL. `verifyToken(secret, token)` → verify TOTP token with window=1. `generateBackupCodes(count=10)` → generate and hash 10 backup codes. `verifyBackupCode(hashedCodes, code)` → verify and consume backup code. Constitution III: MFA
- [ ] T053 [US16] Add MFA endpoints to `backend/src/controllers/auth.controller.ts`: POST `/mfa/setup` (returns QR code data), POST `/mfa/verify` (enable MFA after verification), POST `/mfa/disable` (requires re-auth), POST `/mfa/validate` (during login flow), POST `/mfa/backup-codes` (requires re-auth). POST `/re-authenticate` (verify password, set re-auth timestamp on session)
- [ ] T054 [US16] Update `backend/src/services/auth.service.ts` login flow — if user.mfaEnabled, return `{ requiresMfa: true, mfaSessionToken }` instead of full session. After MFA validation, create full session. Two-step login per FR-A006
- [ ] T055 [P] [US16] Create `frontend/src/app/(auth)/login/mfa-step.tsx` — MFA verification step component: 6-digit TOTP input with auto-focus, backup code toggle, countdown timer, Framer Motion slide transition from password step
- [ ] T056 [P] [US16] Create `frontend/src/app/(dashboard)/settings/mfa/page.tsx` — MFA management page: enable/disable MFA with QR code display, backup codes display (one-time view with copy/download), re-authentication gate before changes
- [ ] T182 [US16] Add new-device and unusual-location detection to `backend/src/services/auth.service.ts` — On login success: extract device fingerprint (User-Agent parsed via `ua-parser-js`), IP address, and approximate geolocation (IP-based, privacy-safe — city/country level only, no precise coordinates). Compare against user's known device+location history stored in Session records. If device or location is new: set `isNewDevice: true` on the Session record, trigger security notification via NotificationService ("New login from [device] in [city, country]"), log audit event with `action: 'auth.new_device_login'`. Do NOT collect unnecessary location data beyond city/country. FR-A016

**Checkpoint**: Full login flow with MFA, session management, new-device detection, and account lockout operational.

---

## Phase 5: User Story 2 — Creating a Digital Legacy Plan (Priority: P1)

**Goal**: Users can create, progress through, auto-save, and finalize a legacy plan via multi-step wizard

**Independent Test**: Create plan → fill steps → auto-save → review → finalize → view version history

### Implementation for User Story 2

- [ ] T057 [P] [US2] Create `backend/src/validators/legacy-plan.validators.ts` — Zod schemas per wizard step: `personalDetailsSchema` (name, dob, address, identification), `familyInfoSchema` (spouse, children array, parents), `witnessDetailsSchema` (witnesses array with name, contact), `specialWishesSchema` (text, instructions), `reviewSchema` (confirmed: boolean.literal(true) required for finalization). Each field with constraints from data-model.md
- [ ] T058 [P] [US2] Create `backend/src/services/legacy-plan.service.ts` — LegacyPlanService: `create(userId)` → enforce max 1 draft per user (409 on duplicate), create with status DRAFT. `getByUserId(userId)` → return current plan. `updateStep(planId, userId, step, data, lockVersion)` → validate ownership, check lockVersion for optimistic locking (409 on conflict), validate step data, update stepsData JSONB + completionStatus, increment lockVersion. `getReview(planId, userId)` → compile all steps, compute completeness per step, return summary. `finalize(planId, userId, lockVersion)` → validate all required steps complete, set status=FINALIZED, create LegacyPlanVersion snapshot, record finalizedAt, log audit. `createNewDraft(planId, userId)` → copy finalized plan data to new DRAFT, increment version. `getVersionHistory(planId, userId)`
- [ ] T059 [US2] Create `backend/src/controllers/legacy-plan.controller.ts` — Handlers: GET `/legacy-plans` (list), POST `/legacy-plans` (create draft), GET `/legacy-plans/:id` (get with steps), PATCH `/legacy-plans/:id/steps/:step` (auto-save), POST `/legacy-plans/:id/review` (get review), POST `/legacy-plans/:id/finalize` (finalize with confirmed:true), GET `/legacy-plans/:id/versions`, POST `/legacy-plans/:id/new-draft`. All enforce ownership
- [ ] T060 [US2] Create `backend/src/routes/v1/legacy-plans.routes.ts` — Mount legacy plan handlers with auth middleware
- [ ] T061 [P] [US2] Create `frontend/src/components/wizard/wizard-provider.tsx` — Reusable wizard context provider: manages currentStep, stepsData, completionStatus, auto-save timer (debounced 3s), navigation methods (next, previous, goToStep), validation per step, dirty-state tracking
- [ ] T062 [P] [US2] Create `frontend/src/components/wizard/wizard-stepper.tsx` — Visual step indicator component: numbered steps with labels, completion checkmarks, active step highlight, clickable completed steps, responsive (horizontal desktop, vertical mobile), Framer Motion step transitions
- [ ] T063 [P] [US2] Create `frontend/src/components/wizard/wizard-step.tsx` — Individual step wrapper: renders step content, handles validation, shows save status indicator ("Saved", "Saving...", "Unsaved changes"), Framer Motion slide animation between steps
- [ ] T064 [US2] Create `frontend/src/app/(dashboard)/legacy-plan/page.tsx` — Legacy plan page: if no plan exists show "Create Plan" CTA, if draft exists show wizard, if finalized show plan summary with "Create New Version" option
- [ ] T065 [US2] Create `frontend/src/app/(dashboard)/legacy-plan/steps/personal-details.tsx` — Step 1: Personal details form (name, DOB, address, ID info) with shadcn/ui inputs, inline validation
- [ ] T066 [P] [US2] Create `frontend/src/app/(dashboard)/legacy-plan/steps/family-info.tsx` — Step 2: Family information (spouse details, children list with add/remove, parent details) with dynamic form arrays
- [ ] T067 [P] [US2] Create `frontend/src/app/(dashboard)/legacy-plan/steps/witness-details.tsx` — Step 8: Witness details (name, contact, address) with add/remove witness rows
- [ ] T068 [P] [US2] Create `frontend/src/app/(dashboard)/legacy-plan/steps/special-wishes.tsx` — Step 9: Special wishes and instructions textarea with optional structured fields
- [ ] T069 [US2] Create `frontend/src/app/(dashboard)/legacy-plan/steps/review.tsx` — Review step: display all entered data organized by section, highlight incomplete/missing sections with warnings, completeness percentage, explicit "Finalize" button with confirmation dialog (shadcn Dialog). FR-C007: review screen with completeness
- [ ] T070 [US2] Create `frontend/src/app/(dashboard)/legacy-plan/versions/page.tsx` — Version history page: list finalized versions with timestamps, view read-only version details

**Checkpoint**: Users can create and finalize a legacy plan through a multi-step wizard with auto-save.

---

## Phase 6: User Story 3 — Adding and Managing Beneficiaries (Priority: P1)

**Goal**: Users can add, edit, remove beneficiaries with duplicate detection and audit logging

**Independent Test**: Add beneficiary → attempt duplicate → edit → remove → verify audit trail

### Implementation for User Story 3

- [ ] T071 [P] [US3] Create `backend/src/validators/beneficiary.validators.ts` — Zod schemas: `createBeneficiarySchema` (name: string.min(1).max(100), relationship: string.min(1), email: string.email, phone: string.optional, isEmergencyBeneficiary: boolean.default(false), notes: string.optional), `updateBeneficiarySchema` (partial of create + confirmed: boolean for authoritative changes per FR-D008)
- [ ] T072 [P] [US3] Create `backend/src/services/beneficiary.service.ts` — BeneficiaryService: `create(userId, data)` → check duplicate email per user (409), create Beneficiary, log audit. `update(id, userId, data)` → verify ownership, require `confirmed: true` for name/email/allocation changes (FR-D008), update, log audit with previous values. `remove(id, userId)` → soft delete, log audit. `list(userId)` → return all non-deleted. `getById(id, userId)` → ownership check. Constitution VII: confirmation before authoritative changes
- [ ] T073 [US3] Create `backend/src/controllers/beneficiary.controller.ts` — Handlers: GET `/beneficiaries`, POST `/beneficiaries`, GET `/beneficiaries/:id`, PATCH `/beneficiaries/:id`, DELETE `/beneficiaries/:id`. All enforce user ownership
- [ ] T074 [US3] Create `backend/src/routes/v1/beneficiaries.routes.ts` — Mount with auth middleware
- [ ] T075 [P] [US3] Create `frontend/src/app/(dashboard)/beneficiaries/page.tsx` — Beneficiary list page: data table with name, relationship, email, status columns. Add Beneficiary button → dialog form. Edit/Delete actions per row. Empty state with guidance. Skeleton loading. Dark theme cards with Framer Motion list animation
- [ ] T076 [US3] Create `frontend/src/app/(dashboard)/beneficiaries/[id]/page.tsx` — Beneficiary detail page: full info display, edit form, assignment list (assets/documents assigned to this beneficiary), confirmation dialog for authoritative changes

**Checkpoint**: Complete beneficiary management with validation, duplicate detection, and audit trail.

---

## Phase 7: User Story 17 — Account Recovery (Priority: P2)

**Goal**: Users can recover accounts via password reset and MFA backup codes

**Independent Test**: Forgot password → reset email → reset → login with new password

### Implementation for User Story 17

- [ ] T077 [US17] Add password reset methods to `backend/src/services/auth.service.ts` — `forgotPassword(email)` → generate reset token (crypto.randomBytes(32)), set 1-hour expiry, invalidate previous tokens, send reset email, log audit. Always return success (prevent email enumeration per FR-A010). `resetPassword(token, newPassword)` → validate token not expired, hash new password, update user, null out token, invalidate ALL sessions for user, log audit (FR-A011)
- [ ] T078 [US17] Add `backend/src/services/mfa.service.ts` — `useBackupCode(userId, code)` method: find user, verify hashed backup code, remove used code, log audit. If all backup codes exhausted, flag for admin support

**Checkpoint**: Account recovery via password reset and MFA backup codes operational.

---

## Phase 8: User Story 4 — Managing Financial Assets (Priority: P2)

**Goal**: Users can add, categorize, and manage financial assets with encrypted sensitive fields

**Independent Test**: Create financial asset → fill category-specific fields → verify encrypted storage → decrypt with re-auth

### Implementation for User Story 4

- [ ] T079 [P] [US4] Create `backend/src/validators/asset.validators.ts` — Zod schemas: `createFinancialAssetSchema` (name: string.min(1).max(200), category: enum BANK_ACCOUNT|FIXED_DEPOSIT|MUTUAL_FUND|STOCK|INSURANCE|RETIREMENT, institution: string.optional, accountNumber: string.optional, policyNumber: string.optional, estimatedValue: number.positive.optional, currency: string.length(3).default("USD"), notes: string.optional, metadata: object.optional), `updateFinancialAssetSchema` (partial), `createPhysicalAssetSchema`, `updatePhysicalAssetSchema`, `createDigitalAssetSchema`, `updateDigitalAssetSchema`
- [ ] T080 [P] [US4] Create `backend/src/services/asset.service.ts` — AssetService: `createFinancial(userId, data)` → encrypt accountNumber and policyNumber with AES-256-GCM before storage, create FinancialAsset, log audit. `getFinancial(id, userId)` → ownership check, return with encrypted fields masked as "••••••". `decryptFinancialField(id, userId, field)` → re-auth required, decrypt field, log credential view in audit (FR-G005). `updateFinancial(id, userId, data)` → re-encrypt if sensitive fields changed, log audit with changes. `deleteFinancial(id, userId)` → soft delete, log audit. `listFinancial(userId)` → return all with masked sensitive fields. Same pattern for Physical and Digital assets
- [ ] T081 [US4] Create `backend/src/controllers/asset.controller.ts` — Handlers for GET/POST/PATCH/DELETE for `/assets/financial`, `/assets/physical`, `/assets/digital`, plus GET `/assets/:type/:id/decrypt` with requireReAuth middleware
- [ ] T082 [US4] Create `backend/src/routes/v1/assets.routes.ts` — Mount with auth middleware, `/decrypt` endpoints with requireReAuth
- [ ] T083 [P] [US4] Create `frontend/src/app/(dashboard)/assets/financial/page.tsx` — Financial assets list: categorized view (tabs or filter by category), data table with name, category, institution, estimated value. Add button → category-specific form dialog. Edit/delete actions. Masked sensitive fields with "Reveal" button triggering re-auth
- [ ] T084 [US4] Create `frontend/src/components/forms/re-auth-dialog.tsx` — Re-authentication dialog: password input (+ MFA if enabled), used before decrypting sensitive fields or performing sensitive operations. Framer Motion scale-in animation

**Checkpoint**: Financial assets fully manageable with encrypted sensitive fields and re-auth gates.

---

## Phase 9: User Story 5 — Managing Physical Assets (Priority: P2)

**Goal**: Users can add and manage physical assets with category-specific metadata

**Independent Test**: Create physical assets across categories → verify metadata → document attachment links

### Implementation for User Story 5

- [ ] T085 [P] [US5] Add physical asset methods to `backend/src/services/asset.service.ts` — `createPhysical(userId, data)`, `getPhysical`, `updatePhysical`, `deletePhysical`, `listPhysical`. Categories from data-model.md: REAL_ESTATE, VEHICLE, GOLD_JEWELRY, PERSONAL_PROPERTY, BUSINESS_ASSET
- [ ] T086 [US5] Create `frontend/src/app/(dashboard)/assets/physical/page.tsx` — Physical assets list and management UI: category tabs, add/edit dialogs with category-specific fields (location for real estate, registration for vehicles, etc.), document attachment links

**Checkpoint**: Physical asset management complete.

---

## Phase 10: User Story 6 — Managing Digital Assets (Priority: P2)

**Goal**: Users can manage digital assets with encrypted credentials and masked display

**Independent Test**: Create digital asset with credentials → verify masked → re-auth → view plaintext → verify audit log

### Implementation for User Story 6

- [ ] T087 [P] [US6] Add digital asset methods to `backend/src/services/asset.service.ts` — `createDigital(userId, data)` → encrypt credentials and recoveryInfo with AES-256-GCM. `decryptDigitalField(id, userId, field)` → re-auth gate, decrypt, log credential view in audit trail (FR-G005). Categories: CRYPTO_WALLET, ONLINE_ACCOUNT, DOMAIN, SUBSCRIPTION, SOCIAL_MEDIA, OTHER
- [ ] T088 [US6] Create `frontend/src/app/(dashboard)/assets/digital/page.tsx` — Digital assets list: platform icons/logos, masked credentials (••••••), "Reveal" button with re-auth dialog, category filter, add/edit with credential input fields (auto-mask on save)
- [ ] T089 [US6] Create `frontend/src/app/(dashboard)/assets/page.tsx` — Assets overview page: summary cards for financial/physical/digital counts and total estimated values, quick navigation to sub-pages, recent changes feed

**Checkpoint**: All three asset categories complete with encryption and audit logging.

---

## Phase 11: User Story 7 — Secure Document Vault (Priority: P2)

**Goal**: Users can upload, organize, encrypt, and manage documents with versioning and permissions

**Independent Test**: Upload file → validate types → encrypt → organize in folders → download via signed URL → version → share with beneficiary

### Implementation for User Story 7

- [ ] T090 [P] [US7] Create `backend/src/services/document.service.ts` — DocumentService: `upload(userId, file, folderId?)` → validate file (validateFile util: type whitelist PDF/JPEG/PNG/GIF/WEBP/TXT/DOC/DOCX/XLS/XLSX, extension, magic bytes, size ≤ 50MB per FR-H002), encrypt file with AES-256-GCM, upload to S3 with private ACL, create Document + DocumentVersion records, log audit. `download(id, userId)` → ownership check, generate signed URL (15min expiry per contracts), log access in audit. `preview(id, userId)` → generate preview data for PDF/images. `updateMetadata(id, userId, data)`. `delete(id, userId)` → soft delete, log audit. `uploadNewVersion(id, userId, file)` → validate, encrypt, store, create DocumentVersion, update currentVersionId. `listVersions(id, userId)`. `share(id, userId, beneficiaryId)` → create BeneficiaryAssignment, log audit. `unshare(id, userId, beneficiaryId)`. `listByFolder(userId, folderId?)`
- [ ] T091 [P] [US7] Create `backend/src/services/folder.service.ts` — FolderService: `create(userId, name, parentId?)` → enforce unique name per parent per user (userId+parentId+name constraint). `rename(id, userId, name)`. `move(id, userId, newParentId)`. `delete(id, userId)` → soft delete (check for documents inside, require confirmation). `list(userId)` → return folder tree
- [ ] T092 [P] [US7] Create `backend/src/middleware/upload.middleware.ts` — Multer configuration: memory storage, file size limit 50MB for documents (500MB for videos), single file upload. File filter rejecting executables
- [ ] T093 [US7] Create `backend/src/controllers/document.controller.ts` — Handlers for all document and folder endpoints per api-contracts.md. Upload endpoint uses multipart/form-data with upload middleware
- [ ] T094 [US7] Create `backend/src/routes/v1/documents.routes.ts` — Mount with auth middleware and upload middleware for upload endpoints
- [ ] T095 [P] [US7] Create `frontend/src/app/(dashboard)/documents/page.tsx` — Document vault UI: folder tree sidebar, document grid/list view (toggle), upload dropzone with drag-and-drop, file type icons, size display, upload progress bar, folder creation dialog, document actions (download, share, delete, version history). Empty state guidance. Skeleton loading. Dark theme with glassmorphism cards
- [ ] T096 [US7] Create `frontend/src/components/shared/file-upload.tsx` — Reusable file upload component: drag-and-drop zone, file type/size validation preview, upload progress, error display, Framer Motion animation for drop state

**Checkpoint**: Secure document vault with upload validation, encryption, folders, versioning, and signed URL downloads.

---

## Phase 12: User Story 18 — Assigning Assets and Documents to Beneficiaries (Priority: P2)

**Goal**: Users can assign beneficiaries to assets/documents with allocation constraints

**Independent Test**: Assign beneficiary to asset → set allocation → attempt over-allocation → verify constraint → token generation

### Implementation for User Story 18

- [ ] T097 [P] [US18] Create `backend/src/services/assignment.service.ts` — AssignmentService: `assign(userId, beneficiaryId, resourceType, resourceId, allocationPercentage?)` → verify ownership of both beneficiary and resource, check existing allocations sum + new ≤ 100% (422 on violation per FR-D005), create BeneficiaryAssignment, log audit. `unassign(assignmentId, userId)` → verify ownership, delete, log audit. `listByResource(resourceType, resourceId, userId)`. `listByBeneficiary(beneficiaryId, userId)`. `generateAccessToken(beneficiaryId, userId, scope)` → generate crypto random token, hash with SHA-256, store BeneficiaryAccessToken with scope JSONB (resource IDs and types), set expiry (configurable, default 7 days), return unhashed token to caller. `revokeToken(tokenId, userId)` → set revokedAt. Constitution VII: allocation constraints
- [ ] T098 [US18] Create `backend/src/controllers/assignment.controller.ts` — Handlers: POST `/assets/:type/:id/assign`, DELETE `/assets/:type/:id/assign/:assignmentId`, GET `/assets/:type/:id/assignments`, POST `/beneficiaries/:id/tokens`, DELETE `/beneficiaries/:id/tokens/:tokenId`
- [ ] T099 [US18] Add assignment UI to `frontend/src/app/(dashboard)/beneficiaries/[id]/page.tsx` — "Assign to Asset" dialog: select asset type (financial/physical/digital/document), select specific asset, set allocation percentage. Display current assignments with allocation bars. Warning when approaching 100%
- [ ] T100 [US18] Create `backend/src/routes/v1/beneficiary-access.routes.ts` — Token-based beneficiary access routes (NO auth middleware — token-based): GET `/access/:token` (validate token → list accessible resources), GET `/access/:token/documents/:id` (verify resource in token scope → signed download URL), GET `/access/:token/assets/:type/:id` (verify scope → return asset data masked appropriately). All access logged to audit trail
- [ ] T101 [US18] Create `frontend/src/app/(beneficiary)/access/[token]/page.tsx` — Beneficiary access page (public, no login required): validate token via API, display accessible resources list, download buttons for documents, read-only asset views. Clean, simple UI with LegacyVault branding. Show expiry timer

**Checkpoint**: Beneficiary assignments with allocation constraints and token-based access fully operational.

---

## Phase 13: User Story 20 — Final Review and Legacy Plan Completion (Priority: P2)

**Goal**: Users can perform a comprehensive final review ensuring completeness

**Independent Test**: Complete plan with beneficiaries + assets + documents → review → verify completeness indicators → finalize

### Implementation for User Story 20

- [ ] T102 [US20] Extend `backend/src/services/legacy-plan.service.ts` `getReview()` method — compute cross-entity completeness: check beneficiary count, asset assignment coverage, document attachment status, allocation totals per asset, incomplete wizard steps. Return structured completeness report with section-level scores and warnings
- [ ] T103 [US20] Update `frontend/src/app/(dashboard)/legacy-plan/steps/review.tsx` — Enhanced review step: show cross-entity completeness (beneficiary list with allocations, asset coverage chart, document attachment status), section-level completion percentages, warning badges for incomplete items, actionable links ("Add more beneficiaries", "Complete financial assets"), summary statistics card

**Checkpoint**: Comprehensive review with cross-entity completeness indicators operational.

---

## Phase 14: User Story 8 — AI Assistant for Legacy Planning (Priority: P2)

**Goal**: AI-powered conversational assistant providing legacy planning guidance

**Independent Test**: Open assistant → ask about legacy planning → receive guidance with disclaimer → verify server-side AI call

### Implementation for User Story 8

- [ ] T104 [P] [US8] Create `backend/src/services/ai/ai-provider.interface.ts` — AIProvider interface: `generateResponse(prompt: string, options?: { systemPrompt?, temperature?, maxTokens?, model? }): Promise<{ content: string, tokenCount: number, model: string, provider: string }>`. AIProviderConfig type. Constitution VI: provider abstraction
- [ ] T105 [P] [US8] Create `backend/src/services/ai/openai.provider.ts` — OpenAIProvider implementing AIProvider: uses openai SDK, reads OPENAI_API_KEY from env (never client-side per Constitution VI), handles rate limits, retries with backoff, error mapping
- [ ] T106 [P] [US8] Create `backend/src/services/ai/gemini.provider.ts` — GeminiProvider implementing AIProvider: uses @google/generative-ai SDK, reads GEMINI_API_KEY from env, handles rate limits, retries, error mapping
- [ ] T107 [US8] Create `backend/src/services/ai/ai-provider.factory.ts` — Factory function: `getProvider(providerName?: string): AIProvider`. Default from AI_DEFAULT_PROVIDER env var. Fallback logic if primary provider fails (FR-R010)
- [ ] T108 [P] [US8] Create `backend/src/services/ai/ai-validation.service.ts` — AIValidationService: `validateResponse(response, context)` → check for hallucination indicators (fabricated references, unsupported claims), flag uncertainty, assess completeness, return `{ isValid: boolean, warnings: string[], confidenceScore: number }`. Constitution VI: detect unsupported claims, hallucinations
- [ ] T109 [US8] Create `backend/src/services/ai/ai-assistant.service.ts` — AIAssistantService: `chat(userId, message, conversationHistory?)` → construct system prompt (legacy planning domain expert, never claim to be a lawyer, always recommend professional legal counsel), call AI provider, validate response, create AIInteraction record (sanitized — no raw PII in logs per Constitution XVI), return response with disclaimer. FR-L007: disclaimer in every response
- [ ] T110 [US8] Create `backend/src/controllers/ai.controller.ts` — Handlers: POST `/ai/assistant/message`, GET `/ai/assistant/history`. Rate limited (AI cost control)
- [ ] T111 [US8] Create `backend/src/routes/v1/ai.routes.ts` — Mount with auth middleware and AI-specific rate limiter
- [ ] T112 [P] [US8] Create `frontend/src/app/(dashboard)/ai/assistant/page.tsx` — AI chat interface: message list with user/assistant bubbles, input with send button, streaming response display, disclaimer banner at top ("AI Assistant — not legal advice"), conversation history, loading skeleton, dark theme with glassmorphism message cards, Framer Motion message animations. Constitution XIII
- [ ] T113 [P] [US8] Create `frontend/src/components/shared/ai-disclaimer.tsx` — Reusable AI disclaimer component: "This AI assistant provides informational guidance only. It does not constitute legal advice. Consult a qualified attorney for legal matters." Styled as a subtle but always-visible banner

**Checkpoint**: AI assistant providing conversational guidance with provider abstraction and disclaimers.

---

## Phase 15: User Story 14 — Security Center (Priority: P2)

**Goal**: Users can view and manage their security posture — sessions, login history, MFA, password

**Independent Test**: View active sessions → revoke one → view login history → change password → verify MFA management

### Implementation for User Story 14

- [ ] T114 [P] [US14] Create `backend/src/services/security.service.ts` — SecurityService: `getActiveSessions(userId)` → list active sessions with device info, IP, location, lastActive. `revokeSession(sessionId, userId)` → verify ownership, delete session, log audit. `getLoginHistory(userId, pagination)` → query AuditLog for auth events. `getSecurityAuditHistory(userId, pagination)` → query AuditLog for security-sensitive events. `getSecurityStatus(userId)` → compute security score (MFA enabled +30, email verified +20, strong password +20, recent sessions reviewed +15, backup codes generated +15). FR-O009: security score
- [ ] T115 [US14] Create `backend/src/controllers/security.controller.ts` — Handlers: GET `/security/sessions`, DELETE `/security/sessions/:id`, GET `/security/login-history`, GET `/security/audit-history`, GET `/security/status`
- [ ] T116 [US14] Create `backend/src/routes/v1/security.routes.ts` — Mount with auth middleware
- [ ] T117 [P] [US14] Create `frontend/src/app/(dashboard)/security-center/page.tsx` — Security Center dashboard: security score ring/gauge with breakdown, active sessions list with device icons and revoke buttons, recent login timeline, quick-action cards (change password, manage MFA, review backup codes). Dark theme with blue/cyan accent highlights, Framer Motion number counter animation for score
- [ ] T118 [US14] Create `frontend/src/app/(dashboard)/settings/page.tsx` — Settings page: profile management (name, email with re-auth), password change form (current + new + confirm with re-auth), notification preferences toggles, display preferences (theme, date format, currency)

**Checkpoint**: Security Center with session management, login history, and security score operational.

---

## Phase 16: User Story 9 — AI Will Generator (Priority: P3)

**Goal**: AI generates will drafts from user's plan data with editing, confirmation, and PDF export

**Independent Test**: Generate draft → review → edit → regenerate → confirm → export PDF

### Implementation for User Story 9

- [ ] T119 [P] [US9] Create `backend/src/services/ai/ai-will-generator.service.ts` — AIWillGeneratorService: `generateDraft(userId)` → load user's legacy plan + beneficiaries + assets, construct structured prompt, call AI provider, validate response for hallucinations and unsupported claims, create AIInteraction with confirmationStatus=PENDING, return draft with confidence indicators. `editDraft(interactionId, userId, edits)` → update draft content. `regenerateDraft(interactionId, userId, instructions?)` → re-generate with optional user instructions. `confirmDraft(interactionId, userId)` → set confirmationStatus=CONFIRMED, persist as part of legacy plan, log audit. FR-M010: explicit confirmation. `exportPdf(interactionId, userId)` → render draft to PDF using @react-pdf/renderer. Constitution V: never claim legal validity
- [ ] T120 [US9] Add AI Will Generator handlers to `backend/src/controllers/ai.controller.ts` — POST `/ai/will-generator/generate`, PATCH `/ai/will-generator/:id/edit`, POST `/ai/will-generator/:id/regenerate`, POST `/ai/will-generator/:id/confirm`, GET `/ai/will-generator/:id/export`
- [ ] T121 [P] [US9] Create `frontend/src/app/(dashboard)/ai/will-generator/page.tsx` — Will generator page: "Generate Draft" CTA (if no draft), draft viewer with section-by-section display, inline editing, confidence indicators per section, "Regenerate" button with optional instructions, "Confirm and Save" with confirmation dialog, "Export PDF" button. AI-generated content labels (FR-M013). Legal disclaimer banner (FR-M014). Dark theme with subtle gradient sections
- [ ] T122 [US9] Create `backend/src/services/ai/pdf-export.service.ts` — PDFExportService: render confirmed will draft to PDF with header (LegacyVault AI branding), sections, beneficiary details, asset lists, signature lines, disclaimer footer ("AI-generated draft — consult legal counsel"), timestamp

**Checkpoint**: AI-powered will generation with editing, confirmation gates, and PDF export.

---

## Phase 17: User Story 10 — Dead Man Switch Configuration (Priority: P3)

**Goal**: Users can configure the Dead Man Switch state machine with check-in parameters and release scope

**Independent Test**: Configure DMS → set schedule → select release scope → verify status display

### Implementation for User Story 10

- [ ] T123 [P] [US10] Create `backend/src/validators/dms.validators.ts` — Zod schemas: `configureDeadManSwitchSchema` (inactivityPeriodDays: number.int.min(7).max(365), checkInFrequencyDays: number.int.min(1).max(90), escalationDelayHours: number.int.min(1).max(168).default(24), trustedContacts: array of { name, email, phone? }.min(1), releaseScope: { documentIds: uuid[], assetIds: uuid[], planSections: string[] }), `updateDeadManSwitchSchema` (partial)
- [ ] T124 [P] [US10] Create `backend/src/services/dead-man-switch.service.ts` — DeadManSwitchService: `configure(userId, data)` → validate releaseScope references valid owned resources, create/update DeadManSwitch (userId UNIQUE constraint — one per user), set status ACTIVE, calculate nextCheckInAt, create DeadManSwitchEvent (CONFIG_CHANGE), schedule first check-in job, log audit. `getConfig(userId)`. `updateConfig(userId, data)` → re-validate scope, update, log event. `pause(userId)` → set status PAUSED, record pausedAt, cancel scheduled jobs, log event. `resume(userId)` → set status ACTIVE, calculate nextCheckInAt, schedule job, log event. `disable(userId)` → requireReAuth, set status INACTIVE, cancel jobs, log event. `getEvents(userId)` → list DMS events. State machine transitions per data-model.md
- [ ] T125 [US10] Create `backend/src/controllers/dms.controller.ts` — Handlers per api-contracts.md: GET, POST, PATCH, POST `/pause`, POST `/resume`, DELETE (with re-auth), GET `/events`
- [ ] T126 [US10] Create `backend/src/routes/v1/dead-man-switch.routes.ts` — Mount with auth middleware, DELETE with requireReAuth
- [ ] T127 [P] [US10] Create `frontend/src/app/(dashboard)/dead-man-switch/page.tsx` — DMS configuration page: setup form (inactivity period slider, check-in frequency, trusted contacts list with add/remove, release scope resource selector), status dashboard (current state badge, next check-in countdown timer, event timeline), action buttons (pause/resume/disable). Dark theme with cyan accent for timer, Framer Motion countdown animation

**Checkpoint**: Dead Man Switch configurable with state machine and release scope selection.

---

## Phase 18: User Story 19 — Responding to Dead Man Switch Check-ins (Priority: P3)

**Goal**: Background jobs send check-in reminders; users can check in; missed check-ins trigger escalation

**Independent Test**: DMS active → check-in notification → respond → verify timer reset. Simulate miss → verify escalation

### Implementation for User Story 19

- [ ] T128 [P] [US19] Create `backend/src/jobs/dms-checkin.job.ts` — BullMQ job handler: query DeadManSwitch records where status=ACTIVE and nextCheckInAt ≤ now, for each: send check-in reminder notification, update status to REMINDER_SENT, create DeadManSwitchEvent. Job must be idempotent (safe to retry). Schedule as recurring job (runs every hour)
- [ ] T129 [P] [US19] Create `backend/src/jobs/dms-escalation.job.ts` — BullMQ job handler: query DeadManSwitch where status in (REMINDER_SENT, GRACE_PERIOD, ESCALATING), check if deadline passed, advance state machine per data-model.md. REMINDER_SENT past window → GRACE_PERIOD. GRACE_PERIOD expired → ESCALATING (send trusted contact notifications). ESCALATING steps exhausted → RELEASING (execute conditional release of scoped resources). Create DeadManSwitchEvent for each transition. Job must be idempotent
- [ ] T130 [US19] Create `backend/src/services/dead-man-switch.service.ts` check-in method — `checkIn(userId, verificationData)` → verify identity (password/MFA), update status to ACTIVE, reset nextCheckInAt, reset currentEscalationStep, create DeadManSwitchEvent (CHECK_IN), log audit. `cancelEscalation(userId, verificationData)` → verify identity, set status ACTIVE, reset escalation state, create event (RECOVERY), log audit. FR-I007: recovery at every stage
- [ ] T131 [US19] Create `backend/src/jobs/dms-release.job.ts` — BullMQ job handler: for DeadManSwitch in RELEASING state, read releaseScope, generate BeneficiaryAccessTokens for each trusted contact scoped to selected resources, send release notification emails with access links, update status to RELEASED, create DeadManSwitchEvent (RELEASE), log audit. Release ONLY pre-authorized resources (FR-I012). Never full account access
- [ ] T132 [US19] Create `backend/src/config/queue.ts` — BullMQ queue configuration: connect to Redis, create named queues (dms-checkin, dms-escalation, dms-release, notifications), configure default job options (attempts: 3, backoff: exponential), worker setup
- [ ] T133 [US19] Add check-in response UI to `frontend/src/app/(dashboard)/dead-man-switch/page.tsx` — "Check In Now" button with identity verification dialog (password + MFA if enabled), success confirmation with timer reset display, escalation warning banner if in grace period or escalating state
- [ ] T183 [P] [US19] Create `backend/src/jobs/dms-health-check.job.ts` — BullMQ recurring job (runs every 15 minutes): verify dms-checkin and dms-escalation jobs are running and not stalled. If a scheduled job has not executed within 2× its expected interval, log a CRITICAL audit event (`action: 'dms.job_health_failure'`), send alert notification to Super Admin. Prevents silent DMS failures that could cause false escalations. NFR-AVL-002

**Checkpoint**: Full DMS lifecycle operational with background jobs, check-ins, escalation, scoped release, and job health monitoring.

---

## Phase 19: User Story 11 — Emergency Access (Priority: P3)

**Goal**: Emergency contacts can request time-limited, scoped access with multi-step verification

**Independent Test**: Configure contact → request access (as contact) → verify OTP → owner approves → access resources → verify expiry

### Implementation for User Story 11

- [ ] T134 [P] [US11] Create `backend/src/validators/emergency-access.validators.ts` — Zod schemas: `configureContactSchema` (contactName, contactEmail, contactPhone?, accessScope: { documentIds, assetIds }, verificationMethod: enum EMAIL_OTP|MFA default EMAIL_OTP, autoGrantTimeoutHours: number.int.min(1).max(168).optional), `requestAccessSchema` (configId, requesterEmail), `verifyAccessSchema` (requestId, verificationCode: string.length(6))
- [ ] T135 [P] [US11] Create `backend/src/services/emergency-access.service.ts` — EmergencyAccessService: `configureContact(userId, data)` → create EmergencyAccessConfig, log audit. `updateContact(id, userId, data)`. `removeContact(id, userId)` → soft delete. `listContacts(userId)`. `requestAccess(configId, requesterEmail)` → validate email matches config, generate OTP (6-digit), hash and store, set 15-min expiry, send OTP email, create EmergencyAccessRequest (PENDING → VERIFYING), notify owner, log audit. `verifyAccess(requestId, code)` → verify OTP (max 3 attempts per FR edge case), set status VERIFIED, log audit. `approveRequest(requestId, userId)` → verify owner, set status APPROVED → ACTIVE, calculate expiresAt (configurable), generate scoped BeneficiaryAccessToken, log audit. `denyRequest(requestId, userId)`. `revokeAccess(requestId, userId)`. State machine per data-model.md
- [ ] T136 [US11] Create `backend/src/jobs/emergency-access-timeout.job.ts` — BullMQ job: query VERIFIED requests where autoGrantTimeout has passed and owner hasn't responded → set status AUTO_GRANTED → ACTIVE, generate scoped token, notify contact, log audit (FR-J006)
- [ ] T137 [US11] Create `backend/src/jobs/emergency-access-expiry.job.ts` — BullMQ job: query ACTIVE emergency access where expiresAt ≤ now → set status EXPIRED, revoke tokens, log audit (FR-J008)
- [ ] T138 [US11] Create `backend/src/controllers/emergency-access.controller.ts` — All handlers per api-contracts.md including public request/verify endpoints (no auth) and owner management endpoints (auth required)
- [ ] T139 [US11] Create `backend/src/routes/v1/emergency-access.routes.ts` — Mount: public routes (request, verify) without auth, owner routes with auth
- [ ] T140 [P] [US11] Create `frontend/src/app/(dashboard)/emergency-access/page.tsx` — Emergency access config page: contact list with access scope display, add/edit contact dialog with resource scope selector, pending requests section with approve/deny buttons, active access list with revoke buttons, event history timeline

**Checkpoint**: Emergency access with multi-step verification, owner approval, time-limited access, and auto-expiry.

---

## Phase 20: User Story 12 — Video Legacy (Priority: P3)

**Goal**: Users can upload, encrypt, and assign video messages with delivery conditions

**Independent Test**: Upload video → assign to beneficiary → set delivery condition → verify encrypted storage

### Implementation for User Story 12

- [ ] T141 [P] [US12] Create `backend/src/services/video-legacy.service.ts` — VideoLegacyService: `upload(userId, file)` → validate (MP4/WebM/MOV, ≤500MB per FR-K002, magic bytes), encrypt with AES-256-GCM, upload to S3 (multipart for large files), create VideoMessage record, log audit. `getById(id, userId)`. `updateMetadata(id, userId, data)`. `delete(id, userId)` → soft delete. `list(userId)`. `assignBeneficiary(videoId, userId, beneficiaryId, deliveryCondition)` → create BeneficiaryAssignment with resourceType=VIDEO_MESSAGE. `unassignBeneficiary(videoId, userId, beneficiaryId)`
- [ ] T142 [US12] Create `backend/src/controllers/video-legacy.controller.ts` — Handlers: POST `/videos/upload` (multipart, upload middleware with 500MB limit), GET/PATCH/DELETE `/videos/:id`, POST/DELETE `/videos/:id/assign`
- [ ] T143 [US12] Create `backend/src/routes/v1/video-legacy.routes.ts` — Mount with auth and upload middleware (500MB limit)
- [ ] T144 [P] [US12] Create `frontend/src/app/(dashboard)/video-legacy/page.tsx` — Video legacy page: video grid with thumbnails (generated or placeholder), upload with progress bar and chunked upload for large files, metadata editor dialog (title, description, recipient, delivery condition dropdown), beneficiary assignment, delivery condition badges. Dark theme with video player modal

**Checkpoint**: Video upload, encryption, assignment, and delivery condition management complete.

---

## Phase 21: User Story 13 — AI Document Analysis (Priority: P3)

**Goal**: AI analyzes uploaded documents to extract assets, beneficiaries, dates, and figures

**Independent Test**: Upload document → analyze → view extracted findings with confidence → confirm selected findings

### Implementation for User Story 13

- [ ] T145 [P] [US13] Create `backend/src/services/ai/ai-document-analysis.service.ts` — AIDocumentAnalysisService: `analyze(userId, documentId)` → verify document ownership, retrieve document from vault, extract text content (PDF text extraction, OCR hook for images per FR-N003), construct analysis prompt, call AI provider, validate response, return findings with confidence indicators (FR-N006). Findings structure: `{ assets: [], beneficiaries: [], dates: [], figures: [], summary: string, confidence: number }`. Create AIInteraction with confirmationStatus=PENDING. `confirmFindings(interactionId, userId, selectedFindings)` → persist selected findings to user's plan/assets (FR-N007), set confirmationStatus=CONFIRMED, log audit. FR-N008: no auto-persistence
- [ ] T146 [US13] Add document analysis handlers to `backend/src/controllers/ai.controller.ts` — POST `/ai/document-analysis/analyze` (accepts documentId), POST `/ai/document-analysis/:id/confirm`
- [ ] T147 [P] [US13] Create `frontend/src/app/(dashboard)/ai/document-analysis/page.tsx` — Document analysis page: document selector (from vault), "Analyze" button, results display with categorized findings (assets, beneficiaries, dates, figures), confidence bars per finding, checkboxes to select findings for import, "Confirm Selected" button, summary view. AI disclaimer banner

**Checkpoint**: AI document analysis with confidence indicators and selective confirmation.

---

## Phase 22: User Story 15 — Platform Administration (Priority: P3)

**Goal**: Super Admin dashboard for user management, audit logs, analytics, and support

**Independent Test**: Login as Super Admin → manage users → view audit logs → view analytics → perform support operations

### Implementation for User Story 15

- [ ] T148 [P] [US15] Create `backend/src/services/admin.service.ts` — AdminService: `listUsers(filters, pagination)` → search/filter users (email, name, role, status). `getUserById(id)` → full user details (masked sensitive fields). `assignRole(id, role)` → update user role, log audit (FR-P004). `unlockAccount(id)` → reset failedLoginAttempts=0, lockedUntil=null, log audit (FR-P007). `resetUserMfa(id)` → disable MFA, clear secret/backup codes, log audit (FR-P007). `getAnalytics()` → user registrations (by day/week/month), active users, total storage usage, plan statistics. `getPlatformAuditLogs(filters, pagination)` → query all AuditLog entries with filters
- [ ] T149 [US15] Create `backend/src/controllers/admin.controller.ts` — Handlers: GET `/admin/users`, GET `/admin/users/:id`, PATCH `/admin/users/:id/role`, POST `/admin/users/:id/unlock`, POST `/admin/users/:id/reset-mfa`, GET `/admin/analytics`, GET `/admin/analytics/registrations`, GET `/admin/analytics/storage`. All require Super Admin role
- [ ] T150 [US15] Create `backend/src/routes/v1/admin.routes.ts` — Mount with auth + requireRole(['SUPER_ADMIN']) middleware on all routes (FR-P012: backend authorization)
- [ ] T151 [P] [US15] Create `frontend/src/app/(admin)/admin/page.tsx` — Admin dashboard: user count card, active users card, storage usage card, recent registrations chart (line/bar), quick-action links. Dark theme admin layout with purple accents
- [ ] T152 [P] [US15] Create `frontend/src/app/(admin)/admin/users/page.tsx` — User management: searchable data table (name, email, role, status, last login), row actions (assign role, unlock, reset MFA), role assignment dialog, bulk actions
- [ ] T153 [P] [US15] Create `frontend/src/app/(admin)/admin/audit-logs/page.tsx` — Platform audit log viewer: filterable table (actor, action, resource, outcome, date), date range picker, action type filter, export capability
- [ ] T154 [US15] Create `frontend/src/app/(admin)/layout.tsx` — Admin route group layout: verify Super Admin role client-side (UX only — backend enforces), admin-specific sidebar navigation, redirect non-admins to dashboard

**Checkpoint**: Super Admin can manage users, view analytics, and access platform-wide audit logs.

---

## Phase 23: Notifications System

**Purpose**: Implement notification abstraction and all notification events

- [ ] T155 [P] Create `backend/src/services/notification.service.ts` — NotificationService: `send(userId, type, title, content, channel, metadata?)` → create Notification record, dispatch to channel (email via EmailService, in-app via DB insert). `markRead(id, userId)`. `markAllRead(userId)`. `getUnreadCount(userId)`. `list(userId, pagination)`. Retry with exponential backoff (3 attempts) for email delivery failures
- [ ] T156 Create `backend/src/controllers/notification.controller.ts` — Handlers: GET `/notifications`, GET `/notifications/unread-count`, PATCH `/notifications/:id/read`, POST `/notifications/read-all`
- [ ] T157 Create `backend/src/routes/v1/notifications.routes.ts` — Mount with auth middleware
- [ ] T158 [P] Create `frontend/src/components/layout/notification-bell.tsx` — Notification bell component in header: unread count badge, dropdown panel with notification list, mark-as-read action, "View All" link, real-time count update via polling (30s interval). Framer Motion badge bounce animation
- [ ] T159 Create `frontend/src/app/(dashboard)/notifications/page.tsx` — Full notifications page: notification list with type icons, timestamps, read/unread styling, mark-all-read button, infinite scroll pagination
- [ ] T160 Wire notification events throughout existing services — Add notification calls to: auth.service (new device login, failed attempts), beneficiary.service (invitation), dead-man-switch.service (check-in reminders, escalation), emergency-access.service (request received, access granted/denied), document.service (shared with beneficiary), dms-release (conditional release)

**Checkpoint**: Notification system operational with email and in-app channels across all modules.

---

## Phase 24: User Audit Log Access

**Purpose**: Users can view their own audit trail

- [ ] T161 Create `backend/src/controllers/audit-log.controller.ts` — Handler: GET `/audit-logs` with pagination + filters (action type, date range, resource type). Scoped to authenticated user's own logs only
- [ ] T162 Create `backend/src/routes/v1/audit-logs.routes.ts` — Mount with auth middleware
- [ ] T163 Create `frontend/src/app/(dashboard)/settings/audit-log/page.tsx` — User audit log page: filterable timeline/table view of user's own actions, date range picker, action type filter, expandable details per entry

**Checkpoint**: Users can view their own activity history.

---

## Phase 25: Polish & Cross-Cutting Concerns

**Purpose**: UI refinement, performance optimization, security hardening

- [ ] T164 [P] Create `frontend/src/components/shared/page-transition.tsx` — Framer Motion page transition wrapper with fade + slide animation for route changes (UX-010)
- [ ] T165 [P] Create `frontend/src/components/shared/skeleton-loader.tsx` — Reusable skeleton loading components matching each data layout (card skeleton, table skeleton, list skeleton, form skeleton). Used across all pages (UX-012)
- [ ] T166 [P] Create `frontend/src/components/shared/empty-state.tsx` — Reusable empty state component with illustration, message, and action CTA. Used for: no beneficiaries, no assets, no documents, no notifications, no plans
- [ ] T167 [P] Create `frontend/src/components/shared/confirmation-dialog.tsx` — Reusable confirmation dialog for destructive/authoritative actions: title, description, confirm/cancel buttons, optional warning icon. Used for: delete, finalize, revoke, disable
- [ ] T168 [P] Add `prefers-reduced-motion` media query check to all Framer Motion and GSAP animations in `frontend/src/hooks/use-reduced-motion.ts`. Constitution XIV: respect user preferences
- [ ] T169 [P] Create `frontend/src/app/page.tsx` — Landing page: hero section with animated gradient, feature highlights (3-4 cards with icons), security badges, CTA buttons (Register, Learn More), responsive layout. Premium dark design with GSAP scroll animations
- [ ] T170 Perform responsive layout audit on all pages — verify proper display on desktop (1440px), tablet (768px), and mobile (375px) breakpoints. Fix any overflow, truncation, or layout issues. Constitution XIV
- [ ] T171 [P] Audit all API error responses across all controllers — verify no stack traces, no database details, no file paths, no internal variable names in error responses. Constitution X
- [ ] T172 [P] Audit all log statements across backend — verify no passwords, tokens, encryption keys, or sensitive PII logged. Constitution XVI
- [ ] T173 Add keyboard navigation support to all interactive elements — tab order, focus styles, enter/escape handling on dialogs, arrow key navigation on lists. Constitution XIV: full keyboard navigation
- [ ] T174 Run `npm audit` and resolve all high/critical dependency vulnerabilities in both `frontend/` and `backend/`
- [ ] T175 Create `docs/SYSTEM_ARCHITECTURE.md` — architecture overview with component diagram, data flow, technology stack, security layers
- [ ] T176 Create `docs/API_SPECIFICATION.md` — full API documentation derived from contracts and implemented endpoints
- [ ] T177 Create `docs/RBAC.md` — role definitions, permission matrix, authorization flow
- [ ] T178 Create `docs/SECURITY.md` — security architecture, encryption approach, session management, threat model
- [ ] T179 [P] Run quickstart.md validation scenarios end-to-end — verify all documented scenarios pass
- [ ] T180 Update `docs/BRAIN.md` with current implemented state, technology decisions from research.md, and architecture from plan.md
- [ ] T184 [P] Implement dark/light theme toggle in `frontend/src/components/layout/theme-toggle.tsx` — Toggle button in dashboard header, persist preference to user's `preferences.theme` field via API and localStorage fallback. Apply `dark`/`light` class to `<html>` element. Default: dark. Respect system `prefers-color-scheme` on first visit. UX-002
- [ ] T185 Conduct pre-production security review checklist covering: authentication flows (registration, login, MFA, password reset), authorization (RBAC enforcement on every endpoint), cross-user data isolation (verify no user can access another user's resources via direct ID manipulation), file access controls (signed URLs, private buckets, no public access), token security (session tokens, beneficiary access tokens, emergency access OTPs), rate limiting (auth endpoints, AI endpoints, sensitive operations), secrets management (no secrets in source control, env vars only), secure HTTP headers (HSTS, CSP, X-Frame-Options, X-Content-Type-Options), error handling (no stack traces/DB details/file paths in responses), OWASP Top 10 (injection, XSS, CSRF, broken auth, security misconfiguration, sensitive data exposure, etc.), dependency vulnerabilities (`npm audit`). Document findings in `docs/SECURITY_REVIEW.md`. NFR-SEC-002
- [ ] T186 [P] Create `scripts/backup-database.sh` — Automated PostgreSQL backup script using `pg_dump`: full database backup with compression, upload to S3 backup bucket, configurable retention policy (default: 30 daily, 12 weekly, 12 monthly), verification step (restore to temp DB and validate table count). Create `scripts/restore-database.sh` for point-in-time restore. NFR-DR-001
- [ ] T187 [P] Create `docs/DISASTER_RECOVERY.md` — Disaster recovery runbook: backup schedule, retention policy, restore procedure (step-by-step), RTO/RPO targets, escalation contacts, restore testing schedule (quarterly), data verification steps post-restore. NFR-DR-002
- [ ] T188 [P] Integrate production error monitoring in `backend/src/config/error-monitoring.ts` — Configure error monitoring service (Sentry or equivalent) with: environment-based DSN from env var (`ERROR_MONITORING_DSN`), release tagging, breadcrumb collection (sanitized — no PII per Constitution XVI), alert rules for error rate spikes, source map upload for stack trace deobfuscation. Attach to Express error handler middleware. NFR-OBS-002
- [ ] T189 Create `backend/src/controllers/user-data.controller.ts` — User data export and account deletion endpoints: GET `/users/me/export` → compile all user data (profile, beneficiaries, assets, documents metadata, plans, AI interactions, audit logs) into structured JSON export, stream as download. DELETE `/users/me` → require re-authentication + confirmation (`confirmed: true`), soft-delete user account (set `deletedAt`), revoke all sessions, cancel active DMS, log audit event. Implement 30-day grace period before hard delete via scheduled job. POST `/users/me/cancel-deletion` → cancel pending deletion within grace period. NFR-CMP-001
- [ ] T190 [P] Create `backend/src/routes/v1/user-data.routes.ts` — Mount user data export/deletion endpoints with auth + requireReAuth middleware
- [ ] T191 [P] Create load test script in `scripts/load-test.ts` — Basic load test using Artillery or k6: simulate 100+ concurrent users performing CRUD operations (create asset, upload document, fetch dashboard), measure p95 response times, verify under 500ms for CRUD operations (SC-004, NFR-PER-002, NFR-SCL-002). Output summary report

**Checkpoint**: All features polished, security audited, backups configured, monitoring integrated, documentation complete, validation scenarios passing.

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies — can start immediately
- **Foundational (Phase 2)**: Depends on Setup completion — BLOCKS all user stories
- **US1 Registration (Phase 3)**: Depends on Foundational
- **US16 Login/MFA (Phase 4)**: Depends on US1 (auth service exists)
- **US2 Legacy Plan (Phase 5)**: Depends on US1 (auth required)
- **US3 Beneficiaries (Phase 6)**: Depends on US1 (auth required)
- **US17 Account Recovery (Phase 7)**: Depends on US1 (auth service extension)
- **US4 Financial Assets (Phase 8)**: Depends on US1 (auth)
- **US5 Physical Assets (Phase 9)**: Depends on US4 (shared asset service)
- **US6 Digital Assets (Phase 10)**: Depends on US4 (shared asset service)
- **US7 Document Vault (Phase 11)**: Depends on US1 (auth), storage config (Phase 2)
- **US18 Assignments (Phase 12)**: Depends on US3 (beneficiaries) + US4-6 (assets) + US7 (documents)
- **US20 Final Review (Phase 13)**: Depends on US2 (plan) + US3 (beneficiaries) + US4-6 (assets)
- **US8 AI Assistant (Phase 14)**: Depends on US1 (auth)
- **US14 Security Center (Phase 15)**: Depends on US1 (auth) + US16 (MFA)
- **US9 AI Will Gen (Phase 16)**: Depends on US2 (plan) + US8 (AI infrastructure)
- **US10 DMS Config (Phase 17)**: Depends on US3 (beneficiaries) + US7 (documents)
- **US19 DMS Check-ins (Phase 18)**: Depends on US10 (DMS config)
- **US11 Emergency Access (Phase 19)**: Depends on US3 (beneficiaries) + US7 (documents)
- **US12 Video Legacy (Phase 20)**: Depends on US3 (beneficiaries), storage config
- **US13 AI Doc Analysis (Phase 21)**: Depends on US7 (vault) + US8 (AI infra)
- **US15 Admin (Phase 22)**: Depends on US1 (auth + RBAC)
- **Notifications (Phase 23)**: Depends on most features (wires events)
- **Audit Access (Phase 24)**: Depends on Phase 2 (audit service)
- **Polish (Phase 25)**: Depends on all user stories

### User Story Dependencies

```
US1 (Registration) ──┬── US16 (Login/MFA)
                     ├── US2 (Legacy Plan) ──── US20 (Final Review)
                     ├── US3 (Beneficiaries) ─┬── US18 (Assignments)
                     │                        ├── US10 (DMS Config) ── US19 (DMS Check-ins)
                     │                        └── US11 (Emergency Access)
                     ├── US4 (Financial) ─┬── US5 (Physical)
                     │                    └── US6 (Digital)
                     ├── US7 (Document Vault) ── US13 (AI Doc Analysis)
                     ├── US8 (AI Assistant) ─── US9 (AI Will Gen)
                     ├── US14 (Security Center)
                     ├── US12 (Video Legacy)
                     ├── US15 (Admin)
                     └── US17 (Account Recovery)
```

### Parallel Opportunities

- **Phase 1**: T003, T004, T005, T006, T007, T008, T009, T010, T011, T012, T013, T014, T015, T016 (all parallel after T001-T002)
- **Phase 2**: T020, T021, T022, T023, T024, T025, T026, T027, T028, T029, T032 (all parallel after T018-T019)
- **Phase 3**: T034, T035, T036, T039, T040-T045 (models/services/pages parallel)
- **After Phase 3**: US4-US6 can run parallel with US7 and US8

---

## Implementation Strategy

### MVP First (Phase 1-3 Only)

1. Complete Phase 1: Setup
2. Complete Phase 2: Foundational (CRITICAL — blocks all)
3. Complete Phase 3: User Story 1 (Registration)
4. **STOP and VALIDATE**: Test registration → verify → login → dashboard
5. Deploy/demo if ready — this is the minimum viable slice

### Incremental Delivery

1. Setup + Foundational → foundation ready
2. US1 Registration → **MVP deployed**
3. US16 Login/MFA + US2 Legacy Plan + US3 Beneficiaries → core value delivered
4. US4-6 Assets + US7 Vault → asset management layer
5. US18 Assignments + US20 Review → cross-entity integration
6. US8 AI Assistant + US14 Security → intelligence + security layer
7. US9-US13 Advanced features → full feature set
8. US15 Admin + Notifications + Polish → production-ready

### Parallel Team Strategy

With multiple developers:

1. Team completes Setup + Foundational together
2. Once Foundational is done:
   - Developer A: US1 → US16 → US14 → US15
   - Developer B: US2 → US20 → US9
   - Developer C: US3 → US4-6 → US18
   - Developer D: US7 → US12 → US13
   - Developer E: US8 → US10 → US19 → US11
3. Stories integrate independently

---

## Notes

- **Total tasks: 191** (T001–T191)
- Tasks T181–T191 were added to resolve findings from `/speckit-analyze` report
- [P] tasks = different files, no dependencies
- [Story] label maps task to specific user story for traceability
- Each user story should be independently completable and testable
- Commit after each task or logical group
- Stop at any checkpoint to validate story independently
- All test tasks omitted — spec does not request TDD. Tests are addressed in Phase 25 (quickstart validation) and can be added per story via `/speckit-tasks` with TDD flag
- FR-L010 (AI voice input) is SHOULD-level and deferred to post-baseline roadmap
- SC-001 (registration < 3min) and SC-002 (90% first-attempt completion) are UX validation metrics — verified via usability testing, not implementation tasks
