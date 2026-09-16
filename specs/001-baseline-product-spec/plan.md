# Implementation Plan: LegacyVault AI — Baseline Product

**Branch**: `001-baseline-product-spec` | **Date**: 2025-09-16 | **Spec**: [spec.md](./spec.md)

**Input**: Baseline product specification from `specs/001-baseline-product-spec/spec.md`

## Summary

LegacyVault AI is a security-first legal-tech SaaS platform enabling users to
securely organize, manage, protect, and transfer their digital and physical
legacy to authorized beneficiaries. The baseline release is individual-user
focused with two roles (User, Super Admin). Beneficiaries access resources via
secure, time-limited, scoped email tokens — no platform accounts required.

The implementation uses a strict frontend/backend separation: Next.js +
TypeScript + Tailwind CSS + shadcn/ui + Framer Motion + GSAP on the frontend,
and Node.js + Express.js + TypeScript with a modular layered architecture on the
backend. PostgreSQL serves as the production data layer. AI features use a
provider abstraction supporting OpenAI and Google Gemini.

## Technical Context

**Language/Version**: TypeScript 5.x (frontend and backend), Node.js 20 LTS

**Primary Dependencies**:
- Frontend: Next.js 14+, Tailwind CSS, shadcn/ui, Framer Motion, GSAP, Zod
- Backend: Express.js, Prisma (ORM), Zod, bcrypt, jsonwebtoken/jose, multer,
  speakeasy (TOTP), nodemailer, winston, helmet, cors, express-rate-limit

**Storage**: PostgreSQL 16+ (primary), S3-compatible object storage (documents
and videos)

**Testing**: Vitest (unit/integration), Supertest (API), Playwright (E2E),
React Testing Library (components)

**Target Platform**: Web application (server-rendered + client-side), deployed
to cloud infrastructure (Linux)

**Project Type**: Full-stack web application (frontend + backend + database)

**Performance Goals**:
- Page load: <3s initial content
- API CRUD: <500ms response under normal load
- Document upload: up to 50 MB without timeout
- Video upload: up to 500 MB without timeout
- Concurrent users: 1,000+ without degradation

**Constraints**:
- All sensitive data encrypted at rest (AES-256) and in transit (TLS 1.2+)
- Zero cross-user data exposure
- AI keys server-side only
- No public bucket access
- WCAG 2.1 AA compliance

**Scale/Scope**:
- 14 core modules, 20 user stories, 150+ functional requirements
- ~60+ pages/views across frontend
- ~80+ API endpoints across 14 domains
- 13 primary database entities

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| # | Principle | Gate Status | Evidence |
|---|-----------|:-----------:|----------|
| I | Security First | ✅ PASS | Server-side auth/authz, secrets in env vars, defense-in-depth, audit logging |
| II | Privacy & Data Protection | ✅ PASS | Encryption at rest/transit, data minimization, no cross-user exposure |
| III | Authentication & Authorization | ✅ PASS | MFA, RBAC (User + Super Admin), server-side enforcement, session management |
| IV | Encryption & Secure Storage | ✅ PASS | AES-256 at rest, TLS 1.2+, private object storage, signed URLs, no hardcoded keys |
| V | Legal-Tech Safety | ✅ PASS | AI disclaimers, user confirmation before persistence, no claims of legal validity |
| VI | AI Safety & Reliability | ✅ PASS | Provider abstraction, server-side keys, validation, hallucination detection, confirmation gates |
| VII | Data Integrity | ✅ PASS | Transactional integrity, allocation constraints, DMS recovery, audit logs |
| VIII | Architecture | ✅ PASS | Strict frontend/backend separation, modular layers, versioned REST API |
| IX | Code Quality | ✅ PASS | TypeScript throughout, consistent structure, no unnecessary deps |
| X | Validation & Error Handling | ✅ PASS | Zod server-side validation, centralized error handler, no stack trace leaks |
| XI | API & Web Security | ✅ PASS | CSRF, rate limiting, file validation (type/size/magic bytes), malware hooks |
| XII | Auditability | ✅ PASS | Comprehensive audit logging, tamper-resistant records, actor/action/resource/outcome |
| XIII | UI/UX | ✅ PASS | Dark-first, glassmorphism, Framer Motion + GSAP, state communication |
| XIV | Accessibility | ✅ PASS | WCAG 2.1 AA, keyboard nav, semantic HTML, responsive layouts |
| XV | Performance | ✅ PASS | Optimized bundles, lazy loading, efficient queries, safe caching |
| XVI | Observability | ✅ PASS | Structured logging, correlation IDs, error monitoring, no sensitive data in logs |
| XVII | Testing | ✅ PASS | Auth, authz, allocation, DMS, emergency, AI validation, encryption tests |
| XVIII | Documentation | ✅ PASS | BRAIN.md, 15 planned docs, clear implemented vs. planned distinction |
| XIX | Git & Change Management | ✅ PASS | No secrets in repo, focused commits, .gitignore configured |
| XX | Development Workflow | ✅ PASS | Full Spec-Driven Development lifecycle followed |
| XXI | Production Readiness | ✅ PASS | HTTPS, secret management, backups, secure headers, rate limiting, monitoring |
| XXII | Decision Priority | ✅ PASS | Security → Privacy → Integrity → Correctness → Safety → Maintainability → Accessibility → Performance → Polish |

