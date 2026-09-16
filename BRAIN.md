# LegacyVault AI — Project Brain

> **Purpose**: Persistent high-level project context for all contributors and
> AI coding agents. This document is the runtime knowledge companion to the
> [constitution](./../.specify/memory/constitution.md). It MUST NOT contradict
> the constitution.
>
> **Last Updated**: 2025-09-16
>
> **Status Legend**:
> ✅ Completed | 🔧 In Progress | 📋 Planned | ⬜ Not Started | 🔍 Needs Review

---

## 1. Project Identity

| Field                  | Value                                                       |
|------------------------|-------------------------------------------------------------|
| **Project Name**       | LegacyVault AI                                              |
| **Product Category**   | AI-Powered Digital Legacy Platform                          |
| **Product Purpose**    | Enable users to securely organize, manage, protect, and transfer their digital and physical legacy to authorized beneficiaries |
| **Core Problem**       | Legacy planning is fragmented, insecure, legally ambiguous, and rarely digitized. Families lose access to assets, documents, and wishes when a loved one becomes incapacitated or passes away |
| **Target Users**       | Individuals planning their digital and physical legacy; families and beneficiaries receiving legacy information; organizations managing employee legacy programs |
| **Core Value Proposition** | A single, secure, AI-assisted platform that consolidates legacy planning — wills, assets, documents, beneficiaries, and final wishes — with intelligent automation, strong encryption, and legally informed (not legally binding) guidance |

---

## 2. Product Scope

All features listed below are **📋 Planned** unless otherwise indicated. No
application features have been implemented yet.

### Core Modules (Planned)

| Module                     | Description                                                                 | Status      |
|----------------------------|-----------------------------------------------------------------------------|-------------|
| Digital Will / Legacy Plan | Create, manage, and store structured legacy plans and will drafts           | 📋 Planned  |
| Beneficiary Management     | Add, edit, remove beneficiaries; assign allocations; define relationships   | 📋 Planned  |
| Financial Asset Management | Record and organize bank accounts, investments, insurance, retirement info  | 📋 Planned  |
| Physical Asset Management  | Record real estate, vehicles, valuables, and other physical property        | 📋 Planned  |
| Digital Asset Management   | Record online accounts, crypto wallets, digital subscriptions, domains      | 📋 Planned  |
| Secure Document Vault      | Upload, encrypt, organize, and permission-control sensitive documents       | 📋 Planned  |
| Dead Man Switch            | Automated inactivity detection and conditional information release          | 📋 Planned  |
| Emergency Access           | Controlled emergency access for designated contacts with verification      | 📋 Planned  |
| Video Legacy               | Record and store personal video messages for beneficiaries                  | 📋 Planned  |
| AI Assistant               | Conversational AI to guide users through legacy planning workflows         | 📋 Planned  |
| AI Will Generator          | AI-assisted will and legacy document drafting with user confirmation        | 📋 Planned  |
| AI Document Analysis       | AI-powered analysis and summarization of uploaded documents                 | 📋 Planned  |
| Security Center            | Dashboard for security settings, activity logs, session management         | 📋 Planned  |
| Admin Dashboard            | Super Admin and Organization Admin management interfaces                   | 📋 Planned  |

---

## 3. Current Repository State

**Inspected on**: 2025-09-16
**Git status**: No commits yet. Untracked files only.

### Actual Repository Structure