**Result**: All 22 gates pass. No violations to justify.

## Project Structure

### Documentation (this feature)

```text
specs/001-baseline-product-spec/
├── spec.md              # Finalized specification
├── plan.md              # This file
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output
├── quickstart.md        # Phase 1 output
├── contracts/           # Phase 1 output (API contracts)
│   ├── auth.md
│   ├── users.md
│   ├── beneficiaries.md
│   ├── assets.md
│   ├── documents.md
│   ├── legacy-plans.md
│   ├── dead-man-switch.md
│   ├── emergency-access.md
│   ├── video-legacy.md
│   ├── ai.md
│   ├── notifications.md
│   ├── security.md
│   ├── audit-logs.md
│   └── admin.md
└── tasks.md             # Phase 2 output (/speckit-tasks — NOT created by /speckit-plan)
```

### Source Code (repository root)

```text
LegacyVault AI/
├── frontend/                          # Next.js application
│   ├── public/                        # Static assets
│   │   ├── fonts/
│   │   └── images/
│   ├── src/
│   │   ├── app/                       # Next.js App Router pages
│   │   │   ├── (auth)/                # Auth route group
│   │   │   │   ├── login/
│   │   │   │   ├── register/
│   │   │   │   ├── verify-email/
│   │   │   │   ├── forgot-password/
│   │   │   │   └── reset-password/
│   │   │   ├── (dashboard)/           # Protected route group
│   │   │   │   ├── dashboard/
│   │   │   │   ├── legacy-plan/       # Create Will stepper
│   │   │   │   ├── beneficiaries/
│   │   │   │   ├── assets/
│   │   │   │   │   ├── financial/
│   │   │   │   │   ├── physical/
│   │   │   │   │   └── digital/
│   │   │   │   ├── documents/         # Secure Document Vault
│   │   │   │   ├── dead-man-switch/
│   │   │   │   ├── emergency-access/
│   │   │   │   ├── video-legacy/
│   │   │   │   ├── ai/
│   │   │   │   │   ├── assistant/
│   │   │   │   │   ├── will-generator/
│   │   │   │   │   └── document-analysis/
│   │   │   │   ├── security-center/
│   │   │   │   └── settings/
│   │   │   ├── (admin)/               # Admin route group
│   │   │   │   ├── admin/
│   │   │   │   │   ├── users/
│   │   │   │   │   ├── audit-logs/
│   │   │   │   │   ├── analytics/
│   │   │   │   │   └── support/
│   │   │   ├── (beneficiary)/         # Beneficiary token-access pages
│   │   │   │   └── access/[token]/
│   │   │   ├── layout.tsx
│   │   │   ├── page.tsx               # Landing page
│   │   │   └── globals.css
│   │   ├── components/
│   │   │   ├── ui/                    # shadcn/ui primitives
│   │   │   ├── layout/                # Shell, sidebar, header, footer
│   │   │   ├── forms/                 # Reusable form components
│   │   │   ├── data-display/          # Tables, cards, lists
│   │   │   ├── feedback/              # Alerts, toasts, modals, confirmations
│   │   │   ├── wizard/                # Stepper/wizard system (Create Will)
│   │   │   └── shared/                # Logos, icons, badges, etc.
│   │   ├── hooks/                     # Custom React hooks
│   │   ├── lib/                       # Utility functions, API client, constants
│   │   ├── services/                  # Frontend service layer (API calls)
│   │   ├── stores/                    # Client state management (Zustand)
│   │   ├── styles/                    # Design tokens, theme config
│   │   └── types/                     # Shared TypeScript types
│   ├── next.config.ts
│   ├── tailwind.config.ts
│   ├── tsconfig.json
│   ├── package.json
│   └── tests/
│       ├── components/
│       └── e2e/
│
├── backend/                           # Express.js application
│   ├── src/
│   │   ├── config/                    # Environment, database, storage, AI config
│   │   ├── middleware/                # Auth, RBAC, rate-limit, error handler, audit, validation
│   │   ├── routes/                    # Express route definitions (v1/)
│   │   │   └── v1/
│   │   │       ├── auth.routes.ts
│   │   │       ├── users.routes.ts
│   │   │       ├── beneficiaries.routes.ts
│   │   │       ├── assets.routes.ts
│   │   │       ├── documents.routes.ts
│   │   │       ├── legacy-plans.routes.ts
│   │   │       ├── dead-man-switch.routes.ts
│   │   │       ├── emergency-access.routes.ts
│   │   │       ├── video-legacy.routes.ts
│   │   │       ├── ai.routes.ts
│   │   │       ├── notifications.routes.ts
│   │   │       ├── security.routes.ts
│   │   │       ├── audit-logs.routes.ts
│   │   │       └── admin.routes.ts
│   │   ├── controllers/              # Request handling, response formatting
│   │   ├── services/                 # Business logic layer
│   │   │   ├── auth.service.ts
│   │   │   ├── user.service.ts
│   │   │   ├── beneficiary.service.ts
│   │   │   ├── asset.service.ts
│   │   │   ├── document.service.ts
│   │   │   ├── legacy-plan.service.ts
│   │   │   ├── dead-man-switch.service.ts
│   │   │   ├── emergency-access.service.ts
│   │   │   ├── video-legacy.service.ts
│   │   │   ├── notification.service.ts
│   │   │   ├── security.service.ts
│   │   │   └── audit.service.ts
│   │   ├── services/ai/             # AI provider abstraction
│   │   │   ├── ai-provider.interface.ts
│   │   │   ├── openai.provider.ts
│   │   │   ├── gemini.provider.ts
│   │   │   ├── ai-assistant.service.ts
│   │   │   ├── ai-will-generator.service.ts
│   │   │   ├── ai-document-analysis.service.ts
│   │   │   └── ai-validation.service.ts
│   │   ├── repositories/            # Data access layer
│   │   ├── models/                  # Prisma schema, type definitions
│   │   ├── validators/              # Zod schemas per domain
│   │   ├── utils/                   # Crypto, file-validation, helpers
│   │   ├── jobs/                    # Background jobs (DMS check-ins, notifications)
│   │   └── app.ts                   # Express app setup
│   ├── prisma/
│   │   └── schema.prisma            # Database schema
│   ├── tsconfig.json
│   ├── package.json
│   └── tests/
│       ├── unit/
│       ├── integration/
│       └── api/
│
├── docs/                             # Project documentation
│   ├── BRAIN.md                      # Project knowledge (exists)
│   ├── PRD.md                        # Product Requirements Document
│   ├── FRD.md                        # Functional Requirements Document
│   ├── SYSTEM_ARCHITECTURE.md
│   ├── DATABASE_SCHEMA.md
│   ├── API_SPECIFICATION.md
│   ├── UI_UX_GUIDELINES.md
│   ├── FEATURES.md
│   ├── BUSINESS_RULES.md
│   ├── RBAC.md
│   ├── SECURITY.md
│   ├── AI_MODULE.md
│   ├── DEPLOYMENT.md
│   ├── ROADMAP.md
│   └── CHANGELOG.md
│
├── scripts/                          # Build, deploy, maintenance scripts
├── .github/                          # CI/CD workflows
│   └── workflows/
├── .specify/                         # Spec Kit infrastructure (exists)
├── specs/                            # Feature specifications (exists)
├── .env.example                      # Environment variable template
└── .gitignore                        # (exists — update for new structure)
```

**Structure Decision**: Web application (Option 2) — strict frontend/backend
separation with shared TypeScript types where needed. No monorepo tooling
required for the baseline; simple package.json per project.

---

## Development Phases

### Phase 0 — Foundation

**Purpose**: Set up the repository structure, tooling, and development
environment.

**Dependencies**: None (first phase)

**Major Modules**:
- Initialize Next.js project in `frontend/`
- Initialize Express.js project in `backend/`
- Configure TypeScript, ESLint, Prettier for both projects
- Set up Tailwind CSS with design tokens (dark-first theme)
- Install and configure shadcn/ui
- Set up PostgreSQL with Prisma ORM
- Configure environment variable structure (.env.example)
- Set up basic CI/CD pipeline (.github/workflows)
- Create shared types package or directory
- Configure Git hooks (pre-commit linting)

**Security Considerations**:
- .env files in .gitignore from day one
- No secrets in repository
- HTTPS for local development where possible

**Testing Requirements**:
- Vitest configured and running for both projects
- At least one passing smoke test per project
- CI pipeline runs tests on push

**Completion Criteria**:
- Both projects build and start successfully
- Database connection established
- CI pipeline passing
- Design system tokens configured (colors, typography, spacing)

---

### Phase 1 — Authentication & Security

**Purpose**: Implement the full authentication system, session management, and
security middleware.

**Dependencies**: Phase 0

**Major Modules**:
- Registration with email/password (FR-A001, FR-A002)
- Email verification with time-limited tokens (FR-A003, FR-A004)
- Login with server-side credential validation (FR-A005)
- MFA/2FA with TOTP (FR-A006)
- Secure session management with httpOnly cookies (FR-A007, FR-A008)
- Logout with server-side session invalidation (FR-A009)
- Password reset flow (FR-A010, FR-A011)
- Account lockout and rate limiting (FR-A012, FR-A013)
- Authentication event logging (FR-A014)
- Re-authentication middleware for sensitive operations (FR-A018)
- RBAC middleware (User, Super Admin) (FR-Q001, FR-Q002)
- Security headers middleware (Helmet — FR-Q015)
- CSRF protection middleware (FR-Q007)
- Input validation middleware (Zod — FR-Q009)
- Centralized error handler (FR-Q016)
- Audit logging service foundation (FR-Q012)
- Frontend auth pages: login, register, verify-email, forgot-password,
  reset-password, MFA setup

**Security Considerations**:
- Passwords hashed with bcrypt (cost factor ≥12)
- Session tokens: cryptographically random, httpOnly, secure, sameSite
- Rate limiting: 5 attempts per 15 minutes per account, 20 per IP
- Account lockout: 30-minute lockout after 5 failed attempts
- Verification tokens: 24-hour expiry, single-use
- Reset tokens: 1-hour expiry, single-use, invalidates all sessions