```
LegacyVault AI/
├── .agents/                          # AI agent skills (gitignored)
│   └── skills/
│       ├── speckit-analyze/SKILL.md
│       ├── speckit-checklist/SKILL.md
│       ├── speckit-clarify/SKILL.md
│       ├── speckit-constitution/SKILL.md
│       ├── speckit-converge/SKILL.md
│       ├── speckit-implement/SKILL.md
│       ├── speckit-plan/SKILL.md
│       ├── speckit-specify/SKILL.md
│       ├── speckit-tasks/SKILL.md
│       └── speckit-taskstoissues/SKILL.md
├── .gitignore                        # Contains: .agents/
├── .specify/                         # Spec Kit project infrastructure
│   ├── .gitignore                    # Ignores feature.json and local overrides
│   ├── init-options.json             # Spec Kit init config (agy, sequential)
│   ├── integration.json              # Agent integration config (agy)
│   ├── integrations/
│   │   ├── agy.manifest.json
│   │   └── speckit.manifest.json
│   ├── memory/
│   │   ├── .constitution-template.json
│   │   └── constitution.md           # ✅ Project constitution v1.0.0
│   ├── scripts/powershell/           # Spec Kit utility scripts
│   │   ├── check-prerequisites.ps1
│   │   ├── common.ps1
│   │   ├── create-new-feature.ps1
│   │   ├── resolve-template.ps1
│   │   ├── setup-plan.ps1
│   │   └── setup-tasks.ps1
│   ├── templates/                    # Spec Kit document templates
│   │   ├── checklist-template.md
│   │   ├── constitution-template.md
│   │   ├── plan-template.md
│   │   ├── spec-template.md
│   │   └── tasks-template.md
│   └── workflows/
│       ├── speckit/workflow.yml
│       └── workflow-registry.json
└── docs/
    └── BRAIN.md                      # 🔧 This document (being created now)
```

### What Actually Exists

| Item                         | Type              | Status        |
|------------------------------|-------------------|---------------|
| `.specify/` infrastructure   | Configuration     | ✅ Completed  |
| Constitution v1.0.0          | Governance doc    | ✅ Completed  |
| Spec Kit skills & templates  | Tooling           | ✅ Completed  |
| `docs/BRAIN.md`              | Documentation     | 🔧 In Progress |
| Application source code      | —                 | ⬜ Does not exist |
| `frontend/` directory        | —                 | ⬜ Does not exist |
| `backend/` directory         | —                 | ⬜ Does not exist |
| Database / schemas           | —                 | ⬜ Does not exist |
| Tests                        | —                 | ⬜ Does not exist |
| CI/CD                        | —                 | ⬜ Does not exist |
| Docker configuration         | —                 | ⬜ Does not exist |
| Environment files            | —                 | ⬜ Does not exist |

> **Important**: No application code, frontend, backend, database, API, or
> feature implementation exists. The repository currently contains only
> governance tooling and documentation infrastructure.

---

## 4. Architecture

> **Status**: 📋 Planned — no application code exists yet.

### Planned Directory Structure

```
LegacyVault AI/
├── frontend/                  # Next.js application
│   ├── src/
│   │   ├── app/               # Next.js App Router pages
│   │   ├── components/        # Reusable UI components
│   │   ├── hooks/             # Custom React hooks
│   │   ├── lib/               # Client utilities and helpers
│   │   ├── services/          # API client services
│   │   ├── store/             # State management
│   │   ├── styles/            # Global styles and theme
│   │   └── types/             # TypeScript type definitions
│   ├── public/                # Static assets
│   ├── next.config.ts
│   ├── tailwind.config.ts
│   ├── tsconfig.json
│   └── package.json
├── backend/                   # Express.js API server
│   ├── src/
│   │   ├── controllers/       # Request handling, response formatting
│   │   ├── services/          # Business logic layer
│   │   ├── repositories/      # Data access layer (models)
│   │   ├── routes/            # Route definitions (/api/v1/...)
│   │   ├── middleware/        # Auth, validation, error handling, rate limiting
│   │   ├── validators/        # Zod schemas for request validation
│   │   ├── config/            # App configuration (env, constants)
│   │   ├── utils/             # Shared utilities
│   │   ├── ai/                # AI provider abstraction and services
│   │   │   ├── providers/     # OpenAI, Gemini provider implementations
│   │   │   └── services/      # AI-powered feature services
│   │   └── types/             # TypeScript type definitions
│   ├── tsconfig.json
│   └── package.json
├── docs/                      # Project documentation
├── assets/                    # Design assets, images, icons
├── docker/                    # Docker and docker-compose files
├── scripts/                   # Build, deploy, and utility scripts
├── .github/                   # GitHub Actions, issue templates, PR templates
├── .specify/                  # Spec Kit infrastructure (exists)
└── .agents/                   # AI agent skills (gitignored, exists)
```

### Technology Stack (Planned)