**Testing Requirements**:
- Unit tests: password hashing, token generation, RBAC logic
- Integration tests: full registration → verification → login flow
- API tests: all auth endpoints, rate limiting, session management
- Security tests: SQL injection, XSS, CSRF, broken auth, IDOR

**Completion Criteria**:
- Users can register, verify email, log in, enable MFA, log out
- Password reset works end-to-end
- Rate limiting and account lockout functional
- RBAC blocks unauthorized access to protected routes
- All auth events logged in audit trail
- Frontend auth pages functional with proper error handling

---

### Phase 2 — Core Database & User Profile API

**Purpose**: Implement the complete database schema, user profile management,
and foundational API patterns.

**Dependencies**: Phase 1

**Major Modules**:
- Full Prisma schema (all 13+ entities)
- Database indexes, constraints, foreign keys
- Soft-delete strategy (deletedAt timestamps)
- User profile CRUD (FR-B001–FR-B007)
- Notification preferences
- Pagination middleware
- API response formatting standards
- Structured logging with correlation IDs (NFR-OBS-001)
- Health check endpoint

**Security Considerations**:
- Profile changes to email/password require re-authentication (FR-B007)
- No raw SQL — use Prisma parameterized queries
- Sensitive fields encrypted at rest (utility module)
- Field-level encryption for PII where appropriate

**Testing Requirements**:
- Unit tests: encryption/decryption utilities, validators
- Integration tests: user CRUD, profile updates with re-auth
- API tests: all user endpoints, validation error responses

**Completion Criteria**:
- All entities exist in the database with proper constraints
- User profile management fully functional
- Encryption utilities working for sensitive fields
- Pagination, filtering, and sorting patterns established
- Structured logging operational

---

### Phase 3 — Legacy Plan / Create Will

**Purpose**: Implement the multi-step Create Will wizard — the core product
feature.

**Dependencies**: Phase 2

**Major Modules**:
- Legacy Plan API (CRUD, step progression, review, finalization)
- Multi-step wizard backend: step validation, auto-save, draft state
- Version history for finalized plans (FR-C008)
- Frontend stepper/wizard component system
  - Progress indicator with completion status per step
  - Step validation with inline errors
  - Auto-save with debounced persistence
  - Navigation between completed steps
  - Missing-information detection
  - Review screen with comprehensive summary
  - Explicit confirmation modal for finalization
- Steps: Personal Details, Family Information, Beneficiaries, Financial Assets,
  Physical Assets, Digital Assets, Witness Details, Special Wishes, Document
  Attachments, Review, Confirmation
- Optimistic locking for concurrent edit detection (FR edge case)

**Security Considerations**:
- All plan data accessible only by the owning user
- Finalization is irreversible without creating a new draft version
- Auto-save must not persist invalid data as "finalized"
- Version history preserved; no deletion of finalized versions

**Testing Requirements**:
- Unit tests: step validation logic, auto-save debounce, version creation
- Integration tests: full wizard flow from draft to finalization
- API tests: step progression, auto-save, concurrent edit handling
- Frontend tests: stepper component, navigation, validation display

**Completion Criteria**:
- Users can create, progress through, and finalize a legacy plan
- Auto-save preserves data on navigation/idle
- Review step shows all data with completeness indicators
- Finalization requires explicit confirmation and creates a version
- Version history accessible; previous versions read-only

---

### Phase 4 — Beneficiaries & Assets

**Purpose**: Implement beneficiary management and all three asset categories.

**Dependencies**: Phase 3 (beneficiaries referenced in plan steps)

**Major Modules**:
- Beneficiary CRUD (FR-D001–FR-D011)
  - Duplicate detection by email (FR-D003)
  - Allocation percentage enforcement (FR-D004, FR-D005)
  - Asset-specific assignments (FR-D006)
  - Status tracking (active, pending, inactive) (FR-D007)
  - Confirmation before authoritative changes (FR-D008)
  - Audit trail for all changes (FR-D009)
  - Token-based beneficiary access generation (FR-D011)
- Financial Assets CRUD (FR-E001–FR-E005)
  - Category-specific metadata (bank, FD, MF, stocks, insurance, retirement)
  - Encrypted sensitive fields (account/policy numbers)
  - Document attachment links
  - Beneficiary assignment with allocation
- Physical Assets CRUD (FR-F001–FR-F004)
  - Category-specific metadata (real estate, vehicles, valuables, property, business)
  - Multiple document attachments
  - Beneficiary assignment
- Digital Assets CRUD (FR-G001–FR-G005)
  - Encrypted credentials and recovery info (FR-G003)
  - Masked display with re-auth for plaintext viewing (FR-G004)
  - Credential view logging (FR-G005)
- Frontend pages for all modules with proper forms, validation, and tables
- Beneficiary invitation email system (token generation + email)

**Security Considerations**:
- Encrypted fields: account numbers, policy numbers, credentials, recovery info
- Re-authentication required to view decrypted credentials
- Allocation constraints enforced server-side (never trust frontend)
- Beneficiary access tokens: cryptographically random, time-limited, scoped
- All modifications logged in audit trail

**Testing Requirements**:
- Unit tests: allocation constraint logic, encryption/decryption, token generation
- Integration tests: full beneficiary lifecycle, asset CRUD with assignments
- API tests: all CRUD endpoints, allocation validation, encrypted field access
- Security tests: cross-user asset access, token scope enforcement

**Completion Criteria**:
- All beneficiary CRUD operations functional with audit logging
- All three asset categories fully functional with encrypted fields
- Allocation constraints enforced; invalid assignments rejected
- Beneficiary token access generates valid, scoped, time-limited tokens
- Document attachments linked to assets
- Re-auth gate working for sensitive field decryption

---

### Phase 5 — Secure Document Vault

**Purpose**: Implement encrypted document storage, upload validation, folder
organization, permissions, and versioning.

**Dependencies**: Phase 2 (file storage infrastructure), Phase 4 (beneficiary
assignment)

**Major Modules**:
- File upload pipeline (FR-H001–FR-H003)
  - Type validation (allowed MIME types)
  - Extension validation (whitelist)
  - Size validation (max 50 MB)
  - Magic byte verification
  - Malware-scanning integration hook (FR-H016)
- Server-side encryption before storage (FR-H004)
- Private object storage integration (S3-compatible) (FR-H005)
- Folder-based organization (FR-H006)
- Metadata management (FR-H007)
- Preview generation for PDF and images (FR-H008)
- Signed URL generation with configurable expiry (FR-H009)
- Document versioning (FR-H010)
- Permission system: owner, shared beneficiaries, emergency contacts (FR-H011–FR-H014)
- Audit logging for all access events (FR-H015)
- Secure deletion (remove access, maintain audit records) (FR-H017)
- Frontend: vault UI with folder navigation, upload, preview, permission
  management, version history

**Security Considerations**:
- All files encrypted before storage; decryption on authorized download only
- No public bucket access; all access through signed URLs
- Server-side permission enforcement (FR-H012)
- Magic byte verification prevents extension spoofing
- Temporary signed URLs with short expiry (15 minutes default)
- Upload size validated server-side (50 MB limit)
- Malware scanning hook: interface defined, scanner pluggable for production

**Testing Requirements**:
- Unit tests: file validation (type, size, magic bytes), encryption, URL signing
- Integration tests: upload → encrypt → store → retrieve → decrypt pipeline
- API tests: all document endpoints, permission enforcement, version management
- Security tests: unauthorized access, URL manipulation, file type bypass

**Completion Criteria**:
- Documents upload, encrypt, store privately, and serve via signed URLs
- File validation rejects invalid files with clear error messages
- Folder organization functional
- Preview working for PDF and images
- Versioning preserves previous versions
- Permissions enforced server-side
- All access events logged

---

### Phase 6 — Dead Man Switch

**Purpose**: Implement the Dead Man Switch state machine with check-ins,
escalation, scoped conditional release, and recovery.

**Dependencies**: Phase 4 (beneficiary/trusted contacts), Phase 5 (document
release)

**Major Modules**:
- DMS configuration API (FR-I001, FR-I012)
  - Inactivity period, check-in frequency
  - Trusted contact selection
  - Escalation rules with configurable delays
  - Resource selection for conditional release scope
- State machine: Configured → Active → Reminder → Grace Period → Escalation
  → Verification → Conditional Release
- Check-in system (FR-I002–FR-I004)
  - Scheduled notifications (background job)
  - Identity verification on check-in
  - Timer reset on successful check-in
- Escalation sequence (FR-I005–FR-I006)
  - Multi-step: reminder → secondary reminder → trusted contact → release
  - Configurable delays between steps
- Recovery mechanism at every stage (FR-I007–FR-I008)
  - Identity verification for cancellation
  - Prevents unauthorized cancellation
- Pause/resume functionality (FR-I010)
- Status display with next check-in date (FR-I011)
- Conditional release: scoped to pre-authorized resources only (FR-I012)
- Comprehensive audit logging (FR-I009)
- Background job scheduler (cron-based or queue-based)
- Frontend: configuration UI, status dashboard, check-in response page

**Security Considerations**:
- Release MUST never grant full account access
- Only user-selected resources released to designated contacts
- Identity verification required for check-in and recovery
- Multi-step escalation with increasing urgency prevents false triggers
- All state transitions logged
- Background jobs must be idempotent (retry-safe)
- Notification delivery failures handled gracefully

**Testing Requirements**:
- Unit tests: state machine transitions, timer calculations, scope validation
- Integration tests: full lifecycle (configure → check-in → miss → escalate → release)
- API tests: configuration, check-in, recovery, pause/resume
- Security tests: unauthorized cancellation, scope bypass, timer manipulation
- Edge case tests: false triggers, notification failures, concurrent state changes

**Completion Criteria**:
- Full state machine operational
- Check-in notifications sent on schedule
- Escalation sequence fires correctly on missed check-ins
- Recovery cancels escalation at any stage with identity verification
- Conditional release delivers only pre-authorized resources
- All events logged in audit trail
- Background jobs running reliably