| Layer          | Technology                                                        | Status      |
|----------------|-------------------------------------------------------------------|-------------|
| Frontend       | Next.js (App Router), TypeScript, Tailwind CSS, shadcn/ui         | 📋 Planned  |
| Animations     | Framer Motion, GSAP                                               | 📋 Planned  |
| Backend        | Node.js, Express.js, TypeScript                                   | 📋 Planned  |
| Validation     | Zod                                                               | 📋 Planned  |
| AI Providers   | OpenAI, Google Gemini (via provider-abstraction layer)            | 📋 Planned  |
| Database       | PostgreSQL 16+ (via Prisma ORM)                                   | ✅ Decided  |
| File Storage   | S3-compatible object storage (AWS S3; MinIO for local dev)        | ✅ Decided  |
| Authentication | Session-based with httpOnly cookies; TOTP MFA via speakeasy      | ✅ Decided  |
| API Style      | Versioned REST (`/api/v1/...`)                                    | 📋 Planned  |
| Cache / Queue  | Redis (sessions in prod, BullMQ job queues)                       | ✅ Decided  |
| Email          | Nodemailer with configurable transport (SMTP dev, SendGrid/SES prod) | ✅ Decided |
| Deployment     | Undecided                                                         | ⬜ Undecided |

### Backend Architecture Pattern (Planned)

```
Request → Route → Middleware (auth, rate limit, validation)
       → Controller (request/response handling)
       → Service (business logic)
       → Repository (data access)
       → Database
```

- Business logic MUST live in the service layer, not in controllers or routes.
- AI operations flow through the AI provider-abstraction layer.
- All sensitive operations pass through authentication and authorization
  middleware before reaching controllers.

---

## 5. Data Architecture

> **Status**: ✅ Decided — PostgreSQL 16+ selected. See `specs/001-baseline-product-spec/research.md` for decision rationale.

### Database Selection

**Decided**: PostgreSQL 16+ with Prisma ORM.

| Decision                     | Status        | Notes                                    |
|------------------------------|---------------|------------------------------------------|
| Primary database engine      | ✅ Decided    | PostgreSQL 16+ (ACID, JSONB, pgcrypto)   |
| ORM / query builder          | ✅ Decided    | Prisma (type-safe, migration management) |
| File storage provider        | ✅ Decided    | S3-compatible (AWS S3 prod, MinIO dev)   |
| Cache layer                  | ✅ Decided    | Redis (sessions in prod, job queues)     |
| Search engine                | ⬜ Undecided  | If needed for document search            |

### Planned Data Domains

These are logical data domains derived from the product scope. No tables,
collections, or schemas have been created.

| Domain                | Key Concepts                                                    |
|-----------------------|-----------------------------------------------------------------|
| Users                 | Registration, profile, authentication credentials, preferences  |
| Organizations         | Multi-tenant groupings (if applicable)                          |
| Beneficiaries         | People designated to receive legacy information and assets      |
| Assets — Financial    | Bank accounts, investments, insurance, retirement accounts      |
| Assets — Physical     | Real estate, vehicles, valuables, personal property             |
| Assets — Digital      | Online accounts, crypto, subscriptions, domains, social media   |
| Documents             | Uploaded files with encryption, permissions, and metadata       |
| Legacy Plans / Wills  | Structured legacy plans, AI-generated will drafts               |
| Video Messages        | Recorded video messages for beneficiaries                       |
| Dead Man Switch       | Inactivity rules, check-in schedules, trigger conditions        |
| Emergency Access      | Emergency contacts, verification requirements, access logs      |
| Audit Logs            | Security events, data access, permission changes                |
| AI Interactions       | AI conversation history, generated drafts, user confirmations   |
| Notifications         | System notifications, alerts, reminders                         |
| Sessions              | Active sessions, tokens, device tracking                        |

### Storage Requirements (from Constitution)

- Sensitive data at rest: AES-256 encryption or equivalent.
- Data in transit: TLS 1.2+ for all connections.
- Files: Private access controls, no public bucket access.
- Time-limited access via signed URLs where appropriate.
- Encryption keys managed separately from the data they protect.

---

## 6. Security Model

> **Status**: 📋 Planned — derived from the constitution. Nothing implemented.

### Summary of Security Requirements

| Category                  | Requirement                                                          | Constitution Ref |
|---------------------------|----------------------------------------------------------------------|------------------|
| Authentication            | Strong authentication, MFA support                                   | Principle III    |
| Session Management        | Secure tokens, expiry, rotation, revocation                          | Principle III    |
| Authorization             | Server-side enforcement on every protected resource                   | Principle III    |
| RBAC                      | Super Admin, Org Admin, Team Manager, Employee/User                  | Principle III    |
| Encryption at Rest        | AES-256 or equivalent for sensitive data                             | Principle IV     |
| Encryption in Transit     | TLS 1.2+ on all connections                                         | Principle IV     |
| Key Management            | Keys stored separately, not hard-coded                               | Principle IV     |
| File Storage              | Private access, signed URLs, no public buckets                       | Principle IV     |
| Input Validation          | Server-side schema validation (Zod), all untrusted input             | Principle X      |
| API Security              | Protection against injection, XSS, CSRF, IDOR, brute force          | Principle XI     |
| Rate Limiting             | Auth endpoints, sensitive operations, public APIs                    | Principle XI     |
| File Upload Security      | Type, size, extension, magic byte validation; malware scanning       | Principle XI     |
| Audit Logging             | Tamper-resistant logs for all security/legal events                   | Principle XII    |
| Secrets Management        | No secrets in source code or committed `.env` files                  | Principles I, IV |
| Privacy                   | Data minimization, no cross-user exposure, no prod data in dev       | Principle II     |
| Error Handling            | No stack traces, internal details, or secrets leaked to clients      | Principle X      |
| Observability             | Structured logging without logging sensitive data                    | Principle XVI    |
| Secure Headers            | HSTS, CSP, X-Frame-Options in production                            | Principle XXI    |

### Security Architecture (Planned)

```
Client Request
  │
  ├── TLS 1.2+ (in transit)
  │
  ├── Rate Limiter
  │
  ├── Secure Headers Middleware
  │
  ├── Authentication Middleware
  │     └── Token validation, session verification
  │
  ├── Authorization Middleware
  │     └── RBAC check, resource-level permissions
  │
  ├── Input Validation Middleware
  │     └── Zod schema validation
  │
  ├── Controller → Service → Repository
  │     └── Business logic with encryption/decryption
  │
  ├── Audit Logger
  │     └── Records actor, action, resource, timestamp, outcome
  │
  └── Error Handler
        └── Safe error responses, no internal details
```

---

## 7. AI Architecture

> **Status**: 📋 Planned — no AI code exists yet.

### Provider Abstraction (Planned)

```
AI Service Interface (abstract)
  ├── OpenAI Provider
  └── Google Gemini Provider
```

- All AI provider API keys MUST remain server-side.
- Provider implementations MUST be interchangeable without affecting business
  logic.
- Provider selection MUST be configurable (environment/config, not hard-coded).

### Planned AI Features

| Feature                  | Description                                                           | Status      |
|--------------------------|-----------------------------------------------------------------------|-------------|
| AI Assistant             | Conversational guide for legacy planning workflows                    | 📋 Planned  |
| AI Will Generator        | Drafts will/legacy documents from user inputs and templates           | 📋 Planned  |
| Document Analysis        | Analyzes uploaded documents, extracts key information, summarizes     | 📋 Planned  |
| Recommendations          | Suggests beneficiary allocations, coverage gaps, improvements         | 📋 Planned  |
| Validation               | Validates completeness of legacy plans and asset records              | 📋 Planned  |

### AI Safety Requirements (from Constitution)

| Requirement                         | Constitution Ref |
|-------------------------------------|------------------|
| Hallucination detection and flagging | Principle VI     |
| Uncertainty communication           | Principle VI     |
| User confirmation before persistence | Principle VI     |
| No representation as legal advice    | Principle V      |
| No silent modification of legal records | Principle V   |
| Response validation where practical  | Principle VI     |
| Confidence/uncertainty indicators    | Principle VI     |

---

## 8. Core Business Rules

> **Status**: 📋 Planned — derived from constitution and product scope.
> No business logic is implemented.

### Beneficiary Rules (Planned)

- Each user MAY designate one or more beneficiaries.
- Beneficiary allocation percentages MUST follow defined business rules.
- Total allocation across beneficiaries for a given asset or category MUST
  NOT exceed 100%.
- Beneficiary changes MUST be audited.
- Users MUST confirm beneficiary designations before they become authoritative.

### Asset Ownership (Planned)