---

### Phase 7 — Emergency Access

**Purpose**: Implement emergency contact configuration, access request workflow,
identity verification, scoped access, and automatic expiration.

**Dependencies**: Phase 4 (beneficiaries/contacts), Phase 5 (document
permissions)

**Major Modules**:
- Emergency contact configuration (FR-J001)
  - Contact details and verification requirements
  - Access scope definition (documents, assets, plan sections)
- Access request workflow (FR-J002)
  - Request initiation page (accessible without full account)
  - Multi-step identity verification (email + OTP/MFA) (FR-J003)
- Owner notification system (FR-J004)
  - Notify owner of all requests
  - Owner approve/deny capability (FR-J005)
- Unreachable-owner fallback rules (FR-J006)
  - Configurable timeout before auto-grant per pre-defined rules
- Time-limited, scoped access grants (FR-J007–FR-J008)
  - Automatic expiration with revocation
  - Scoped to explicitly authorized resources
  - No full account access
- Owner revocation at any time (FR-J010)
- Comprehensive audit logging (FR-J009)
- Frontend: emergency contact setup, request page, access dashboard

**Security Considerations**:
- Emergency access MUST NOT bypass user-defined permissions
- Multi-step verification prevents unauthorized requests
- Time-limited access with automatic revocation
- Owner notification ensures awareness
- All events logged for forensic review

**Testing Requirements**:
- Unit tests: verification logic, scope enforcement, expiration calculations
- Integration tests: full request → verify → grant → expire lifecycle
- API tests: all emergency access endpoints
- Security tests: scope bypass, expired access attempts, unauthorized requests

**Completion Criteria**:
- Emergency contacts configurable with access scopes
- Request workflow with multi-step verification functional
- Owner notifications sent for all requests
- Access time-limited and automatically revoked on expiry
- All events logged

---

### Phase 8 — AI Features

**Purpose**: Implement AI provider abstraction, assistant, will generator, and
document analysis.

**Dependencies**: Phase 3 (legacy plan data), Phase 5 (document vault)

**Major Modules**:
- AI Provider Abstraction Layer (FR-R001)
  - Common interface for all providers
  - OpenAI provider implementation
  - Google Gemini provider implementation
  - Provider configuration via environment variables
  - Fallback behavior on provider outage (FR-R010)
- AI Assistant (FR-L001–FR-L010)
  - Conversational interface with message history
  - Legacy planning guidance and terminology explanation
  - Missing information detection from user's plan
  - Product/process question answering
  - Disclaimer display in every response (FR-L007)
  - Voice input integration hook (FR-L010)
- AI Will Generator (FR-M001–FR-M014)
  - Natural language input processing
  - Structured information extraction
  - Draft generation from plan data
  - Clause suggestions based on asset/beneficiary profile
  - Missing information detection and highlighting
  - Draft preview, inline editing, regeneration
  - Validation for internal consistency (FR-M009)
  - Explicit user confirmation before persistence (FR-M010)
  - Version history (FR-M011)
  - PDF export (FR-M012)
  - AI-generated content labeling (FR-M013)
  - Legal disclaimer (FR-M014)
- AI Document Analysis (FR-N001–FR-N008)
  - Secure document content ingestion (FR-N002)
  - Text extraction (PDF) and OCR hooks (images) (FR-N003)
  - Summary generation (FR-N004)
  - Asset/beneficiary/date/figure detection (FR-N005)
  - Confidence indicators for uncertain findings (FR-N006)
  - User confirmation before persistence (FR-N007)
  - No auto-persistence (FR-N008)
- AI Validation Service
  - Hallucination detection heuristics (FR-R004)
  - Uncertainty flagging with confidence indicators (FR-R005)
  - Response completeness checks (FR-R003)
- Prompt management and versioning
- Token/cost tracking and controls
- AI interaction logging (without sensitive content) (FR-Q017)
- Frontend: chat UI, will generator wizard, document analysis results

**Security Considerations**:
- All AI API calls server-side; keys never exposed to client (FR-R002)
- Document content sent to AI providers must be handled per privacy policy
- AI MUST NOT silently modify authoritative records (FR-R007)
- No fabricated references or guaranteed legal claims (FR-R008)
- Response validation before presenting to user
- Rate limiting on AI endpoints (cost control)
- Logging excludes sensitive document content

**Testing Requirements**:
- Unit tests: provider abstraction, prompt construction, validation logic
- Integration tests: assistant conversation flow, draft generation lifecycle
- API tests: all AI endpoints, confirmation gates, disclaimer presence
- AI validation tests: hallucination detection, uncertainty flagging
- Graceful degradation tests: provider outage simulation

**Completion Criteria**:
- Provider abstraction supports OpenAI and Gemini with hot-swap
- AI assistant provides helpful guidance with disclaimers
- Will generator produces drafts requiring user confirmation
- Document analysis detects information with confidence indicators
- All AI content clearly labeled; no auto-persistence
- Graceful degradation when providers unavailable

---

### Phase 9 — Video Legacy

**Purpose**: Implement video upload, encrypted storage, beneficiary assignment,
and controlled delivery.