- Assets belong to the creating user.
- Asset records MAY be shared with specific beneficiaries under defined
  permission rules.
- Asset data MUST be encrypted at rest.

### Document Permissions (Planned)

- Document access permissions MUST be enforced server-side.
- Permissions: owner (full control), designated beneficiary (view if granted),
  emergency contact (view under emergency access conditions).
- Permission changes MUST be audited.

### Dead Man Switch (Planned)

- User defines an inactivity period and check-in schedule.
- System sends periodic check-in notifications.
- If user fails to respond within the defined window, triggers escalation.
- Escalation sequence: reminder → secondary reminder → trusted contact
  notification → conditional information release.
- MUST include recovery mechanisms to cancel false triggers.
- MUST include verification safeguards to confirm user identity on check-in.
- Dead Man Switch events MUST be audited.

### Emergency Access (Planned)

- Designated emergency contacts may request access under defined conditions.
- Emergency access MUST require multi-step verification.
- Access scope is limited to what the user has explicitly authorized.
- All emergency access events MUST be audited.
- Users MUST be notified of emergency access requests and grants.

### User Confirmation (Planned)

- AI-generated content (wills, summaries, recommendations) MUST NOT be
  persisted as authoritative records without explicit user confirmation.
- Beneficiary designations MUST require user confirmation.
- Legal/legacy documents MUST be explicitly finalized by the user.

### Auditability (Planned)

All of the following events MUST be logged with actor, timestamp, action,
resource, and outcome:

- Authentication events (login, logout, failed attempts, MFA)
- Document access and modifications
- Permission changes
- Beneficiary changes
- Emergency access requests and grants
- Dead Man Switch triggers and cancellations
- AI-generated content confirmations
- Admin actions (role changes, user management)

---

## 9. UI/UX System

> **Status**: 📋 Planned — no UI code exists yet.

### Design Direction (from Constitution Principle XIII)

| Aspect                 | Specification                                                  |
|------------------------|----------------------------------------------------------------|
| Visual System          | Dark-first with light mode support                             |
| Style                  | Glassmorphism, subtle gradients, restrained visual effects     |
| Color Palette          | Blue / purple / cyan accents on dark backgrounds               |
| Typography             | Strong, modern, high-contrast type hierarchy                   |
| Animation Libraries    | Framer Motion (React), GSAP (complex sequences)               |
| Animation Philosophy   | Meaningful and purposeful; enhances comprehension and trust    |
| Motion Preferences     | MUST respect `prefers-reduced-motion`                          |
| Accessibility          | WCAG 2.1 AA minimum; semantic HTML; keyboard navigation        |
| Responsiveness         | Desktop, tablet, and mobile breakpoints                        |
| Component Library      | shadcn/ui as foundation, customized to design system           |
| State Communication    | Clear loading states, error states, confirmations              |

### Design Constraints

- Animations MUST NOT compromise accessibility, performance, usability, or
  security.
- MUST NOT rely solely on color to communicate state.
- Interactive elements MUST have sufficient contrast and focus indicators.
- Premium, futuristic aesthetic that inspires trust for sensitive legal-tech
  workflows.

---

## 10. Roles and Permissions

> **Status**: 📋 Planned — no RBAC implementation exists yet.

### Planned Role Hierarchy

| Role                | Scope                 | Key Permissions                                      |
|---------------------|-----------------------|------------------------------------------------------|
| Super Admin         | Platform-wide         | Full system access, user management, org management, system config |
| Organization Admin  | Organization-scoped   | Manage org members, view org-level reports, org settings |
| Team Manager        | Team-scoped           | Manage team members, view team activity              |
| Employee / User     | Self-scoped           | Manage own legacy data, beneficiaries, documents, settings |

### Permission Principles (from Constitution)

- All authorization MUST be enforced server-side (Principle III).
- Frontend route guards are UX affordances only, not security controls.
- Document-level permissions MUST be enforced independently of role
  (Principle VII).
- Permission changes MUST be audited (Principle XII).

### Undecided Items

| Item                                    | Status        |
|-----------------------------------------|---------------|
| Granular permission model (ABAC vs RBAC) | ⬜ Undecided  |
| Organization/multi-tenancy model details | ⬜ Undecided  |
| Role assignment and management UI        | 📋 Planned    |
| Permission inheritance rules             | ⬜ Undecided  |

---

## 11. Documentation Map

| Document                          | Purpose                                        | Status        |
|-----------------------------------|-------------------------------------------------|---------------|
| `docs/BRAIN.md`                   | High-level project context (this file)          | 🔧 In Progress |
| `docs/PRD.md`                     | Product Requirements Document                   | ⬜ Not Started |
| `docs/FRD.md`                     | Functional Requirements Document                 | ⬜ Not Started |
| `docs/SYSTEM_ARCHITECTURE.md`    | Detailed system architecture                     | ⬜ Not Started |
| `docs/DATABASE_SCHEMA.md`        | Database schema definitions                      | ⬜ Not Started |
| `docs/API_SPECIFICATION.md`      | API endpoint documentation                       | ⬜ Not Started |
| `docs/UI_UX_GUIDELINES.md`       | Design system and UI/UX standards                | ⬜ Not Started |
| `docs/FEATURES.md`               | Feature catalog with status tracking             | ⬜ Not Started |
| `docs/BUSINESS_RULES.md`         | Detailed business rules documentation            | ⬜ Not Started |
| `docs/RBAC.md`                   | Role and permission definitions                  | ⬜ Not Started |
| `docs/SECURITY.md`               | Security policies and implementation guide       | ⬜ Not Started |
| `docs/AI_MODULE.md`              | AI architecture and integration guide            | ⬜ Not Started |
| `docs/DEPLOYMENT.md`             | Deployment procedures and environment setup      | ⬜ Not Started |
| `docs/ROADMAP.md`                | Development phases and milestones                | ⬜ Not Started |
| `docs/CHANGELOG.md`              | Version history and change tracking              | ⬜ Not Started |
| `.specify/memory/constitution.md` | Engineering constitution (governance)            | ✅ Completed   |

---

## 12. Development Workflow

All significant features MUST follow Spec-Driven Development as defined in
Constitution Principle XX.

### Workflow Stages

```
Constitution → Specification → Clarification → Plan → Checklist
→ Tasks → Analysis → Implementation → Convergence
```

| Stage          | Tool / Command         | Output                               |
|----------------|------------------------|--------------------------------------|
| Constitution   | `/speckit-constitution` | `.specify/memory/constitution.md`    |
| Specification  | `/speckit-specify`      | `specs/<feature>/spec.md`            |
| Clarification  | `/speckit-clarify`      | Updated spec with resolved questions |
| Plan           | `/speckit-plan`         | `specs/<feature>/plan.md`            |
| Checklist      | `/speckit-checklist`    | `specs/<feature>/checklists/*.md`    |
| Tasks          | `/speckit-tasks`        | `specs/<feature>/tasks.md`           |
| Analysis       | `/speckit-analyze`      | Cross-artifact consistency report    |
| Implementation | `/speckit-implement`    | Application source code              |
| Convergence    | `/speckit-converge`     | Validation against specification     |

### Rules

- Trivial changes MAY skip intermediate steps.
- Security-sensitive or architecturally significant work MUST NOT skip steps.
- Implementation MUST NOT begin without an approved specification and plan.
- Features MUST be validated against their specification before being declared
  complete.

---

## 13. Current Status

| Area                        | Status        | Notes                                      |
|-----------------------------|---------------|--------------------------------------------|
| Repository initialized      | ✅ Completed  | Git repo, `.gitignore`                     |
| Spec Kit initialized         | ✅ Completed  | `.specify/`, templates, scripts, workflows |
| Agent skills installed       | ✅ Completed  | `.agents/skills/speckit-*`                 |
| Constitution ratified        | ✅ Completed  | v1.0.0, 22 principles                     |
| BRAIN.md created             | 🔧 In Progress | This document                             |
| Product requirements         | ⬜ Not Started | `docs/PRD.md` does not exist               |
| Feature specifications       | ⬜ Not Started | No `specs/` directory exists               |
| Frontend application         | ⬜ Not Started | No `frontend/` directory exists            |
| Backend application          | ⬜ Not Started | No `backend/` directory exists             |
| Database schema              | ⬜ Not Started | No database chosen or configured           |
| API implementation           | ⬜ Not Started | No API code exists                         |
| AI integration               | ⬜ Not Started | No AI code exists                          |
| Authentication system        | ⬜ Not Started | No auth code exists                        |
| UI/UX design system          | ⬜ Not Started | No design tokens or components exist       |
| Testing infrastructure       | ⬜ Not Started | No tests exist                             |
| CI/CD pipeline               | ⬜ Not Started | No `.github/workflows/` exists             |
| Docker configuration         | ⬜ Not Started | No `docker/` directory exists              |
| Deployment setup             | ⬜ Not Started | No deployment configuration exists         |