**Dependencies**: Phase 4 (beneficiaries), Phase 5 (storage infrastructure),
Phase 6 (DMS delivery conditions)

**Major Modules**:
- Video upload with validation (FR-K001–FR-K002)
  - Format validation (MP4, WebM, MOV)
  - Size validation (max 500 MB)
  - Chunked upload for large files
- Encrypted storage (FR-K003)
- Metadata management (FR-K004)
- Beneficiary assignment (FR-K005)
- Delivery condition configuration (FR-K006)
  - Immediate upon trigger
  - After Dead Man Switch activation
  - Upon emergency access
- Access expiration (FR-K007)
- Audit logging (FR-K008)
- Frontend: upload UI, metadata editor, assignment manager, video player

**Security Considerations**:
- Videos encrypted at rest; decryption only on authorized access
- Chunked uploads validated reassembled
- Access tokens scoped to specific videos and beneficiaries
- Delivery condition enforcement on backend
- No direct file URL exposure

**Testing Requirements**:
- Unit tests: validation, encryption, delivery condition logic
- Integration tests: upload → encrypt → store → deliver lifecycle
- API tests: all video endpoints
- Security tests: unauthorized access, scope bypass

**Completion Criteria**:
- Videos upload, encrypt, and store successfully (up to 500 MB)
- Metadata and beneficiary assignment functional
- Delivery conditions enforced
- Access logged

---

### Phase 10 — Security Center & Administration

**Purpose**: Implement the Security Center dashboard and Super Admin
management interfaces.

**Dependencies**: Phase 1 (auth), Phase 2 (audit infrastructure)

**Major Modules**:
- Security Center (FR-O001–FR-O009)
  - Security status dashboard
  - Active session display with device/location info (FR-O002)
  - Session revocation (FR-O003)
  - Login history (FR-O004)
  - Password change with re-auth (FR-O005)
  - MFA management (enable, disable, backup codes) (FR-O006)
  - Suspicious activity alerts (FR-O007)
  - Security audit history (FR-O008)
  - Security score/indicators (FR-O009)
- Super Admin Dashboard (FR-P001–FR-P007, FR-P011–FR-P012)
  - User management (view, search, manage) (FR-P002)
  - Role assignment (Super Admin, User) (FR-P004)
  - Platform-wide audit logs (FR-P005)
  - System analytics (registrations, active users, storage) (FR-P006)
  - Support operations (unlock accounts, reset MFA) (FR-P007)
  - Admin action audit logging (FR-P011)
  - Server-side RBAC enforcement for admin routes (FR-P012)
- Frontend: Security Center pages, Admin dashboard with data tables,
  charts, and management forms

**Security Considerations**:
- Admin routes protected by RBAC middleware (Super Admin only)
- Backend authorization enforced; no frontend-only protection
- Session revocation invalidates server-side immediately
- Admin actions logged with full audit detail
- Admin cannot bypass resource-level user permissions (view content)

**Testing Requirements**:
- Unit tests: security score calculation, session management
- Integration tests: session revocation, admin user management
- API tests: all security and admin endpoints
- Authorization tests: non-admin access to admin routes blocked

**Completion Criteria**:
- Security Center displays sessions, history, and security settings
- Session revocation works end-to-end
- MFA management functional (enable, disable, backup codes)
- Super Admin can manage users, view logs, and perform support operations
- RBAC enforced on all admin routes

---

### Phase 11 — Notifications & UI Polish

**Purpose**: Implement the notification system and finalize UI/UX polish.

**Dependencies**: Phase 1–10 (all functional modules)

**Major Modules**:
- Notification abstraction layer
  - Email provider integration (nodemailer + configurable transport)
  - In-app notification system
  - Notification preferences (FR-B005)
- Notification events:
  - Authentication alerts (new device login, failed attempts)
  - Beneficiary invitation emails
  - Dead Man Switch check-in reminders
  - DMS escalation notifications
  - Emergency access request notifications
  - Document sharing notifications
  - Conditional release notifications
- Notification delivery tracking and retry with backoff
- UI/UX polish pass:
  - Dark-first theme refinement (UX-001–UX-004)
  - Glassmorphism and gradient effects (UX-003)
  - Framer Motion page transitions (UX-010)
  - GSAP complex animations (UX-006)
  - Micro-interactions (UX-011)
  - Skeleton screens and loading states (UX-012)
  - Empty states with guidance
  - Error states with actionable messages (UX-013)
  - Success confirmations (UX-014)
  - prefers-reduced-motion support (UX-009)
- Responsive layout refinement (desktop, tablet, mobile)

**Security Considerations**:
- Email content must not expose sensitive data in plaintext
- Notification tokens (e.g., email verification links) time-limited
- Delivery failures logged but do not block user workflows

**Testing Requirements**:
- Unit tests: notification service, email template rendering
- Integration tests: notification delivery pipeline
- UI tests: animation rendering, responsive breakpoints
- Accessibility tests: keyboard navigation, contrast ratios, screen readers