---

## 14. Important Decisions

### Confirmed Decisions

| Decision                              | Choice                                            | Source         |
|---------------------------------------|---------------------------------------------------|----------------|
| Frontend framework                    | Next.js (App Router) with TypeScript              | Constitution VIII |
| CSS framework                         | Tailwind CSS with shadcn/ui                       | Constitution VIII |
| Animation libraries                   | Framer Motion + GSAP                              | Constitution XIII |
| Backend framework                     | Express.js with TypeScript                        | Constitution VIII |
| API style                             | Versioned REST (`/api/v1/...`)                    | Constitution VIII |
| AI providers                          | OpenAI + Google Gemini (via abstraction)          | Constitution VI |
| Validation library                    | Zod (or equivalent)                               | Constitution X |
| Development methodology               | Spec-Driven Development                           | Constitution XX |
| Agent integration                     | Antigravity (agy)                                 | `.specify/init-options.json` |
| Feature numbering                     | Sequential (NNN)                                  | `.specify/init-options.json` |
| Visual design system                  | Dark-first, glassmorphism, blue/purple/cyan       | Constitution XIII |
| Security priority                     | Security > Integrity > Correctness > ... > Polish | Constitution XXII |

### Undecided / Pending Decisions

| Decision                              | Options Under Consideration                       | Status         |
|---------------------------------------|---------------------------------------------------|----------------|
| Database engine                       | **PostgreSQL 16+**                                | ✅ Decided     |
| ORM / data access library             | **Prisma**                                        | ✅ Decided     |
| File storage provider                 | **S3-compatible (AWS S3 prod, MinIO dev)**        | ✅ Decided     |
| Authentication provider / method      | **Session-based, httpOnly cookies, speakeasy MFA**| ✅ Decided     |
| Email / notification service          | **Nodemailer (SMTP dev, SendGrid/SES prod)**      | ✅ Decided     |
| Hosting / deployment platform         | Vercel, AWS, GCP, self-hosted, etc.               | ⬜ Undecided   |
| Cache layer                           | **Redis**                                         | ✅ Decided     |
| Encryption implementation details     | **AES-256-GCM, Node.js crypto, keys from env**   | ✅ Decided     |
| Multi-tenancy model                   | Deferred to future specification                  | ⏸️ Deferred    |
| Video storage / streaming approach    | **S3 multipart upload, encrypted at rest**        | ✅ Decided     |
| Malware scanning integration          | Pluggable interface (noop dev, real prod)          | 📋 Planned    |

---

## 15. Known Risks

| Risk                               | Severity | Mitigation Strategy                                   |
|------------------------------------|----------|-------------------------------------------------------|
| Legal validity concerns            | High     | Clearly disclaim AI output as informational, not legal advice; require user confirmation; recommend professional legal review |
| Sensitive data exposure             | Critical | Encryption at rest/transit, RBAC, audit logging, private storage, no cross-user data exposure |
| AI hallucination in legal context   | High     | Hallucination detection, confidence indicators, mandatory user confirmation before persistence |
| Unauthorized beneficiary access     | Critical | Server-side permission enforcement, audit logging, multi-factor verification |
| Unauthorized document access        | Critical | Document-level permissions enforced server-side, signed URLs, encryption |
| Dead Man Switch false trigger       | High     | Multi-step escalation, recovery mechanisms, identity verification on check-in |
| Emergency access abuse              | High     | Multi-step verification, limited scope, full audit trail, user notification |
| Insecure file uploads               | High     | Type/size/extension/magic-byte validation, malware scanning hooks |
| Secrets leakage                     | Critical | No secrets in source control, server-side API keys, secure env management |
| Data loss                           | Critical | Database backups, disaster recovery procedures, transactional integrity |
| Vendor / API dependency             | Medium   | AI provider abstraction layer enables provider switching; avoid deep coupling to any single vendor |
| Regulatory compliance               | Medium   | Data minimization, privacy-by-design; specific regulatory requirements (GDPR, etc.) to be determined |