**Completion Criteria**:
- All notification events fire correctly
- Email delivery working with retry
- In-app notifications displayed and dismissible
- UI meets design system requirements (dark theme, glassmorphism, animations)
- Responsive across desktop, tablet, mobile
- prefers-reduced-motion respected

---

### Phase 12 — Testing & Hardening

**Purpose**: Comprehensive testing, security hardening, and performance
optimization.

**Dependencies**: Phase 0–11 (all features complete)

**Major Modules**:
- Complete unit test coverage for critical paths
- Integration test suites for all module interactions
- API test suite covering all endpoints
- Authorization test matrix (role × resource × operation)
- End-to-end tests for critical user journeys:
  - Registration → verification → onboarding
  - Create Will → finalize
  - Add beneficiary → assign assets → generate token
  - Upload document → set permissions → share
  - Configure DMS → check-in → miss → escalate → recover
  - Emergency access request → verify → grant → expire
  - AI assistant conversation
  - AI will generation → confirm
- Security-specific tests:
  - OWASP Top 10 coverage
  - Cross-user data isolation
  - Token security (expiry, scope, revocation)
  - File upload attack vectors
  - Rate limiting effectiveness
  - CSRF protection verification
- Performance testing:
  - API response times under load
  - Database query optimization
  - Frontend bundle analysis and optimization
  - Lazy loading verification
- Accessibility audit (automated + manual)
- Error handling review (no stack trace leaks)

**Security Considerations**:
- This phase IS the security consideration — comprehensive validation
- Penetration testing patterns applied
- All findings resolved before Phase 12 completion

**Testing Requirements**: This IS the testing phase.

**Completion Criteria**:
- All critical path tests passing
- Authorization matrix fully tested
- E2E tests passing for all critical journeys
- No OWASP Top 10 vulnerabilities found
- Performance meets NFR targets
- Accessibility audit passing (WCAG 2.1 AA)
- No stack trace or internal detail leaks in error responses
- Zero cross-user data exposure

---

### Phase 13 — Deployment & Production Readiness

**Purpose**: Configure production infrastructure, CI/CD, monitoring, and launch
preparation.

**Dependencies**: Phase 12 (testing complete)

**Major Modules**:
- Environment configuration:
  - Development environment (local)
  - Staging environment (cloud)
  - Production environment (cloud)
- CI/CD pipeline:
  - Build → test → lint → security scan → deploy
  - Automated testing on PR
  - Staging auto-deploy on main merge
  - Production deploy with manual approval
  - Rollback strategy
- Production security:
  - HTTPS/TLS for all traffic
  - Secure headers (HSTS, CSP, X-Frame-Options, etc.)
  - Rate limiting (API-level and route-level)
  - Secret management (cloud secret manager or equivalent)
  - Dependency scanning (npm audit, Snyk)
- Database operations:
  - Automated backups with configurable frequency
  - Backup verification
  - Disaster recovery plan
  - Migration strategy
- Monitoring and observability:
  - Structured log aggregation
  - Error monitoring and alerting
  - Health check endpoints
  - Uptime monitoring
  - Performance metrics
- Documentation finalization:
  - All planned docs completed or marked with current-phase status
  - API specification complete
  - Deployment runbook

**Security Considerations**:
- All production secrets in secure secret manager
- Environment isolation (no staging data in production, no production data in dev)
- Security scanning in CI pipeline
- Incident response procedures documented

**Testing Requirements**:
- Staging deployment smoke tests
- Production deployment verification
- Rollback procedure verification
- Backup/restore verification

**Completion Criteria**:
- All three environments operational
- CI/CD pipeline fully functional with security scanning
- Production deployed with HTTPS, secure headers, rate limiting
- Database backups running and verified
- Monitoring and alerting active
- Documentation complete for current phase
- Rollback procedure tested

---

## Documentation Plan

| Document | Create During | Description |
|----------|:------------:|-------------|
| `BRAIN.md` | ✅ Exists | Project knowledge — update incrementally |
| `PRD.md` | Phase 0 | Product requirements (derived from spec.md) |
| `FRD.md` | Phase 0 | Functional requirements (derived from spec.md) |
| `SYSTEM_ARCHITECTURE.md` | Phase 0 | Architecture overview, component diagrams |
| `DATABASE_SCHEMA.md` | Phase 2 | Entity details, relationships, indexes |
| `API_SPECIFICATION.md` | Phase 2 | Full endpoint documentation |
| `UI_UX_GUIDELINES.md` | Phase 0 | Design system, components, patterns |
| `FEATURES.md` | Phase 3+ | Feature documentation (incremental) |
| `BUSINESS_RULES.md` | Phase 3 | Allocation rules, DMS logic, access rules |
| `RBAC.md` | Phase 1 | Role definitions, permission matrix |
| `SECURITY.md` | Phase 1 | Security architecture, threat model |
| `AI_MODULE.md` | Phase 8 | AI architecture, prompts, validation |
| `DEPLOYMENT.md` | Phase 13 | Deployment procedures, runbooks |
| `ROADMAP.md` | Phase 0 | Release roadmap and phasing |
| `CHANGELOG.md` | Phase 0 | Change log (update per phase) |

## Complexity Tracking

No constitution violations detected. No complexity justifications required.