---

## 16. Roadmap

> **Status**: 📋 Proposed — not yet formally approved or scheduled.

### Phase 0: Foundation (Current)

- [x] Initialize repository
- [x] Set up Spec Kit project infrastructure
- [x] Ratify engineering constitution
- [x] Create BRAIN.md (this document)
- [ ] Establish detailed product requirements (`docs/PRD.md`)
- [ ] Make pending technology decisions (database, auth, hosting)

### Phase 1: Core Infrastructure

- [ ] Initialize frontend (Next.js) and backend (Express.js) projects
- [ ] Set up TypeScript, linting, formatting, and build configuration
- [ ] Implement authentication and session management
- [ ] Implement RBAC framework
- [ ] Set up database with initial schema
- [ ] Implement centralized error handling and validation middleware
- [ ] Set up audit logging infrastructure
- [ ] Set up CI/CD pipeline
- [ ] Create design system and base UI components

### Phase 2: Core Features

- [ ] User profile and settings
- [ ] Beneficiary management
- [ ] Financial asset management
- [ ] Physical asset management
- [ ] Digital asset management
- [ ] Secure document vault (upload, encrypt, permission)

### Phase 3: AI Integration

- [ ] AI provider abstraction layer
- [ ] AI assistant (conversational legacy planning)
- [ ] AI Will Generator with user confirmation workflow
- [ ] AI document analysis and summarization

### Phase 4: Advanced Features

- [ ] Digital Will / Legacy Plan builder
- [ ] Dead Man Switch implementation
- [ ] Emergency access workflow
- [ ] Video Legacy (record, store, deliver)
- [ ] Security Center dashboard

### Phase 5: Admin and Operations

- [ ] Super Admin dashboard
- [ ] Organization Admin functionality
- [ ] Production monitoring and alerting
- [ ] Malware scanning integration
- [ ] Database backup and disaster recovery

### Phase 6: Production Hardening

- [ ] Security audit and penetration testing
- [ ] Performance optimization
- [ ] Accessibility audit (WCAG 2.1 AA)
- [ ] Production deployment with HTTPS, secure headers, WAF
- [ ] Documentation completion

> **Note**: This roadmap is a proposed logical ordering. Phases may overlap or
> be reordered based on product priorities and resource availability. Each
> phase's features should go through the Spec-Driven Development workflow
> before implementation.

---

## 17. AI Agent Rules

All AI coding agents working on the LegacyVault AI repository MUST follow
these rules:

1. **Read governance first**: Read the
   [constitution](./../.specify/memory/constitution.md) and this `BRAIN.md`
   before beginning any significant work.

2. **Inspect before modifying**: Examine existing code, directory structure,
   and dependencies before making changes. Do not assume the state of the
   codebase.

3. **Follow the specification**: Do not implement features without an approved
   specification and plan. Follow the Spec-Driven Development workflow.

4. **Avoid unnecessary rewrites**: Prefer targeted modifications over full
   module rewrites. Preserve working functionality.

5. **Never invent implementation status**: Do not claim a feature is
   implemented unless the codebase confirms it. Do not fabricate test results
   or deployment status.

6. **Protect secrets**: Never include API keys, credentials, encryption keys,
   private keys, or sensitive configuration in source code, commits, or logs.

7. **Preserve security boundaries**: Do not bypass authentication,
   authorization, encryption, or validation to "simplify" implementation.
   Security is non-negotiable.

8. **Update documentation**: When architecture, business rules, API contracts,
   or data schemas change, update the relevant documentation (`BRAIN.md` and
   other `docs/` files) to reflect the current state.

9. **Respect the decision-making hierarchy**: When requirements conflict,
   follow the priority order: Security → Integrity → Correctness →
   Legal-Tech Safety → Maintainability → Accessibility → Performance →
   Visual Polish.

10. **Mark uncertainty**: If a decision has not been made, mark it as
    undecided. If a feature is planned but not built, mark it as planned.
    Never guess or assume.

---

*This document is a living reference. Update it as the project evolves.
Last verified against repository state: 2025-09-16.*
